import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TEST_CATALOG } from "@/lib/labs/test-catalog";

const root = process.cwd();

/**
 * The app ships copies of two supplied files: the questionnaire definition it
 * renders from, and the CSV template it offers for download. A copy that
 * drifts from the original is a silent correctness bug, so the copies are
 * asserted byte-identical rather than trusted.
 */
describe("supplied fixtures are copied verbatim", () => {
  it("lib/assessments/dsma8.json matches the supplied questionnaire", () => {
    const original = readFileSync(
      join(root, ".docs/questionnaire-dsma8.json"),
    );
    const copy = readFileSync(join(root, "lib/assessments/dsma8.json"));

    expect(copy.equals(original)).toBe(true);
  });

  it("public/templates/lab-results-template.csv matches the supplied template", () => {
    const original = readFileSync(join(root, ".docs/lab-results-template.csv"));
    const copy = readFileSync(
      join(root, "public/templates/lab-results-template.csv"),
    );

    expect(copy.equals(original)).toBe(true);
  });
});

describe("CSV template header", () => {
  const REQUIRED_HEADER =
    "mrn,collected_date,test_code,test_name,value,unit,ref_low,ref_high";

  it("is exactly the eight columns the brief specifies", () => {
    const text = readFileSync(
      join(root, "public/templates/lab-results-template.csv"),
      "utf8",
    );
    expect(text.split(/\r?\n/)[0]).toBe(REQUIRED_HEADER);
  });
});

describe("test catalog matches the supplied sample data", () => {
  it("covers every test code that appears in the clean sample", () => {
    const sample = readFileSync(
      join(root, ".docs/lab-results-sample-clean.csv"),
      "utf8",
    );

    const codesInSample = new Set(
      sample
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean)
        .map((line) => line.split(",")[2]),
    );

    const known = new Set(TEST_CATALOG.map((t) => t.csvCode));

    for (const code of codesInSample) {
      expect(known.has(code), `sample uses unknown code ${code}`).toBe(true);
    }
  });

  it("maps each test to the LOINC code the FHIR guide specifies", () => {
    const expected: Record<string, string> = {
      "GLU-F": "1558-6",
      HBA1C: "4548-4",
      SBP: "8480-6",
    };

    for (const test of TEST_CATALOG) {
      expect(test.loinc).toBe(expected[test.csvCode]);
    }
  });
});
