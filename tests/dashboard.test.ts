import { describe, expect, it } from "vitest";

import { DSMA8 } from "@/lib/assessments/definition";
import {
  DEFAULT_UPLOAD_WINDOW,
  NO_ASSESSMENT,
  UPLOAD_WINDOWS,
  completionRate,
  formatRate,
  higherRiskCount,
  parseUploadWindow,
  riskDistribution,
} from "@/lib/dashboard/metrics";
import {
  timeDomain,
  toLabSeries,
  toScoreSeries,
  type LabRow,
} from "@/lib/labs/series";
import { TestCode } from "@/lib/generated/prisma/enums";

/**
 * The dashboard's arithmetic and the charts' data shaping.
 *
 * Both are pure precisely because each has a failure mode that renders as a
 * confident, plausible, wrong answer rather than as an error: a completion rate
 * that divides by zero, a distribution that counts assessments instead of
 * patients, and a chart whose line doubles back because the x-axis was
 * categorical.
 */

/* =================================================== completion rate ===== */

describe("completionRate", () => {
  it("is null, not zero, when nothing has been sent", () => {
    // D-DASH-2. "0%" states a fact not in evidence and reads as a failing
    // practice rather than a new one.
    expect(completionRate(0, 0).rate).toBeNull();
    expect(formatRate(completionRate(0, 0).rate)).toBe("—");
  });

  it("computes completed over sent", () => {
    expect(completionRate(4, 3).rate).toBe(0.75);
    expect(formatRate(completionRate(4, 3).rate)).toBe("75%");
  });

  it("reports 100% when every assessment came back", () => {
    expect(formatRate(completionRate(5, 5).rate)).toBe("100%");
  });

  it("reports 0% when assessments were sent and none came back", () => {
    // Genuinely zero, and distinct from "nothing sent" above.
    expect(formatRate(completionRate(5, 0).rate)).toBe("0%");
  });

  it("treats a negative or nonsensical denominator as nothing sent", () => {
    expect(completionRate(-1, 0).rate).toBeNull();
  });

  it("keeps expired assessments in the denominator", () => {
    // An expiry is a sent assessment that was not completed, which is exactly
    // what the metric measures. Excluding them would flatter the clinic.
    const sent = 10; // 6 completed, 4 expired
    expect(formatRate(completionRate(sent, 6).rate)).toBe("60%");
  });
});

/* ================================================ risk distribution ====== */

describe("riskDistribution", () => {
  const BANDS = DSMA8.scoring.bands.map((b) => b.label);

  it("returns every band plus 'No assessment', in severity order", () => {
    const segments = riskDistribution([]);

    expect(segments.map((s) => s.label)).toEqual([...BANDS, NO_ASSESSMENT]);
  });

  it("keeps empty bands rather than hiding them", () => {
    // A distribution that drops its empty bands changes shape as data arrives
    // and stops being comparable between two glances at it.
    const segments = riskDistribution([{ riskBand: "Low risk" }]);

    expect(segments).toHaveLength(BANDS.length + 1);
    expect(segments.find((s) => s.label === "Very high risk")?.count).toBe(0);
  });

  it("counts each patient once", () => {
    const segments = riskDistribution([
      { riskBand: "Low risk" },
      { riskBand: "Low risk" },
      { riskBand: "High risk" },
    ]);

    expect(segments.find((s) => s.label === "Low risk")?.count).toBe(2);
    expect(segments.find((s) => s.label === "High risk")?.count).toBe(1);
  });

  it("counts patients with no completed assessment as their own segment", () => {
    const segments = riskDistribution([
      { riskBand: "Low risk" },
      { riskBand: null },
      { riskBand: null },
    ]);

    expect(segments.find((s) => s.label === NO_ASSESSMENT)?.count).toBe(2);
  });

  it("always sums to the number of patients", () => {
    // The property that matters: if the segments do not add up to the
    // register, a patient has silently vanished from the clinic's view.
    const patients = [
      { riskBand: "Low risk" },
      { riskBand: "Moderate risk" },
      { riskBand: null },
      { riskBand: "Very high risk" },
      { riskBand: "an unrecognised band from an older version" },
    ];

    const segments = riskDistribution(patients);
    const total = segments.reduce((sum, s) => sum + s.count, 0);

    expect(total).toBe(patients.length);
  });

  it("folds an unrecognised band into 'No assessment' rather than dropping it", () => {
    const segments = riskDistribution([{ riskBand: "Catastrophic" }]);

    expect(segments.find((s) => s.label === NO_ASSESSMENT)?.count).toBe(1);
  });

  it("reports shares that sum to 1", () => {
    const segments = riskDistribution([
      { riskBand: "Low risk" },
      { riskBand: "Low risk" },
      { riskBand: "High risk" },
      { riskBand: null },
    ]);

    const share = segments.reduce((sum, s) => sum + s.share, 0);
    expect(share).toBeCloseTo(1, 10);
  });

  it("reports zero shares rather than NaN when there are no patients", () => {
    // 0/0 renders as "NaN%" on the page if it is not handled here.
    expect(riskDistribution([]).every((s) => s.share === 0)).toBe(true);
  });
});

