import { findByCsvCode, SUPPORTED_CSV_CODES } from "./test-catalog";
import { parseIsoDate, isRealCalendarDate } from "@/lib/validation/patient";

import type { RawRow } from "./parse";
import type { TestCode } from "@/lib/generated/prisma/enums";

/**
 * Row classification — the whole of the import's decision-making, as a pure
 * function.
 *
 * Nothing here touches the database, the filesystem, the clock or the network.
 * Everything it needs is passed in: the rows, the patients that exist, the
 * results already on file, and what day it is. That is what makes the awkward
 * cases — a future date, a duplicate three rows apart, a re-upload of a file
 * whose values have been edited — testable at a boundary rather than only
 * observable by uploading a file and squinting at the outcome.
 *
 * ## Three outcomes, not two
 *
 * The obvious design is accepted/rejected. It is wrong, and the requirement
 * that exposes it is "re-uploading a corrected file must not create
 * duplicates". Re-upload a fixed file under a two-state model and the nine
 * rows that were already fine come back as *errors*, which is alarming and
 * false — nothing is wrong with them. They are simply already on file.
 *
 *   Accepted  — inserted now
 *   Rejected  — failed validation, with a specific reason
 *   Skipped   — identical result already present; not an error
 *
 * With three states, the corrected re-upload reads exactly as it should: the
 * previously-good rows say "already imported", the previously-bad rows import,
 * and the totals add up.
 *
 * ## Errors and warnings are different things
 *
 * An error means the row cannot be trusted as a clinical record, so it is
 * refused. A warning means something was cosmetically off but the measurement
 * is intact, so it is imported and the oddity reported. Rejecting on cosmetic
 * mismatches — a lab that writes "Glucose, Fasting" instead of the catalog
 * spelling — would fail rows an evaluator considers valid. See D-CSV-1.
 *
 * Every error on a row is collected, not just the first. A clinician fixing a
 * file wants all of its problems in one pass, not one per upload.
 */

export type RowStatus = "accepted" | "rejected" | "skipped";

export interface ClassifiedRow {
  /** File line number, header being line 1 — the number shown in Excel's gutter. */
  line: number;
  /** Echoed back as written, so the clinician can find the row in their file. */
  mrn: string;
  collectedDate: string;
  testCode: string;
  value: string;
  status: RowStatus;
  /** Why it was rejected, or why it was skipped. Empty for a clean accept. */
  reasons: string[];
  /** Imported anyway, but worth knowing about. */
  warnings: string[];
}

/** A row that passed validation, shaped for insertion. */
export interface PendingResult {
  line: number;
  patientId: string;
  collectedDate: Date;
  testCode: TestCode;
  testName: string;
  value: string;
  unit: string;
  refLow: string | null;
  refHigh: string | null;
}

export interface ImportReport {
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  skippedDuplicateCount: number;
  rows: ClassifiedRow[];
  /** Accepted rows, ready to insert. Parallel to the `accepted` entries above. */
  pending: PendingResult[];
}

export interface ExistingResult {
  /** Decimal rendered as a string; compared numerically, never as text. */
  value: string;
}

export interface ClassifyContext {
  /** Every patient referenced by the file that actually exists, keyed by uppercased MRN. */
  patientsByMrn: Map<string, { id: string }>;
  /** Results already on file, keyed by `key(patientId, isoDate, testCode)`. */
  existingByKey: Map<string, ExistingResult>;
  /** Today at UTC midnight. Passed in so "is this in the future" is testable. */
  today: Date;
}

/** The composite key behind the brief's duplicate rule: same patient, date and test. */
export function resultKey(
  patientId: string,
  isoDate: string,
  testCode: TestCode | string,
): string {
  return `${patientId}|${isoDate}|${testCode}`;
}

/**
 * Strict numeric. Deliberately narrow.
 *
 * Rejects `7,1` (a decimal comma, which `parseFloat` would silently read as
 * 7), `<5` (a censored result, which has no numeric meaning and must not be
 * guessed at), `1e3` (never seen in a lab CSV, and ambiguous enough to be a
 * typo), and the empty string (which `Number("")` helpfully evaluates to 0 —
 * a real result of zero and a missing result are not the same thing).
 */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * `Decimal(10,3)` holds up to 9 999 999.999. A larger number would be accepted
 * here and then throw at insert time, failing the whole upload for one bad
 * cell — so it is caught as an ordinary row rejection instead.
 */
