import type { Metadata } from "next";
import Link from "next/link";

import { PatientForm } from "@/components/patients/patient-form";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { createPatient } from "@/lib/actions/patients";
import { requireClinician } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add patient" };

export default async function NewPatientPage() {
  await requireClinician();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Add patient"
        eyebrow={
          <Link href="/patients" className="text-xs text-muted hover:text-ink">
            ← Patients
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Patient details"
          description="The MRN must be unique across the clinic."
        />
        <div className="px-5 py-5">
          <PatientForm
            action={createPatient}
            submitLabel="Create patient"
            cancelHref="/patients"
          />
        </div>
      </Card>
    </div>
  );
}
