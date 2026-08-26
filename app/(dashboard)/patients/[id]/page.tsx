import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SendAssessment } from "@/components/assessments/send-assessment";
import { LabTrends, ScoreTrend } from "@/components/charts/patient-trends";
import { DeletePatient } from "@/components/patients/delete-patient";
import { IdentityBanner } from "@/components/patients/identity-banner";
import { TrajectorySummary } from "@/components/patients/trajectory-summary";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { aiConfigProblem, isAiConfigured } from "@/lib/ai/config";
import { bandTone, displayStatus } from "@/lib/assessments/service";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toLabSeries, toScoreSeries } from "@/lib/labs/series";
import { toIsoDate } from "@/lib/validation/patient";

export const metadata: Metadata = { title: "Patient" };

const SEX_LABEL: Record<string, string> = {
  FEMALE: "Female",
  MALE: "Male",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireClinician();

  const { id } = await params;

  const patient = await prisma.patient.findUnique({
    where: { id },
    select: {
      id: true,
      mrn: true,
      fullName: true,
      dateOfBirth: true,
      sex: true,
      email: true,
      phone: true,
      fhirOwnership: true,
      fhirPatientId: true,
      assessments: {
        orderBy: { sentAt: "desc" },
        select: {
          id: true,
          status: true,
          sentAt: true,
          expiresAt: true,
          completedAt: true,
          totalScore: true,
          riskBand: true,
        },
      },
      labResults: {
        orderBy: { collectedDate: "desc" },
        select: {
          id: true,
          collectedDate: true,
          testCode: true,
          testName: true,
          value: true,
          unit: true,
          refLow: true,
          refHigh: true,
          source: true,
        },
      },
    },
  });

  // An unknown id is a 404, not a crash and not an empty page.
  if (!patient) notFound();

  // Captured once, before rendering, so the render itself stays pure.
  const now = new Date();
  const assessments = patient.assessments.map((a) => ({
    ...a,
    displayStatus: displayStatus(a, now),
  }));

  // Both series are shaped before the render tree, by pure functions that sort
  // chronologically. The charts must never depend on the order a query happened
  // to return, and the render itself stays free of computation.
  const labSeries = toLabSeries(patient.labResults);
  const scorePoints = toScoreSeries(patient.assessments);

  const isSeeded = patient.fhirOwnership === "EXTERNAL_SEED";

  // The band a clinician needs at the top of the page: the most recent
  // *completed* assessment, which is the same rule the clinic dashboard counts
  // by. Assessments arrive newest-first, so the first completed one wins.
  const latestBand =
    patient.assessments.find((a) => a.status === "COMPLETED")?.riskBand ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={patient.fullName}
        eyebrow={
          <Link href="/patients" className="text-xs text-muted hover:text-ink">
            ← Patients
          </Link>
        }
        badge={
          <>
            {latestBand ? (
              <Badge tone={bandTone(latestBand)}>{latestBand}</Badge>
            ) : (
              <Badge tone="neutral">Not yet assessed</Badge>
            )}
            {isSeeded ? (
              <Badge tone="accent">National platform record</Badge>
            ) : null}
          </>
        }
        action={
          <Link href={`/patients/${patient.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />

      <IdentityBanner
        mrn={patient.mrn}
        dateOfBirth={toIsoDate(patient.dateOfBirth)}
        sex={SEX_LABEL[patient.sex] ?? patient.sex}
        email={patient.email ?? "Not recorded"}
        phone={patient.phone ?? "Not recorded"}
        platform={
          patient.fhirPatientId
            ? `Linked · ${patient.fhirPatientId}`
            : "Not yet synced"
        }
      />

      {/* Four charts in one grid rather than a stack of full-width cards. The
          score leads: it is the measure this clinic sends the questionnaire
          for, and the labs qualify it. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScoreTrend points={scorePoints} />
        <LabTrends series={labSeries} />
      </div>

      {/* The narrative sits between the charts and the records: after the
          shapes a clinician reads first, before the rows they check against.
          Whether the feature is configured is decided on the server — the key
          never reaches the browser, and neither does the question of whether
          there is one. */}
      <TrajectorySummary
        patientId={patient.id}
        configured={isAiConfigured()}
        problem={aiConfigProblem()}
      />

      {/* The two record tables side by side. Both keep their own
          horizontal scroll, so a narrow column never clips a column
          header — it scrolls inside the card, not the page. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Assessments"
            description="DSMA-8 self-assessment history"
            action={
              <SendAssessment
                patientId={patient.id}
                hasEmail={Boolean(patient.email)}
              />
            }
          />
          {assessments.length === 0 ? (
            <EmptyState
              title="No assessments sent"
              description="Send this patient a DSMA-8 self-assessment to start tracking their score over time."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left">
                    {["Sent", "Status", "Completed", "Score", "Risk band"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a) => {
                    const status = a.displayStatus;

                    return (
                      <tr
                        key={a.id}
                        className="border-b border-rule last:border-0"
                      >
                        <td className="tabular px-5 py-3 whitespace-nowrap text-ink-2">
                          {toIsoDate(a.sentAt)}
                        </td>
                        <td className="px-5 py-3">
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
                        </td>
                        <td className="tabular px-5 py-3 whitespace-nowrap text-ink-2">
                          {a.completedAt ? toIsoDate(a.completedAt) : "—"}
                        </td>
                        <td className="tabular px-5 py-3 font-mono whitespace-nowrap text-ink">
                          {a.totalScore ?? "—"}
                          {a.totalScore !== null ? (
                            <span className="text-muted"> / 24</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          {a.riskBand ? (
                            <Badge tone={bandTone(a.riskBand)}>{a.riskBand}</Badge>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Lab results"
            description="Every stored result, newest first. This is the table view of the charts above — no value is reachable only by hovering."
          />
          {patient.labResults.length === 0 ? (
            <EmptyState
              title="No lab results"
              description="Import a CSV of lab results, or pull this patient's history from the national platform."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left">
                    {["Collected", "Test", "Result", "Reference", "Source"].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {patient.labResults.map((result) => {
                    const value = Number(result.value);
                    const low = result.refLow === null ? null : Number(result.refLow);
                    const high = result.refHigh === null ? null : Number(result.refHigh);

                    // Flagged, not coloured-only: the word "High" or "Low" is
                    // what carries the meaning, with the tone as reinforcement.
                    const flag =
                      low !== null && value < low
                        ? "Low"
                        : high !== null && value > high
                          ? "High"
                          : null;

                    return (
                      <tr
                        key={result.id}
                        className="border-b border-rule last:border-0"
                      >
                        <td className="tabular px-5 py-3 whitespace-nowrap text-ink-2">
                          {toIsoDate(result.collectedDate)}
                        </td>
                        <td className="px-5 py-3 text-ink">{result.testName}</td>
                        <td className="px-5 py-3">
                          <span className="tabular font-mono text-ink">
                            {value}
                          </span>
                          <span className="ml-1 text-muted">{result.unit}</span>
                          {flag ? (
                            <span className="ml-2">
                              <Badge tone={flag === "High" ? "high" : "moderate"}>
                                {flag}
                              </Badge>
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular px-5 py-3 whitespace-nowrap text-muted">
                          {low !== null && high !== null ? `${low}–${high}` : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={result.source === "FHIR" ? "accent" : "neutral"}>
                            {result.source === "FHIR"
                              ? "National platform"
                              : result.source === "CSV"
                                ? "CSV import"
                                : "Manual"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Danger zone" />
        <div className="px-5 py-5">
          <DeletePatient
            patientId={patient.id}
            patientName={patient.fullName}
            isOnFhir={Boolean(patient.fhirPatientId)}
          />
        </div>
      </Card>
    </div>
  );
}
