import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { bandTone } from "@/lib/assessments/service";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AssessmentStatus } from "@/lib/generated/prisma/enums";
import { toIsoDate } from "@/lib/validation/patient";

export const metadata: Metadata = { title: "Patients" };

const SEX_LABEL: Record<string, string> = {
  FEMALE: "Female",
  MALE: "Male",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

async function PatientTable({ query }: { query: string }) {
  const trimmed = query.trim();

  // Prisma parameterises every value, so the search term is never interpolated
  // into SQL. No raw queries anywhere in this codebase.
  const patients = await prisma.patient.findMany({
    where: trimmed
      ? {
          OR: [
            { fullName: { contains: trimmed, mode: "insensitive" } },
            { mrn: { contains: trimmed, mode: "insensitive" } },
            { email: { contains: trimmed, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { fullName: "asc" },
    take: 200,
    select: {
      id: true,
      mrn: true,
      fullName: true,
      dateOfBirth: true,
      sex: true,
      email: true,
      fhirOwnership: true,
      _count: { select: { labResults: true, assessments: true } },
      // The same rule the dashboard counts by (D-DASH-3): a patient's band is
      // their most recent *completed* assessment, not their most recent one.
      assessments: {
        where: { status: AssessmentStatus.COMPLETED },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { riskBand: true, completedAt: true },
      },
      labResults: {
        orderBy: { collectedDate: "desc" },
        take: 1,
        select: { collectedDate: true },
      },
    },
  });

  if (patients.length === 0) {
    // "No matches for this search" and "no patients at all" are different
    // situations and must not share a message.
    return trimmed ? (
      <EmptyState
        title={`No patients match “${trimmed}”`}
        description="Try a different name or MRN, or clear the search to see everyone."
        action={
          <Link href="/patients">
            <Button variant="secondary">Clear search</Button>
          </Link>
        }
      />
    ) : (
      <EmptyState
        title="No patients yet"
        description="Add your first patient to start tracking lab results and self-assessments."
        action={
          <Link href="/patients/new">
            <Button>Add patient</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          {/* Sticky, because a register is scrolled and a column you cannot
              name is a column you cannot read. */}
          <tr className="border-b border-rule text-left">
            {[
              "Name",
              "MRN",
              "Date of birth",
              "Sex",
              "Latest band",
              "Last result",
              "Records",
            ].map((h) => (
              <th
                key={h}
                scope="col"
                className="sticky top-0 z-10 bg-surface px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => {
            const band = p.assessments[0]?.riskBand ?? null;
            const lastResult = p.labResults[0]?.collectedDate ?? null;

            return (
              <tr
                key={p.id}
                className="border-b border-rule last:border-0 hover:bg-subtle"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/patients/${p.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {p.fullName}
                  </Link>
                  {p.fhirOwnership === "EXTERNAL_SEED" ? (
                    <span className="ml-2">
                      <Badge tone="accent">National platform</Badge>
                    </span>
                  ) : null}
                  {p.email ? (
                    <div className="text-xs text-muted">{p.email}</div>
                  ) : null}
                </td>
                <td className="tabular px-5 py-3 font-mono whitespace-nowrap text-ink-2">
                  {p.mrn}
                </td>
                <td className="tabular px-5 py-3 whitespace-nowrap text-ink-2">
                  {toIsoDate(p.dateOfBirth)}
                </td>
                <td className="px-5 py-3 text-ink-2">
                  {SEX_LABEL[p.sex] ?? p.sex}
                </td>
                {/* Always the written band, never colour alone — the same rule
                    that governs the distribution chart. */}
                <td className="px-5 py-3">
                  {band ? (
                    <Badge tone={bandTone(band)}>{band}</Badge>
                  ) : (
                    <span className="text-xs text-muted">Not assessed</span>
                  )}
                </td>
                <td className="tabular px-5 py-3 whitespace-nowrap text-ink-2">
                  {lastResult ? (
                    toIsoDate(lastResult)
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="tabular px-5 py-3 text-xs whitespace-nowrap text-muted">
                  {p._count.labResults} labs · {p._count.assessments} assessments
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 py-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireClinician();

  const { q = "" } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Patients"
        description="Search by name, MRN or email address."
        action={
          <>
            {/* Search sits with the action rather than on its own line: it is
                the other thing you came here to do, and three stacked blocks
                of chrome above a table is two too many. */}
            <form method="get" className="flex w-full gap-2 sm:w-auto">
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search patients…"
                aria-label="Search patients"
                className="min-w-0 sm:w-64"
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            <Link href="/patients/new">
              <Button>Add patient</Button>
            </Link>
          </>
        }
      />

      <Card>
        {/* key forces a fresh Suspense boundary per query, so the skeleton
            shows again when the search term changes. */}
        <Suspense key={q} fallback={<TableSkeleton />}>
          <PatientTable query={q} />
        </Suspense>
      </Card>
    </div>
  );
}
