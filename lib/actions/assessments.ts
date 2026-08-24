"use server";

import { revalidatePath } from "next/cache";

import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  QUESTIONNAIRE_ID,
  QUESTIONNAIRE_VERSION,
} from "@/lib/assessments/definition";
import { assessmentUrl, issueToken } from "@/lib/assessments/token";
import { assessmentInviteEmail } from "@/lib/email/assessment-invite";
import { getEmailProvider } from "@/lib/email/email-service";

export interface SendAssessmentState {
  ok?: boolean;
  /** Shown once, immediately after sending, to the clinician who triggered it. */
  link?: string;
  emailDelivered?: boolean;
  emailProvider?: string;
  error?: string;
}

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000"
  );
}

/**
 * Issues a new DSMA-8 assessment and emails the patient a one-time link.
 *
 * The raw token exists only inside this function and in the outgoing email.
 * What is persisted is its SHA-256 hash, so the database never holds a working
 * link. It is also returned to the caller once, so the clinician can copy it —
 * that is what keeps the flow demonstrable when the mail provider refuses a
 * recipient, which Resend's free tier does for every address but its owner's.
 */
export async function sendAssessment(
  patientId: string,
  _prevState: SendAssessmentState,
  _formData: FormData,
): Promise<SendAssessmentState> {
  await requireClinician();

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, fullName: true, email: true },
  });

  if (!patient) {
    return { error: "That patient no longer exists." };
  }

  if (!patient.email) {
    return {
      error:
        "This patient has no email address. Add one before sending an assessment.",
    };
  }

  const { rawToken, tokenHash, expiresAt } = issueToken();

  await prisma.assessment.create({
    data: {
      patientId: patient.id,
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      tokenHash,
      expiresAt,
    },
  });

  const url = assessmentUrl(rawToken, appBaseUrl());

  const provider = getEmailProvider();
  const result = await provider.send(
    assessmentInviteEmail({
      to: patient.email,
      patientFirstName: patient.fullName.split(" ")[0] ?? "",
      url,
      expiresAt,
    }),
  );

  // A failed send is surfaced rather than swallowed. The assessment row stays
  // either way: the link is valid, and the clinician can still deliver it.
  revalidatePath(`/patients/${patient.id}`);

  return {
    ok: true,
    link: url,
    emailDelivered: result.delivered,
    emailProvider: result.provider,
    error: result.delivered ? undefined : result.error,
  };
}