/* ==================================================== lab series ========= */

function labRow(
  date: string,
  testCode: TestCode,
  value: string,
  refLow: string | null = "70",
  refHigh: string | null = "99",
): LabRow {
  return {
    collectedDate: new Date(`${date}T00:00:00.000Z`),
    testCode,
    value,
    unit: "mg/dL",
    refLow,
    refHigh,
  };
}

describe("higherRiskCount", () => {
  it("counts only the top two bands", () => {
    const segments = riskDistribution([
      { riskBand: "Low risk" },
      { riskBand: "Moderate risk" },
      { riskBand: "High risk" },
      { riskBand: "Very high risk" },
      { riskBand: "Very high risk" },
    ]);

    expect(higherRiskCount(segments)).toBe(3);
  });

  it("never counts the unassessed as higher risk", () => {
    // The dangerous confusion: "no assessment" is missing information, not a
    // good result and not a bad one. Counting it either way would be a claim
    // the data does not support.
    const segments = riskDistribution([
      { riskBand: null },
      { riskBand: null },
      { riskBand: "Low risk" },
    ]);

    expect(higherRiskCount(segments)).toBe(0);
  });

  it("is zero for an empty register", () => {
    expect(higherRiskCount(riskDistribution([]))).toBe(0);
  });

  it("agrees with the chart it sits beside", () => {
    // The tile and the distribution read from one source precisely so they
    // cannot disagree. This is that promise, asserted.
    const patients = [
      { riskBand: "High risk" },
      { riskBand: "High risk" },
      { riskBand: "Very high risk" },
      { riskBand: "Low risk" },
      { riskBand: null },
    ];
    const segments = riskDistribution(patients);
    const fromChart = segments
      .filter((s) => s.label === "High risk" || s.label === "Very high risk")
      .reduce((n, s) => n + s.count, 0);

    expect(higherRiskCount(segments)).toBe(fromChart);
  });
});

describe("toLabSeries", () => {
  it("sorts points chronologically regardless of query order", () => {
    // The bug this prevents: a back-dated result imported after a later one
    // draws a line that doubles back on itself and looks like a real event.
    const series = toLabSeries([
      labRow("2026-06-02", TestCode.GLU_F, "104"),
      labRow("2026-05-02", TestCode.GLU_F, "112"),
      labRow("2026-07-02", TestCode.GLU_F, "98"),
    ]);

    expect(series[0].points.map((p) => p.date)).toEqual([
      "2026-05-02",
      "2026-06-02",
      "2026-07-02",
    ]);
  });

  it("uses a numeric timestamp for x, never a label", () => {
    // A string x-axis is categorical in Recharts: points are spaced evenly in
    // array order, so a year's gap and a day's gap are drawn identically.
    const series = toLabSeries([labRow("2026-05-02", TestCode.GLU_F, "112")]);

    expect(typeof series[0].points[0].t).toBe("number");
    expect(series[0].points[0].t).toBe(Date.UTC(2026, 4, 2));
  });

  it("splits different tests into separate series", () => {
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.GLU_F, "112"),
      labRow("2026-05-02", TestCode.HBA1C, "7.1", "4", "5.6"),
    ]);

    expect(series).toHaveLength(2);
    expect(series.every((s) => s.points).valueOf()).toBe(true);
  });

  it("orders series by the catalog, so every patient reads the same way", () => {
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.SBP, "128", "90", "120"),
      labRow("2026-05-02", TestCode.HBA1C, "7.1", "4", "5.6"),
      labRow("2026-05-02", TestCode.GLU_F, "112"),
    ]);

    expect(series.map((s) => s.testCode)).toEqual([
      TestCode.GLU_F,
      TestCode.HBA1C,
      TestCode.SBP,
    ]);
  });

  it("names the test from the catalog, not from the stored row", () => {
    const series = toLabSeries([labRow("2026-05-02", TestCode.GLU_F, "112")]);
    expect(series[0].name).toBe("Fasting Glucose");
  });

  it("shades a reference band when every result agrees on it", () => {
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.GLU_F, "112"),
      labRow("2026-06-02", TestCode.GLU_F, "104"),
    ]);

    expect(series[0].refLow).toBe(70);
    expect(series[0].refHigh).toBe(99);
  });

  it("shades nothing when two labs disagree about the range", () => {
    // Shading either range would misrepresent half the points.
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.GLU_F, "112", "70", "99"),
      labRow("2026-06-02", TestCode.GLU_F, "104", "65", "105"),
    ]);

    expect(series[0].refLow).toBeNull();
    expect(series[0].refHigh).toBeNull();
  });

  it("shades nothing when the range is absent", () => {
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.GLU_F, "112", null, null),
    ]);

    expect(series[0].refLow).toBeNull();
  });

  it("drops a series whose values are all unparseable rather than plotting NaN", () => {
    const series = toLabSeries([
      labRow("2026-05-02", TestCode.GLU_F, "not-a-number"),
    ]);

    expect(series).toHaveLength(0);
  });

  it("returns nothing for a patient with no results", () => {
    expect(toLabSeries([])).toEqual([]);
  });
});

