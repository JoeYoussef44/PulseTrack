import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyRows,
  resultKey,
  type ClassifyContext,
  type ImportReport,
} from "@/lib/labs/classify";
import { MAX_ROWS, parseLabCsv } from "@/lib/labs/parse";
import { TestCode } from "@/lib/generated/prisma/enums";

/**
 * The brief promises the uploader will be tested "with a deliberately messy
 * file", so this suite is written as that file: every documented rejection
 * reason, plus the traps that a real Excel export carries and a naive parser
 * fails on.
 *
 * Both units under test are pure, so the awkward cases — a future date, a
 * duplicate three lines apart, a re-upload whose values were edited — are
 * exercised directly rather than by uploading a file and inspecting the
 * result.
 */

const HEADER = "mrn,collected_date,test_code,test_name,value,unit,ref_low,ref_high";

/** Fixed "today" so a test written now still passes next year. */
const TODAY = new Date("2026-08-24T00:00:00.000Z");

const PATIENTS = new Map([
  ["MRN-1001", { id: "p1" }],
  ["MRN-1002", { id: "p2" }],
  ["MRN-1003", { id: "p3" }],
]);

function context(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    patientsByMrn: PATIENTS,
    existingByKey: new Map(),
    today: TODAY,
    ...overrides,
  };
}

/** Parse a CSV body and classify it in one step, asserting the file parsed. */
function run(body: string, ctx: ClassifyContext = context()): ImportReport {
  const parsed = parseLabCsv(body);
  if (!parsed.ok) throw new Error(`expected a parseable file, got: ${parsed.error}`);
  return classifyRows(parsed.rows, ctx);
}

/** A single data row appended to the standard header. */
function oneRow(row: string, ctx: ClassifyContext = context()): ImportReport {
  return run(`${HEADER}\n${row}\n`, ctx);
}

const VALID = "MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99";

/* ======================================================== file envelope === */

