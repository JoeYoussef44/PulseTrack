import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SendAssessment } from "@/components/assessments/send-assessment";
import { DeletePatient } from "@/components/patients/delete-patient";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { bandTone, displayStatus } from "@/lib/assessments/service";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toIsoDate } from "@/lib/validation/patient";

export const metadata: Metadata = { title: "Patient" };

const SEX_LABEL: Record<string, string> = {
  FEMALE: "Female",
  MALE: "Male",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

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

  const isSeeded = patient.fhirOwnership === "EXTERNAL_SEED";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/patients" className="text-xs text-muted hover:text-ink">
          ← Patients
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {patient.fullName}
          </h1>
          {isSeeded ? <Badge tone="accent">National platform record</Badge> : null}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Patient details"
          action={
            <div className="flex items-center gap-2">
              <Link href={`/patients/${patient.id}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            </div>
          }
        />
        <dl className="grid gap-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="MRN" value={patient.mrn} />
          <DetailItem
            label="Date of birth"
            value={toIsoDate(patient.dateOfBirth)}
          />
          <DetailItem
            label="Sex"
            value={SEX_LABEL[patient.sex] ?? patient.sex}
          />
          <DetailItem label="Email" value={patient.email ?? "Not recorded"} />
          <DetailItem label="Phone" value={patient.phone ?? "Not recorded"} />
          <DetailItem
            label="National platform"
            value={
              patient.fhirPatientId
                ? `Linked · ${patient.fhirPatientId}`
                : "Not yet synced"
            }
          />
        </dl>
      </Card>

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
            <table className="w-full min-w-[560px] text-sm">
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
                      <td className="tabular px-5 py-3 text-ink-2">
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
                      <td className="tabular px-5 py-3 text-ink-2">
                        {a.completedAt ? toIsoDate(a.completedAt) : "—"}
                      </td>
                      <td className="tabular px-5 py-3 font-mono text-ink">
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
        <CardHeader title="Lab results" description="Imported test results" />
        <EmptyState
          title="No lab results"
          description="Import a CSV of lab results, or pull this patient's history from the national platform."
        />
      </Card>

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
