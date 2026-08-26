import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/db";
import { AssessmentStatus } from "@/lib/generated/prisma/enums";

import { TEST_CATALOG } from "@/lib/labs/test-catalog";

import {
  itemBreakdown,
  monthlyClinicMeans,
  monthlyVolume,
  testInsight,
  usableRows,
  type ItemBreakdown,
  type MonthPoint,
  type TestInsight,
  type VolumePoint,
} from "./insights";
import {
  completionRate,
  riskDistribution,
  type CompletionRate,
  type RiskSegment,
} from "./metrics";

/**
 * The clinic overview's data, in one place.
 *
 * The queries are here; the arithmetic is in `metrics.ts`, which is pure and
 * tested. Keeping them apart is what lets the divide-by-zero and
 * count-each-patient-once rules be exercised without a database.
 */

export interface ClinicMetrics {
  patientCount: number;
  labResultCount: number;
  completion: CompletionRate;
  distribution: RiskSegment[];
  /** Patients with at least one completed assessment — the denominator of the useful half. */
  assessedPatientCount: number;
}

/**
 * Wrapped in `cache` because the overview now reads these figures from two
 * places — the tile strip and the risk chart, which stream into different
 * columns and so cannot share one `await`. Without it that is two identical
 * sets of four queries per page load; with it, one.
 */
export const clinicMetrics = cache(async function clinicMetrics(): Promise<ClinicMetrics> {
  /**
   * Every patient with their most recent *completed* assessment.
   *
   * `take: 1` per patient is what enforces "each patient counted once"
   * (D-DASH-3). Counting assessments instead would let one conscientious
   * patient with four completed questionnaires appear four times and make the
   * clinic look four times sicker than it is.
   *
   * Ordered by completedAt rather than sentAt: the band reflects how the
   * patient last reported, not which invitation went out most recently.
   */
  const [patients, sent, completed, labResultCount] = await Promise.all([
    prisma.patient.findMany({
      select: {
        id: true,
        assessments: {
          where: { status: AssessmentStatus.COMPLETED },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { riskBand: true },
        },
      },
    }),
    prisma.assessment.count(),
    prisma.assessment.count({ where: { status: AssessmentStatus.COMPLETED } }),
    prisma.labResult.count(),
  ]);

  const risks = patients.map((p) => ({
    riskBand: p.assessments[0]?.riskBand ?? null,
  }));

  return {
    patientCount: patients.length,
    labResultCount,
    completion: completionRate(sent, completed),
    distribution: riskDistribution(risks),
    assessedPatientCount: risks.filter((r) => r.riskBand !== null).length,
  };
});

/* ------------------------------------------------------------- insights -- */

export interface ClinicInsights {
  tests: Array<TestInsight & { trend: MonthPoint[] }>;
  volume: VolumePoint[];
  items: ItemBreakdown[];
  /** Completed assessments the item breakdown is drawn from. */
  assessmentCount: number;
  /** Results dropped from every aggregate because the unit is not canonical. */
  excludedForUnit: number;
  /** Total usable results, so an empty state can tell zero from filtered-to-zero. */
  usableCount: number;
}

/**
 * Everything the clinic's insight panels need, in two queries.
 *
 * Two, not eleven. The aggregates could each be a `groupBy` — one per test per
 * month — but the whole table is two hundred rows on a clinic this size and
 * every one of those queries is a round trip to a database that scales its
 * compute to zero. Reading once and folding in memory is both faster here and
 * testable, because the folding is pure.
 *
 * That trade reverses at some size. The comment is the marker for where to look
 * when it does: once `lab_results` is large enough that this select is the slow
 * part, the monthly aggregates belong in SQL and the histogram stays here.
 *
 * `cache` for the same reason `clinicMetrics` has it: the panels stream into
 * different Suspense boundaries and so cannot share one `await`.
 */
export const clinicInsights = cache(async function clinicInsights(): Promise<ClinicInsights> {
  const [labs, answers, assessmentCount] = await Promise.all([
    prisma.labResult.findMany({
      select: {
        patientId: true,
        testCode: true,
        collectedDate: true,
        value: true,
        unit: true,
      },
    }),
    prisma.assessmentAnswer.findMany({
      // Only answers attached to a completed assessment. A partially written
      // row cannot exist today — answers are inserted in the same transaction
      // that marks the assessment complete — but the breakdown must describe
      // finished questionnaires, not whatever rows happen to be present.
      where: { assessment: { status: AssessmentStatus.COMPLETED } },
      select: { questionId: true, score: true },
    }),
    prisma.assessment.count({ where: { status: AssessmentStatus.COMPLETED } }),
  ]);

  const { rows, excludedForUnit, excludedByTest } = usableRows(labs);

  return {
    tests: TEST_CATALOG.map((test) => ({
      ...testInsight(rows, test.code, excludedByTest[test.code] ?? 0),
      trend: monthlyClinicMeans(rows, test.code),
    })),
    volume: monthlyVolume(rows),
    items: itemBreakdown(answers),
    assessmentCount,
    excludedForUnit,
    usableCount: rows.length,
  };
});
