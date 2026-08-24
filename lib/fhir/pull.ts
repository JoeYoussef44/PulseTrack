import "server-only";

import { prisma } from "@/lib/db";
import {
  FhirOwnership,
  FhirSyncStatus,
  LabSource,
} from "@/lib/generated/prisma/enums";

import { fetchBundlePage, searchBundle } from "./client";
import { FhirError } from "./errors";
import {
  fromFhirObservation,
  fromFhirPatient,
  type ImportedObservation,
  type ImportedPatient,
  type ObservationSkipReason,
} from "./mappers";
import { PAGE_SIZE, walkPages } from "./pagination";
import { planObservationWrites } from "./reconcile";
import { readFhirConfig } from "./config";
import { MRN_SYSTEM } from "./systems";
import type { Bundle, FhirObservation, FhirPatient } from "./types";

/**
 * Importing the platform's own historical data.
 *
 * Tier 2 requirement 2: five seeded patients with twelve months of monthly
 * observations each, which have to end up in the same tables as locally
 * entered data so they appear on the same dashboards and the same charts. The
 * `source` discriminator on `LabResult` is what makes that possible without a
 * parallel set of tables.
 *
 * Everything here is read-only against the platform. Seeded resources are
 * tagged `cand-admin` — they are not ours, we may not write them, and we never
 * push them back (D-FHIR-2).
 */

export interface ImportSkip {
  reason: ObservationSkipReason;
  count: number;
}

export interface PatientImportReport {
  mrn: string;
  /** False when the platform has no patient with this MRN. */
  found: boolean;
  patientId?: string;
  patientCreated?: boolean;

  /** New local rows. */
  imported: number;
  /** Rows the platform has revised since we stored them. */
  updated: number;
  /** Rows already linked and identical — no write at all. */
  unchanged: number;
  /**
   * A local row already held this measurement under a different provenance.
   * Linked, never overwritten — see `mergeExisting` below.
   */
  merged: number;
  /** Merged rows whose local value disagreed with the platform's. */
  conflicts: number;
  /** Observations we could not represent, grouped by why. */
  skipped: ImportSkip[];

  pagesFetched: number;
  /** True when MAX_PAGES was hit with a next link still outstanding. */
  truncated: boolean;

  error?: string;
}

const SKIP_LABELS: Record<ObservationSkipReason, string> = {
  "unsupported-code": "a test this clinic does not track",
  "no-value": "no numeric result",
  "no-date": "no collection date",
  "no-id": "no identifier on the platform",
};

export function describeSkip(reason: ObservationSkipReason): string {
  return SKIP_LABELS[reason];
}

/**
 * Imports one seeded patient and their whole observation history.
 *
 * One MRN per call, deliberately. Each patient is three requests to the
 * platform — one search plus two pages of observations — and doing all five in
 * one invocation makes this the single slowest thing in the app and the most
 * likely to meet Vercel's 60-second ceiling. Per-patient also means a patient
 * that fails does not take the other four down with it, and the UI has
 * something real to show as progress.
 */
export async function importSeedPatient(
  mrn: string,
): Promise<PatientImportReport> {
  const empty: PatientImportReport = {
    mrn,
    found: false,
    imported: 0,
    updated: 0,
    unchanged: 0,
    merged: 0,
    conflicts: 0,
    skipped: [],
    pagesFetched: 0,
    truncated: false,
  };

  try {
    // No `_tag` filter here, and that is the point: this is deliberately
    // somebody else's data. Everywhere we *write*, the tag scope is mandatory.
    const bundle = await searchBundle<FhirPatient>("Patient", {
      identifier: `${MRN_SYSTEM}|${mrn}`,
    });

    const resource = bundle.entry?.[0]?.resource;
    if (!resource) return empty;

    const mapped = fromFhirPatient(resource);
    if (!mapped) {
      return {
        ...empty,
        error:
          "The platform returned a patient record without an MRN or an id, which cannot be linked to anything here.",
      };
    }

    const { patientId, created } = await upsertPatient(mapped);

    const observations = await pullObservations(mapped.fhirPatientId);
    const stored = await storeObservations(patientId, observations.mapped);

    console.info(
      `[fhir] pull mrn=${mrn} local=${patientId} pages=${observations.pagesFetched} ` +
        `imported=${stored.imported} updated=${stored.updated} unchanged=${stored.unchanged} merged=${stored.merged} ` +
        `skipped=${observations.skipped.reduce((n, s) => n + s.count, 0)}`,
    );

    return {
      mrn,
      found: true,
      patientId,
      patientCreated: created,
      ...stored,
      skipped: observations.skipped,
      pagesFetched: observations.pagesFetched,
      truncated: observations.truncated,
    };
  } catch (error) {
    const fhirError =
      error instanceof FhirError
        ? error
        : new FhirError("unexpected", "The import failed unexpectedly.");

    console.warn(`[fhir] pull failed mrn=${mrn} kind=${fhirError.kind}`);

    return { ...empty, error: fhirError.toRecord() };
  }
}

