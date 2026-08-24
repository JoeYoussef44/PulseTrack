import "server-only";

import { prisma } from "@/lib/db";
import { AssessmentStatus } from "@/lib/generated/prisma/enums";

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

export async function clinicMetrics(): Promise<ClinicMetrics> {
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
}
