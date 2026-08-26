import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Alert,
  Badge,
  Card,
  CardHeader,
  PageHeader,
  cx,
} from "@/components/ui";
import { bandByLabel, bandTone } from "@/lib/assessments/bands";
import { DSMA8 } from "@/lib/assessments/definition";
import { itemShare, reviewAssessment } from "@/lib/assessments/review";
import { displayStatus } from "@/lib/assessments/service";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toIsoDate } from "@/lib/validation/patient";

export const metadata: Metadata = { title: "Assessment" };

/**
 * One completed questionnaire, as the patient answered it.
 *
 * The patient page's table gives a clinician a score and a band, which is the
 * right summary and a poor answer to the question a nurse actually asks before
 * a consultation: *what did they say?* A total of 14 can be one bad item and
 * seven good ones, or eight mediocre ones, and those are different
 * conversations. This page is the answer — the eight items, the option the
 * patient chose, and what each contributed.
 *
 * Two guards worth naming.
 *
 * **The assessment must belong to the patient in the URL.** Reading it by id
 * alone would render any assessment under any patient's heading, which is a
 * wrong clinical record rather than a broken page. A mismatch is a 404, not a
 * redirect: the pairing does not exist.
 *
 * **The total is recomputed from the stored answers** by `reviewAssessment`,
 * and a disagreement with the stored total is rendered rather than hidden.
 */
export default async function AssessmentReviewPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  await requireClinician();

  const { id, assessmentId } = await params;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      patientId: true,
      questionnaireId: true,
      questionnaireVersion: true,
      status: true,
      sentAt: true,
      expiresAt: true,
      emailDeliveredAt: true,
      completedAt: true,
      totalScore: true,
      riskBand: true,
      answers: { select: { questionId: true, score: true } },
      patient: { select: { id: true, fullName: true, mrn: true } },
    },
  });

  // An unknown id, or an assessment that belongs to a different patient, is
  // the same fact from the reader's point of view: this record is not here.
  if (!assessment || assessment.patientId !== id) notFound();

  const now = new Date();
  const status = displayStatus(assessment, now);
  const review = reviewAssessment(assessment.answers, assessment.totalScore);
  const band = assessment.riskBand ? bandByLabel(assessment.riskBand) : undefined;

  const backHref = `/patients/${assessment.patient.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={DSMA8.title}
        eyebrow={
          <Link href={backHref} className="text-xs text-muted hover:text-ink">
            ← {assessment.patient.fullName}
          </Link>
        }
        description={`${assessment.patient.mrn} · ${assessment.questionnaireId} v${assessment.questionnaireVersion}`}
        badge={
          <>
            <Badge
              tone={
                status === "COMPLETED"
                  ? "low"
                  : status === "EXPIRED"
                    ? "neutral"
                    : "accent"
              }
            >
              {status === "COMPLETED"
                ? "Completed"
                : status === "EXPIRED"
                  ? "Expired"
                  : "Awaiting reply"}
            </Badge>
            {assessment.riskBand ? (
              <Badge tone={bandTone(assessment.riskBand)}>
                {assessment.riskBand}
              </Badge>
            ) : null}
          </>
        }
      />

      {/* The stored total and the answers on file are two records of one fact.
          When they disagree, say so on the page rather than picking one. */}
      {review.totalMismatch ? (
        <Alert tone="danger" title="This record disagrees with itself">
          The stored total is {assessment.totalScore}, but the {review.answeredCount}{" "}
          answers on file add up to {review.computedTotal}. The individual answers
          below are the primary record. Do not act on the total until this is
          resolved.
        </Alert>
      ) : null}

      {review.unknownAnswerIds.length > 0 ? (
        <Alert tone="danger" title="Answers from a different questionnaire">
          {review.unknownAnswerIds.length} stored{" "}
          {review.unknownAnswerIds.length === 1 ? "answer is" : "answers are"} for
          question {review.unknownAnswerIds.join(", ")}, which{" "}
          {review.unknownAnswerIds.length === 1 ? "is" : "are"} not part of{" "}
          {DSMA8.id} v{DSMA8.version}. They are not shown below and are not
          counted in the total.
        </Alert>
      ) : null}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-3 xl:grid-cols-5">
          <Fact label="Sent" value={toIsoDate(assessment.sentAt)} />
          <Fact
            label="Invitation"
            value={
              assessment.emailDeliveredAt
                ? `Emailed ${toIsoDate(assessment.emailDeliveredAt)}`
                : "Not emailed"
            }
            hint={
              assessment.emailDeliveredAt
                ? undefined
                : "The link was created but no mail provider delivered it."
            }
          />
          <Fact
            label="Completed"
            value={
              assessment.completedAt ? toIsoDate(assessment.completedAt) : "—"
            }
            hint={
              assessment.completedAt
                ? undefined
                : status === "EXPIRED"
                  ? `Link expired ${toIsoDate(assessment.expiresAt)}`
                  : `Link expires ${toIsoDate(assessment.expiresAt)}`
            }
          />
          <Fact
            label="Score"
            value={
              review.computedTotal === null
                ? "—"
                : `${review.computedTotal} / ${review.maxTotal}`
            }
            hint={
              review.computedTotal === null
                ? undefined
                : "Recomputed from the answers on file"
            }
          />
          <Fact
            label="Risk band"
            value={assessment.riskBand ?? "—"}
            hint={band?.guidance}
          />
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Answers"
          description={
            review.answeredCount === review.itemCount
              ? DSMA8.instructions
              : `${review.answeredCount} of ${review.itemCount} items answered. ${DSMA8.instructions}`
          }
        />

        {review.answeredCount === 0 ? (
          <div className="px-5 py-5">
            <Alert tone="info" title="No answers yet">
              {status === "EXPIRED"
                ? "This invitation expired before the patient answered it. The questions that were asked are listed below."
                : "The patient has not submitted this questionnaire yet. The questions they have been asked are listed below."}
            </Alert>
          </div>
        ) : null}

        <ol className="flex flex-col">
          {review.items.map((item) => {
            const answered = item.score !== null;

            return (
              <li
                key={item.id}
                className="grid grid-cols-1 gap-3 border-b border-rule px-5 py-4 last:border-0 sm:grid-cols-[1fr_14rem] sm:gap-6"
              >
                <div className="flex min-w-0 gap-3">
                  <span className="tabular font-mono text-xs text-muted">
                    {item.position}.
                  </span>
                  <p className="text-sm text-ink">{item.text}</p>
                </div>

                <div className="flex flex-col gap-1.5 sm:items-end">
                  {answered ? (
                    <>
                      <p className="text-sm font-medium text-ink">
                        {item.answerLabel ?? "Unrecognised answer"}
                        <span className="tabular ml-2 font-mono text-xs text-muted">
                          {item.score}
                        </span>
                      </p>

                      {/* The bar is reinforcement, never the only carrier: the
                          option label and the number are both already there in
                          text. It exists so eight rows can be scanned for the
                          long ones without reading eight sentences. */}
                      <div
                        aria-hidden
                        className="h-1.5 w-full overflow-hidden rounded-full bg-subtle sm:w-40"
                      >
                        <div
                          className={cx(
                            "h-full rounded-full",
                            item.score! === 0 ? "bg-rule-strong" : "bg-accent",
                          )}
                          style={{
                            // A zero answer still gets a sliver, so "answered
                            // Never" and "not answered" do not look identical.
                            width: `${Math.max(itemShare(item.score) * 100, 4)}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted">Not answered</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <p className="text-xs text-muted">
        Higher scores describe more difficulty. {DSMA8.notes}
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
