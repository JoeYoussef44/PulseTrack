import { TestCode } from "@/lib/generated/prisma/enums";

/**
 * The entire supported test vocabulary. Three tests, closed set.
 *
 * These are the only codes present in the supplied CSV template and sample,
 * and the only three seeded on the FHIR server. Keeping the vocabulary closed
 * is what makes both CSV validation and LOINC mapping tractable — a row
 * carrying anything else is rejected with a clear reason.
 */

export interface TestDefinition {
  /** The code as it appears in the CSV. */
  csvCode: string;
  /** The database enum member. */
  code: TestCode;
  /** Canonical display name, used when test_name is blank or mismatched. */
  displayName: string;
  /** Canonical unit, used when unit is blank. */
  unit: string;
  /** LOINC code for the FHIR Observation push. */
  loinc: string;
  /** Reference range from the supplied template, used only as a fallback. */
  refLow: number;
  refHigh: number;
}

export const TEST_CATALOG: readonly TestDefinition[] = [
  {
    csvCode: "GLU-F",
    code: TestCode.GLU_F,
    displayName: "Fasting Glucose",
    unit: "mg/dL",
    loinc: "1558-6",
    refLow: 70,
    refHigh: 99,
  },
  {
    csvCode: "HBA1C",
    code: TestCode.HBA1C,
    displayName: "Hemoglobin A1c",
    unit: "%",
    loinc: "4548-4",
    refLow: 4.0,
    refHigh: 5.6,
  },
  {
    csvCode: "SBP",
    code: TestCode.SBP,
    displayName: "Systolic Blood Pressure",
    unit: "mmHg",
    loinc: "8480-6",
    refLow: 90,
    refHigh: 120,
  },
] as const;

const BY_CSV_CODE = new Map(
  TEST_CATALOG.map((t) => [t.csvCode.toUpperCase(), t]),
);
const BY_ENUM = new Map(TEST_CATALOG.map((t) => [t.code, t]));
const BY_LOINC = new Map(TEST_CATALOG.map((t) => [t.loinc, t]));

/** Resolve a CSV `test_code` cell. Case- and whitespace-insensitive. */
export function findByCsvCode(raw: string): TestDefinition | undefined {
  return BY_CSV_CODE.get(raw.trim().toUpperCase());
}

export function findByCode(code: TestCode): TestDefinition {
  const test = BY_ENUM.get(code);
  if (!test) throw new Error(`No catalog entry for test code ${code}`);
  return test;
}

/** Resolve an incoming FHIR Observation by its LOINC code. */
export function findByLoinc(loinc: string): TestDefinition | undefined {
  return BY_LOINC.get(loinc.trim());
}

export const SUPPORTED_CSV_CODES = TEST_CATALOG.map((t) => t.csvCode);
