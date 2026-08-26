import { bandForScore } from "@/lib/assessments/scoring";
import { findByCode } from "@/lib/labs/test-catalog";
import { toIsoDate } from "@/lib/validation/patient";

import type { Sex, TestCode } from "@/lib/generated/prisma/enums";

/**
 * The facts a trajectory summary is allowed to talk about.
 *
 * This module is the whole hallucination strategy, so it is worth stating the
 * reasoning rather than just the types.
 *
 * The obvious way to build an AI summary is to hand the model the patient's
 * rows and ask what it sees. That asks a language model to do arithmetic and to
 * decide what is clinically notable, and it will do both fluently whether or not
 * it does them correctly — a fabricated HbA1c delta reads exactly like a real
 * one.
 *
 * So the split is: **every number is computed here, in TypeScript, and the model
 * only narrates them.** Two things follow, and they are why this design was
 * chosen over the fluent one:
 *
 *  1. A number in the prose that is not in this object is *detectable*, by
 *     `verify.ts`, mechanically. Grounding stops being a promise and becomes a
 *     check that either passes or fails.
 *  2. The same object is rendered beside the summary in the UI, so a clinician
 *     can check the prose against its source without leaving the page.
 *
 * It is also less code than the fluent version, not more.
 *
 * ## Two things this module deliberately does not do
 *
 * **It does not decide what is clinically significant.** It reports direction,
 * magnitude, and whether a value sits outside its reference range. "Concerning",
 * "improving" and "stable" are words for a clinician; a threshold invented here
 * would be an unsourced clinical rule wearing the costume of a computation.
 *
 * **It never sees an identity.** Age is derived from the date of birth and the
 * date of birth is then discarded; name, MRN, email, phone and tokens are not
 * parameters of any function here, so they cannot reach a prompt by someone
 * later passing the wrong object. See S19 in `.docs/01-challenge-analysis.md`.
 */

/* ----------------------------------------------------------------- inputs -- */

/** The shape this module needs from a stored lab result. */
export interface LabFactRow {
  collectedDate: Date;
  testCode: TestCode;
  value: { toString(): string };
  unit: string;
  refLow: { toString(): string } | null;
  refHigh: { toString(): string } | null;
}

/** The shape this module needs from an assessment. */
export interface AssessmentFactRow {
  completedAt: Date | null;
  totalScore: number | null;
}

export interface FactInput {
  dateOfBirth: Date;
  sex: Sex;
  labs: LabFactRow[];
  assessments: AssessmentFactRow[];
  /** Injected rather than read from the clock: purity, and a testable "today". */
  now: Date;
}

/* ---------------------------------------------------------------- outputs -- */

export type Direction = "rising" | "falling" | "unchanged" | "single-reading";

/** Where a value sits against its reference range. */
export type RangeStatus = "below" | "within" | "above" | "no-range";

export interface Reading {
  date: string;
  value: number;
}

export interface LabFact {
  testCode: TestCode;
  name: string;
  unit: string;
  readings: number;
  first: Reading;
  latest: Reading;
  /** latest minus first, rounded. Null when there is only one reading. */
  change: number | null;
  direction: Direction;
  /** Days between the first and the latest reading. */
  spanDays: number;
  refLow: number | null;
  refHigh: number | null;
  latestStatus: RangeStatus;
  outOfRangeCount: number;
}

export type ScoreDirection =
  | "worsened"
  | "improved"
  | "unchanged"
  | "single-assessment";

export interface AssessmentFacts {
  completed: number;
  latest: { date: string; score: number; band: string } | null;
  previous: { date: string; score: number; band: string } | null;
  /** latest minus previous. Positive means a *higher* score — see `direction`. */
  change: number | null;
  direction: ScoreDirection;
  /** True when the two most recent assessments fall in different bands. */
  bandChanged: boolean;
}

export interface PatientFacts {
  ageYears: number;
  sex: Sex;
  labs: LabFact[];
  assessments: AssessmentFacts;
  /** Days since the most recent lab result or completed assessment. */
  daysSinceLastData: number | null;
  /** The scale, so the model never has to recall it. */
  scoreRange: { min: number; max: number };
  /**
   * Higher DSMA-8 scores mean *worse* self-management: every item is negatively
   * worded ("I missed or skipped a dose of my diabetes medication"). Stated
   * explicitly in the payload because it is the single easiest thing for a
   * model to get backwards, and getting it backwards inverts the whole summary.
   */
  scoreDirectionNote: string;
}

export const SCORE_DIRECTION_NOTE =
  "Higher DSMA-8 scores mean worse self-management and higher risk; lower is better.";

/* -------------------------------------------------------------- computing -- */

const MS_PER_DAY = 86_400_000;

/**
 * Rounded once, here, and never again.
 *
 * The prompt and the verifier both read this object, so the number the model is
 * shown and the number the verifier will accept are the same number by
 * construction. Rounding in the prompt layer instead would let the model
 * faithfully echo "6.8" while the verifier held 6.799999999999999 and rejected
 * a summary that was in fact correct.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Age in whole years.
 *
 * Computed in UTC because `dateOfBirth` is a `@db.Date` stored at UTC midnight;
 * reading it with local getters shifts the day west of UTC and can age someone
 * a year early on their birthday.
 */
export function ageInYears(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  const beforeBirthday =
    monthDelta < 0 ||
    (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate());

  if (beforeBirthday) age -= 1;

  return Math.max(0, age);
}

function rangeStatus(
  value: number,
  refLow: number | null,
  refHigh: number | null,
): RangeStatus {
  if (refLow === null || refHigh === null) return "no-range";
  if (value < refLow) return "below";
  if (value > refHigh) return "above";
  return "within";
}

