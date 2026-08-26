import "server-only";

import { prisma } from "@/lib/db";

import { aiAttribution, isAiConfigured } from "./config";
import { buildPatientFacts, hasEnoughData, type PatientFacts } from "./facts";
import { buildPrompt } from "./prompt";
import { AiError, complete, messageFor } from "./provider";
import { verifySummary } from "./verify";

/**
 * The trajectory summary, end to end.
 *
 * Load → compute facts → narrate → verify. The interesting decisions are the
 * two places this refuses to produce prose:
 *
 *  - **Not enough data.** Two data points is the floor. Below it the model
 *    would be padding, and an empty state that says so is more useful.
 *  - **Ungrounded output.** If the summary contains a number that is not in the
 *    facts it was given, the prose is thrown away and the facts are returned on
 *    their own. The panel degrades to a table rather than showing a clinician a
 *    figure the system knows to be unsourced.
 *
 * Nothing here is written to the database. A machine-generated narrative is not
 * a clinical record, and persisting it would make it one — it would outlive the
 * data it described, and the next reader would have no way to tell a stale
 * summary from a current one. It is recomputed on request, or not shown.
 */

export type SummaryResult =
  | {
      status: "ok";
      summary: string;
      facts: PatientFacts;
      attribution: { provider: string; model: string } | null;
    }
  | {
      /** The model returned prose containing a number not in the facts. */
      status: "ungrounded";
      facts: PatientFacts;
      unsupported: number[];
      attribution: { provider: string; model: string } | null;
    }
  | { status: "insufficient-data"; facts: PatientFacts }
  | { status: "not-configured" }
  | { status: "error"; message: string; facts: PatientFacts | null };

interface PatientRecord {
  id: string;
  dateOfBirth: Date;
  sex: Parameters<typeof buildPatientFacts>[0]["sex"];
  labResults: Parameters<typeof buildPatientFacts>[0]["labs"];
  assessments: Parameters<typeof buildPatientFacts>[0]["assessments"];
}

/**
 * Reads only the columns the facts are computed from.
 *
 * An explicit `select` rather than the whole row, so that the identity fields
 * are not merely unused here but never loaded into the process at all. It is a
 * weaker guarantee than the one in `facts.ts` — which cannot see them — but it
 * is the one that holds if someone later logs this object.
 */
async function loadPatient(patientId: string): Promise<PatientRecord | null> {
  return prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      dateOfBirth: true,
      sex: true,
      labResults: {
        select: {
          collectedDate: true,
          testCode: true,
          value: true,
          unit: true,
          refLow: true,
          refHigh: true,
        },
        orderBy: { collectedDate: "asc" },
      },
      assessments: {
        select: { completedAt: true, totalScore: true },
        orderBy: { sentAt: "desc" },
      },
    },
  });
}

export async function generateTrajectorySummary(
  patientId: string,
): Promise<SummaryResult> {
  if (!isAiConfigured()) return { status: "not-configured" };

  const patient = await loadPatient(patientId);
  if (!patient) {
    return {
      status: "error",
      message: "That patient no longer exists.",
      facts: null,
    };
  }

  const facts = buildPatientFacts({
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    labs: patient.labResults,
    assessments: patient.assessments,
    now: new Date(),
  });

  if (!hasEnoughData(facts)) {
    return { status: "insufficient-data", facts };
  }

  const attribution = aiAttribution();

  let prose: string;
  try {
    prose = await complete(buildPrompt(facts));
  } catch (error) {
    if (error instanceof AiError) {
      // Kind and patient id only. Never the prompt, never the facts, never the
      // provider's body — all three carry patient data.
      console.warn(`[ai] summary failed kind=${error.kind} patient=${patientId}`);
      return { status: "error", message: error.message, facts };
    }

    console.error(
      "[ai] summary failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { status: "error", message: messageFor("unexpected"), facts };
  }

  const verification = verifySummary(prose, facts);

  if (!verification.grounded) {
    // Counts, not the prose, and not the offending values in production terms —
    // the numbers themselves are patient data.
    console.warn(
      `[ai] summary rejected as ungrounded patient=${patientId} unsupported=${verification.unsupported.length}`,
    );

    return {
      status: "ungrounded",
      facts,
      unsupported: verification.unsupported,
      attribution,
    };
  }

  return { status: "ok", summary: prose, facts, attribution };
}
