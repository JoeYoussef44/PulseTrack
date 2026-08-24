import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  HeroFigure,
  Meter,
  RiskDistribution,
  StatTile,
} from "@/components/dashboard/figures";
import { Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import { requireClinician } from "@/lib/auth/session";
import { clinicMetrics } from "@/lib/dashboard/service";
import { formatRate } from "@/lib/dashboard/metrics";

export const metadata: Metadata = { title: "Clinic" };

/** An overview of live activity must not be served from a cache. */
export const dynamic = "force-dynamic";

async function Overview() {
  const metrics = await clinicMetrics();

  // A clinic with no patients is a new clinic, not a broken dashboard. Zeroes
  // across five tiles read as failure; one sentence and a next action does not.
  if (metrics.patientCount === 0) {
    return (
      <Card>
        <EmptyState
          title="No patients yet"
          description="Add your first patient to start tracking assessments, lab results and risk across the practice."
          action={
            <Link href="/patients/new">
              <Button>Add patient</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const { completion } = metrics;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* The one hero figure on the page. */}
        <Card className="lg:col-span-1">
          <HeroFigure
            label="Patients"
            value={metrics.patientCount}
            caption={
              metrics.assessedPatientCount === metrics.patientCount
                ? "All have completed an assessment"
                : `${metrics.assessedPatientCount} assessed · ${
                    metrics.patientCount - metrics.assessedPatientCount
                  } not yet`
            }
          />
        </Card>

        <Card className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-px bg-rule sm:grid-cols-2">
            <div className="flex flex-col gap-3 bg-surface px-5 py-4">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted">Assessment completion</p>
                <p className="text-2xl font-semibold tracking-tight text-ink">
                  {formatRate(completion.rate)}
                </p>
              </div>
              <Meter value={completion.rate} label="Assessment completion rate" />
              <p className="text-xs text-muted">
                {completion.sent === 0
                  ? "No assessments sent yet"
                  : `${completion.completed} of ${completion.sent} completed, all time`}
              </p>
            </div>

            <StatTile
              label="Lab results on file"
              value={metrics.labResultCount}
              caption={
                metrics.labResultCount === 0
                  ? "Import a CSV to get started"
                  : "From CSV imports and the national platform"
              }
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Patients by risk band"
          description="Each patient counted once, by their most recent completed assessment."
        />
        <RiskDistribution
          segments={metrics.distribution}
          total={metrics.patientCount}
        />
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col gap-3 px-5 py-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-16" />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-3 px-5 py-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-2 w-full" />
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex flex-col gap-3 px-5 py-6">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </Card>
    </div>
  );
}

export default async function ClinicDashboardPage() {
  await requireClinician();

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

      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </div>
  );
}
