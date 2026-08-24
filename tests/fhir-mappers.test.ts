import { describe, expect, it } from "vitest";

import {
  fromFhirObservation,
  fromFhirPatient,
  joinName,
  observationSearchQuery,
  parseFhirDate,
  patientSearchQuery,
  splitName,
  toFhirObservation,
  toFhirPatient,
} from "@/lib/fhir/mappers";
import {
  idFromLocation,
  isOwnedByUs,
  LAB_RESULT_SYSTEM,
  MRN_SYSTEM,
  TAG_SYSTEM,
} from "@/lib/fhir/systems";
import type { FhirObservation, FhirPatient } from "@/lib/fhir/types";
import { Sex, TestCode } from "@/lib/generated/prisma/enums";
import { parseIsoDate } from "@/lib/validation/patient";

/**
 * The mapping layer is the only part of the FHIR integration that can be
 * exercised without writing to the shared server — where every write is
 * permanent, because DELETE is disabled. So these tests carry more weight than
 * usual: they are the safety net for the code that decides what we send.
 */

const CANDIDATE = "cand-joe-l";

describe("splitName", () => {
  it("puts the last token in family and the rest in given", () => {
    expect(splitName("Jane Doe")).toEqual({ family: "Doe", given: ["Jane"] });
    expect(splitName("Maria del Carmen Ruiz")).toEqual({
      family: "Ruiz",
      given: ["Maria", "del", "Carmen"],
    });
  });

  it("handles a single name without inventing a given name", () => {
    expect(splitName("Prince")).toEqual({ family: "Prince", given: [] });
  });

  it("collapses irregular whitespace rather than producing empty parts", () => {
    expect(splitName("  Jane   Doe  ")).toEqual({
      family: "Doe",
      given: ["Jane"],
    });
  });

  it("never produces an empty family, which FHIR would reject", () => {
    expect(splitName("   ").family).toBe("Unknown");
  });
});

describe("toFhirPatient", () => {
  const patient = {
    mrn: "MRN-1001",
    fullName: "Jane Doe",
    dateOfBirth: parseIsoDate("1980-05-12"),
    sex: Sex.FEMALE,
  };

  it("maps identity, name, gender and birth date", () => {
    expect(toFhirPatient(patient)).toEqual({
      resourceType: "Patient",
      identifier: [{ system: MRN_SYSTEM, value: "MRN-1001" }],
      name: [{ family: "Doe", given: ["Jane"] }],
      gender: "female",
      birthDate: "1980-05-12",
    });
  });

  it("does not send contact details to a server other candidates can read", () => {
    const resource = toFhirPatient(patient) as FhirPatient & {
      telecom?: unknown;
    };

    expect(resource.telecom).toBeUndefined();
    expect(JSON.stringify(resource)).not.toContain("@");
  });

  it("keeps the birth date on its calendar day", () => {
    // The bug this guards: building the string from local date components
    // renders 1980-05-11 anywhere west of UTC.
    expect(toFhirPatient(patient).birthDate).toBe("1980-05-12");
  });

  it("maps every sex value onto a FHIR gender", () => {
    const genders = Object.values(Sex).map(
      (sex) => toFhirPatient({ ...patient, sex }).gender,
    );

    expect(genders).toEqual(["male", "female", "other", "unknown"]);
  });
});

describe("conditional-create search queries", () => {
  it("scopes a patient search to the MRN identifier system", () => {
    expect(patientSearchQuery("MRN-1001")).toBe(
      `identifier=${MRN_SYSTEM}|MRN-1001`,
    );
  });

  it("keys an observation on the local row id, which cannot collide", () => {
    // An MRN is shared vocabulary — five other candidates have created
    // MRN-1001 on this server. A cuid is ours alone, so If-None-Exist on it is
    // exact even though reads are open to everyone.
    expect(observationSearchQuery("clx123abc")).toBe(
      `identifier=${LAB_RESULT_SYSTEM}|clx123abc`,
    );
  });
});

