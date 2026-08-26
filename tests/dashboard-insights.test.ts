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
  monthlyClinicMeans,
  monthlyVolume,
  monthStart,
  patientMonthlyMeans,
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

/* ------------------------------------------------ unit integrity, end to end -- */

describe("a result in an incompatible unit", () => {
  // One 5.4 mmol/L glucose reading against a register recorded in mg/dL. The
  // importer stores it exactly as reported and flags it rather than converting,
  // which is right — relabelling it as mg/dL invents a reading wrong by a
  // factor of eighteen. This block is the other half of that decision: correct
  // on import, and a trap on every aggregate, so it must reach none of them.
  const raw: InsightRow[] = [
    row("p1", TestCode.GLU_F, "2026-07-01", 150),
    row("p1", TestCode.GLU_F, "2026-07-10", 160),
    row("stray", TestCode.GLU_F, "2026-07-02", 5.4, "mmol/L"),
  ];

  const { rows, excludedForUnit, excludedByTest } = usableRows(raw);

  it("is counted, in total and against its own test", () => {
    expect(excludedForUnit).toBe(1);
    expect(excludedByTest[TestCode.GLU_F]).toBe(1);
    expect(excludedByTest[TestCode.HBA1C]).toBe(0);
  });

  it("does not reach the histogram", () => {
    const insight = testInsight(rows, TestCode.GLU_F, excludedForUnit);
    const plotted = insight.buckets.reduce((sum, b) => sum + b.count, 0);

    expect(plotted).toBe(2);
    // A 5.4 bucket would sit far below every real reading and stretch the axis
    // across a range the register does not occupy.
    expect(insight.buckets.every((b) => b.from >= 50)).toBe(true);
  });

  it("does not reach the clinic trend", () => {
    const points = monthlyClinicMeans(rows, TestCode.GLU_F);

    expect(points[0].mean).toBe(155);
    expect(points[0].resultCount).toBe(2);
  });

  it("does not reach the latest-value population metrics", () => {
    const insight = testInsight(rows, TestCode.GLU_F, excludedForUnit);

    // "stray" is a patient with no usable reading, so they are not a patient
    // this figure can describe at all — not a patient counted as in range.
    expect(insight.patientCount).toBe(1);
    expect(latestPerPatient(rows, TestCode.GLU_F).map((l) => l.patientId)).toEqual(
      ["p1"],
    );
    expect(insight.belowRangeCount).toBe(0);
  });

  it("is left exactly as it was stored, because nothing here converts anything", () => {
    // The narrowing must be a read, not a write. The patient's own record keeps
    // the value and the unit as reported; this module only declines to average
    // them.
    const stray = raw[2];

    expect(stray.value).toBe(5.4);
    expect(stray.unit).toBe("mmol/L");
    expect(raw).toHaveLength(3);
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
    expect(buckets[buckets.length - 1].closed).toBe(true);
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

  it("handles a single value without producing a zero-width axis", () => {
    const buckets = histogram([7.2], TestCode.HBA1C);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(1);
  });

  /* ------------------------------------------------------------ boundaries - */

  it("counts a value on a bucket edge exactly once, in the bucket that starts there", () => {
    // The bug this guards: (5.5 - 4.0) / 0.5 is 2.9999999999999996 in IEEE 754,
    // so a plain Math.floor files an HbA1c of exactly 5.5 into the 5.0–5.5
    // bucket — one bucket below the one whose label names it.
    const buckets = histogram([5.5], TestCode.HBA1C);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].from).toBe(5.5);
    expect(buckets[0].count).toBe(1);
  });

  it("puts every boundary value in exactly one bucket, and none in two", () => {
    // Every bucket edge across the range, fed back in as values.
    const edges = [70, 90, 110, 130, 150];
    const buckets = histogram(edges, TestCode.GLU_F);

    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(edges.length);

    for (const edge of edges) {
      const holding = buckets.filter((b) => b.count > 0 && b.from === edge);
      expect(holding).toHaveLength(1);
    }
  });

  it("has buckets that touch without overlapping", () => {
    const buckets = histogram([60, 200], TestCode.GLU_F);

    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i].from).toBe(buckets[i - 1].to);
    }
  });

  it("shows no more decimals than the measure is reported at", () => {
    for (const bucket of histogram([60, 200], TestCode.GLU_F)) {
      expect(bucket.label).toMatch(/^\d+–\d+$/);
    }
  });

  it("spells each edge the same way in the label and on its own", () => {
    // The tooltip writes the edges into a sentence rather than a range, and
    // "5.5 to under 6" beside an axis labelled "5.5–6.0" makes a reader decide
    // which of two spellings of one number to trust.
    for (const bucket of histogram([4.0, 9.0], TestCode.HBA1C)) {
      expect(bucket.label).toBe(`${bucket.fromLabel}–${bucket.toLabel}`);
      expect(bucket.fromLabel).toMatch(/^\d+\.\d$/);
    }
  });

  /* -------------------------------------------------- reference alignment -- */

  it("anchors the bucket grid at the reference floor, so the floor is an edge", () => {
    const buckets = histogram([60, 200], TestCode.GLU_F);

    expect(buckets.some((b) => b.from === 70)).toBe(true);
  });

  it("gives systolic pressure a grid where both limits are edges", () => {
    // 90 and 120, at a width of 5. Neither limit falls inside a bucket, so no
    // bucket has to be marked as spanning one.
    const buckets = histogram([85, 140], TestCode.SBP);

    expect(buckets.some((b) => b.from === 90)).toBe(true);
    expect(buckets.some((b) => b.from === 120)).toBe(true);
    expect(buckets.filter((b) => b.status === "straddles")).toHaveLength(0);
  });

  it("never calls a bucket in-range when part of it is out of range", () => {
    // Glucose's ceiling is 99, which falls inside the 90–110 bucket. Calling
    // that bucket "within" would tell a clinician the readings in it are fine
    // when some of them are not.
    const buckets = histogram([60, 200], TestCode.GLU_F);
    const straddler = buckets.find((b) => b.from === 90)!;

    expect(straddler.status).toBe("straddles");
    expect(straddler.boundary).toBe(99);
  });

  it("tells a below-range bucket apart from an in-range one", () => {
    // Hypoglycaemia read as "not above the ceiling" under the old two-state
    // rule and was painted the same as a perfectly normal bucket.
    const buckets = histogram([55, 75], TestCode.GLU_F);

    expect(buckets.find((b) => b.from === 50)!.status).toBe("below");
    expect(buckets.find((b) => b.from === 70)!.status).toBe("within");
  });

  it("marks buckets wholly above the ceiling as above", () => {
    const buckets = histogram([5.0, 9.9], TestCode.HBA1C);

    // 5.0–5.5 is inside HbA1c's 4.0–5.6 range; 9.5–10.0 is well past it.
    expect(buckets[0].status).toBe("within");
    expect(buckets[buckets.length - 1].status).toBe("above");
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

  it("splits the register into below, within and above, and they sum to the patients", () => {
    const insight = testInsight(
      usable([
        row("low", TestCode.GLU_F, "2026-01-01", 60),
        row("ok", TestCode.GLU_F, "2026-01-01", 85),
        row("high", TestCode.GLU_F, "2026-01-01", 150),
      ]),
      TestCode.GLU_F,
    );

    expect(insight.belowRangeCount).toBe(1);
    expect(insight.withinRangeCount).toBe(1);
    expect(insight.aboveRangeCount).toBe(1);
    expect(
      insight.belowRangeCount + insight.withinRangeCount + insight.aboveRangeCount,
    ).toBe(insight.patientCount);
  });

  it("treats both reference limits as in range", () => {
    // A patient sitting exactly on the ceiling is in range, not above it.
    const insight = testInsight(
      usable([
        row("floor", TestCode.GLU_F, "2026-01-01", 70),
        row("ceiling", TestCode.GLU_F, "2026-01-01", 99),
      ]),
      TestCode.GLU_F,
    );

    expect(insight.withinRangeCount).toBe(2);
    expect(insight.aboveRangeCount).toBe(0);
    expect(insight.belowRangeCount).toBe(0);
  });

  it("takes the median over one reading per patient, not over every reading", () => {
    // p1 has four readings and p2 one. Over every reading the median is 100;
    // over the latest per patient it is the midpoint of 190 and 200.
    const insight = testInsight(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-01", 100),
        row("p1", TestCode.GLU_F, "2026-02-01", 100),
        row("p1", TestCode.GLU_F, "2026-03-01", 100),
        row("p1", TestCode.GLU_F, "2026-04-01", 190),
        row("p2", TestCode.GLU_F, "2026-01-01", 200),
      ]),
      TestCode.GLU_F,
    );

    expect(insight.patientCount).toBe(2);
    expect(insight.medianLatest).toBe(195);
  });

  it("does not offer a clinician a median carrying floating-point noise", () => {
    // (5.1 + 5.2) / 2 evaluates to 5.1499999999999995.
    const insight = testInsight(
      usable([
        row("p1", TestCode.HBA1C, "2026-01-01", 5.1, "%"),
        row("p2", TestCode.HBA1C, "2026-01-01", 5.2, "%"),
      ]),
      TestCode.HBA1C,
    );

    expect(insight.medianLatest).toBe(5.15);
  });

  it("keeps a genuine half in a median rather than rounding it away", () => {
    // Glucose is displayed to whole numbers, but the midpoint of 110 and 111
    // is a real 110.5 — reporting 111 names a reading nobody took.
    const insight = testInsight(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-01", 110),
        row("p2", TestCode.GLU_F, "2026-01-01", 111),
      ]),
      TestCode.GLU_F,
    );

    expect(insight.medianLatest).toBe(110.5);
  });

  it("reports a test with no results without throwing", () => {
    const insight = testInsight(rows, TestCode.SBP);

    expect(insight.resultCount).toBe(0);
    expect(insight.patientCount).toBe(0);
    expect(insight.medianLatest).toBeNull();
    expect(insight.buckets).toEqual([]);
  });

  it("carries its own excluded-for-unit count, so a panel can explain its gap", () => {
    const { rows: usableGlucose, excludedByTest } = usableRows([
      row("p1", TestCode.GLU_F, "2026-01-01", 5.4, "mmol/L"),
      row("p2", TestCode.GLU_F, "2026-01-02", 5.9, "mmol/L"),
    ]);

    const insight = testInsight(
      usableGlucose,
      TestCode.GLU_F,
      excludedByTest[TestCode.GLU_F],
    );

    expect(insight.resultCount).toBe(0);
    expect(insight.excludedForUnit).toBe(2);
  });
});