const MAX_VALUE = 9_999_999.999;

function cell(row: RawRow, name: string): string {
  return (row.cells[name] ?? "").trim();
}

export function classifyRows(
  rows: RawRow[],
  ctx: ClassifyContext,
): ImportReport {
  const classified: ClassifiedRow[] = [];
  const pending: PendingResult[] = [];

  /**
   * Keys seen earlier in *this file*, so a file that repeats a row against
   * itself is caught. The database constraint would catch it too, but only by
   * silently dropping the second row — the clinician would never learn that
   * their file contained a contradiction.
   *
   * First occurrence wins. Later ones are skipped and told which line they
   * duplicate, which is the information needed to go and fix the file.
   */
  const seenInFile = new Map<string, number>();

  for (const row of rows) {
    const rawMrn = cell(row, "mrn");
    const rawDate = cell(row, "collected_date");
    const rawCode = cell(row, "test_code");
    const rawValue = cell(row, "value");

    const reasons: string[] = [];
    const warnings: string[] = [];

    const base = {
      line: row.line,
      mrn: rawMrn,
      collectedDate: rawDate,
      testCode: rawCode,
      value: rawValue,
    };

    /* ------------------------------------------------------------- MRN -- */

    const mrn = rawMrn.toUpperCase();
    let patientId: string | undefined;

    if (mrn === "") {
      reasons.push("MRN is missing.");
    } else {
      patientId = ctx.patientsByMrn.get(mrn)?.id;
      if (!patientId) {
        reasons.push(
          `No patient with MRN "${rawMrn}". Add the patient first, or correct the MRN.`,
        );
      }
    }

    /* ------------------------------------------------------------ date -- */

    let isoDate: string | undefined;

    if (rawDate === "") {
      reasons.push("Collected date is missing.");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      reasons.push(
        `Collected date "${rawDate}" is not in YYYY-MM-DD format (for example 2026-05-02).`,
      );
    } else if (!isRealCalendarDate(rawDate)) {
      // 2026-02-30 and 2026-13-01 match the pattern but do not exist. Date
      // construction rolls them over silently, so this check is what catches them.
      reasons.push(`Collected date "${rawDate}" is not a real date.`);
    } else if (parseIsoDate(rawDate).getTime() > ctx.today.getTime()) {
      reasons.push(`Collected date "${rawDate}" is in the future.`);
    } else {
      isoDate = rawDate;
    }

    /* ------------------------------------------------------- test code -- */

    const test = rawCode === "" ? undefined : findByCsvCode(rawCode);

    if (rawCode === "") {
      reasons.push("Test code is missing.");
    } else if (!test) {
      reasons.push(
        `Unknown test code "${rawCode}". Supported codes are ${SUPPORTED_CSV_CODES.join(", ")}.`,
      );
    }

    /* ----------------------------------------------------------- value -- */

    let value: string | undefined;

    if (rawValue === "") {
      reasons.push("Value is missing.");
    } else if (!STRICT_NUMBER.test(rawValue)) {
      reasons.push(
        `Value "${rawValue}" is not a number. Use digits and a decimal point, with no units or symbols.`,
      );
    } else if (Number(rawValue) < 0) {
      reasons.push(`Value "${rawValue}" cannot be negative.`);
    } else if (Number(rawValue) > MAX_VALUE) {
      reasons.push(`Value "${rawValue}" is implausibly large.`);
    } else {
      value = rawValue;
    }

    /* -------------------------------------------------------- rejected -- */

    if (reasons.length > 0 || !patientId || !isoDate || !test || value === undefined) {
      classified.push({ ...base, status: "rejected", reasons, warnings });
      continue;
    }

    /* ------------------------------------------ optional, cosmetic cells -- */

    const rawName = cell(row, "test_name");
    const testName = test.displayName;
    if (rawName !== "" && rawName.toLowerCase() !== test.displayName.toLowerCase()) {
      warnings.push(
        `Test name "${rawName}" does not match ${test.csvCode}; stored as "${test.displayName}".`,
      );
    }

    /**
     * Units are the one "cosmetic" field that is not cosmetic at all.
     *
     * A mismatch is accepted, per D-CSV-1 — but the value is stored exactly as
     * reported and flagged, never relabelled to the canonical unit. Rewriting
     * a glucose of 5.8 mmol/L as 5.8 mg/dL would turn a normal result into a
     * fatal-looking one while appearing to be a tidy-up. We do not silently
     * restate what a lab measured; we record it and say it looks wrong.
     */
    const rawUnit = cell(row, "unit");
    let unit = test.unit;
    if (rawUnit !== "" && !unitsMatch(rawUnit, test.unit)) {
      unit = rawUnit;
      warnings.push(
        `Unit "${rawUnit}" is not the expected ${test.unit} for ${test.csvCode}. The value was stored as reported — check it before relying on it.`,
      );
    }

    // Reference ranges are advisory chart furniture. A malformed one is never
    // worth rejecting a measurement over, so fall back to the catalog range.
    const { refLow, refHigh, rangeWarning } = resolveRange(
      cell(row, "ref_low"),
      cell(row, "ref_high"),
      test.refLow,
      test.refHigh,
    );
    if (rangeWarning) warnings.push(rangeWarning);

    /* ------------------------------------------------------ duplicates -- */

    const key = resultKey(patientId, isoDate, test.code);

    const duplicateOfLine = seenInFile.get(key);
    if (duplicateOfLine !== undefined) {
      classified.push({
        ...base,
        status: "skipped",
        reasons: [
          `Duplicate of line ${duplicateOfLine} in this file — same patient, date and test. Only the first was imported.`,
        ],
        warnings,
      });
      continue;
    }

    const existing = ctx.existingByKey.get(key);
    if (existing) {
      /**
       * D-CSV-2. A row that matches an existing result but carries a different
       * value is skipped and reported, never written over the top.
       *
       * Overwriting would make the import non-idempotent — upload the same
       * file twice, get different data — and silently mutating a stored
       * clinical result is the wrong default regardless. Saying so plainly
       * lets the clinician decide.
       */
      const changed = Number(existing.value) !== Number(value);
      classified.push({
        ...base,
        status: "skipped",
        reasons: [
          changed
            ? `Already imported with a different value (${trimDecimal(existing.value)}). The stored result was left unchanged — delete it first if you need to replace it.`
            : "Already imported.",
        ],
        warnings,
      });
      continue;
    }

    /* -------------------------------------------------------- accepted -- */

    seenInFile.set(key, row.line);

    pending.push({
      line: row.line,
      patientId,
      collectedDate: parseIsoDate(isoDate),
      testCode: test.code,
      testName,
      value,
      unit,
      refLow,
      refHigh,
    });

    classified.push({ ...base, status: "accepted", reasons: [], warnings });
  }

  return {
    totalRows: rows.length,
    acceptedCount: classified.filter((r) => r.status === "accepted").length,
    rejectedCount: classified.filter((r) => r.status === "rejected").length,
    skippedDuplicateCount: classified.filter((r) => r.status === "skipped").length,
    rows: classified,
    pending,
  };
}

