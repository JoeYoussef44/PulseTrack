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
 * instead of quietly showing a smaller truth. Nothing is ever converted, and
 * nothing stored is ever altered — the patient's own record keeps the value and
 * the unit exactly as reported.
 *
 * ## The other one: a clinic figure counts patients, not results
 *
 * A register is a population of people, not a pile of readings, and the two
 * come apart the moment one patient is measured more often than another. Every
 * population figure in this module therefore weights each patient once:
 *
 *  - `monthlyClinicMeans` summarises each patient within the month first, then
 *    averages those patient-level values (see its own comment for the worked
 *    example, and the fifteen-unit difference it makes).
 *  - `latestPerPatient` feeds the median and the in-range counts, so a patient
 *    seen monthly counts once rather than twelve times.
 *
 * The single exception is the histogram, which plots every usable result on
 * purpose: the shape of the whole record is what a distribution is for.
 *
 * ## Reference ranges are the catalog's, deterministically
 *
 * Clinic-level figures always use `TEST_CATALOG`'s documented range for the
 * test, never the `ref_low` / `ref_high` a particular CSV row happened to
 * carry. Rows from two labs can disagree, and averaging two disagreeing ranges
 * produces a boundary that neither lab uses. Individual patient records keep
 * their own reported range — that is `lib/labs/series.ts`, and it shades a band
 * only when every result for that patient agrees on one.
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
  /** The same count split by test, so a panel can explain its own gap. */
  excludedByTest: Record<TestCode, number>;
}

function zeroByTest(): Record<TestCode, number> {
  return Object.fromEntries(
    TEST_CATALOG.map((t) => [t.code, 0]),
  ) as Record<TestCode, number>;
}

/**
 * Narrows raw results to the ones it is meaningful to do arithmetic across.
 *
 * Two exclusions, both silent-failure candidates:
 *
 *  - **A unit that is not the canonical one.** Counted, not hidden — and
 *    counted per test as well as in total, because "three results are missing
 *    from this page" is a much weaker statement than "every glucose result you
 *    have is in mmol/L".
 *  - **A value that does not parse to a finite number.** Cannot reach the
 *    database through the importer, which rejects non-numerics, but a `Decimal`
 *    arriving through any other path must not turn a mean into `NaN` and every
 *    chart into an empty box.
 *
 * Nothing here modifies or converts a stored row. The patient's own record
 * keeps the value and the unit exactly as they were reported; this is a
 * narrowing for the purpose of one page's arithmetic and nothing more.
 */
