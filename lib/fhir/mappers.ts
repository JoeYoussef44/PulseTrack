import {
  LAB_RESULT_SYSTEM,
  LOINC_SYSTEM,
  MRN_SYSTEM,
  UCUM_SYSTEM,
} from "./systems";
import type { FhirGender, FhirObservation, FhirPatient } from "./types";
import { Sex, TestCode } from "@/lib/generated/prisma/enums";
import { findByCode, findByLoinc } from "@/lib/labs/test-catalog";
import { toIsoDate } from "@/lib/validation/patient";

/**
 * Translation between our data model and FHIR R4.
 *
 * Pure functions with no IO, which is deliberate: mapping is where an
 * integration is most likely to be quietly wrong — a date shifted by a time
 * zone, a unit relabelled, a name split at the wrong space — and pure
 * functions are the only part of this integration that can be tested without
 * writing to a permanent, shared, undeleteable server.
 *
 * Anything that cannot be mapped returns null rather than a guess. A skipped
 * observation that is counted and reported is honest; one that is silently
 * coerced into the nearest supported shape is a fabricated lab result.
 */

/* ------------------------------------------------------------- outbound -- */

const SEX_TO_GENDER: Record<Sex, FhirGender> = {
  [Sex.MALE]: "male",
  [Sex.FEMALE]: "female",
  [Sex.OTHER]: "other",
  [Sex.UNKNOWN]: "unknown",
};

const GENDER_TO_SEX: Record<FhirGender, Sex> = {
  male: Sex.MALE,
  female: Sex.FEMALE,
  other: Sex.OTHER,
  unknown: Sex.UNKNOWN,
};

export interface LocalPatient {
  mrn: string;
  fullName: string;
  dateOfBirth: Date;
  sex: Sex;
}

/**
 * Splits a single name field into FHIR's structured form.
 *
 * The last whitespace-separated token becomes `family`, everything before it
 * becomes `given`. This is a documented simplification, not a claim about
 * names: it is wrong for "van der Berg" and for cultures that put the family
 * name first, and a production system would collect the parts separately
 * rather than guess. We store one `fullName` because the brief asks for one,
 * so the guess happens here, in one place, where it can be seen.
 */
export function splitName(fullName: string): { family: string; given: string[] } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return { family: "Unknown", given: [] };
  if (parts.length === 1) return { family: parts[0], given: [] };

  return { family: parts[parts.length - 1], given: parts.slice(0, -1) };
}

/**
 * Local patient → FHIR `Patient`.
 *
 * Email and phone are deliberately **not** mapped to `telecom`. The server is
 * shared with other candidates and reads are open, so every field we send is
 * readable by everyone else on it. The integration needs identity and
 * demographics to link observations; it does not need contact details, so the
 * least data that does the job is what goes.
 */
export function toFhirPatient(patient: LocalPatient): FhirPatient {
  const { family, given } = splitName(patient.fullName);

  return {
    resourceType: "Patient",
    identifier: [{ system: MRN_SYSTEM, value: patient.mrn }],
    name: [given.length ? { family, given } : { family }],
    gender: SEX_TO_GENDER[patient.sex],
    // toIsoDate formats from UTC components. Building this string from local
    // date parts shifts the birthday a day west of UTC.
    birthDate: toIsoDate(patient.dateOfBirth),
  };
}

/** The tag-scoped conditional-create search for a patient. */
export function patientSearchQuery(mrn: string): string {
  return `identifier=${MRN_SYSTEM}|${mrn}`;
}

export interface LocalLabResult {
  id: string;
  collectedDate: Date;
  testCode: TestCode;
  value: string;
  unit: string;
  refLow: string | null;
  refHigh: string | null;
}

/**
 * Local lab result → FHIR `Observation`.
 *
 * The local row id travels in `identifier` because that is what makes the push
 * idempotent: it is a cuid, unique by construction, so — unlike an MRN — it can
 * never match another candidate's resource. `If-None-Exist` on it is therefore
 * exact, and a retry after an ambiguous network failure finds the observation
 * the lost response created rather than duplicating it.
 */
export function toFhirObservation(
  result: LocalLabResult,
  fhirPatientId: string,
): FhirObservation {
  const test = findByCode(result.testCode);

  const observation: FhirObservation = {
    resourceType: "Observation",
    identifier: [{ system: LAB_RESULT_SYSTEM, value: result.id }],
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: result.testCode === TestCode.SBP ? "vital-signs" : "laboratory",
            display:
              result.testCode === TestCode.SBP ? "Vital Signs" : "Laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        { system: LOINC_SYSTEM, code: test.loinc, display: test.displayName },
      ],
    },
    subject: { reference: `Patient/${fhirPatientId}` },
    effectiveDateTime: toIsoDate(result.collectedDate),
    valueQuantity: {
      value: Number(result.value),
      // The unit is sent exactly as it is stored, which may be what the lab
      // reported rather than the catalog's canonical spelling (D-CSV-5). The
      // alternative — relabelling it to look tidy — would be changing a
      // clinical record to match our vocabulary.
      unit: result.unit,
      system: UCUM_SYSTEM,
      code: result.unit,
    },
  };

  if (result.refLow !== null || result.refHigh !== null) {
    observation.referenceRange = [
      {
        ...(result.refLow !== null
          ? { low: { value: Number(result.refLow), unit: result.unit } }
          : {}),
        ...(result.refHigh !== null
          ? { high: { value: Number(result.refHigh), unit: result.unit } }
          : {}),
      },
    ];
  }

  return observation;
}

