import { AssessmentStatus } from "@/lib/generated/prisma/enums";

import type { BandTone } from "./bands";

/**
 * What an assessment row's state is, and what to call it on screen.
 *
 * Pure, and in its own file for the same reason `bands.ts` is: `service.ts`
 * carries `server-only` because it holds Prisma queries, so nothing in it can
 * be exercised in a unit test or imported by a client component. `displayStatus`
 * lived there and is neither of those things — it is a two-branch function over
 * a date — so it moves here and `service.ts` re-exports it. One definition, no
 * change at any existing call site.
 */

/**
 * The status to show for a stored assessment.
 *
 * Expiry is derived rather than swept by a background job, so a row can still
 * read SENT after its expiry has passed. Deriving it in one place keeps the
 * clinician's table and the patient's page from ever disagreeing.
 *
 * `now` is a parameter, not a call to Date.now(), so this stays pure and can
 * be tested at a boundary.
 */
export function displayStatus(
  assessment: { status: AssessmentStatus; expiresAt: Date },
  now: Date,
): AssessmentStatus {
  if (
    assessment.status === AssessmentStatus.SENT &&
    assessment.expiresAt.getTime() <= now.getTime()
  ) {
    return AssessmentStatus.EXPIRED;
  }
  return assessment.status;
}

export interface StatusPresentation {
  label: string;
  tone: BandTone | "accent";
}

/**
 * The label, and the one case it used to get wrong.
 *
 * "Awaiting reply" asserts that an invitation reached the patient. It is
 * written the moment the row is created, before delivery is even attempted,
 * and the row is deliberately kept when delivery fails — so on a deployment
 * whose mail provider refuses fabricated recipients, which is this one, that
 * badge was claiming a send that never left the building.
 *
 * A pending assessment therefore has two labels, not one, decided by whether a
 * real provider ever accepted the message.
 *
 * The label is all it returns. An earlier version added "share the link with
 * the patient" as a second line, which is good advice for the row that was
 * just created and bad advice for every other one: the raw token is shown once
 * and only its hash is stored, so there is no link left to share on a row from
 * last week. The honest next step there is a fresh invitation, and the label
 * plus the assessment's own page say enough for a clinician to reach it.
 *
 * Completed and expired rows do not carry the distinction. By then the question
 * has been answered — the patient replied, or the window closed — and how the
 * link travelled is history, available on the assessment's own page.
 */
export function statusPresentation(
  status: AssessmentStatus,
  emailDeliveredAt: Date | null,
): StatusPresentation {
  if (status === AssessmentStatus.COMPLETED) {
    return { label: "Completed", tone: "low" };
  }

  if (status === AssessmentStatus.EXPIRED) {
    return { label: "Expired", tone: "neutral" };
  }

  if (emailDeliveredAt) {
    return { label: "Awaiting reply", tone: "accent" };
  }

  return { label: "Not emailed", tone: "moderate" };
}
