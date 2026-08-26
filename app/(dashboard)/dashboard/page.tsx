import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  Meter,
  RiskDistribution,
  StatTile,
} from "@/components/dashboard/figures";
import { ItemBreakdownCard } from "@/components/dashboard/item-breakdown";
import { LabInsights, LabVolume } from "@/components/dashboard/lab-insights";
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
import { clinicInsights, clinicMetrics } from "@/lib/dashboard/service";
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

/* --------------------------------------------------------------- insights -- */

/**
 * The clinical panels: the three measures, then the questionnaire.
 *
 * One Suspense boundary around all of it rather than four, deliberately. They
 * come from a single `clinicInsights()` call, so splitting them would buy four
 * skeletons resolving at the same instant — flicker rather than progressive
 * disclosure. The tile strip above is a separate boundary because it is a
 * separate query and genuinely does resolve first.
 *
 * Order is the order a clinician reads in: what the register looks like now and
 * which way it is moving, then how much data is arriving, then which behaviour
 * to work on. The last one is the only panel that suggests an action.
 */
async function Insights() {
  const insights = await clinicInsights();

  return (
    <>
      <LabInsights
        tests={insights.tests}
        excludedForUnit={insights.excludedForUnit}
      />

      {/* `items-start`, so a card sized to a 14rem chart does not stretch to
          match a card holding eight questionnaire rows. Equal heights are worth
          having when both cards fill them; here it bought 500px of empty white
          inside the shorter one, which reads as a panel that failed to load. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(28rem,100%),1fr))] items-start gap-6">
        <LabVolume points={insights.volume} />
        <ItemBreakdownCard
          items={insights.items}
          assessmentCount={insights.assessmentCount}
        />
      </div>
    </>
  );
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1].map((row) => (
        <div
          key={row}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(28rem,100%),1fr))] gap-6"
        >
          {[0, 1].map((col) => (
            <Card key={col}>
              <div className="flex flex-col gap-2 border-b border-rule px-5 py-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <div className="px-5 py-5">
                <Skeleton className="h-44 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
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
          the same moment and neither fills a wide screen alone.

          `auto-fit` rather than a fixed pair of columns, because on a clinic
          with no patients the distribution renders nothing and a fixed grid
          would leave the imports card stranded in half a row with dead space
          beside it — which is exactly the "looks broken rather than
          intentional" the brief calls out. An empty track collapses, so the
          survivor takes the width. `min(30rem, 100%)` is what keeps the track
          from being wider than a phone.  */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(30rem,100%),1fr))] gap-6">
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

      <Suspense fallback={<InsightsSkeleton />}>
        <Insights />
      </Suspense>
    </div>
  );
}