describe("toFhirObservation", () => {
  const result = {
    id: "clx123abc",
    collectedDate: parseIsoDate("2026-06-01"),
    testCode: TestCode.GLU_F,
    value: "105",
    unit: "mg/dL",
    refLow: "70",
    refHigh: "99",
  };

  it("maps to the LOINC code the API guide specifies", () => {
    const observation = toFhirObservation(result, "816");

    expect(observation.code.coding?.[0]).toMatchObject({
      system: "http://loinc.org",
      code: "1558-6",
    });
    expect(observation.subject.reference).toBe("Patient/816");
    expect(observation.effectiveDateTime).toBe("2026-06-01");
    expect(observation.valueQuantity).toMatchObject({
      value: 105,
      unit: "mg/dL",
    });
  });

  it("maps each supported test to its own LOINC code", () => {
    const codes = [TestCode.GLU_F, TestCode.HBA1C, TestCode.SBP].map(
      (testCode) =>
        toFhirObservation({ ...result, testCode }, "816").code.coding?.[0].code,
    );

    expect(codes).toEqual(["1558-6", "4548-4", "8480-6"]);
  });

  it("carries the local row id, which is what makes a re-push idempotent", () => {
    expect(toFhirObservation(result, "816").identifier?.[0]).toEqual({
      system: LAB_RESULT_SYSTEM,
      value: "clx123abc",
    });
  });

  it("sends the unit as stored rather than relabelling it (D-CSV-5)", () => {
    const observation = toFhirObservation(
      { ...result, unit: "mmol/L" },
      "816",
    );

    expect(observation.valueQuantity?.unit).toBe("mmol/L");
  });

  it("categorises blood pressure as a vital sign, not a lab test", () => {
    const sbp = toFhirObservation({ ...result, testCode: TestCode.SBP }, "816");
    const glucose = toFhirObservation(result, "816");

    expect(sbp.category?.[0].coding?.[0].code).toBe("vital-signs");
    expect(glucose.category?.[0].coding?.[0].code).toBe("laboratory");
  });

  it("omits referenceRange entirely when neither bound is known", () => {
    const observation = toFhirObservation(
      { ...result, refLow: null, refHigh: null },
      "816",
    );

    expect(observation.referenceRange).toBeUndefined();
  });

  it("sends a one-sided range when only one bound is known", () => {
    const observation = toFhirObservation({ ...result, refLow: null }, "816");

    expect(observation.referenceRange?.[0].low).toBeUndefined();
    expect(observation.referenceRange?.[0].high?.value).toBe(99);
  });
});

describe("fromFhirPatient", () => {
  const seeded: FhirPatient = {
    resourceType: "Patient",
    id: "1",
    meta: { tag: [{ system: TAG_SYSTEM, code: "cand-admin" }] },
    identifier: [{ system: MRN_SYSTEM, value: "MRN-2001" }],
    name: [{ family: "Haddad", given: ["Layla"] }],
    gender: "female",
    birthDate: "1974-03-08",
  };

  it("maps a seeded patient into our fields", () => {
    expect(fromFhirPatient(seeded)).toEqual({
      mrn: "MRN-2001",
      fullName: "Layla Haddad",
      dateOfBirth: parseIsoDate("1974-03-08"),
      sex: Sex.FEMALE,
      fhirPatientId: "1",
    });
  });

  it("refuses a resource with no MRN — there is nothing to key it on", () => {
    expect(fromFhirPatient({ ...seeded, identifier: [] })).toBeNull();
  });

  it("refuses a resource with no server id — observations could not link", () => {
    expect(fromFhirPatient({ ...seeded, id: undefined })).toBeNull();
  });

  it("ignores identifiers from a different system", () => {
    const other = {
      ...seeded,
      identifier: [{ system: "http://example.org/other", value: "X-1" }],
    };

    expect(fromFhirPatient(other)).toBeNull();
  });

  it("treats an unstated gender as unknown rather than guessing", () => {
    expect(fromFhirPatient({ ...seeded, gender: undefined })?.sex).toBe(
      Sex.UNKNOWN,
    );
  });
});

describe("joinName", () => {
  it("prefers the server's own rendered text when it has one", () => {
    expect(joinName([{ text: "Layla Haddad", family: "X" }])).toBe(
      "Layla Haddad",
    );
  });

  it("joins given names before the family name", () => {
    expect(joinName([{ family: "Ruiz", given: ["Maria", "del Carmen"] }])).toBe(
      "Maria del Carmen Ruiz",
    );
  });

  it("returns null when there is no name at all", () => {
    expect(joinName(undefined)).toBeNull();
    expect(joinName([{}])).toBeNull();
  });
});

