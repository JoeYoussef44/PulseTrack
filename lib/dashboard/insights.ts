import { DSMA8, QUESTION_IDS } from "@/lib/assessments/definition";
import { TEST_CATALOG, findByCode } from "@/lib/labs/test-catalog";

import type { TestCode } from "@/lib/generated/prisma/enums";

/**
 * Clinic-wide aggregates over lab results and questionnaire answers.
 *
 * Pure — no database, no framework — for the same reason `metrics.ts` is: these
 * are small calculations with several well-known ways to be quietly wrong, and
 * a wrong aggregate is worse than no aggregate because it looks like knowledge.
 *
 * ## The one that matters: a mean is arithmetic, and arithmetic needs one unit
 *
 * The CSV importer stores a mismatched unit exactly as reported and flags it,
 * rather than converting — a deliberate decision, and the right one: silently
 * relabelling 5.4 mmol/L as mg/dL invents a glucose reading wrong by a factor
 * of eighteen (`.docs/05-ugly-csv-expected-outcomes.md`, row 7).
 *
 * Correct on import, and a trap on aggregation. Averaging that row in with
 * sixty-eight mg/dL readings is adding millimoles to milligrams, and the clinic
 * mean comes out low by an amount nobody can see. So every function here
 * filters to results whose unit matches the catalog's canonical unit, and
 * `excludedForUnit` reports how many were dropped so the page can say so
 * instead of quietly showing a smaller truth.
 */

/* ------------------------------------------------------------- lab rows -- */

/** The shape these functions need from a stored lab result. */
export interface InsightRow {
  patientId: string;
  testCode: TestCode;
  collectedDate: Date;
  value: { toString(): string };
  unit: string;
}

interface UsableRow {
  patientId: string;
  testCode: TestCode;
  collectedDate: Date;
  value: number;
  month: string;
}

/** `2026-07-03` -> `"2026-07"`, from UTC parts so no reading shifts a month. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Midnight UTC on the first of that month, for a time-scaled axis. */
export function monthStart(key: string): number {
  return Date.parse(`${key}-01T00:00:00.000Z`);
}

