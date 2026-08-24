import "server-only";

import { prisma } from "@/lib/db";
import { AssessmentStatus } from "@/lib/generated/prisma/enums";

import { DSMA8 } from "./definition";
import { hashToken, isExpired } from "./token";
import { type AnswerMap, scoreAssessment, validateAnswers } from "./scoring";

/**
 * Everything the public questionnaire route is allowed to do.
 *
 * The route itself holds no logic: it hashes the token, asks this module what
 * state the assessment is in, and renders accordingly. Every guard lives here
 * so that the render path and the submit path cannot drift apart — an
 * assessment that looks open but rejects a submission, or worse, the reverse.
 */

export type AssessmentGateState =
  | "valid"
  | "not-found"
  | "expired"
  | "completed";

export interface AssessmentGate {
  state: AssessmentGateState;
  assessment?: {
    id: string;
    patientFirstName: string;
    expiresAt: Date;
  };
}

/**
 * Resolves a raw token to an assessment and decides whether it may be used.
 *
 * Note what is *not* returned to the caller for a rejected token: no patient
 * name, no dates, nothing that distinguishes "this token never existed" from
 * "this token belongs to someone else". Only the state.
 */
export async function openAssessment(
  rawToken: string,
  now: Date = new Date(),
): Promise<AssessmentGate> {
  // Lookup is by hash. The raw token is never stored, so a database read can
  // never yield a working link.
  const assessment = await prisma.assessment.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      patient: { select: { fullName: true } },
    },
  });

  if (!assessment) return { state: "not-found" };

  if (assessment.status === AssessmentStatus.COMPLETED) {
    return { state: "completed" };
  }

  if (isExpired(assessment.expiresAt, now)) {
    // Expiry is derived from the timestamp, not from a background sweep. The
    // status is persisted opportunistically so the clinician's view agrees,
    // but correctness never depends on that write having happened.
    if (assessment.status !== AssessmentStatus.EXPIRED) {
      await prisma.assessment
        .updateMany({
          where: { id: assessment.id, status: AssessmentStatus.SENT },
          data: { status: AssessmentStatus.EXPIRED },
        })
        .catch(() => undefined);
    }
    return { state: "expired" };
  }

  return {
    state: "valid",
    assessment: {
      id: assessment.id,
      patientFirstName: assessment.patient.fullName.split(" ")[0] ?? "",
      expiresAt: assessment.expiresAt,
    },
  };
}

export type SubmitOutcome =
  | { ok: true; totalScore: number; bandLabel: string }
  | { ok: false; reason: AssessmentGateState | "invalid-answers"; issues?: string[] };

/**
 * Records a submission.
 *
 * Every guard from openAssessment runs again here. Re-checking is not
 * redundancy — the render happened at some earlier moment, and the link may
 * have expired or been used in between.
 */
export async function submitAssessment(
  rawToken: string,
  answers: AnswerMap,
  now: Date = new Date(),
): Promise<SubmitOutcome> {
  const issues = validateAnswers(answers);
  if (issues.length > 0) {
    return { ok: false, reason: "invalid-answers", issues };
  }

  const gate = await openAssessment(rawToken, now);
  if (gate.state !== "valid" || !gate.assessment) {
    return { ok: false, reason: gate.state };
  }

  // The score is computed here, from the submitted answers, by the same pure
  // function the tests exercise. Any total sent by the browser is ignored:
  // this number becomes a clinical record.
  const { totalScore, band } = scoreAssessment(answers);

  const assessmentId = gate.assessment.id;

  const committed = await prisma.$transaction(async (tx) => {
    /**
     * The single-use guarantee.
     *
     * A conditional update — "set COMPLETED where the row is still SENT" —
     * returns a count. Two submissions racing each other both reach this
     * line; exactly one sees count 1 and proceeds, the other sees 0 and is
     * rejected. Reading the status first and then writing would let both
     * through.
     */
    const claimed = await tx.assessment.updateMany({
      where: { id: assessmentId, status: AssessmentStatus.SENT },
      data: {
        status: AssessmentStatus.COMPLETED,
        completedAt: now,
        totalScore,
        riskBand: band.label,
      },
    });

    if (claimed.count !== 1) return false;

    await tx.assessmentAnswer.createMany({
      data: DSMA8.items.map((item) => ({
        assessmentId,
        questionId: item.id,
        score: answers[item.id],
      })),
    });

    return true;
  });

  if (!committed) {
    return { ok: false, reason: "completed" };
  }

  return { ok: true, totalScore, bandLabel: band.label };
}

/** Band metadata for rendering a stored score. */
export function bandByLabel(label: string) {
  return DSMA8.scoring.bands.find((b) => b.label === label);
}

/** Maps a risk band to the UI tone used by the Badge component. */
export function bandTone(
  label: string | null | undefined,
): "neutral" | "low" | "moderate" | "high" | "critical" {
  switch (label) {
    case "Low risk":
      return "low";
    case "Moderate risk":
      return "moderate";
    case "High risk":
      return "high";
    case "Very high risk":
      return "critical";
    default:
      return "neutral";
  }
}
