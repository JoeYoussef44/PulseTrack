import { toIsoDate } from "@/lib/validation/patient";
import { findByCode } from "./test-catalog";

import type { TestCode } from "@/lib/generated/prisma/enums";

/**
 * Shaping stored results into something a chart can plot.
 *
 * Small, but it is where the one genuinely dangerous charting bug lives, so it
 * is pure and tested rather than inlined into a component.
 *
 * ## The trap
 *
 * Recharts treats an x-axis of strings as *categorical*: it plots the points in
 * array order and spaces them evenly, whatever the labels say. Two consequences,
 * both of which produce a chart that looks perfectly plausible and is wrong:
 *
 *  1. A result imported out of order — a March value uploaded after a June one —
 *     draws a line that doubles back on itself.
 *  2. Readings a year apart and a day apart are drawn the same distance apart,
 *     so the shape of the trend is fiction.
 *
 * Both are fixed the same way: the x value is a **timestamp number** on a time
 * scale, and the series is sorted chronologically here rather than relying on
 * whatever order the query happened to return.
 */

export interface SeriesPoint {
  /** Milliseconds since epoch — a numeric, time-scaled x, never a label. */
  t: number;
  value: number;
  /** Kept for the tooltip and the table, so neither reformats the date itself. */
  date: string;
}

export interface LabSeries {
  testCode: TestCode;
  /** "Fasting Glucose" — from the catalog, not from the stored row. */
  name: string;
  unit: string;
  points: SeriesPoint[];
  /** The reference band to shade, when every point agrees on one. */
  refLow: number | null;
  refHigh: number | null;
}

/** The shape this module needs from a stored lab result. */
export interface LabRow {
  collectedDate: Date;
  testCode: TestCode;
  value: { toString(): string };
  unit: string;
  refLow: { toString(): string } | null;
  refHigh: { toString(): string } | null;
}

function num(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Groups results by test into one series each.
 *
 * One series per chart, deliberately. Glucose, HbA1c and blood pressure share
 * no scale — 112 mg/dL, 7.1 % and 128 mmHg on one pair of axes would need two
 * y-scales, and the alignment between two y-scales is arbitrary, so the chart
 * invents a correlation that is not in the data. Three charts, one scale each.
 */
export function toLabSeries(rows: LabRow[]): LabSeries[] {
  const byTest = new Map<TestCode, LabRow[]>();

  for (const row of rows) {
    const bucket = byTest.get(row.testCode);
    if (bucket) bucket.push(row);
    else byTest.set(row.testCode, [row]);
  }

  const series: LabSeries[] = [];

  for (const [testCode, testRows] of byTest) {
    const points = testRows
      .map((row) => {
        const value = num(row.value);
        return value === null
          ? null
          : {
              t: row.collectedDate.getTime(),
              value,
              date: toIsoDate(row.collectedDate),
            };
      })
      .filter((p): p is SeriesPoint => p !== null)
      // Sorted here, not left to the query. A chart that depends on an
      // ORDER BY three files away is one refactor from drawing backwards.
      .sort((a, b) => a.t - b.t);

    if (points.length === 0) continue;

    const definition = findByCode(testCode);

    series.push({
      testCode,
      name: definition.displayName,
      unit: testRows[0].unit || definition.unit,
      points,
      ...sharedRange(testRows),
    });
  }

  // Catalog order, so the charts appear in the same sequence on every patient.
  return series.sort(
    (a, b) => CATALOG_ORDER.indexOf(a.testCode) - CATALOG_ORDER.indexOf(b.testCode),
  );
}

const CATALOG_ORDER: TestCode[] = ["GLU_F", "HBA1C", "SBP"] as TestCode[];

/**
 * The reference band to shade, but only when every result agrees on it.
 *
 * If two labs supplied different ranges for the same test, shading either one
 * would misrepresent half the points, so nothing is shaded and the values speak
 * for themselves.
 */
function sharedRange(rows: LabRow[]): { refLow: number | null; refHigh: number | null } {
  const lows = new Set(rows.map((r) => num(r.refLow)));
  const highs = new Set(rows.map((r) => num(r.refHigh)));

  const low = lows.size === 1 ? [...lows][0] : null;
  const high = highs.size === 1 ? [...highs][0] : null;

  if (low === null || high === null || low >= high) {
    return { refLow: null, refHigh: null };
  }

  return { refLow: low, refHigh: high };
}

/* ------------------------------------------------------ assessment scores -- */

export interface ScorePoint {
  t: number;
  score: number;
  date: string;
  band: string | null;
}

export interface CompletedAssessment {
  completedAt: Date | null;
  totalScore: number | null;
  riskBand: string | null;
}

/**
 * The score history, plotted against completion date.
 *
 * Only completed assessments appear: a questionnaire that was sent and never
 * answered has no score, and interpolating the line across it would invent one.
 */
export function toScoreSeries(assessments: CompletedAssessment[]): ScorePoint[] {
  return assessments
    .filter(
      (a): a is CompletedAssessment & { completedAt: Date; totalScore: number } =>
        a.completedAt !== null && a.totalScore !== null,
    )
    .map((a) => ({
      t: a.completedAt.getTime(),
      score: a.totalScore,
      date: toIsoDate(a.completedAt),
      band: a.riskBand,
    }))
    .sort((a, b) => a.t - b.t);
}

/* ---------------------------------------------------------- chart domain -- */

const ONE_DAY = 86_400_000;

/**
 * The x-domain for a time-scaled axis.
 *
 * A single reading is the case that breaks: its first and last timestamps are
 * the same, so `[dataMin, dataMax]` is a zero-width domain and the point either
 * vanishes or is drawn on the axis itself. Padding a week either side puts the
 * lone marker in the middle of the plot, which is what a reader expects.
 *
 * Extracted from the chart component so this can be tested — a chart that
 * silently renders nothing for new patients, who by definition have one
 * reading, is exactly the bug that ships.
 */
export function timeDomain(points: Array<{ t: number }>): [number, number] {
  if (points.length === 0) return [0, 0];

  const first = points[0].t;
  const last = points[points.length - 1].t;

  if (first === last) return [first - ONE_DAY * 7, last + ONE_DAY * 7];

  return [first, last];
}