/* ------------------------------------------------------------ monthly ----- */

describe("patientMonthlyMeans", () => {
  it("averages each patient within each month, and nothing across patients", () => {
    const entries = patientMonthlyMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-06-14", 120),
        row("A", TestCode.GLU_F, "2026-06-27", 140),
        row("B", TestCode.GLU_F, "2026-06-09", 180),
      ]),
      TestCode.GLU_F,
    );

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.patientId === "A")!.mean).toBe(120);
    expect(entries.find((e) => e.patientId === "A")!.resultCount).toBe(3);
    expect(entries.find((e) => e.patientId === "B")!.mean).toBe(180);
  });

  it("keeps a patient's months separate from one another", () => {
    const entries = patientMonthlyMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-07-02", 200),
      ]),
      TestCode.GLU_F,
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.mean).sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it("ignores other tests", () => {
    const entries = patientMonthlyMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.HBA1C, "2026-06-02", 7, "%"),
      ]),
      TestCode.HBA1C,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].mean).toBe(7);
  });
});

describe("monthlyClinicMeans", () => {
  it("weights each patient equally, not each result", () => {
    // The case the whole method exists for. Patient A has three readings and
    // patient B one. The mean of the four results is 135 — a figure about the
    // appointment book as much as about the glucose. The mean of the two
    // patient-level monthly means is 150.
    const points = monthlyClinicMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-06-14", 120),
        row("A", TestCode.GLU_F, "2026-06-27", 140),
        row("B", TestCode.GLU_F, "2026-06-09", 180),
      ]),
      TestCode.GLU_F,
    );

    expect(points).toHaveLength(1);
    expect(points[0].mean).toBe(150);
    expect(points[0].mean).not.toBe(135);
  });

  it("is the plain arithmetic mean when every patient contributes one reading", () => {
    // The normalisation must not move a figure that has nothing to normalise.
    const points = monthlyClinicMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("B", TestCode.GLU_F, "2026-06-09", 140),
        row("C", TestCode.GLU_F, "2026-06-20", 180),
      ]),
      TestCode.GLU_F,
    );

    expect(points[0].mean).toBe(140);
    expect(points[0].patientCount).toBe(3);
    expect(points[0].resultCount).toBe(3);
  });

  it("normalises each month independently of the others", () => {
    // A dominates June with three readings and is absent in July. If the
    // normalisation leaked across months, July would carry A's weight too.
    const points = monthlyClinicMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-06-14", 120),
        row("A", TestCode.GLU_F, "2026-06-27", 140),
        row("B", TestCode.GLU_F, "2026-06-09", 180),
        row("B", TestCode.GLU_F, "2026-07-09", 200),
        row("C", TestCode.GLU_F, "2026-07-15", 100),
      ]),
      TestCode.GLU_F,
    );

    expect(points.map((p) => p.month)).toEqual(["2026-06", "2026-07"]);
    expect(points[0].mean).toBe(150);
    expect(points[1].mean).toBe(150);
    expect(points[0].patientCount).toBe(2);
    expect(points[1].patientCount).toBe(2);
  });

  it("counts patients and results separately, because they are different numbers", () => {
    const points = monthlyClinicMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-06-14", 120),
        row("B", TestCode.GLU_F, "2026-06-09", 180),
      ]),
      TestCode.GLU_F,
    );

    expect(points[0].patientCount).toBe(2);
    expect(points[0].resultCount).toBe(3);
  });

  it("keeps a month supported by a single patient, and says so", () => {
    // A thin month is a real finding, not a reason to hide the point. The
    // patient count is what tells a reader how much weight to give it.
    const points = monthlyClinicMeans(
      usable([
        row("A", TestCode.GLU_F, "2026-06-02", 100),
        row("A", TestCode.GLU_F, "2026-07-02", 220),
      ]),
      TestCode.GLU_F,
    );

    expect(points).toHaveLength(2);
    expect(points[1].patientCount).toBe(1);
    expect(points[1].mean).toBe(220);
  });

  it("omits months with no results rather than plotting a zero", () => {
    // A zero would draw as a catastrophic reading. February has no mean.
    const points = monthlyClinicMeans(
      usable([
        row("p1", TestCode.GLU_F, "2026-01-05", 100),
        row("p1", TestCode.GLU_F, "2026-03-05", 120),
      ]),
      TestCode.GLU_F,
    );

    expect(points.map((p) => p.month)).toEqual(["2026-01", "2026-03"]);
    expect(points.every((p) => p.mean > 0)).toBe(true);
  });

  it("returns nothing at all for a test with no results", () => {
    expect(monthlyClinicMeans([], TestCode.GLU_F)).toEqual([]);
  });

  it("sorts on the timestamp, not on a formatted label", () => {
    // "Feb 26" sorts before "Jan 26" alphabetically; the year would draw
    // backwards and nothing about the chart would look wrong.
    const points = monthlyClinicMeans(
      usable([
        row("p1", TestCode.GLU_F, "2026-02-05", 100),
        row("p1", TestCode.GLU_F, "2026-01-05", 110),
        row("p1", TestCode.GLU_F, "2025-12-05", 120),
      ]),
      TestCode.GLU_F,
    );

    expect(points.map((p) => p.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].t).toBeGreaterThan(points[i - 1].t);
    }
  });

  it("files a first-of-the-month reading under that month, not the one before", () => {
    // 2026-07-01 at midnight UTC is 30 June anywhere west of Greenwich. Read
    // from local parts, this point lands in June and the whole series shifts.
    const points = monthlyClinicMeans(
      usable([row("p1", TestCode.GLU_F, "2026-07-01", 100)]),
      TestCode.GLU_F,
    );

    expect(points[0].month).toBe("2026-07");
    expect(monthKey(new Date(points[0].t))).toBe("2026-07");
  });

  it("files a last-of-the-month reading under that month, not the next one", () => {
    const points = monthlyClinicMeans(
      usable([row("p1", TestCode.GLU_F, "2026-12-31", 100)]),
      TestCode.GLU_F,
    );

    expect(points[0].month).toBe("2026-12");
  });

  it("rounds to the precision the test is reported at, and only at the end", () => {
    const points = monthlyClinicMeans(
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

  it("rounds the patient means once, not twice", () => {
    // A patient at 7.05 and 7.06 has a mean of 7.055. Rounding that to 7.1
    // before averaging it with a second patient at 7.0 gives 7.05 -> 7.1;
    // carrying it unrounded gives 7.0275 -> 7.0. The second is correct.
    const points = monthlyClinicMeans(
      usable([
        row("p1", TestCode.HBA1C, "2026-01-05", 7.05, "%"),
        row("p1", TestCode.HBA1C, "2026-01-06", 7.06, "%"),
        row("p2", TestCode.HBA1C, "2026-01-07", 7.0, "%"),
      ]),
      TestCode.HBA1C,
    );

    expect(points[0].mean).toBe(7);
  });

  it("leaves out a result in a non-canonical unit", () => {
    // The mmol/L reading must not reach the trend. Were it counted, the mean
    // of 150 and 5.4 would be 77.7 and the line would fall off a cliff.
    const points = monthlyClinicMeans(
      usable([
        row("p1", TestCode.GLU_F, "2026-07-01", 150),
        row("p2", TestCode.GLU_F, "2026-07-02", 5.4, "mmol/L"),
      ]),
      TestCode.GLU_F,
    );

    expect(points[0].mean).toBe(150);
    expect(points[0].patientCount).toBe(1);
    expect(points[0].resultCount).toBe(1);
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