/* =================================================== score series ======== */

describe("toScoreSeries", () => {
  it("plots only completed assessments", () => {
    // A sent-but-unanswered questionnaire has no score; drawing the line
    // across it would invent one.
    const points = toScoreSeries([
      { completedAt: new Date("2026-05-02T10:00:00Z"), totalScore: 12, riskBand: "Moderate risk" },
      { completedAt: null, totalScore: null, riskBand: null },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].score).toBe(12);
  });

  it("sorts by completion date, not by the order given", () => {
    const points = toScoreSeries([
      { completedAt: new Date("2026-07-02T10:00:00Z"), totalScore: 8, riskBand: "Moderate risk" },
      { completedAt: new Date("2026-05-02T10:00:00Z"), totalScore: 15, riskBand: "High risk" },
    ]);

    expect(points.map((p) => p.score)).toEqual([15, 8]);
  });

  it("keeps a genuine zero score, which is a valid result", () => {
    const points = toScoreSeries([
      { completedAt: new Date("2026-05-02T10:00:00Z"), totalScore: 0, riskBand: "Low risk" },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].score).toBe(0);
  });

  it("returns nothing when no assessment has been completed", () => {
    expect(
      toScoreSeries([{ completedAt: null, totalScore: null, riskBand: null }]),
    ).toEqual([]);
  });
});

/* =================================================== chart x-domain ====== */

describe("timeDomain", () => {
  const DAY = 86_400_000;

  it("spans first to last for a normal series", () => {
    const a = Date.UTC(2026, 4, 2);
    const b = Date.UTC(2026, 6, 2);

    expect(timeDomain([{ t: a }, { t: b }])).toEqual([a, b]);
  });

  it("pads a single reading so it is not drawn on the axis", () => {
    // The case that breaks: one point makes dataMin === dataMax, a zero-width
    // domain, and the marker either vanishes or lands on the axis line. Every
    // new patient has exactly one reading, so this is the common case, not
    // the exotic one.
    const t = Date.UTC(2026, 4, 2);

    expect(timeDomain([{ t }])).toEqual([t - 7 * DAY, t + 7 * DAY]);
  });

  it("pads when several readings share one date", () => {
    const t = Date.UTC(2026, 4, 2);
    const [lo, hi] = timeDomain([{ t }, { t }]);

    expect(hi).toBeGreaterThan(lo);
  });

  it("survives an empty series without producing NaN", () => {
    expect(timeDomain([])).toEqual([0, 0]);
  });
});

/* ================================================== upload window ======== */

describe("parseUploadWindow", () => {
  const NOW = new Date("2026-08-24T12:00:00.000Z");

  it("resolves a known window to its cutoff", () => {
    const w = parseUploadWindow("7", NOW);

    expect(w.days).toBe(7);
    expect(w.since?.toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  it("treats 'all' as no cutoff at all", () => {
    const w = parseUploadWindow("all", NOW);

    expect(w.days).toBeNull();
    expect(w.since).toBeNull();
  });

  it("falls back to the default when the parameter is absent", () => {
    expect(parseUploadWindow(undefined, NOW).key).toBe(DEFAULT_UPLOAD_WINDOW);
  });

  it("falls back rather than throwing on a hand-edited URL", () => {
    // The value arrives straight from a query string, so it can be anything.
    // Querying on a NaN date would fail at the database, not here.
    for (const junk of ["", "0", "-5", "9999999999", "'; drop table", "NaN", "30 "]) {
      const w = parseUploadWindow(junk, NOW);
      expect(w.key, junk).toBe(DEFAULT_UPLOAD_WINDOW);
      expect(w.since === null || !Number.isNaN(w.since.getTime())).toBe(true);
    }
  });

  it("offers a default that is one of the options", () => {
    expect(UPLOAD_WINDOWS.some((w) => w.key === DEFAULT_UPLOAD_WINDOW)).toBe(true);
  });
});