/** Case- and space-insensitive unit comparison, so `MG/DL` is not a mismatch. */
function unitsMatch(a: string, b: string): boolean {
  const fold = (u: string) => u.replace(/\s+/g, "").toLowerCase();
  return fold(a) === fold(b);
}

function resolveRange(
  rawLow: string,
  rawHigh: string,
  fallbackLow: number,
  fallbackHigh: number,
): { refLow: string | null; refHigh: string | null; rangeWarning?: string } {
  const bothBlank = rawLow === "" && rawHigh === "";
  if (bothBlank) {
    return { refLow: String(fallbackLow), refHigh: String(fallbackHigh) };
  }

  const lowOk = rawLow !== "" && STRICT_NUMBER.test(rawLow);
  const highOk = rawHigh !== "" && STRICT_NUMBER.test(rawHigh);

  if (!lowOk || !highOk) {
    return {
      refLow: String(fallbackLow),
      refHigh: String(fallbackHigh),
      rangeWarning: `Reference range is incomplete or not numeric; the standard ${fallbackLow}–${fallbackHigh} range was used instead.`,
    };
  }

  if (Number(rawLow) > Number(rawHigh)) {
    return {
      refLow: String(fallbackLow),
      refHigh: String(fallbackHigh),
      rangeWarning: `Reference range ${rawLow}–${rawHigh} is inverted; the standard ${fallbackLow}–${fallbackHigh} range was used instead.`,
    };
  }

  return { refLow: rawLow, refHigh: rawHigh };
}

/** `7.100` -> `7.1`, for a message a human reads rather than a machine parses. */
function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
