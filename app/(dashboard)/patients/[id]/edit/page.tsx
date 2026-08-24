import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PatientForm } from "@/components/patients/patient-form";
import { Card, CardHeader } from "@/components/ui";
import { updatePatient } from "@/lib/actions/patients";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toIsoDate } from "@/lib/validation/patient";

export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireClinician();

  const { id } = await params;

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) notFound();

  // Binding the id server-side means the form cannot be repointed at another
  // patient by editing a hidden field in the browser.
  const action = updatePatient.bind(null, patient.id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/patients/${patient.id}`}
          className="text-xs text-muted hover:text-ink"
        >
          ← {patient.fullName}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Edit patient
        </h1>
      </div>

      <Card>
        <CardHeader title="Patient details" />
        <div className="px-5 py-5">
          <PatientForm
            action={action}
            submitLabel="Save changes"
            cancelHref={`/patients/${patient.id}`}
            defaults={{
              fullName: patient.fullName,
              mrn: patient.mrn,
              dateOfBirth: toIsoDate(patient.dateOfBirth),
              sex: patient.sex,
              email: patient.email ?? "",
              phone: patient.phone ?? "",
            }}
          />
        </div>
      </Card>
    </div>
  );
}