describe("fromFhirObservation", () => {
  const observation: FhirObservation = {
    resourceType: "Observation",
    id: "42",
    status: "final",
    code: {
      coding: [
        { system: "http://loinc.org", code: "4548-4", display: "HbA1c" },
      ],
    },
    subject: { reference: "Patient/1" },
    effectiveDateTime: "2025-07-20",
    valueQuantity: {
      value: 7.2,
      unit: "%",
      system: "http://unitsofmeasure.org",
      code: "%",
    },
  };

  it("maps a seeded observation onto our test vocabulary", () => {
    const mapped = fromFhirObservation(observation);

    expect(mapped).toEqual({
      ok: true,
      value: {
        fhirObservationId: "42",
        collectedDate: parseIsoDate("2025-07-20"),
        testCode: TestCode.HBA1C,
        testName: "Hemoglobin A1c",
        value: "7.2",
        unit: "%",
        // Verified against the live server: the seeded observations carry no
        // referenceRange at all, which is why these columns are nullable.
        refLow: null,
        refHigh: null,
      },
    });
  });

  it("names why an observation was skipped rather than dropping it silently", () => {
    const unsupported = {
      ...observation,
      code: { coding: [{ system: "http://loinc.org", code: "9999-9" }] },
    };

    expect(fromFhirObservation(unsupported)).toEqual({
      ok: false,
      reason: "unsupported-code",
    });
  });

  it("skips a non-quantity value rather than coercing it to a number", () => {
    const { valueQuantity: _omitted, ...withoutValue } = observation;

    expect(fromFhirObservation(withoutValue)).toEqual({
      ok: false,
      reason: "no-value",
    });
  });

  it("skips an observation with no effective date", () => {
    const { effectiveDateTime: _omitted, ...undated } = observation;

    expect(fromFhirObservation(undated)).toEqual({
      ok: false,
      reason: "no-date",
    });
  });

  it("falls back to effectivePeriod.start when there is no dateTime", () => {
    const { effectiveDateTime: _omitted, ...rest } = observation;
    const periodic = { ...rest, effectivePeriod: { start: "2025-08-20" } };

    const mapped = fromFhirObservation(periodic);

    expect(mapped.ok && mapped.value.collectedDate).toEqual(
      parseIsoDate("2025-08-20"),
    );
  });

  it("reads a reference range when the server does send one", () => {
    const ranged = {
      ...observation,
      referenceRange: [{ low: { value: 4 }, high: { value: 5.6 } }],
    };

    const mapped = fromFhirObservation(ranged);

    expect(mapped.ok && mapped.value.refLow).toBe("4");
    expect(mapped.ok && mapped.value.refHigh).toBe("5.6");
  });

  it("ignores a LOINC-shaped code from another system", () => {
    const wrongSystem = {
      ...observation,
      code: { coding: [{ system: "http://snomed.info/sct", code: "4548-4" }] },
    };

    expect(fromFhirObservation(wrongSystem)).toEqual({
      ok: false,
      reason: "unsupported-code",
    });
  });
});

describe("parseFhirDate", () => {
  it("reads a plain date at UTC midnight", () => {
    expect(parseFhirDate("2025-07-20")?.toISOString()).toBe(
      "2025-07-20T00:00:00.000Z",
    );
  });

  it("keeps the calendar day of a full instant", () => {
    expect(parseFhirDate("2025-07-20T14:32:01.000Z")?.toISOString()).toBe(
      "2025-07-20T00:00:00.000Z",
    );
  });

  it("accepts FHIR's partial dates", () => {
    expect(parseFhirDate("2025")?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(parseFhirDate("2025-07")?.toISOString()).toBe(
      "2025-07-01T00:00:00.000Z",
    );
  });

  it("returns null rather than an Invalid Date", () => {
    expect(parseFhirDate(undefined)).toBeNull();
    expect(parseFhirDate("not a date")).toBeNull();
    expect(parseFhirDate("2025-13-45")).toBeNull();
  });
});

describe("idFromLocation", () => {
  it("takes the id before _history, not the version after it", () => {
    // Verbatim from the live server's response to our first conditional create.
    expect(idFromLocation("http://hapi:8080/fhir/Patient/816/_history/1")).toBe(
      "816",
    );
  });

  it("reads a location with no version suffix", () => {
    expect(idFromLocation("https://example.org/fhir/Observation/99")).toBe("99");
  });

  it("returns null when there is no location header", () => {
    expect(idFromLocation(null)).toBeNull();
  });

  it("does not mistake a host:port for a resource id", () => {
    expect(idFromLocation("http://hapi:8080")).toBeNull();
  });
});

describe("isOwnedByUs", () => {
  it("recognises our own tag", () => {
    const meta = { tag: [{ system: TAG_SYSTEM, code: CANDIDATE }] };
    expect(isOwnedByUs(meta, CANDIDATE)).toBe(true);
  });

  it("rejects the seed data's tag", () => {
    // Measured: the five seeded patients carry cand-admin, not us. Treating a
    // readable resource as writable is the mistake this guards.
    const meta = { tag: [{ system: TAG_SYSTEM, code: "cand-admin" }] };
    expect(isOwnedByUs(meta, CANDIDATE)).toBe(false);
  });

  it("rejects our candidate id under a different tag system", () => {
    const meta = { tag: [{ system: "http://example.org/tags", code: CANDIDATE }] };
    expect(isOwnedByUs(meta, CANDIDATE)).toBe(false);
  });

  it("treats an untagged or absent meta as not ours", () => {
    expect(isOwnedByUs(undefined, CANDIDATE)).toBe(false);
    expect(isOwnedByUs({}, CANDIDATE)).toBe(false);
  });
});