export function usableRows(rows: InsightRow[]): UsableRows {
  const out: UsableRow[] = [];
  const excludedByTest = zeroByTest();
  let excludedForUnit = 0;

  for (const row of rows) {
    const canonical = findByCode(row.testCode).unit;

    if (!sameUnit(row.unit, canonical)) {
      excludedForUnit += 1;
      excludedByTest[row.testCode] = (excludedByTest[row.testCode] ?? 0) + 1;
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

  return { rows: out, excludedForUnit, excludedByTest };
}

/* ------------------------------------------------------------- precision -- */

/**
 * How many decimals each measure is worth showing, per test.
 *
 * Declared rather than derived from the bucket width, which is what it used to
 * share. They answer different questions — a bucket width is chosen to give the
 * histogram a shape, display precision is chosen from how the measure is
 * reported — and tying them together means a change to one silently moves the
 * other.
 */
export const DISPLAY_DECIMALS: Record<TestCode, number> = {
  GLU_F: 0,
  HBA1C: 1,
  SBP: 0,
} as Record<TestCode, number>;

export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** A computed mean, at the precision the test is reported at. */
export function roundForDisplay(value: number, testCode: TestCode): number {
  return roundTo(value, DISPLAY_DECIMALS[testCode] ?? 1);
}

/**
 * A median, at one decimal more than a mean.
 *
 * The median of an even number of readings is a genuine midpoint — two glucose
 * values of 110 and 111 have a median of 110.5, and rounding that to 111
 * reports a reading nobody took. One extra place keeps it; `Number()` drops the
 * trailing zero again for the odd case, so 138 stays "138" and does not become
 * "138.0".
 */
export function roundMedian(value: number, testCode: TestCode): number {
  return roundTo(value, (DISPLAY_DECIMALS[testCode] ?? 1) + 1);
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

/**
 * Where a bucket sits relative to the test's reference range.
 *
 * Four states, not two. The previous pair — above the ceiling, or not — painted
 * a bucket holding hypoglycaemic readings in the same tone as a bucket of
 * perfectly normal ones, and painted a bucket that *straddles* a limit as
 * though all of it were fine.
 */
export type BucketStatus = "below" | "within" | "straddles" | "above";

export interface Bucket {
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound — except on the final bucket, which is closed. */
  to: number;
  count: number;
  /** "7.0–7.5" — formatted here so the chart does not reinvent it. */
  label: string;
  /** The two edges separately, at the same precision as the label. */
  fromLabel: string;
  toLabel: string;
  status: BucketStatus;
  /** For a straddling bucket, the reference limit that falls inside it. */
  boundary: number | null;
  /** True on the last bucket, which is closed at the top. */
  closed: boolean;
}

function decimalsFor(width: number): number {
  return width < 1 ? 1 : 0;
}

/**
 * Which bucket a value belongs to, counting from the grid's anchor.
 *
 * The floating-point guard is not decoration. `(5.5 - 4.0) / 0.5` is
 * `2.9999999999999996`, so a plain `Math.floor` files an HbA1c of exactly 5.5
 * into the 5.0–5.5 bucket — a value landing one bucket below the one its own
 * label names. Snapping to the nearest integer when the remainder is within
 * floating-point noise puts a boundary value in the bucket that *starts* there,
 * which is what a half-open `[from, to)` interval means.
 */
function stepIndex(value: number, anchor: number, width: number): number {
  const raw = (value - anchor) / width;
  const nearest = Math.round(raw);

  return Math.abs(raw - nearest) < 1e-9 ? nearest : Math.floor(raw);
}

/**
 * Classifies a bucket against the reference range, which is inclusive at both
 * ends: a value of exactly `refHigh` is in range.
 *
 * One deliberate imprecision, stated rather than hidden. A bucket beginning
 * exactly at `refHigh` — `[120, 125)` for systolic pressure — contains the
 * single in-range value 120 and four out-of-range ones, and is called `above`.
 * Calling it `straddles` for the sake of one integer would grey out a bar that
 * is, in every practical sense, the above-range bar. The error is one reading
 * wide and it errs towards flagging rather than towards reassurance.
 */
function classify(from: number, to: number, refLow: number, refHigh: number): {
  status: BucketStatus;
  boundary: number | null;
} {
  if (from >= refHigh) return { status: "above", boundary: null };
  if (to <= refLow) return { status: "below", boundary: null };
  if (from >= refLow && to <= refHigh) return { status: "within", boundary: null };

  // Crosses a limit. Name which one, so the tooltip can say it in words.
  return {
    status: "straddles",
    boundary: from < refLow && to > refLow ? refLow : refHigh,
  };
}

/**
 * A histogram of values, on fixed-width buckets covering the observed range.
 *
 * ## The grid is anchored at the reference floor, not at zero
 *
 * Anchoring at zero put both of glucose's limits — 70 and 99 — inside a bucket,
 * so the bucket holding most of the normal register also held readings above
 * the ceiling and there was no bucket that could honestly be called "in range".
 * Anchoring at `refLow` makes the floor a bucket edge for every test, and makes
 * the ceiling one as well wherever it divides: systolic pressure's 90 and 120
 * both land on edges at a width of 5, so its histogram has no straddling bucket
 * at all. Glucose and HbA1c are left with exactly one each, which the chart
 * marks as spanning a limit rather than colouring as though it did not.
 *
 * Empty interior buckets are kept. A histogram that omits them is not a
 * histogram — the gaps *are* the shape, and closing them up moves every bar
 * and misstates the spread.
 */
export function histogram(values: number[], testCode: TestCode): Bucket[] {
  if (values.length === 0) return [];

  const width = BUCKET_WIDTH[testCode] ?? 1;
  const { refLow, refHigh } = findByCode(testCode);
  const decimals = decimalsFor(width);

  const min = Math.min(...values);
  const max = Math.max(...values);

  const firstStep = stepIndex(min, refLow, width);
  const lastStep = stepIndex(max, refLow, width);

  const buckets: Bucket[] = [];

  // Stepped by index from the anchor, not by repeatedly adding `width`:
  // accumulating 0.5 fourteen times drifts off the decimal grid and labels read
  // "7.000000001".
  for (let step = firstStep; step <= lastStep; step += 1) {
    const from = roundTo(refLow + step * width, 6);
    const to = roundTo(refLow + (step + 1) * width, 6);

    buckets.push({
      from,
      to,
      count: 0,
      label: `${from.toFixed(decimals)}–${to.toFixed(decimals)}`,
      // The edges again, separately. The tooltip writes them into a sentence
      // rather than a range, and reading "5.5 to under 6" beside an axis
      // labelled "5.5–6.0" is the kind of small disagreement that makes a
      // reader wonder which number to believe.
      fromLabel: from.toFixed(decimals),
      toLabel: to.toFixed(decimals),
      closed: step === lastStep,
      ...classify(from, to, refLow, refHigh),
    });
  }

  for (const value of values) {
    // The final bucket is closed at the top so the maximum lands inside it
    // rather than falling off the end.
    const index = Math.min(
      stepIndex(value, refLow, width) - firstStep,
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
  /** Results on file for this test that no figure here can use — wrong unit. */
  excludedForUnit: number;
  /** One per patient: the latest reading. */
  patientCount: number;
  /** Patients whose latest reading is above the reference range. */
  aboveRangeCount: number;
  /** Patients whose latest reading is below it. */
  belowRangeCount: number;
  /** Patients whose latest reading is inside it. */
  withinRangeCount: number;
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

/**
 * The clinic's position on one test, right now.
 *
 * Every population figure here is drawn from `latestPerPatient` — one reading
 * per patient — and never from the full history. Counting every result instead
 * would let the best-monitored patients carry the register: a patient seen
 * monthly would count twelve times against a patient seen once, and the figure
 * would describe the appointment book rather than the population. Only the
 * histogram plots all results, because the shape of the whole record is what a
 * distribution is for.
 */
export function testInsight(
  rows: UsableRow[],
  testCode: TestCode,
  excludedForUnit = 0,
): TestInsight {
  const test = findByCode(testCode);
  const forTest = rows.filter((r) => r.testCode === testCode);
  const latest = latestPerPatient(rows, testCode);
  const medianLatest = median(latest.map((l) => l.value));

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
    excludedForUnit,
    patientCount: latest.length,
    aboveRangeCount: latest.filter((l) => l.value > test.refHigh).length,
    belowRangeCount: latest.filter((l) => l.value < test.refLow).length,
    withinRangeCount: latest.filter(
      (l) => l.value >= test.refLow && l.value <= test.refHigh,
    ).length,
    medianLatest:
      medianLatest === null ? null : roundMedian(medianLatest, testCode),
  };
}

/* --------------------------------------------------------- monthly trend -- */

export interface PatientMonth {
  month: string;
  patientId: string;
  /** That patient's mean for that month, unrounded — an intermediate value. */
  mean: number;
  /** How many of their results it was computed from. */
  resultCount: number;
}

/**
 * Step one of the clinic trend: each patient's own mean, month by month.
 *
 * Exported because it is the step worth being able to check on its own. The
 * clinic figure below is a mean of *these*, and if this is wrong the clinic
 * figure is wrong in a way no amount of staring at the second function reveals.
 *
 * Deliberately unrounded. Rounding here and again at the clinic level rounds
 * twice, and a patient's monthly mean is never displayed — it exists only to be
 * averaged.
 */
export function patientMonthlyMeans(
  rows: UsableRow[],
  testCode: TestCode,
): PatientMonth[] {
  // A map of maps, not a composite string key. Concatenating a month and a
  // patient id into one string works right up until an id contains whatever
  // separator was chosen, and the failure mode is two patients silently merged
  // into one — a wrong mean that nothing about the chart would reveal.
  const grouped = new Map<
    string,
    Map<string, { total: number; count: number }>
  >();

  for (const row of rows) {
    if (row.testCode !== testCode) continue;

    // Both parts, together. Grouping by patient alone would average a whole
    // history into one number and lose the trend; grouping by month alone is
    // the raw-result mean this function exists to replace.
    let patients = grouped.get(row.month);
    if (!patients) {
      patients = new Map();
      grouped.set(row.month, patients);
    }

    const held = patients.get(row.patientId) ?? { total: 0, count: 0 };

    held.total += row.value;
    held.count += 1;
    patients.set(row.patientId, held);
  }

  const out: PatientMonth[] = [];

  for (const [month, patients] of grouped) {
    for (const [patientId, { total, count }] of patients) {
      out.push({ month, patientId, mean: total / count, resultCount: count });
    }
  }

  return out;
}

export interface MonthPoint {
  month: string;
  /** Milliseconds at the start of the month — a numeric, time-scaled x. */
  t: number;
  /** Mean of the patient-level monthly means, at display precision. */
  mean: number;
  /** Unique patients contributing at least one usable result that month. */
  patientCount: number;
  /** Usable results behind the point — always at least `patientCount`. */
  resultCount: number;
}

/**
 * The clinic's monthly figure for one test, with every patient weighted equally.
 *
 * ## Why this is not the mean of the month's results
 *
 * A patient seen three times in June contributes three readings to that month;
 * a patient seen once contributes one. Averaging the raw results lets the first
 * patient carry three times the weight of the second, so the line tracks *who
 * happened to be measured most often* as much as it tracks the population.
 *
 *     Patient A: 100, 120, 140      Patient B: 180
 *
 *     mean of results   (100 + 120 + 140 + 180) / 4 = 135
 *     mean of patients  ((100+120+140)/3 + 180) / 2 = 150
 *
 * 135 is a fact about the register's appointment pattern as much as about its
 * glucose. 150 is the figure a clinician means by "how is the clinic doing" —
 * and the difference of fifteen is invisible on the chart, which is exactly
 * what makes it worth being deliberate about. So: summarise each patient within
 * the month first, then average those.
 *
 * Months with no results are absent rather than zero. A zero would be plotted
 * as a catastrophic reading; a gap is what actually happened. A month with one
 * patient is a real point and is kept — the tooltip carries the patient count,
 * so a thin month says so rather than being quietly dropped.
 *
 * Rounded only at the end, and to the precision the test is reported at, so a
 * tooltip does not offer a clinician an HbA1c of 7.633333333333333.
 */
export function monthlyClinicMeans(
  rows: UsableRow[],
  testCode: TestCode,
): MonthPoint[] {
  const byMonth = new Map<
    string,
    { total: number; patients: number; results: number }
  >();

  for (const entry of patientMonthlyMeans(rows, testCode)) {
    const held = byMonth.get(entry.month) ?? {
      total: 0,
      patients: 0,
      results: 0,
    };

    held.total += entry.mean;
    held.patients += 1;
    held.results += entry.resultCount;
    byMonth.set(entry.month, held);
  }

  return [...byMonth.entries()]
    .map(([month, { total, patients, results }]) => ({
      month,
      t: monthStart(month),
      mean: roundForDisplay(total / patients, testCode),
      patientCount: patients,
      resultCount: results,
    }))
    // Sorted on the timestamp, never on a formatted label: "Feb 26" sorts
    // before "Jan 26" alphabetically, and the chart would draw the year
    // backwards without anything looking wrong.
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
