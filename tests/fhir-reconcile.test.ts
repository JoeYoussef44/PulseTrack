import { describe, expect, it } from "vitest";

import type { ImportedObservation } from "@/lib/fhir/mappers";
import {
  type ExistingResult,
  naturalKey,
  planObservationWrites,
} from "@/lib/fhir/reconcile";
import { TestCode } from "@/lib/generated/prisma/enums";
import { parseIsoDate } from "@/lib/validation/patient";

/**
 * The import's collision handling.
 *
 * Two unique constraints can disagree about the same observation, and the way
 * that disagreement is resolved decides whether a re-import is safe and
 * whether a clinician's own record can be silently overwritten. Both are worth
 * pinning down here rather than discovering against a server whose writes are
 * permanent.
 */

const PATIENT = "patient-1";

function observation(
  overrides: Partial<ImportedObservation> = {},
): ImportedObservation {
  return {
    fhirObservationId: "900",
    collectedDate: parseIsoDate("2025-07-20"),
    testCode: TestCode.HBA1C,
    testName: "Hemoglobin A1c",
    value: "7.2",
    unit: "%",
    refLow: null,
    refHigh: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingResult> = {}): ExistingResult {
  return {
    id: "row-1",
    patientId: PATIENT,
    collectedDate: parseIsoDate("2025-07-20"),
    testCode: TestCode.HBA1C,
    value: "7.2",
    unit: "%",
    refLow: null,
    refHigh: null,
    fhirObservationId: null,
    ...overrides,
  };
}

describe("planObservationWrites", () => {
  it("creates everything on a first import", () => {
    const plan = planObservationWrites(
      PATIENT,
      [
        observation({ fhirObservationId: "900" }),
        observation({
          fhirObservationId: "901",
          collectedDate: parseIsoDate("2025-08-20"),
        }),
      ],
      [],
    );

    expect(plan.create).toHaveLength(2);
    expect(plan.update).toHaveLength(0);
    expect(plan.link).toHaveLength(0);
  });

  it("writes nothing at all on a re-import — the whole idempotency guarantee", () => {
    const incoming = observation({ fhirObservationId: "900" });

    const plan = planObservationWrites(
      PATIENT,
      [incoming],
      [existing({ id: "row-1", fhirObservationId: "900" })],
    );

    // Not merely "creates nothing": an identical row is not rewritten either.
    // Doing so cost 180 sequential updates and 10s per patient on a re-import.
    expect(plan.create).toHaveLength(0);
    expect(plan.link).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it("rewrites a linked row when the reference range changes but the value does not", () => {
    const plan = planObservationWrites(
      PATIENT,
      [observation({ fhirObservationId: "900", refHigh: "5.6" })],
      [existing({ fhirObservationId: "900", refHigh: null })],
    );

    expect(plan.update).toHaveLength(1);
    expect(plan.unchanged).toBe(0);
  });

  it("refreshes a linked row when the platform's value has changed", () => {
    const incoming = observation({ fhirObservationId: "900", value: "7.5" });

    const plan = planObservationWrites(
      PATIENT,
      [incoming],
      [existing({ fhirObservationId: "900", value: "7.2" })],
    );

    // The platform owns rows it gave us, so it is the authority on them.
    expect(plan.update[0].observation.value).toBe("7.5");
    expect(plan.unchanged).toBe(0);
    expect(plan.conflicts).toBe(0);
  });

  it("links a measurement already held locally instead of duplicating it", () => {
    // The row came from a CSV: same patient, date and test, no FHIR id.
    const plan = planObservationWrites(
      PATIENT,
      [observation({ fhirObservationId: "900" })],
      [existing({ id: "csv-row", fhirObservationId: null })],
    );

    expect(plan.create).toHaveLength(0);
    expect(plan.link).toEqual([
      { id: "csv-row", fhirObservationId: "900" },
    ]);
  });

  it("never overwrites a locally-held value, and counts the disagreement", () => {
    // The rule that matters: a remote resource sharing a date is not grounds
    // for silently editing what a clinician recorded (D-CSV-2's rule, applied
    // to the pull).
    const plan = planObservationWrites(
      PATIENT,
      [observation({ fhirObservationId: "900", value: "9.9" })],
      [existing({ id: "csv-row", value: "7.2" })],
    );

    expect(plan.link).toEqual([{ id: "csv-row", fhirObservationId: "900" }]);
    expect(plan.update).toHaveLength(0);
    expect(plan.conflicts).toBe(1);
    // Nothing in the plan carries the remote value towards that row.
    expect(JSON.stringify(plan.link)).not.toContain("9.9");
  });

  it("does not count a match as a conflict when the values agree", () => {
    const plan = planObservationWrites(
      PATIENT,
      [observation({ value: "7.2" })],
      [existing({ value: "7.2" })],
    );

    expect(plan.link).toHaveLength(1);
    expect(plan.conflicts).toBe(0);
  });

  it("prefers the FHIR id over the natural key when both match", () => {
    // Same row, reachable either way. Matching on the id is what lets a
    // corrected remote value through; matching on the natural key would not.
    const plan = planObservationWrites(
      PATIENT,
      [observation({ fhirObservationId: "900", value: "8.0" })],
      [existing({ id: "row-1", fhirObservationId: "900", value: "7.2" })],
    );

    expect(plan.update).toHaveLength(1);
    expect(plan.link).toHaveLength(0);
  });

  it("keeps only one of two identical measurements inside a single pull", () => {
    // A duplicate within one page would otherwise violate the natural key
    // mid-transaction and fail the entire import.
    const plan = planObservationWrites(
      PATIENT,
      [
        observation({ fhirObservationId: "900" }),
        observation({ fhirObservationId: "901" }),
      ],
      [],
    );

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].fhirObservationId).toBe("900");
  });

  it("treats the same date under a different test as a different measurement", () => {
    const plan = planObservationWrites(
      PATIENT,
      [
        observation({ fhirObservationId: "900", testCode: TestCode.HBA1C }),
        observation({ fhirObservationId: "901", testCode: TestCode.GLU_F }),
        observation({ fhirObservationId: "902", testCode: TestCode.SBP }),
      ],
      [],
    );

    expect(plan.create).toHaveLength(3);
  });

  it("ignores another patient's row when matching on the natural key", () => {
    // fhirObservationId is globally unique so it matches across patients; the
    // natural key is per-patient and must not reach outside this one.
    const plan = planObservationWrites(
      PATIENT,
      [observation({ fhirObservationId: "900" })],
      [existing({ id: "other", patientId: "patient-2" })],
    );

    expect(plan.create).toHaveLength(1);
    expect(plan.link).toHaveLength(0);
  });

  it("handles a full re-import of a seeded patient with no writes at all", () => {
    // 36 observations, all already linked: three per month over twelve months.
    const incoming = Array.from({ length: 36 }, (_, i) =>
      observation({
        fhirObservationId: `9${i}`,
        collectedDate: parseIsoDate(
          `2025-${String((i % 12) + 1).padStart(2, "0")}-20`,
        ),
        testCode: [TestCode.HBA1C, TestCode.GLU_F, TestCode.SBP][
          Math.floor(i / 12)
        ],
      }),
    );

    const stored = incoming.map((o, i) =>
      existing({
        id: `row-${i}`,
        collectedDate: o.collectedDate,
        testCode: o.testCode,
        fhirObservationId: o.fhirObservationId,
      }),
    );

    const plan = planObservationWrites(PATIENT, incoming, stored);

    expect(plan.create).toHaveLength(0);
    expect(plan.link).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchanged).toBe(36);
  });
});

describe("naturalKey", () => {
  it("keys on the calendar day, not the instant", () => {
    expect(naturalKey(parseIsoDate("2025-07-20"), TestCode.HBA1C)).toBe(
      "2025-07-20|HBA1C",
    );
  });

  it("gives two tests on one day different keys", () => {
    const date = parseIsoDate("2025-07-20");
    expect(naturalKey(date, TestCode.HBA1C)).not.toBe(
      naturalKey(date, TestCode.GLU_F),
    );
  });
});
