import type { Metadata } from "next";

import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card, CardHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Clinic" };

export default async function ClinicDashboardPage() {
  await requireClinician();

  const patientCount = await prisma.patient.count();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Clinic overview
        </h1>
        <p className="text-sm text-muted">
          Aggregate activity across the practice.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Patients"
          description="Total records in the register"
        />
        <div className="px-5 py-6">
          <p className="tabular font-mono text-3xl text-ink">{patientCount}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Assessments and uploads" />
        <EmptyState
          title="Nothing recorded yet"
          description="Completion rates, risk bands and recent lab uploads appear here once assessments have been sent and results imported."
        />
      </Card>
    </div>
  );
}
