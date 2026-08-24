import "server-only";

import { prisma } from "@/lib/db";
import {
  FhirOwnership,
  FhirSyncStatus,
  LabSource,
} from "@/lib/generated/prisma/enums";

import { isFhirConfigured, missingFhirConfig } from "./config";
import { countPending } from "./push";

/**
 * What the integration page reports.
 *
 * Deliberately a count of local rows rather than a live query against the
 * platform: this is the page a clinician opens to answer "did our data get
 * there", and it must render in an empty, unconfigured, or offline state
 * without a network call that can hang or fail.
 *
 * The base URL and candidate id are safe to show — the API guide puts both in
 * search URLs. The API key is never read here.
 */

export interface FhirIntegrationStatus {
  configured: boolean;
  /** Variable names only, never values. */
  missing: string[];
  baseUrl: string | null;
  candidateId: string | null;

  push: {
    patientsLinked: number;
    patientsTotal: number;
    resultsPushed: number;
    resultsPushable: number;
    pending: number;
    failed: number;
    /** Records the platform refused and will keep refusing. */
    forbidden: number;
    lastSyncedAt: Date | null;
  };

  pull: {
    patientsImported: number;
    resultsImported: number;
  };
}

export async function readIntegrationStatus(): Promise<FhirIntegrationStatus> {
  const configured = isFhirConfigured();

  const [
    patientsTotal,
    patientsLinked,
    patientsImported,
    resultsPushed,
    resultsPushable,
    resultsImported,
    failedPatients,
    failedResults,
    forbiddenPatients,
    forbiddenResults,
    pending,
    lastSynced,
  ] = await Promise.all([
    prisma.patient.count({
      where: { fhirOwnership: { not: FhirOwnership.EXTERNAL_SEED } },
    }),
    prisma.patient.count({ where: { fhirOwnership: FhirOwnership.OWNED } }),
    prisma.patient.count({
      where: { fhirOwnership: FhirOwnership.EXTERNAL_SEED },
    }),
    prisma.labResult.count({
      where: { source: { not: LabSource.FHIR }, fhirObservationId: { not: null } },
    }),
    prisma.labResult.count({ where: { source: { not: LabSource.FHIR } } }),
    prisma.labResult.count({ where: { source: LabSource.FHIR } }),
    prisma.patient.count({ where: { fhirSyncStatus: FhirSyncStatus.FAILED } }),
    prisma.labResult.count({ where: { fhirSyncStatus: FhirSyncStatus.FAILED } }),
    prisma.patient.count({ where: { fhirSyncStatus: FhirSyncStatus.FORBIDDEN } }),
    prisma.labResult.count({
      where: { fhirSyncStatus: FhirSyncStatus.FORBIDDEN },
    }),
    countPending(),
    prisma.patient.findFirst({
      where: { fhirLastSyncedAt: { not: null } },
      orderBy: { fhirLastSyncedAt: "desc" },
      select: { fhirLastSyncedAt: true },
    }),
  ]);

  return {
    configured,
    missing: missingFhirConfig(),
    baseUrl: process.env.FHIR_BASE_URL?.trim() ?? null,
    candidateId: process.env.FHIR_CANDIDATE_ID?.trim() ?? null,
    push: {
      patientsLinked,
      patientsTotal,
      resultsPushed,
      resultsPushable,
      pending,
      failed: failedPatients + failedResults,
      forbidden: forbiddenPatients + forbiddenResults,
      lastSyncedAt: lastSynced?.fhirLastSyncedAt ?? null,
    },
    pull: {
      patientsImported,
      resultsImported,
    },
  };
}

/**
 * The records the platform rejected, for the integration page's problem list.
 *
 * A failed sync that is only a number is not actionable. This names the
 * patient and the reason the server gave, which is usually enough to tell a
 * configuration problem from a data one.
 */
export async function readSyncFailures(limit = 10) {
  const [patients, results] = await Promise.all([
    prisma.patient.findMany({
      where: {
        fhirSyncStatus: { in: [FhirSyncStatus.FAILED, FhirSyncStatus.FORBIDDEN] },
      },
      select: {
        id: true,
        mrn: true,
        fullName: true,
        fhirSyncStatus: true,
        fhirLastError: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.labResult.findMany({
      where: {
        fhirSyncStatus: { in: [FhirSyncStatus.FAILED, FhirSyncStatus.FORBIDDEN] },
      },
      select: {
        id: true,
        testName: true,
        collectedDate: true,
        fhirSyncStatus: true,
        fhirLastError: true,
        patient: { select: { id: true, mrn: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return { patients, results };
}
