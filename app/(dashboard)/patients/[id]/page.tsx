import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeletePatient } from "@/components/patients/delete-patient";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
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
      _count: { select: { labResults: true, assessments: true } },
    },
  });

  // An unknown id is a 404, not a crash and not an empty page.
  if (!patient) notFound();

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
        />
        <EmptyState
          title="No assessments sent"
          description="Send this patient a DSMA-8 self-assessment to start tracking their score over time."
        />
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