/**
 * Links a seeded patient locally, without overwriting anything a clinician has
 * edited.
 *
 * D-FHIR-3: remote wins on the first import, local wins thereafter. A record
 * imported once and then corrected here — a misspelled name, a corrected date
 * of birth — must not silently revert every time someone presses Import.
 *
 * The link fields are refreshed either way, because those describe the
 * relationship rather than the person.
 */
async function upsertPatient(
  mapped: ImportedPatient,
): Promise<{ patientId: string; created: boolean }> {
  const existing = await prisma.patient.findUnique({
    where: { mrn: mapped.mrn },
    select: { id: true },
  });

  if (existing) {
    await prisma.patient.update({
      where: { id: existing.id },
      data: {
        fhirPatientId: mapped.fhirPatientId,
        fhirOwnership: FhirOwnership.EXTERNAL_SEED,
        fhirSyncStatus: FhirSyncStatus.SYNCED,
        fhirLastSyncedAt: new Date(),
        fhirLastError: null,
      },
    });

    return { patientId: existing.id, created: false };
  }

  const created = await prisma.patient.create({
    data: {
      mrn: mapped.mrn,
      fullName: mapped.fullName,
      dateOfBirth: mapped.dateOfBirth,
      sex: mapped.sex,
      // No email or phone: the platform is not asked for contact details and
      // does not hold ours. A clinician adds them if this patient is to be
      // sent a questionnaire.
      fhirPatientId: mapped.fhirPatientId,
      fhirOwnership: FhirOwnership.EXTERNAL_SEED,
      fhirSyncStatus: FhirSyncStatus.SYNCED,
      fhirLastSyncedAt: new Date(),
    },
    select: { id: true },
  });

  return { patientId: created.id, created: true };
}

interface PulledObservations {
  mapped: ImportedObservation[];
  skipped: ImportSkip[];
  pagesFetched: number;
  truncated: boolean;
}

/**
 * Walks a patient's observations to exhaustion.
 *
 * Two things here are not what the API guide says, both measured (.docs §23):
 *
 * `_count` is **20, not the guide's 50**. Each seeded patient has exactly 36
 * observations, so at 50 everything returns in one page, no `next` link is
 * ever emitted, and the pagination code never runs — an integration that
 * *looks* paginated and has never paginated once.
 *
 * And the `next` link cannot be followed as given: it points at `hapi:8080`,
 * the server's own container hostname, which is unreachable from outside.
 * Following it verbatim, as the guide instructs, fails silently and truncates
 * every import to its first 20 results. `nextPageUrl` re-bases it onto our
 * configured host, keeping the server's opaque `_getpages` cursor intact.
 */
async function pullObservations(
  fhirPatientId: string,
): Promise<PulledObservations> {
  const config = readFhirConfig();
  if (!config) throw new FhirError("config", "The integration is not configured.");

  const query = new URLSearchParams({
    subject: `Patient/${fhirPatientId}`,
    _sort: "date",
    _count: String(PAGE_SIZE),
  });

  // The walk itself — cursor loop guard, page cap, and the rule that loop
  // control depends on the `next` link and never on `bundle.total` — lives in
  // pagination.ts and is unit-tested there.
  const walked = await walkPages<FhirObservation>(
    `${config.baseUrl}/Observation?${query.toString()}`,
    config.baseUrl,
    async (url) => {
      const bundle: Bundle<FhirObservation> =
        await fetchBundlePage<FhirObservation>(url);

      return {
        entries: (bundle.entry ?? [])
          .map((entry) => entry.resource)
          .filter((resource): resource is FhirObservation => Boolean(resource)),
        links: bundle.link,
      };
    },
  );

  const mapped: ImportedObservation[] = [];
  const skips = new Map<ObservationSkipReason, number>();

  for (const resource of walked.items) {
    const result = fromFhirObservation(resource);
    if (result.ok) mapped.push(result.value);
    else skips.set(result.reason, (skips.get(result.reason) ?? 0) + 1);
  }

  return {
    mapped,
    skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })),
    pagesFetched: walked.pagesFetched,
    // Reported rather than hidden: a silently truncated import is worse than a
    // failed one, because it looks like it worked.
    truncated: walked.truncated,
  };
}

