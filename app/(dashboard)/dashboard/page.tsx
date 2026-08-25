import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  Meter,
  RiskDistribution,
  StatTile,
} from "@/components/dashboard/figures";
import { RecentUploads } from "@/components/dashboard/recent-uploads";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { requireClinician } from "@/lib/auth/session";
import { clinicMetrics } from "@/lib/dashboard/service";
import {
  formatRate,
  higherRiskCount,
  parseUploadWindow,
} from "@/lib/dashboard/metrics";

export const metadata: Metadata = { title: "Clinic" };

/** An overview of live activity must not be served from a cache. */
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ tiles -- */

/**
 * The four figures the clinic is judged on, in one joined strip.
 *
 * They were previously a large hero number in its own card beside a pair
 * sharing a second — a seam that read as an accident rather than a decision,
 * and which left two-fifths of a wide monitor empty. Four equal tiles scan in
 * one pass, which is what a strip of figures is for.
 *
 * The fourth is deliberately not "patients not yet assessed": tile one already
 * says that in its caption, and the distribution below says it again. Higher
 * risk is the number that changes what a clinician does today.
 */
async function Tiles() {
  const metrics = await clinicMetrics();

  // A clinic with no patients is a new clinic, not a broken dashboard. Zeroes
  // across four tiles read as failure; one sentence and a next action does not.
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
  const higherRisk = higherRiskCount(metrics.distribution);
  const notAssessed = metrics.patientCount - metrics.assessedPatientCount;

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Patients"
        value={metrics.patientCount}
        caption={
          notAssessed === 0
            ? "All have completed an assessment"
            : `${metrics.assessedPatientCount} assessed · ${notAssessed} not yet`
        }
      />

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
        label="Higher risk"
        value={higherRisk}
        caption={
          higherRisk === 0
            ? "Nobody is high or very high"
            : "High or very high on their latest assessment"
        }
      />

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
  );
}

function TilesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-surface px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-16" />
          <Skeleton className="mt-1.5 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ distribution -- */

async function RiskBands() {
  const metrics = await clinicMetrics();

  // The empty register already says everything it has to say in the tile strip.
  if (metrics.patientCount === 0) return null;

  return (
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
  );
}

function RiskBandsSkeleton() {
  return (
    <Card>
      <div className="flex flex-col gap-4 px-5 py-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page -- */

export default async function ClinicDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ uploads?: string }>;
}) {
  await requireClinician();

  const { uploads } = await searchParams;
  // Total: an absent, unknown or hand-edited value falls back to the default
  // rather than throwing or querying on an invalid date.
  const window = parseUploadWindow(uploads);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clinic overview"
        description="Aggregate activity across the practice."
      />

      <Suspense fallback={<TilesSkeleton />}>
        <Tiles />
      </Suspense>

      {/* The register's shape beside the register's traffic. Both are read at
          the same moment and neither fills a wide screen alone. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Suspense fallback={<RiskBandsSkeleton />}>
          <RiskBands />
        </Suspense>

        <Suspense
          key={window.key}
          fallback={
            <Card>
              <div className="flex flex-col gap-2 px-5 py-6">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </Card>
          }
        >
          <RecentUploads window={window} />
        </Suspense>
      </div>
    </div>
  );
}