function sameUnit(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface UsableRows {
  rows: UsableRow[];
  /** Dropped because the recorded unit is not the test's canonical unit. */
  excludedForUnit: number;
}

/**
 * Narrows raw results to the ones it is meaningful to do arithmetic across.
 *
 * Two exclusions, both silent-failure candidates:
 *
 *  - **A unit that is not the canonical one.** Counted, not hidden.
 *  - **A value that does not parse to a finite number.** Cannot reach the
 *    database through the importer, which rejects non-numerics, but a `Decimal`
 *    arriving through any other path must not turn a mean into `NaN` and every
 *    chart into an empty box.
 */
export function usableRows(rows: InsightRow[]): UsableRows {
  const out: UsableRow[] = [];
  let excludedForUnit = 0;

  for (const row of rows) {
    const canonical = findByCode(row.testCode).unit;

    if (!sameUnit(row.unit, canonical)) {
      excludedForUnit += 1;
      continue;
    }

    const value = Number(row.value.toString());
    if (!Number.isFinite(value)) continue;

    out.push({
      patientId: row.patientId,
      testCode: row.testCode,
      collectedDate: row.collectedDate,
      value,
      month: monthKey(row.collectedDate),
    });
  }

  return { rows: out, excludedForUnit };
}

/* ------------------------------------------------------ latest per patient - */

export interface LatestValue {
  patientId: string;
  value: number;
  date: Date;
}

/**
 * Each patient's most recent result for one test — one entry per patient.
 *
 * The clinically actionable view, and the same counting rule the risk
 * distribution uses (D-DASH-3): a patient with twelve HbA1c readings is one
 * patient, not twelve. Counting results instead would let the best-monitored
 * patients dominate every clinic figure.
 *
 * Ties on the same date resolve to whichever came first in the input rather
 * than being counted twice; two results for one patient on one day cannot exist
 * anyway — the database's `(patientId, collectedDate, testCode)` unique index
 * forbids it — so this is a guard, not a policy.
 */
export function latestPerPatient(
  rows: UsableRow[],
  testCode: TestCode,
): LatestValue[] {
  const latest = new Map<string, LatestValue>();

  for (const row of rows) {
    if (row.testCode !== testCode) continue;

    const held = latest.get(row.patientId);
    if (!held || row.collectedDate.getTime() > held.date.getTime()) {
      latest.set(row.patientId, {
        patientId: row.patientId,
        value: row.value,
        date: row.collectedDate,
      });
    }
  }

  return [...latest.values()];
}

/* ------------------------------------------------------------ histogram --- */

/**
 * Bucket widths, one per test, in that test's canonical unit.
 *
 * Fixed rather than derived from the data. A width computed from the current
 * range changes as results arrive, so the same chart means something different
 * on Tuesday than it did on Monday and two glances at it cannot be compared.
 * These are chosen to be clinically legible *and* to produce a histogram with a
 * shape: half a percentage point of HbA1c, 20 mg/dL of glucose, 5 mmHg of
 * systolic pressure. Systolic was 10 first and drawn — at 10 the whole clinic
 * fell into three enormous bars, which is a bar chart of nothing. Blood
 * pressure simply varies over a narrower range than glucose does, so it needs a
 * finer bucket to say anything.
 */
export const BUCKET_WIDTH: Record<TestCode, number> = {
  HBA1C: 0.5,
  GLU_F: 20,
  SBP: 5,
} as Record<TestCode, number>;

export interface Bucket {
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound. */
  to: number;
  count: number;
  /** "7.0–7.5" — formatted here so the chart does not reinvent it. */
  label: string;
  /** True when the whole bucket sits above the reference range. */
  aboveRange: boolean;
}

function decimalsFor(width: number): number {
  return width < 1 ? 1 : 0;
}

/**
 * A histogram of values, on fixed-width buckets covering the observed range.
 *
 * Empty interior buckets are kept. A histogram that omits them is not a
 * histogram — the gaps *are* the shape, and closing them up moves every bar
 * and misstates the spread.
 */
export function histogram(values: number[], testCode: TestCode): Bucket[] {
  if (values.length === 0) return [];

  const width = BUCKET_WIDTH[testCode] ?? 1;
  const { refHigh } = findByCode(testCode);
  const decimals = decimalsFor(width);

  const min = Math.min(...values);
  const max = Math.max(...values);

  const first = Math.floor(min / width) * width;
  const last = Math.floor(max / width) * width;

  const buckets: Bucket[] = [];

  // Stepped by index, not by repeatedly adding `width`: accumulating 0.5
  // fourteen times drifts off the decimal grid and labels read "7.000000001".
  const steps = Math.round((last - first) / width);

  for (let i = 0; i <= steps; i += 1) {
    const from = first + i * width;
    const to = from + width;

    buckets.push({
      from,
      to,
      count: 0,
      label: `${from.toFixed(decimals)}–${to.toFixed(decimals)}`,
      aboveRange: from >= refHigh,
    });
  }

  for (const value of values) {
    // The final bucket is closed at the top so the maximum lands inside it
    // rather than falling off the end.
    const index = Math.min(
      Math.floor((value - first) / width),
      buckets.length - 1,
    );
    buckets[index].count += 1;
  }

  return buckets;
}

/* ------------------------------------------------- per-test lab insight --- */

export interface TestInsight {
  testCode: TestCode;
  name: string;
  unit: string;
  refLow: number;
  refHigh: number;
  /** Every usable result for this test, bucketed. */
  buckets: Bucket[];
  /** How many results the histogram is drawn from. */
  resultCount: number;
  /** One per patient: the latest reading. */
  patientCount: number;
  /** Patients whose latest reading is above the reference range. */
  aboveRangeCount: number;
  /** Median of the latest-per-patient values, or null when there are none. */
  medianLatest: number | null;
}

/**
 * Median rather than mean for the headline figure.
 *
 * One patient at 221 mg/dL pulls a mean of eight readings up by fifteen and
 * makes the clinic look worse than any individual patient is. The median moves
 * only when the middle of the register moves, which is the thing a clinician is
 * asking about.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function testInsight(rows: UsableRow[], testCode: TestCode): TestInsight {
  const test = findByCode(testCode);
  const forTest = rows.filter((r) => r.testCode === testCode);
  const latest = latestPerPatient(rows, testCode);

  return {
    testCode,
    name: test.displayName,
    unit: test.unit,
    refLow: test.refLow,
    refHigh: test.refHigh,
    buckets: histogram(
      forTest.map((r) => r.value),
      testCode,
    ),
    resultCount: forTest.length,
    patientCount: latest.length,
    aboveRangeCount: latest.filter((l) => l.value > test.refHigh).length,
    medianLatest: median(latest.map((l) => l.value)),
  };
}

/* --------------------------------------------------------- monthly trend -- */

export interface MonthPoint {
  month: string;
  /** Milliseconds at the start of the month — a numeric, time-scaled x. */
  t: number;
  /** Mean of every usable result collected that month. */
  mean: number;
  count: number;
}

/**
 * The clinic's mean for one test, month by month.
 *
 * Months with no results are absent rather than zero. A zero would be plotted
 * as a catastrophic reading; a gap is what actually happened.
 *
 * Rounded to the precision the test is reported at, so a chart tooltip does not
 * offer a clinician an HbA1c of 7.633333333333333.
 */
export function monthlyMeans(
  rows: UsableRow[],
  testCode: TestCode,
): MonthPoint[] {
  const sums = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    if (row.testCode !== testCode) continue;

    const held = sums.get(row.month) ?? { total: 0, count: 0 };
    held.total += row.value;
    held.count += 1;
    sums.set(row.month, held);
  }

  const decimals = decimalsFor(BUCKET_WIDTH[testCode] ?? 1);

  return [...sums.entries()]
    .map(([month, { total, count }]) => ({
      month,
      t: monthStart(month),
      mean: Number((total / count).toFixed(decimals)),
      count,
    }))
    .sort((a, b) => a.t - b.t);
}

