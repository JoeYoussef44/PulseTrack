import type { ImportedObservation } from "./mappers";
import type { TestCode } from "@/lib/generated/prisma/enums";
import { toIsoDate } from "@/lib/validation/patient";

/**
 * Deciding what an import should write, as a pure function.
 *
 * This is the part of the pull that is genuinely hard to get right, and the
 * part that cannot be exercised against the live server without permanently
 * writing to it. Two unique constraints can disagree about the same
 * observation:
 *
 * - `fhirObservationId` — one local row per resource on the platform
 * - `(patientId, collectedDate, testCode)` — one local row per measurement
 *
 * They collide whenever a result already entered from a CSV describes the same
 * measurement the platform is now reporting. Letting the second constraint
 * throw would fail an entire import over one row that is not even wrong.
 *
 * Separating the decision from the writing is what lets every branch below be
 * tested in milliseconds instead of by uploading a CSV and then importing.
 */

/** The subset of a stored row this decision depends on. */
export interface ExistingResult {
  id: string;
  patientId: string;
  collectedDate: Date;
  testCode: TestCode;
  /** Stringified, because Prisma returns Decimal. */
  value: string;
  unit: string;
  refLow: string | null;
  refHigh: string | null;
  fhirObservationId: string | null;
}

export interface WritePlan {
  /** New to us. */
  create: ImportedObservation[];
  /** Already linked, and the platform's copy has changed since we stored it. */
  update: Array<{ id: string; observation: ImportedObservation }>;
  /** Already linked and identical. No write at all. */
  unchanged: number;
  /** Held locally from elsewhere. Link only — never overwrite the value. */
  link: Array<{ id: string; fhirObservationId: string }>;
  /** Linked rows whose local value disagreed with the platform's. */
  conflicts: number;
}

/**
 * Whether a linked row still matches what the platform is reporting.
 *
 * The reason this exists rather than updating unconditionally: re-importing
 * five patients is 180 linked rows, and writing each one back is 180 sequential
 * round trips inside a transaction. Measured before this check existed, a
 * re-import took **10s per patient against 2.4s for the first** — all of it
 * spent writing values that had not changed. It also makes "updated" mean
 * something a clinician can read: the platform revised this result.
 */
function matches(row: ExistingResult, observation: ImportedObservation): boolean {
  return (
    row.value === observation.value &&
    row.unit === observation.unit &&
    row.refLow === observation.refLow &&
    row.refHigh === observation.refHigh
  );
}

export function naturalKey(collectedDate: Date, testCode: TestCode): string {
  return `${toIsoDate(collectedDate)}|${testCode}`;
}

/**
 * Sorts incoming observations into creates, updates and links.
 *
 * The rule that matters is the third one. Where a measurement is already on
 * file from a CSV, the platform's copy does **not** overwrite it: the link is
 * attached and the stored value is left exactly as recorded. Silently editing
 * a clinician's record because a remote resource happens to share a date is
 * how a clinical system stops being trustworthy — and it is the same rule a
 * re-uploaded CSV row already follows (D-CSV-2). Where the two disagree, that
 * is counted and shown rather than resolved behind the clinician's back.
 */
export function planObservationWrites(
  patientId: string,
  observations: readonly ImportedObservation[],
  existing: readonly ExistingResult[],
): WritePlan {
  const byFhirId = new Map(
    existing
      .filter((r): r is ExistingResult & { fhirObservationId: string } =>
        Boolean(r.fhirObservationId),
      )
      .map((r) => [r.fhirObservationId, r]),
  );

  const byNaturalKey = new Map(
    existing
      .filter((r) => r.patientId === patientId)
      .map((r) => [naturalKey(r.collectedDate, r.testCode), r]),
  );

  const plan: WritePlan = {
    create: [],
    update: [],
    unchanged: 0,
    link: [],
    conflicts: 0,
  };

  // Claimed within this run, so two observations of the same measurement
  // arriving in one pull cannot both be created — that would violate the
  // natural key mid-transaction and fail the whole import.
  const claimed = new Set<string>();

  for (const observation of observations) {
    const linked = byFhirId.get(observation.fhirObservationId);

    if (linked) {
      if (matches(linked, observation)) plan.unchanged += 1;
      else plan.update.push({ id: linked.id, observation });
      continue;
    }

    const key = naturalKey(observation.collectedDate, observation.testCode);
    const natural = byNaturalKey.get(key);

    if (natural) {
      plan.link.push({
        id: natural.id,
        fhirObservationId: observation.fhirObservationId,
      });
      if (natural.value !== observation.value) plan.conflicts += 1;
      continue;
    }

    if (claimed.has(key)) continue;

    claimed.add(key);
    plan.create.push(observation);
  }

  return plan;
}
