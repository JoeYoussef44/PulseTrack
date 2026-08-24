import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge, Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
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
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              Name
            </th>
            <th className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              MRN
            </th>
            <th className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              Date of birth
            </th>
            <th className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              Sex
            </th>
            <th className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
              Records
            </th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
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
              <td className="tabular px-5 py-3 font-mono text-ink-2">{p.mrn}</td>
              <td className="tabular px-5 py-3 text-ink-2">
                {toIsoDate(p.dateOfBirth)}
              </td>
              <td className="px-5 py-3 text-ink-2">
                {SEX_LABEL[p.sex] ?? p.sex}
              </td>
              <td className="tabular px-5 py-3 text-xs text-muted">
                {p._count.labResults} labs · {p._count.assessments} assessments
              </td>
            </tr>
          ))}
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Patients
          </h1>
          <p className="text-sm text-muted">
            Search by name, MRN or email address.
          </p>
        </div>

        <Link href="/patients/new">
          <Button>Add patient</Button>
        </Link>
      </div>

      <form method="get" className="flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search patients…"
          aria-label="Search patients"
          className="max-w-sm"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

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