/* -------------------------------------------------------- monthly volume -- */

export interface VolumePoint {
  month: string;
  t: number;
  total: number;
  /** Per-test counts, keyed by test code, every test present even at zero. */
  byTest: Record<string, number>;
}

/**
 * How many results were collected each month, in total and per test.
 *
 * Unlike the trend, this one *does* fill the gaps: a month with no results is a
 * real and interesting zero — it is the coverage gap a clinician is looking
 * for — whereas a month with no results has no mean to plot. Same data, two
 * opposite correct answers, which is why they are separate functions.
 *
 * Only months between the first and last result are filled. Extending to today
 * would draw a run of zeroes describing nothing but the calendar.
 */
export function monthlyVolume(rows: UsableRow[]): VolumePoint[] {
  if (rows.length === 0) return [];

  const counts = new Map<string, Record<string, number>>();

  const blank = (): Record<string, number> =>
    Object.fromEntries(TEST_CATALOG.map((t) => [t.code, 0]));

  for (const row of rows) {
    const held = counts.get(row.month) ?? blank();
    held[row.testCode] = (held[row.testCode] ?? 0) + 1;
    counts.set(row.month, held);
  }

  const months = [...counts.keys()].sort();
  const filled: VolumePoint[] = [];

  const cursor = new Date(`${months[0]}-01T00:00:00.000Z`);
  const end = new Date(`${months[months.length - 1]}-01T00:00:00.000Z`);

  while (cursor.getTime() <= end.getTime()) {
    const key = monthKey(cursor);
    const byTest = counts.get(key) ?? blank();

    filled.push({
      month: key,
      t: cursor.getTime(),
      total: Object.values(byTest).reduce((sum, n) => sum + n, 0),
      byTest,
    });

    // setUTCMonth handles the December rollover; adding 30 days does not.
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return filled;
}

/* ------------------------------------------------------ DSMA-8 breakdown -- */

export interface ItemBreakdown {
  id: string;
  /** 1-based, matching the numbering on the questionnaire. */
  position: number;
  text: string;
  /** Count of each option value, indexed by the option's position, 0…3. */
  counts: number[];
  /** Total answers recorded for this item. */
  n: number;
  /** Mean score, 0–3, or null when nobody has answered it. */
  mean: number | null;
  /** Answers of 2 or 3 — "more than half the days" or worse. */
  frequentCount: number;
}

const OPTION_VALUES = DSMA8.options.map((o) => o.value);

/**
 * How the whole clinic answered each question.
 *
 * This is the chart that says *which self-management behaviour the practice is
 * failing at*, which no total score can. Two patients scoring 12 can be failing
 * at completely different things, and the intervention differs.
 *
 * Sorted worst-first by mean, because the reason to look is to find where to
 * act. Ties keep questionnaire order so the list is stable between reads.
 *
 * Items nobody has answered are kept, with a null mean and a zero bar. Dropping
 * them would make the list change length as data arrives and would hide the
 * questions the clinic has no signal on at all — which is itself worth seeing.
 */
export function itemBreakdown(
  answers: Array<{ questionId: string; score: number }>,
): ItemBreakdown[] {
  const tally = new Map<string, number[]>(
    QUESTION_IDS.map((id) => [id, OPTION_VALUES.map(() => 0)]),
  );

  for (const answer of answers) {
    const counts = tally.get(answer.questionId);
    if (!counts) continue; // an id from another instrument

    const index = OPTION_VALUES.indexOf(answer.score);
    if (index === -1) continue; // a value outside the option set

    counts[index] += 1;
  }

  const rows: ItemBreakdown[] = DSMA8.items.map((item, position) => {
    const counts = tally.get(item.id)!;
    const n = counts.reduce((sum, c) => sum + c, 0);
    const total = counts.reduce(
      (sum, c, index) => sum + c * OPTION_VALUES[index],
      0,
    );

    return {
      id: item.id,
      position: position + 1,
      text: item.text,
      counts,
      n,
      mean: n === 0 ? null : Number((total / n).toFixed(2)),
      frequentCount: counts.reduce(
        (sum, c, index) => (OPTION_VALUES[index] >= 2 ? sum + c : sum),
        0,
      ),
    };
  });

  return rows.sort(
    (a, b) => (b.mean ?? -1) - (a.mean ?? -1) || a.position - b.position,
  );
}

/** The highest value the instrument's options allow — the bar's denominator. */
export const MAX_ITEM_MEAN = Math.max(...OPTION_VALUES);