describe("parseLabCsv - files it must accept", () => {
  it("parses the supplied clean sample", () => {
    const body = readFileSync(
      join(process.cwd(), ".docs/lab-results-sample-clean.csv"),
      "utf8",
    );
    const parsed = parseLabCsv(body);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(10);
  });

  it("strips a UTF-8 BOM, which is what Excel writes by default", () => {
    const parsed = parseLabCsv(`\uFEFF${HEADER}\n${VALID}\n`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Without bom:true the first header becomes U+FEFF followed by "mrn" and every row
    // rejects for a missing MRN.
    expect(parsed.rows[0].cells.mrn).toBe("MRN-1001");
  });

  it("accepts CRLF line endings", () => {
    const parsed = parseLabCsv(`${HEADER}\r\n${VALID}\r\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
  });

  it("accepts header case and spacing variance", () => {
    const parsed = parseLabCsv(
      ` MRN , Collected Date ,TEST_CODE,test-name,Value,unit,ref_low,ref_high\n${VALID}\n`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].cells.collected_date).toBe("2026-05-02");
  });

  it("accepts quoted fields containing commas", () => {
    const parsed = parseLabCsv(
      `${HEADER}\nMRN-1001,2026-05-02,SBP,"Systolic, seated",128,mmHg,90,120\n`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].cells.test_name).toBe("Systolic, seated");
  });

  it("accepts short rows, treating absent trailing cells as blank", () => {
    const parsed = parseLabCsv(`${HEADER}\nMRN-1001,2026-05-02,GLU-F\n`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].cells.value).toBeUndefined();
  });

  it("accepts over-long rows, ignoring the extra cells", () => {
    const parsed = parseLabCsv(`${HEADER}\n${VALID},EXTRA,MORE\n`);
    expect(parsed.ok).toBe(true);
  });

  it("skips blank lines without shifting the reported line numbers", () => {
    const parsed = parseLabCsv(`${HEADER}\n\n${VALID}\n\n`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    // The row really is on line 3 of the file; that is the number the
    // clinician sees in Excel when they go to fix it.
    expect(parsed.rows[0].line).toBe(3);
  });

  it("reports optional columns that are absent", () => {
    const parsed = parseLabCsv(
      `mrn,collected_date,test_code,value\nMRN-1001,2026-05-02,GLU-F,112\n`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.missingOptionalColumns).toEqual([
      "test_name",
      "unit",
      "ref_low",
      "ref_high",
    ]);
  });
});

describe("parseLabCsv - files it must reject whole", () => {
  it("rejects a file missing a required column, naming it", () => {
    const parsed = parseLabCsv(
      `mrn,collected_date,test_code,unit\nMRN-1001,2026-05-02,GLU-F,mg/dL\n`,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('"value"');
  });

  it("rejects a header with no data rows", () => {
    const parsed = parseLabCsv(`${HEADER}\n`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("no data rows");
  });

  it("rejects an empty file", () => {
    expect(parseLabCsv("").ok).toBe(false);
    expect(parseLabCsv("   \n\n").ok).toBe(false);
  });

  it("rejects a binary file wearing a .csv extension", () => {
    // A PDF renamed to .csv. Detected by the NUL byte rather than left to
    // produce a baffling "missing column" error.
    const parsed = parseLabCsv("%PDF-1.7\n\u0000\u0000binary junk");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("not a text CSV");
  });

  it("rejects a file over the row cap rather than risking a timeout", () => {
    const body = [HEADER, ...Array(MAX_ROWS + 1).fill(VALID)].join("\n");
    const parsed = parseLabCsv(body);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("row limit");
  });

  it("rejects a wrong-but-valid CSV, such as an exported patient list", () => {
    const parsed = parseLabCsv(`name,email,phone
A Patient,a@example.com,123
`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // Every required column is absent, so this is the wrong file rather than a
    // lab CSV with a gap — say so once instead of listing four columns twice.
    expect(parsed.error).toContain("does not look like a lab results CSV");
  });

  it("names the specific gap when only some required columns are missing", () => {
    const parsed = parseLabCsv(
      `mrn,collected_date,unit
MRN-1001,2026-05-02,mg/dL
`,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('"test_code", "value"');
    expect(parsed.error).not.toContain("does not look like");
  });
});

/* ====================================================== the happy path === */

describe("the supplied sample imports cleanly on a fresh database", () => {
  it("accepts all ten rows", () => {
    const body = readFileSync(
      join(process.cwd(), ".docs/lab-results-sample-clean.csv"),
      "utf8",
    );

    const report = run(body);

    // The checkpoint for this phase. It only holds because the seed creates
    // MRN-1001/1002/1003 (D-CSV-3) — without them an evaluator's first upload
    // rejects 10/10 and the feature looks broken.
    expect(report.acceptedCount).toBe(10);
    expect(report.rejectedCount).toBe(0);
    expect(report.skippedDuplicateCount).toBe(0);
  });

  it("re-uploading the same file imports nothing and rejects nothing", () => {
    const body = readFileSync(
      join(process.cwd(), ".docs/lab-results-sample-clean.csv"),
      "utf8",
    );

    const first = run(body);

    // Everything the first pass accepted is now on file.
    const existingByKey = new Map(
      first.pending.map((p) => [
        resultKey(p.patientId, p.collectedDate.toISOString().slice(0, 10), p.testCode),
        { value: p.value },
      ]),
    );

    const second = run(body, context({ existingByKey }));

    expect(second.acceptedCount).toBe(0);
    expect(second.rejectedCount).toBe(0);
    expect(second.skippedDuplicateCount).toBe(10);
    // "Already imported" is not an error, and must not read like one.
    expect(second.rows.every((r) => r.reasons[0] === "Already imported.")).toBe(true);
  });
});

/* ========================================================== rejections === */

describe("rejection: unknown MRN", () => {
  it("rejects a row whose patient does not exist", () => {
    const report = oneRow("MRN-9999,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99");

    expect(report.rejectedCount).toBe(1);
    expect(report.rows[0].reasons[0]).toContain('No patient with MRN "MRN-9999"');
  });

  it("matches MRN case-insensitively", () => {
    const report = oneRow("mrn-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.acceptedCount).toBe(1);
  });

  it("tolerates surrounding whitespace in the MRN", () => {
    const report = oneRow(" MRN-1001 ,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.acceptedCount).toBe(1);
  });
});

describe("rejection: dates", () => {
  const cases: Array<[string, string]> = [
    ["01/06/2026", "not in YYYY-MM-DD format"],
    ["2026-6-1", "not in YYYY-MM-DD format"],
    ["June 1 2026", "not in YYYY-MM-DD format"],
    ["2026-13-01", "not a real date"],
    ["2026-02-30", "not a real date"],
    ["2027-01-01", "in the future"],
  ];

  for (const [date, expected] of cases) {
    it(`rejects "${date}" as ${expected}`, () => {
      const report = oneRow(`MRN-1001,${date},GLU-F,Fasting Glucose,112,mg/dL,70,99`);

      expect(report.rejectedCount).toBe(1);
      expect(report.rows[0].reasons.join(" ")).toContain(expected);
    });
  }

  it("accepts today, which is not the future", () => {
    const report = oneRow("MRN-1001,2026-08-24,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.acceptedCount).toBe(1);
  });

  it("rejects tomorrow", () => {
    const report = oneRow("MRN-1001,2026-08-25,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.rejectedCount).toBe(1);
  });
});

describe("rejection: values", () => {
  const cases: Array<[string, string]> = [
    ["abc", "is not a number"],
    ["7,1", "is not a number"],
    ["<5", "is not a number"],
    ["112 mg/dL", "is not a number"],
    ["1e3", "is not a number"],
    ["-4", "cannot be negative"],
    ["99999999", "implausibly large"],
  ];

  for (const [value, expected] of cases) {
    it(`rejects "${value}"`, () => {
      const report = oneRow(
        `MRN-1001,2026-05-02,GLU-F,Fasting Glucose,"${value}",mg/dL,70,99`,
      );

      expect(report.rejectedCount).toBe(1);
      expect(report.rows[0].reasons.join(" ")).toContain(expected);
    });
  }

  it("accepts a decimal value", () => {
    const report = oneRow("MRN-1001,2026-05-02,HBA1C,Hemoglobin A1c,7.1,%,4.0,5.6");
    expect(report.acceptedCount).toBe(1);
  });

  it("accepts a genuine zero rather than treating it as missing", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,0,mg/dL,70,99");
    expect(report.acceptedCount).toBe(1);
  });
});

describe("rejection: test codes", () => {
  it("rejects an unknown code and lists the supported ones", () => {
    const report = oneRow("MRN-1001,2026-05-02,XYZ,Something,5,u,1,2");

    expect(report.rejectedCount).toBe(1);
    expect(report.rows[0].reasons[0]).toContain('Unknown test code "XYZ"');
    expect(report.rows[0].reasons[0]).toContain("GLU-F");
  });

  it("matches codes case-insensitively", () => {
    const report = oneRow("MRN-1001,2026-05-02,hba1c,Hemoglobin A1c,7.1,%,4.0,5.6");
    expect(report.acceptedCount).toBe(1);
    expect(report.pending[0].testCode).toBe(TestCode.HBA1C);
  });
});

describe("rejection: missing required fields", () => {
  it("rejects a blank MRN", () => {
    const report = oneRow(",2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.rows[0].reasons).toContain("MRN is missing.");
  });

  it("rejects a blank date", () => {
    const report = oneRow("MRN-1001,,GLU-F,Fasting Glucose,112,mg/dL,70,99");
    expect(report.rows[0].reasons).toContain("Collected date is missing.");
  });

  it("rejects a blank test code", () => {
    const report = oneRow("MRN-1001,2026-05-02,,Fasting Glucose,112,mg/dL,70,99");
    expect(report.rows[0].reasons).toContain("Test code is missing.");
  });

  it("rejects a blank value", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,,mg/dL,70,99");
    expect(report.rows[0].reasons).toContain("Value is missing.");
  });

  it("rejects a row that is missing trailing cells entirely", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F");
    expect(report.rows[0].reasons).toContain("Value is missing.");
  });

  it("collects every problem on a row, not just the first", () => {
    const report = oneRow("MRN-9999,not-a-date,XYZ,,abc,,,");

    // A clinician fixing a file wants all of its faults in one pass rather
    // than discovering them one upload at a time.
    expect(report.rows[0].reasons.length).toBe(4);
  });
});

/* ========================================================== duplicates === */

describe("duplicates within a single file", () => {
  it("imports the first and skips the second, citing the line", () => {
    const report = run(
      [HEADER, VALID, VALID].join("\n"),
    );

    expect(report.acceptedCount).toBe(1);
    expect(report.skippedDuplicateCount).toBe(1);
    expect(report.rejectedCount).toBe(0);
    expect(report.rows[1].reasons[0]).toContain("Duplicate of line 2");
  });

  it("treats a differing value on the same key as a duplicate, not a new result", () => {
    const report = run(
      [
        HEADER,
        VALID,
        "MRN-1001,2026-05-02,GLU-F,Fasting Glucose,999,mg/dL,70,99",
      ].join("\n"),
    );

    expect(report.acceptedCount).toBe(1);
    expect(report.skippedDuplicateCount).toBe(1);
    // First occurrence wins, so the stored value is the first one.
    expect(report.pending[0].value).toBe("112");
  });

  it("does not treat a different test on the same day as a duplicate", () => {
    const report = run(
      [
        HEADER,
        VALID,
        "MRN-1001,2026-05-02,HBA1C,Hemoglobin A1c,7.1,%,4.0,5.6",
      ].join("\n"),
    );

    expect(report.acceptedCount).toBe(2);
  });

  it("does not treat the same test on a different day as a duplicate", () => {
    const report = run(
      [
        HEADER,
        VALID,
        "MRN-1001,2026-06-02,GLU-F,Fasting Glucose,104,mg/dL,70,99",
      ].join("\n"),
    );

    expect(report.acceptedCount).toBe(2);
  });
});

describe("duplicates against results already on file", () => {
  const existingByKey = new Map([
    [resultKey("p1", "2026-05-02", TestCode.GLU_F), { value: "112" }],
  ]);

  it("skips an identical row without calling it an error", () => {
    const report = oneRow(VALID, context({ existingByKey }));

    expect(report.skippedDuplicateCount).toBe(1);
    expect(report.rejectedCount).toBe(0);
    expect(report.rows[0].reasons[0]).toBe("Already imported.");
  });

  it("compares values numerically, so 112 and 112.000 are the same result", () => {
    const report = oneRow(
      "MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112.000,mg/dL,70,99",
      context({
        existingByKey: new Map([
          [resultKey("p1", "2026-05-02", TestCode.GLU_F), { value: "112.000" }],
        ]),
      }),
    );

    expect(report.rows[0].reasons[0]).toBe("Already imported.");
  });

  it("refuses to overwrite a changed value, and says what is on file", () => {
    // D-CSV-2. Silently rewriting a stored clinical result on re-upload is the
    // wrong default; the import stays idempotent and the clinician decides.
    const report = oneRow(
      "MRN-1001,2026-05-02,GLU-F,Fasting Glucose,150,mg/dL,70,99",
      context({ existingByKey }),
    );

    expect(report.skippedDuplicateCount).toBe(1);
    expect(report.pending).toHaveLength(0);
    expect(report.rows[0].reasons[0]).toContain("different value (112)");
  });
});

/* ====================================================== partial import === */

describe("partial import", () => {
  it("imports the good rows from a file that also contains bad ones", () => {
    const report = run(
      [
        HEADER,
        VALID, // fine
        "MRN-9999,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,70,99", // unknown MRN
        "MRN-1002,2026-05-15,HBA1C,Hemoglobin A1c,5.4,%,4.0,5.6", // fine
        "MRN-1002,01/06/2026,GLU-F,Fasting Glucose,89,mg/dL,70,99", // bad date
        "MRN-1003,2026-06-20,XYZ,Mystery,1,u,0,1", // unknown code
        VALID, // duplicate of line 2
      ].join("\n"),
    );

    // One bad row must never stop the good ones landing.
    expect(report.acceptedCount).toBe(2);
    expect(report.rejectedCount).toBe(3);
    expect(report.skippedDuplicateCount).toBe(1);
  });

  it("always accounts for every row exactly once", () => {
    const report = run(
      [
        HEADER,
        VALID,
        "MRN-9999,2026-05-02,GLU-F,x,1,mg/dL,70,99",
        VALID,
        "MRN-1002,2026-05-15,HBA1C,x,5.4,%,4,5.6",
      ].join("\n"),
    );

    expect(
      report.acceptedCount + report.rejectedCount + report.skippedDuplicateCount,
    ).toBe(report.totalRows);
    expect(report.rows).toHaveLength(report.totalRows);
  });

  it("only ever offers accepted rows for insertion", () => {
    const report = run(
      [HEADER, VALID, "MRN-9999,2026-05-02,GLU-F,x,1,mg/dL,70,99", VALID].join("\n"),
    );

    expect(report.pending).toHaveLength(report.acceptedCount);
  });
});

/* ================================================ warnings, not errors === */

describe("cosmetic mismatches warn rather than reject", () => {
  it("accepts a mismatched test name and stores the canonical one", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Glucose (fasting),112,mg/dL,70,99");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings[0]).toContain("does not match GLU-F");
    expect(report.pending[0].testName).toBe("Fasting Glucose");
  });

  it("accepts a blank test name and fills in the canonical one", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,,112,mg/dL,70,99");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings).toHaveLength(0);
    expect(report.pending[0].testName).toBe("Fasting Glucose");
  });

  it("does not warn when the unit differs only by case or spacing", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112, MG/DL ,70,99");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings).toHaveLength(0);
    expect(report.pending[0].unit).toBe("mg/dL");
  });

  it("stores a genuinely different unit as reported and flags it", () => {
    // Never relabel: rewriting 5.8 mmol/L as 5.8 mg/dL would turn a normal
    // glucose into a fatal-looking one while appearing to be a tidy-up.
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,5.8,mmol/L,4,6");

    expect(report.acceptedCount).toBe(1);
    expect(report.pending[0].unit).toBe("mmol/L");
    expect(report.rows[0].warnings[0]).toContain("not the expected mg/dL");
  });
});

describe("reference ranges are advisory", () => {
  it("falls back to the catalog range when both bounds are blank", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,,");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings).toHaveLength(0);
    expect(report.pending[0].refLow).toBe("70");
    expect(report.pending[0].refHigh).toBe("99");
  });

  it("keeps a valid supplied range", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,65,100");

    expect(report.pending[0].refLow).toBe("65");
    expect(report.pending[0].refHigh).toBe("100");
  });

  it("warns and falls back on a non-numeric bound, without rejecting the row", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,low,99");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings[0]).toContain("standard 70–99 range");
    expect(report.pending[0].refLow).toBe("70");
  });

  it("warns and falls back on an inverted range", () => {
    const report = oneRow("MRN-1001,2026-05-02,GLU-F,Fasting Glucose,112,mg/dL,99,70");

    expect(report.acceptedCount).toBe(1);
    expect(report.rows[0].warnings[0]).toContain("inverted");
    expect(report.pending[0].refLow).toBe("70");
  });

  it("imports a file with no reference-range columns at all", () => {
    const report = run(
      `mrn,collected_date,test_code,value\nMRN-1001,2026-05-02,GLU-F,112\n`,
    );

    expect(report.acceptedCount).toBe(1);
    expect(report.pending[0].unit).toBe("mg/dL");
    expect(report.pending[0].refLow).toBe("70");
  });
});

/* ============================================================== dates ==== */

describe("stored dates do not drift", () => {
  it("stores the collected date at UTC midnight", () => {
    const report = oneRow(VALID);

    // Constructing from local components would store 1 May west of UTC and
    // shift every chart by a day.
    expect(report.pending[0].collectedDate.toISOString()).toBe(
      "2026-05-02T00:00:00.000Z",
    );
  });
});