/**
 * One fact block per test, from that test's readings in date order.
 *
 * The reference range is taken from the reading itself where it has one, and
 * falls back to the catalog otherwise — the same precedence the importer uses,
 * so a summary judges a value against the range the clinician sees on the chart.
 */
function labFacts(rows: LabFactRow[]): LabFact[] {
  const byTest = new Map<TestCode, LabFactRow[]>();

  for (const row of rows) {
    const bucket = byTest.get(row.testCode);
    if (bucket) bucket.push(row);
    else byTest.set(row.testCode, [row]);
  }

  const facts: LabFact[] = [];

  for (const [testCode, testRows] of byTest) {
    const definition = findByCode(testCode);

    const points = testRows
      .map((row) => {
        const value = num(row.value);
        if (value === null) return null;
        return {
          date: toIsoDate(row.collectedDate),
          at: row.collectedDate,
          value,
          refLow: num(row.refLow) ?? definition.refLow,
          refHigh: num(row.refHigh) ?? definition.refHigh,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Sorted here rather than trusting the query, for the same reason
      // `toLabSeries` does it: a summary that reads the newest row as the
      // oldest reports every trend backwards, and reads perfectly well.
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    if (points.length === 0) continue;

    const first = points[0];
    const latest = points[points.length - 1];
    const change = points.length > 1 ? round(latest.value - first.value) : null;

    facts.push({
      testCode,
      name: definition.displayName,
      unit: testRows[0].unit || definition.unit,
      readings: points.length,
      first: { date: first.date, value: round(first.value) },
      latest: { date: latest.date, value: round(latest.value) },
      change,
      direction:
        change === null
          ? "single-reading"
          : change > 0
            ? "rising"
            : change < 0
              ? "falling"
              : "unchanged",
      spanDays: daysBetween(first.at, latest.at),
      refLow: latest.refLow,
      refHigh: latest.refHigh,
      latestStatus: rangeStatus(latest.value, latest.refLow, latest.refHigh),
      outOfRangeCount: points.filter(
        (p) => rangeStatus(p.value, p.refLow, p.refHigh) !== "within",
      ).length,
    });
  }

  // Catalog order, so every patient's facts arrive in the same sequence.
  return facts.sort(
    (a, b) =>
      CATALOG_ORDER.indexOf(a.testCode) - CATALOG_ORDER.indexOf(b.testCode),
  );
}

const CATALOG_ORDER: TestCode[] = ["GLU_F", "HBA1C", "SBP"] as TestCode[];

/**
 * The two most recent completed assessments, and the move between them.
 *
 * The direction words are the inversion trap: a *rising* DSMA-8 score is a
 * patient doing worse, because every item asks how often something went wrong.
 * `change > 0` therefore maps to "worsened", and `SCORE_DIRECTION_NOTE` says so
 * again inside the payload for the model.
 */
function assessmentFacts(rows: AssessmentFactRow[]): AssessmentFacts {
  const completed = rows
    .filter(
      (a): a is { completedAt: Date; totalScore: number } =>
        a.completedAt !== null && a.totalScore !== null,
    )
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  const none: AssessmentFacts = {
    completed: 0,
    latest: null,
    previous: null,
    change: null,
    direction: "single-assessment",
    bandChanged: false,
  };

  if (completed.length === 0) return none;

  const describe = (a: { completedAt: Date; totalScore: number }) => ({
    date: toIsoDate(a.completedAt),
    score: a.totalScore,
    band: bandForScore(a.totalScore).label,
  });

  const latest = describe(completed[0]);

  if (completed.length === 1) {
    return { ...none, completed: 1, latest };
  }

  const previous = describe(completed[1]);
  const change = latest.score - previous.score;

  return {
    completed: completed.length,
    latest,
    previous,
    change,
    direction: change > 0 ? "worsened" : change < 0 ? "improved" : "unchanged",
    bandChanged: latest.band !== previous.band,
  };
}

/**
 * Everything the model is permitted to know about this patient.
 *
 * Note what is *not* a parameter: name, MRN, email, phone, the date of birth
 * itself, and any token. `FactInput` takes a date of birth only to derive an
 * age, and the age is what survives into the output.
 */
export function buildPatientFacts(input: FactInput): PatientFacts {
  const lastDataAt = [
    ...input.labs.map((l) => l.collectedDate.getTime()),
    ...input.assessments
      .filter((a) => a.completedAt !== null)
      .map((a) => a.completedAt!.getTime()),
  ].sort((a, b) => b - a)[0];

  return {
    ageYears: ageInYears(input.dateOfBirth, input.now),
    sex: input.sex,
    labs: labFacts(input.labs),
    assessments: assessmentFacts(input.assessments),
    daysSinceLastData:
      lastDataAt === undefined
        ? null
        : Math.max(0, daysBetween(new Date(lastDataAt), input.now)),
    scoreRange: { min: 0, max: 24 },
    scoreDirectionNote: SCORE_DIRECTION_NOTE,
  };
}

/**
 * Whether there is enough here to be worth narrating.
 *
 * A summary of one reading and no questionnaire is one sentence restating that
 * reading, which is worse than an empty state saying so plainly. The threshold
 * is deliberately low — two data points of any kind — because the cost of
 * refusing is a clinician seeing nothing at all.
 */
export function hasEnoughData(facts: PatientFacts): boolean {
  const labReadings = facts.labs.reduce((sum, lab) => sum + lab.readings, 0);
  return labReadings + facts.assessments.completed >= 2;
}
