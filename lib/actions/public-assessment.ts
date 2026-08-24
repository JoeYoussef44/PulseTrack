"use server";

import { submitAssessment } from "@/lib/assessments/service";
import { QUESTION_IDS } from "@/lib/assessments/definition";

export interface PublicSubmitState {
  ok?: boolean;
  totalScore?: number;
  bandLabel?: string;
  /** Question ids the patient has not answered. */
  missing?: string[];
  error?: string;
}

/**
 * The only mutation reachable without a session.
 *
 * It authorises on the token alone, revalidates every guard server-side, and
 * derives the score itself. Nothing the browser sends is trusted beyond the
 * eight answer values, and those are range-checked before use.
 */
export async function submitPublicAssessment(
  rawToken: string,
  _prevState: PublicSubmitState,
  formData: FormData,
): Promise<PublicSubmitState> {
  const answers: Record<string, number> = {};
  const missing: string[] = [];

  for (const id of QUESTION_IDS) {
    const raw = formData.get(id);

    if (raw === null || raw === "") {
      missing.push(id);
      continue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value)) {
      missing.push(id);
      continue;
    }

    answers[id] = value;
  }

  if (missing.length > 0) {
    return {
      missing,
      error:
        missing.length === 1
          ? "One question is unanswered. Please answer every question."
          : `${missing.length} questions are unanswered. Please answer every question.`,
    };
  }

  const outcome = await submitAssessment(rawToken, answers);

  if (outcome.ok) {
    return {
      ok: true,
      totalScore: outcome.totalScore,
      bandLabel: outcome.bandLabel,
    };
  }

  switch (outcome.reason) {
    case "completed":
      return { error: "This assessment has already been submitted." };
    case "expired":
      return { error: "This link has expired and can no longer be used." };
    case "not-found":
      return { error: "This link is not valid." };
    default:
      return {
        error: "Some answers were not valid. Please review and try again.",
      };
  }
}
