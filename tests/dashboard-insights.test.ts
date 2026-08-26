import { describe, expect, it } from "vitest";

import { DSMA8, QUESTION_IDS } from "@/lib/assessments/definition";
import {
  BUCKET_WIDTH,
  MAX_ITEM_MEAN,
  histogram,
  itemBreakdown,
  latestPerPatient,
  median,
  monthKey,
  monthlyMeans,
  monthlyVolume,
  monthStart,
  testInsight,
  usableRows,
  type InsightRow,
} from "@/lib/dashboard/insights";
import { TestCode } from "@/lib/generated/prisma/enums";

const DAY = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function row(
  patientId: string,
  testCode: TestCode,
  iso: string,
  value: number,
  unit = "mg/dL",
): InsightRow {
  return { patientId, testCode, collectedDate: DAY(iso), value, unit };
}

const usable = (rows: InsightRow[]) => usableRows(rows).rows;

/* --------------------------------------------------------- unit filtering -- */

describe("usableRows", () => {
  it("drops a result recorded in a different unit, and counts it", () => {
    // The importer stores 5.4 mmol/L exactly as reported and flags it, rather
    // than converting (.docs/05-ugly-csv-expected-outcomes.md, row 7). Right on
    // import; averaging it in with mg/dL would be adding millimoles to
    // milligrams and would drag the clinic mean down invisibly.
    const result = usableRows([
      row("p1", TestCode.GLU_F, "2026-07-01", 150),
      row("p2", TestCode.GLU_F, "2026-07-02", 5.4, "mmol/L"),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.excludedForUnit).toBe(1);
  });

  it("accepts a unit that differs only by case or padding", () => {
    const result = usableRows([
      row("p1", TestCode.GLU_F, "2026-07-01", 150, "MG/DL"),
      row("p2", TestCode.GLU_F, "2026-07-02", 160, "  mg/dL "),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.excludedForUnit).toBe(0);
  });

  it("uses each test's own canonical unit, not one shared unit", () => {
    const result = usableRows([
      row("p1", TestCode.HBA1C, "2026-07-01", 7.2, "%"),
      row("p1", TestCode.SBP, "2026-07-01", 130, "mmHg"),
      row("p1", TestCode.GLU_F, "2026-07-01", 150, "mg/dL"),
    ]);

    expect(result.rows).toHaveLength(3);
  });

  it("drops a value that does not parse, rather than turning a mean into NaN", () => {
    const result = usableRows([
      { ...row("p1", TestCode.GLU_F, "2026-07-01", 0), value: "not a number" },
      row("p2", TestCode.GLU_F, "2026-07-02", 150),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.excludedForUnit).toBe(0);
  });
});

/* ------------------------------------------------------------- month keys -- */

describe("month keys", () => {
  it("reads the month from UTC parts, so no result shifts a month", () => {
    // 1 July at midnight UTC is 30 June locally west of Greenwich. Building
    // this from local components would file it under the wrong month.
    expect(monthKey(DAY("2026-07-01"))).toBe("2026-07");
    expect(monthKey(DAY("2026-12-31"))).toBe("2026-12");
  });

  it("round-trips a key to the start of its month", () => {
    expect(monthKey(new Date(monthStart("2026-02")))).toBe("2026-02");
  });
});

/* --------------------------------------------------- latest per patient --- */

describe("latestPerPatient", () => {
  it("counts each patient once, at their most recent reading", () => {
    const rows = usable([
      row("p1", TestCode.GLU_F, "2026-01-01", 100),
      row("p1", TestCode.GLU_F, "2026-06-01", 180),
      row("p1", TestCode.GLU_F, "2026-03-01", 140),
      row("p2", TestCode.GLU_F, "2026-02-01", 90),
    ]);

    const latest = latestPerPatient(rows, TestCode.GLU_F);

    expect(latest).toHaveLength(2);
    expect(latest.find((l) => l.patientId === "p1")!.value).toBe(180);
  });

  it("does not let one well-monitored patient dominate the register", () => {
    const rows = usable([
      ...Array.from({ length: 12 }, (_, i) =>
        row("keen", TestCode.HBA1C, `2026-0${(i % 9) + 1}-01`, 9, "%"),
      ),
      row("other", TestCode.HBA1C, "2026-01-01", 5, "%"),
    ]);

    expect(latestPerPatient(rows, TestCode.HBA1C)).toHaveLength(2);
  });

  it("ignores other tests", () => {
    const rows = usable([
      row("p1", TestCode.GLU_F, "2026-01-01", 100),
      row("p1", TestCode.SBP, "2026-06-01", 130, "mmHg"),
    ]);

    expect(latestPerPatient(rows, TestCode.SBP)).toHaveLength(1);
    expect(latestPerPatient(rows, TestCode.SBP)[0].value).toBe(130);
  });
});

/* -------------------------------------------------------------- histogram -- */

describe("histogram", () => {
  it("returns nothing for no values rather than an axis with no bars", () => {
    expect(histogram([], TestCode.HBA1C)).toEqual([]);
  });

  it("keeps every value, including the maximum, inside a bucket", () => {
    const values = [5.4, 6.1, 7.0, 7.4, 9.9];
    const buckets = histogram(values, TestCode.HBA1C);

    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(values.length);
    // The top bucket is closed so the maximum does not fall off the end.
    expect(buckets[buckets.length - 1].count).toBeGreaterThan(0);
  });

  it("keeps empty interior buckets, because the gaps are the shape", () => {
    const buckets = histogram([5.0, 9.0], TestCode.HBA1C);

    expect(buckets.length).toBeGreaterThan(2);
    expect(buckets.some((b) => b.count === 0)).toBe(true);
  });

  it("uses fixed widths, so the same chart means the same thing twice", () => {
    const narrow = histogram([7.0, 7.4], TestCode.HBA1C);
    const wide = histogram([5.0, 9.9], TestCode.HBA1C);

    for (const b of [...narrow, ...wide]) {
      expect(Number((b.to - b.from).toFixed(6))).toBe(
        BUCKET_WIDTH[TestCode.HBA1C],
      );
    }
  });

  it("labels buckets without floating-point drift", () => {
    // Stepping by repeated addition of 0.5 produces "7.000000000000001".
    for (const bucket of histogram([4.0, 12.0], TestCode.HBA1C)) {
      expect(bucket.label).toMatch(/^\d+\.\d–\d+\.\d$/);
    }
  });

  it("marks only the buckets that sit wholly above the reference ceiling", () => {
    const buckets = histogram([5.0, 9.9], TestCode.HBA1C);
    // HbA1c refHigh is 5.6, so the 5.0–5.5 bucket straddles nothing above it.
    expect(buckets[0].aboveRange).toBe(false);
    expect(buckets[buckets.length - 1].aboveRange).toBe(true);
  });

  it("handles a single value without producing a zero-width axis", () => {
    const buckets = histogram([7.2], TestCode.HBA1C);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(1);
  });
});

/* ----------------------------------------------------------------- median -- */

describe("median", () => {
  it("is null for no values, not zero", () => {
    expect(median([])).toBeNull();
  });

  it("averages the middle pair on an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not move when one outlier arrives, which is why it is the headline", () => {
    expect(median([100, 110, 120])).toBe(110);
    expect(median([100, 110, 120, 900])).toBe(115);
    // The mean of the second set is 307.5 — worse than any of the first three
    // patients and worse than three of the four.
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

/* ---------------------------------------------------------- test insight --- */

describe("testInsight", () => {
  const rows = usable([
    row("p1", TestCode.HBA1C, "2026-01-01", 5.2, "%"),
    row("p1", TestCode.HBA1C, "2026-06-01", 8.4, "%"),
    row("p2", TestCode.HBA1C, "2026-02-01", 5.1, "%"),
    row("p3", TestCode.HBA1C, "2026-03-01", 9.0, "%"),
  ]);

  it("counts results for the histogram and patients for the headline", () => {
    const insight = testInsight(rows, TestCode.HBA1C);

    expect(insight.resultCount).toBe(4);
    expect(insight.patientCount).toBe(3);
  });

  it("counts above-range on the latest reading, not on every reading", () => {
    const insight = testInsight(rows, TestCode.HBA1C);

    // p1's 5.2 is in range but superseded by 8.4; p2 is in range; p3 is above.
    expect(insight.aboveRangeCount).toBe(2);
  });

  it("reports a test with no results without throwing", () => {
    const insight = testInsight(rows, TestCode.SBP);

    expect(insight.resultCount).toBe(0);
    expect(insight.patientCount).toBe(0);
    expect(insight.medianLatest).toBeNull();
    expect(insight.buckets).toEqual([]);
  });
});

/* ------------------------------------------------------------ monthly ----- */

describe("monthlyMeans", () => {
  it("averages within a month and sorts chronologically", () => {
    const points = monthlyMeans(
      usable([
        row("p1", TestCode.GLU_F, "2026-03-05", 100),
        row("p2", TestCode.GLU_F, "2026-01-05", 200),
        row("p2", TestCode.GLU_F, "2026-03-25", 140),
      ]),
      TestCode.GLU_F,
    );

    expect(points.map((p) => p.month)).toEqual(["2026-01", "2026-03"]);
    expect(points[1].mean).toBe(120);
    expect(points[1].count).toBe(2);
  });

  it("omits months with no results rather than plotting a zero", () => {
    // A zero would draw as a catastrophic reading. February has no mean.
    const points = monthlyMeans(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-05", 100),
        row("p1", TestCode.GLU_F, "2026-03-05", 120),
      ]),
      TestCode.GLU_F,
    );

    expect(points.map((p) => p.month)).toEqual(["2026-01", "2026-03"]);
  });

  it("rounds to the precision the test is reported at", () => {
    const points = monthlyMeans(
      usable([
        row("p1", TestCode.HBA1C, "2026-01-05", 7.1, "%"),
        row("p2", TestCode.HBA1C, "2026-01-06", 7.2, "%"),
        row("p3", TestCode.HBA1C, "2026-01-07", 8.6, "%"),
      ]),
      TestCode.HBA1C,
    );

    // 7.633333... is not a number to offer a clinician.
    expect(points[0].mean).toBe(7.6);
  });
});

describe("monthlyVolume", () => {
  it("fills months with nothing collected, because a gap is the finding", () => {
    const points = monthlyVolume(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-05", 100),
        row("p1", TestCode.GLU_F, "2026-04-05", 120),
      ]),
    );

    expect(points.map((p) => p.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(points[1].total).toBe(0);
  });

  it("rolls over a year boundary", () => {
    // Adding 30 days per step lands on the wrong month; setUTCMonth does not.
    const points = monthlyVolume(
      usable([
        row("p1", TestCode.GLU_F, "2025-11-05", 100),
        row("p1", TestCode.GLU_F, "2026-02-05", 120),
      ]),
    );

    expect(points.map((p) => p.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("splits a month by test and totals it", () => {
    const points = monthlyVolume(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-05", 100),
        row("p1", TestCode.HBA1C, "2026-01-05", 7, "%"),
        row("p2", TestCode.HBA1C, "2026-01-06", 8, "%"),
      ]),
    );

    expect(points[0].total).toBe(3);
    expect(points[0].byTest[TestCode.HBA1C]).toBe(2);
    expect(points[0].byTest[TestCode.SBP]).toBe(0);
  });

  it("returns nothing for no rows rather than a run of empty months", () => {
    expect(monthlyVolume([])).toEqual([]);
  });
});

/* ------------------------------------------------------- item breakdown --- */

describe("itemBreakdown", () => {
  const answers = [
    ...QUESTION_IDS.map((questionId) => ({ questionId, score: 0 })),
    { questionId: "q7", score: 3 },
    { questionId: "q7", score: 3 },
    { questionId: "q3", score: 2 },
  ];

  it("returns every item, even ones nobody answered", () => {
    const rows = itemBreakdown([{ questionId: "q1", score: 3 }]);

    expect(rows).toHaveLength(DSMA8.items.length);
    expect(rows.filter((r) => r.n === 0)).toHaveLength(
      DSMA8.items.length - 1,
    );
  });

  it("sorts worst first, because the reason to look is to decide where to act", () => {
    const rows = itemBreakdown(answers);

    expect(rows[0].id).toBe("q7");
    expect(rows[1].id).toBe("q3");
  });

  it("keeps questionnaire order as the tie-break, so the list is stable", () => {
    const flat = QUESTION_IDS.map((questionId) => ({ questionId, score: 1 }));

    expect(itemBreakdown(flat).map((r) => r.id)).toEqual([...QUESTION_IDS]);
  });

  it("counts each option and computes the mean over answers, not over patients", () => {
    const q7 = itemBreakdown(answers).find((r) => r.id === "q7")!;

    expect(q7.n).toBe(3);
    expect(q7.counts).toEqual([1, 0, 0, 2]);
    expect(q7.mean).toBe(2);
  });

  it("counts 'more than half the days' or worse as frequent", () => {
    const q7 = itemBreakdown(answers).find((r) => r.id === "q7")!;
    expect(q7.frequentCount).toBe(2);

    const q1 = itemBreakdown(answers).find((r) => r.id === "q1")!;
    expect(q1.frequentCount).toBe(0);
  });

  it("gives an unanswered item a null mean rather than zero", () => {
    // Zero means "answered, never" — the opposite of "no signal".
    const rows = itemBreakdown([]);
    expect(rows.every((r) => r.mean === null)).toBe(true);
  });

  it("ignores ids and values that are not part of this instrument", () => {
    const rows = itemBreakdown([
      { questionId: "q1", score: 3 },
      { questionId: "q99", score: 3 },
      { questionId: "q1", score: 7 },
    ]);

    const q1 = rows.find((r) => r.id === "q1")!;
    expect(q1.n).toBe(1);
    expect(q1.mean).toBe(3);
  });

  it("reads its ceiling from the option set", () => {
    expect(MAX_ITEM_MEAN).toBe(Math.max(...DSMA8.options.map((o) => o.value)));
  });
});