/**
 * Writes the pulled observations, resolving both ways they can collide.
 *
 * `fhirObservationId` is unique, and so is `(patientId, collectedDate,
 * testCode)`. Those two constraints can disagree — a result already entered
 * from a CSV describes the same measurement the platform is now reporting —
 * and letting the second constraint throw would fail an entire import over one
 * row that is not even wrong.
 *
 * So there are three outcomes, all counted:
 *
 * - **imported** — new to us.
 * - **updated** — already linked to this observation; refreshed, because the
 *   platform owns these rows and is the authority on them.
 * - **merged** — we already held this measurement from elsewhere. The link is
 *   attached; the stored value is *not* touched. Overwriting a clinician's
 *   record with a remote one that happens to share a date is the kind of
 *   silent edit that makes a clinical system untrustworthy, and it follows the
 *   same rule as a re-uploaded CSV row (D-CSV-2). Where the two disagree, that
 *   is counted separately and shown.
 */
async function storeObservations(
  patientId: string,
  observations: ImportedObservation[],
): Promise<{
  imported: number;
  updated: number;
  unchanged: number;
  merged: number;
  conflicts: number;
}> {
  if (observations.length === 0) {
    return { imported: 0, updated: 0, unchanged: 0, merged: 0, conflicts: 0 };
  }

  // Two bounded queries regardless of how many observations came back, rather
  // than a lookup per row. The filter is narrowed by the same axes the two
  // unique constraints are built from.
  const existing = await prisma.labResult.findMany({
    where: {
      OR: [
        { fhirObservationId: { in: observations.map((o) => o.fhirObservationId) } },
        {
          patientId,
          collectedDate: { in: observations.map((o) => o.collectedDate) },
          testCode: { in: [...new Set(observations.map((o) => o.testCode))] },
        },
      ],
    },
    select: {
      id: true,
      patientId: true,
      collectedDate: true,
      testCode: true,
      value: true,
      unit: true,
      refLow: true,
      refHigh: true,
      fhirObservationId: true,
    },
  });

  const plan = planObservationWrites(
    patientId,
    observations,
    existing.map((row) => ({
      ...row,
      // Prisma returns Decimal; the mapper produced strings.
      value: row.value.toString(),
      refLow: row.refLow?.toString() ?? null,
      refHigh: row.refHigh?.toString() ?? null,
    })),
  );

  const created = await prisma.$transaction(
    async (tx) => {
      const inserted = plan.create.length
        ? await tx.labResult.createMany({
            data: plan.create.map((o) => ({
              patientId,
              collectedDate: o.collectedDate,
              testCode: o.testCode,
              testName: o.testName,
              value: o.value,
              unit: o.unit,
              refLow: o.refLow,
              refHigh: o.refHigh,
              source: LabSource.FHIR,
              fhirObservationId: o.fhirObservationId,
              fhirSyncStatus: FhirSyncStatus.SYNCED,
            })),
            // The last line of defence against a concurrent second import,
            // not a substitute for the planning above.
            skipDuplicates: true,
          })
        : { count: 0 };

      for (const { id, observation } of plan.update) {
        await tx.labResult.update({
          where: { id },
          data: {
            value: observation.value,
            unit: observation.unit,
            refLow: observation.refLow,
            refHigh: observation.refHigh,
            testName: observation.testName,
          },
        });
      }

      for (const { id, fhirObservationId } of plan.link) {
        await tx.labResult.update({
          where: { id },
          // Deliberately only the link. The value stays as recorded.
          data: { fhirObservationId },
        });
      }

      return inserted.count;
    },
    { timeout: 20_000 },
  );

  return {
    imported: created,
    updated: plan.update.length,
    unchanged: plan.unchanged,
    merged: plan.link.length,
    conflicts: plan.conflicts,
  };
}
