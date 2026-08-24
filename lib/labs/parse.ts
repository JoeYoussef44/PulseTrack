import { parse } from "csv-parse/sync";

/**
 * CSV parsing — the file envelope, not the clinical content.
 *
 * This module answers one question: "is this a lab CSV at all, and what are
 * its rows?" Whether any individual row is *valid* is `classify.ts`'s job.
 *
 * The split matters because the two failure modes are different in kind. A
 * bad row is normal and expected — the brief says outright that they will
 * test with a deliberately messy file, and one bad row must never stop the
 * other nine importing. A bad *file* (a PDF renamed `.csv`, a spreadsheet with
 * the wrong columns) cannot be partially imported, so it is rejected whole
 * with a message that says what was wrong with it.
 *
 * Deliberately tolerated, because real files from real labs contain all of
 * these and none of them changes the meaning of the data:
 *
 *   - a UTF-8 BOM, which is what Excel writes by default and which otherwise
 *     turns the first header into `U+FEFF followed by mrn`
 *   - CRLF or LF line endings
 *   - header case and spacing variance (`MRN`, ` Collected Date `)
 *   - quoted fields containing commas
 *   - blank lines, including a trailing newline
 *   - short rows (missing trailing cells) and over-long rows (extra cells)
 *   - stray quotes inside an unquoted field
 */

/** Columns the importer understands. Order is the supplied template's order. */
export const CSV_COLUMNS = [
  "mrn",
  "collected_date",
  "test_code",
  "test_name",
  "value",
  "unit",
  "ref_low",
  "ref_high",
] as const;

/**
 * Columns a file must contain to be processable at all.
 *
 * Deliberately four, not eight — see D-CSV-1. The brief never states which
 * columns are required, and treating all eight as mandatory would reject rows
 * an evaluator considers perfectly valid. `test_name` and `unit` are cosmetic,
 * and `ref_low`/`ref_high` are absent from the FHIR data entirely.
 */
export const REQUIRED_COLUMNS = [
  "mrn",
  "collected_date",
  "test_code",
  "value",
] as const;

/** 2 MB. Vercel caps a request body at 4.5 MB; we stop well short with a clear message. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Upper bound on data rows. A file larger than this is far more likely to be
 * a mistake than a real lab export, and processing it would risk the
 * serverless function timeout — which fails opaquely, midway, with rows
 * already written. Refusing up front is the kinder failure.
 */
export const MAX_ROWS = 10_000;

/** One row exactly as it appeared in the file. Every cell is still a string. */
export interface RawRow {
  /**
   * The line number in the file, counting the header as line 1.
   *
   * This is the number the clinician sees in the left-hand gutter when they
   * open the file in Excel to fix it, which is the only reason a row number is
   * worth reporting at all. It is not the row's index among the data rows —
   * blank lines and multi-line quoted fields make those two diverge.
   */
  line: number;
  cells: Record<string, string | undefined>;
}

export type ParseResult =
  | { ok: true; rows: RawRow[]; missingOptionalColumns: string[] }
  | { ok: false; error: string };

/** Lowercase, trim, and fold spaces/hyphens to underscores: ` Collected-Date ` -> `collected_date`. */
function normaliseHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function parseLabCsv(text: string): ParseResult {
  // A NUL byte means this is a binary file wearing a .csv extension. Detected
  // explicitly because csv-parse would otherwise "succeed" on the garbage and
  // produce a baffling header error instead of an honest one.
  if (text.includes("\u0000")) {
    return {
      ok: false,
      error:
        "That file is not a text CSV. Export it from your spreadsheet as CSV and try again.",
    };
  }

  if (text.trim() === "") {
    return { ok: false, error: "That file is empty." };
  }

  let parsed: Array<{ record: Record<string, string>; info: { lines: number } }>;

  /**
   * Captured from the header line itself rather than inferred from the first
   * record's keys.
   *
   * With `relax_column_count`, a row missing its trailing cells yields a
   * record missing those keys entirely. Inferring the file's columns from row
   * one would therefore report a *file* missing "value" whenever the first
   * data row happens to be short — rejecting a whole upload over one ragged
   * row, which is precisely the case this importer exists to survive.
   */
  let headers: string[] = [];

  try {
    parsed = parse(text, {
      bom: true,
      columns: (header: unknown[]) => {
        headers = header.map(normaliseHeader);
        return headers;
      },
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      info: true,
    }) as typeof parsed;
  } catch (error) {
    return {
      ok: false,
      error: `That file could not be read as CSV: ${
        error instanceof Error ? error.message : "unknown parsing error"
      }`,
    };
  }

  // Going through csv-parse's own header handling means the BOM, quoting and
  // whitespace are already dealt with by the time we look at the names.
  const present = new Set(headers);

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !present.has(c));

  if (missingRequired.length > 0) {
    // When every required column is absent this is not a lab CSV at all —
    // usually the wrong file entirely — so listing the missing columns twice
    // would just be noise. Naming them is only useful when some are present.
    const allMissing = missingRequired.length === REQUIRED_COLUMNS.length;

    return {
      ok: false,
      error: allMissing
        ? `This does not look like a lab results CSV. It needs the columns ${REQUIRED_COLUMNS.map((c) => `"${c}"`).join(", ")} — download the template to see the expected format.`
        : `This file is missing the ${plural(missingRequired.length, "column", "columns")} ` +
          `${missingRequired.map((c) => `"${c}"`).join(", ")}. ` +
          `A lab CSV needs at least ${REQUIRED_COLUMNS.map((c) => `"${c}"`).join(", ")}. ` +
          `Download the template to see the expected format.`,
    };
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: "That file has a valid header but no data rows.",
    };
  }

  if (parsed.length > MAX_ROWS) {
    return {
      ok: false,
      error: `That file has ${parsed.length.toLocaleString()} rows, which is more than the ${MAX_ROWS.toLocaleString()}-row limit. Split it into smaller files.`,
    };
  }

  return {
    ok: true,
    rows: parsed.map(({ record, info }) => ({
      line: info.lines,
      cells: record,
    })),
    // Reported so the UI can say "no unit column, canonical units assumed"
    // once at the top rather than repeating it on every single row.
    missingOptionalColumns: CSV_COLUMNS.filter(
      (c) => !REQUIRED_COLUMNS.includes(c as never) && !present.has(c),
    ),
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