/** The tag-scoped conditional-create search for an observation. */
export function observationSearchQuery(localResultId: string): string {
  return `identifier=${LAB_RESULT_SYSTEM}|${localResultId}`;
}

/* -------------------------------------------------------------- inbound -- */

export interface ImportedPatient {
  mrn: string;
  fullName: string;
  dateOfBirth: Date;
  sex: Sex;
  fhirPatientId: string;
}

/** Reads the MRN out of a resource's identifier list. */
export function readMrn(
  identifiers: Array<{ system?: string; value?: string }> | undefined,
): string | null {
  const match = identifiers?.find((i) => i.system === MRN_SYSTEM && i.value);
  return match?.value ?? null;
}

/** Joins a FHIR structured name back into our single field. */
export function joinName(
  names: FhirPatient["name"],
): string | null {
  const name = names?.[0];
  if (!name) return null;

  if (name.text?.trim()) return name.text.trim();

  const joined = [...(name.given ?? []), name.family]
    .filter((p): p is string => Boolean(p?.trim()))
    .join(" ")
    .trim();

  return joined || null;
}

/**
 * FHIR `Patient` → the fields we store.
 *
 * Returns null when the resource lacks the two things we cannot invent: an MRN
 * to key on and a server id to link observations to.
 */
export function fromFhirPatient(resource: FhirPatient): ImportedPatient | null {
  const mrn = readMrn(resource.identifier);
  const fullName = joinName(resource.name);

  if (!mrn || !resource.id || !fullName) return null;

  return {
    mrn,
    fullName,
    // A missing birthDate is stored as the epoch rather than dropping the
    // patient: the DOB is a display field here, while the MRN and the id are
    // what the integration depends on. Every seeded patient carries one.
    dateOfBirth: parseFhirDate(resource.birthDate) ?? new Date(0),
    sex: resource.gender ? (GENDER_TO_SEX[resource.gender] ?? Sex.UNKNOWN) : Sex.UNKNOWN,
    fhirPatientId: resource.id,
  };
}

export interface ImportedObservation {
  fhirObservationId: string;
  collectedDate: Date;
  testCode: TestCode;
  testName: string;
  value: string;
  unit: string;
  refLow: string | null;
  refHigh: string | null;
}

export type ObservationSkipReason =
  | "unsupported-code"
  | "no-value"
  | "no-date"
  | "no-id";

/**
 * FHIR `Observation` → a local lab result, or the reason it was skipped.
 *
 * Four ways an observation cannot become a row, each named rather than
 * lumped into one count, because "we skipped 12" is not something a clinician
 * can act on and "12 used a test code this clinic does not track" is.
 */
export function fromFhirObservation(
  resource: FhirObservation,
): { ok: true; value: ImportedObservation } | { ok: false; reason: ObservationSkipReason } {
  if (!resource.id) return { ok: false, reason: "no-id" };

  const loinc = resource.code?.coding?.find(
    (c) => c.system === LOINC_SYSTEM && c.code,
  )?.code;

  const test = loinc ? findByLoinc(loinc) : undefined;
  if (!test) return { ok: false, reason: "unsupported-code" };

  // Only `valueQuantity` is supported. An Observation can also carry a
  // CodeableConcept, a string, a ratio or a component array; none of those is
  // a number we could chart, so they are skipped and counted rather than
  // coerced.
  const quantity = resource.valueQuantity;
  if (quantity?.value === undefined || !Number.isFinite(quantity.value)) {
    return { ok: false, reason: "no-value" };
  }

  const collectedDate =
    parseFhirDate(resource.effectiveDateTime) ??
    parseFhirDate(resource.effectivePeriod?.start);

  if (!collectedDate) return { ok: false, reason: "no-date" };

  const range = resource.referenceRange?.[0];

  return {
    ok: true,
    value: {
      fhirObservationId: resource.id,
      collectedDate,
      testCode: test.code,
      testName: test.displayName,
      value: String(quantity.value),
      // As reported. The seeded observations use UCUM spellings that match our
      // catalog, but a unit is a fact about the measurement, not a label we own.
      unit: quantity.unit?.trim() || test.unit,
      refLow: numberOrNull(range?.low?.value),
      refHigh: numberOrNull(range?.high?.value),
    },
  };
}

function numberOrNull(value: number | undefined): string | null {
  return value === undefined || !Number.isFinite(value) ? null : String(value);
}

/**
 * Parses a FHIR date or dateTime to a UTC-midnight `Date`.
 *
 * FHIR allows `YYYY`, `YYYY-MM`, `YYYY-MM-DD` and a full instant. We store a
 * `@db.Date`, so only the calendar day matters — and it must be read in UTC.
 * `new Date("2025-07-20")` is already UTC midnight; `new Date(2025, 6, 20)` is
 * local midnight, which is the previous day everywhere west of Greenwich.
 */
export function parseFhirDate(value: string | undefined): Date | null {
  if (!value) return null;

  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value.trim());
  if (!match) return null;

  const [, year, month = "01", day = "01"] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
