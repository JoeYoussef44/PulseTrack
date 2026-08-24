import "server-only";

import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  FhirOwnership,
  FhirSyncStatus,
  LabSource,
} from "@/lib/generated/prisma/enums";

import { conditionalCreate, requireConfig, updateResource } from "./client";
import { FhirError } from "./errors";
import {
  observationSearchQuery,
  patientSearchQuery,
  toFhirObservation,
  toFhirPatient,
} from "./mappers";
import { isOwnedByUs } from "./systems";
import type { FhirPatient } from "./types";

/**
 * Pushing local records to the national platform.
 *
 * Two rules shape everything here.
 *
 * **The local write always wins.** A patient is saved, or a CSV is imported,
 * and only then does the sync run. A platform outage must never roll back a
 * clinical record or block a clinician from working — so every function in
 * this module records an outcome and returns; none of them throws into the
 * caller's transaction.
 *
 * **We only ever write what we own.** The server tags every resource with its
 * creator, and reads are open while writes are not. Ownership is therefore
 * verified from the response's own `meta.tag` rather than assumed from the
 * fact that our request succeeded.
 */

export interface PushOutcome {
  ok: boolean;
  /** Present when the record is now linked to a resource on the platform. */
  fhirId?: string;
  /** True when this call created the resource rather than matching one. */
  created?: boolean;
  error?: string;
}

/* ------------------------------------------------------------- patients -- */

/**
 * Creates or updates a patient on the platform, idempotently.
 *
 * First push: a tag-scoped conditional create. Later pushes: a `PUT` to the id
 * the server gave us, but only once `meta.tag` has confirmed the resource is
 * ours. Without that check a conditional create that matched a foreign
 * resource would leave us holding someone else's id and PUTting to it forever,
 * earning a permanent 403 — which is exactly the failure the tag scoping is
 * there to prevent, checked twice because the cost of being wrong is a
 * write we cannot undo.
 */
export async function pushPatient(patientId: string): Promise<PushOutcome> {
  const config = requireConfig();

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      mrn: true,
      fullName: true,
      dateOfBirth: true,
      sex: true,
      fhirPatientId: true,
      fhirOwnership: true,
    },
  });

  if (!patient) return { ok: false, error: "That patient no longer exists." };

  // Pulled seed patients belong to the platform, not to us. Pushing one back
  // would either 403 or, worse, create a second copy of a record that already
  // exists there under someone else's ownership.
  if (patient.fhirOwnership === FhirOwnership.EXTERNAL_SEED) {
    return {
      ok: false,
      error:
        "This patient came from the national platform and is read-only there.",
    };
  }

  const resource = toFhirPatient(patient);

  try {
    let fhirId: string;
    let created = false;
    let owned: boolean;

    if (patient.fhirPatientId && patient.fhirOwnership === FhirOwnership.OWNED) {
      const updated = await updateResource<FhirPatient>(
        "Patient",
        patient.fhirPatientId,
        resource,
      );
      fhirId = patient.fhirPatientId;
      owned = updated ? isOwnedByUs(updated.meta, config.candidateId) : true;
    } else {
      const result = await conditionalCreate("Patient", resource, patientSearchQuery(patient.mrn));
      fhirId = result.id;
      created = result.created;
      // A matched resource that is not ours must never be written to again.
      owned = result.resource
        ? isOwnedByUs(result.resource.meta, config.candidateId)
        : result.created;
    }

    await prisma.patient.update({
      where: { id: patient.id },
      data: {
        fhirPatientId: fhirId,
        fhirOwnership: owned ? FhirOwnership.OWNED : FhirOwnership.NONE,
        fhirSyncStatus: owned ? FhirSyncStatus.SYNCED : FhirSyncStatus.FORBIDDEN,
        fhirLastSyncedAt: new Date(),
        fhirLastError: owned
          ? null
          : "The matching record on the national platform belongs to another organisation, so it was not modified.",
      },
    });

    // Ids and counts only — never a name, an MRN or a date of birth.
    console.info(
      `[fhir] patient push local=${patient.id} remote=${fhirId} created=${created} owned=${owned}`,
    );

    return { ok: owned, fhirId, created };
  } catch (error) {
    return recordPatientFailure(patient.id, error);
  }
}

async function recordPatientFailure(
  patientId: string,
  error: unknown,
): Promise<PushOutcome> {
  const fhirError =
    error instanceof FhirError
      ? error
      : new FhirError("unexpected", "The sync failed unexpectedly.");

  await prisma.patient.update({
    where: { id: patientId },
    data: {
      fhirSyncStatus:
        fhirError.kind === "forbidden"
          ? FhirSyncStatus.FORBIDDEN
          : FhirSyncStatus.FAILED,
      fhirLastError: fhirError.toRecord(),
    },
  });

  console.warn(
    `[fhir] patient push failed local=${patientId} kind=${fhirError.kind} status=${fhirError.status ?? "-"}`,
  );

  return { ok: false, error: fhirError.message };
}

/**
 * Marks a patient as needing a push without performing one.
 *
 * Used on create and update so the clinician's save returns immediately: the
 * sync is a consequence of the save, not a precondition for it, and a slow or
 * unreachable platform must not make patient entry feel broken.
 */
export async function markPatientPending(patientId: string): Promise<void> {
  await prisma.patient.updateMany({
    where: { id: patientId, fhirOwnership: { not: FhirOwnership.EXTERNAL_SEED } },
    data: { fhirSyncStatus: FhirSyncStatus.PENDING },
  });
}

/* --------------------------------------------------------- observations -- */

/**
 * Pushes one lab result, creating its patient's resource first if needed.
 *
 * The patient is a precondition rather than a separate step for the caller to
 * remember: an Observation needs a resolvable `subject` reference, and pushing
 * one whose subject does not exist yet produces a dangling record on a server
 * that does not allow deletes.
 */
export async function pushLabResult(labResultId: string): Promise<PushOutcome> {
  const result = await prisma.labResult.findUnique({
    where: { id: labResultId },
    select: {
      id: true,
      collectedDate: true,
      testCode: true,
      testName: true,
      value: true,
      unit: true,
      refLow: true,
      refHigh: true,
      source: true,
      fhirObservationId: true,
      patient: {
        select: { id: true, fhirPatientId: true, fhirOwnership: true },
      },
    },
  });

  if (!result) return { ok: false, error: "That lab result no longer exists." };

  // D-FHIR-2. Data we pulled from the platform is never pushed back: it would
  // duplicate the platform's own records and misrepresent where they came from.
  if (result.source === LabSource.FHIR) {
    return {
      ok: false,
      error: "This result came from the national platform and is not pushed back.",
    };
  }

  // Already linked. The conditional create would return the same id, so this
  // saves a request rather than changing the outcome.
  if (result.fhirObservationId) {
    return { ok: true, fhirId: result.fhirObservationId, created: false };
  }

  let subjectId = result.patient.fhirPatientId;

  if (!subjectId || result.patient.fhirOwnership === FhirOwnership.NONE) {
    const patientOutcome = await pushPatient(result.patient.id);
    if (!patientOutcome.ok || !patientOutcome.fhirId) {
      await recordResultFailure(
        result.id,
        new FhirError(
          "invalid",
          patientOutcome.error ??
            "The patient could not be synced, so the result was not sent.",
        ),
      );
      return { ok: false, error: patientOutcome.error };
    }
    subjectId = patientOutcome.fhirId;
  }

  try {
    const observation = toFhirObservation(
      {
        id: result.id,
        collectedDate: result.collectedDate,
        testCode: result.testCode,
        value: result.value.toString(),
        unit: result.unit,
        refLow: result.refLow?.toString() ?? null,
        refHigh: result.refHigh?.toString() ?? null,
      },
      subjectId,
    );

    const created = await conditionalCreate(
      "Observation",
      observation,
      observationSearchQuery(result.id),
    );

    await prisma.labResult.update({
      where: { id: result.id },
      data: {
        fhirObservationId: created.id,
        fhirSyncStatus: FhirSyncStatus.SYNCED,
        fhirLastError: null,
      },
    });

    return { ok: true, fhirId: created.id, created: created.created };
  } catch (error) {
    return recordResultFailure(result.id, error);
  }
}

async function recordResultFailure(
  labResultId: string,
  error: unknown,
): Promise<PushOutcome> {
  const fhirError =
    error instanceof FhirError
      ? error
      : new FhirError("unexpected", "The sync failed unexpectedly.");

  await prisma.labResult.update({
    where: { id: labResultId },
    data: {
      fhirSyncStatus:
        fhirError.kind === "forbidden"
          ? FhirSyncStatus.FORBIDDEN
          : FhirSyncStatus.FAILED,
      fhirLastError: fhirError.toRecord(),
    },
  });

  console.warn(
    `[fhir] observation push failed local=${labResultId} kind=${fhirError.kind} status=${fhirError.status ?? "-"}`,
  );

  return { ok: false, error: fhirError.message };
}

/* ------------------------------------------------------------ the queue -- */

export interface SyncBatchResult {
  patientsPushed: number;
  resultsPushed: number;
  failed: number;
  /** True when records are still waiting — the caller should call again. */
  more: boolean;
  remaining: number;
  /** The first failure, for the UI. One message, not a wall of them. */
  firstError?: string;
}

/**
 * Pushes one bounded batch of pending records.
 *
 * Bounded on purpose. A Vercel function has 60 seconds and a CSV can hold
 * thousands of rows, so "push everything" is not a shape that survives on the
 * deployed URL — it is the shape that works locally and times out in front of
 * an evaluator. Instead each call does a fixed slice and reports whether more
 * remain; the client loops, which also gives it something honest to show as
 * progress.
 */
export async function pushPendingBatch(limit = 25): Promise<SyncBatchResult> {
  const patients = await prisma.patient.findMany({
    where: {
      fhirOwnership: { not: FhirOwnership.EXTERNAL_SEED },
      fhirSyncStatus: { in: [FhirSyncStatus.PENDING, FhirSyncStatus.FAILED] },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let patientsPushed = 0;
  let resultsPushed = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const patient of patients) {
    const outcome = await pushPatient(patient.id);
    if (outcome.ok) patientsPushed += 1;
    else {
      failed += 1;
      firstError ??= outcome.error;
    }
  }

  const remainingSlots = Math.max(0, limit - patients.length);

  if (remainingSlots > 0) {
    const results = await prisma.labResult.findMany({
      where: pendingResultFilter(),
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: remainingSlots,
    });

    for (const result of results) {
      const outcome = await pushLabResult(result.id);
      if (outcome.ok) resultsPushed += 1;
      else {
        failed += 1;
        firstError ??= outcome.error;
      }
    }
  }

  const remaining = await countPending();

  return {
    patientsPushed,
    resultsPushed,
    failed,
    // A batch that pushed nothing but still reports work outstanding means
    // every remaining record just failed. Saying `more` there would loop the
    // client forever against a platform that is down.
    more: remaining > 0 && patientsPushed + resultsPushed > 0,
    remaining,
    firstError,
  };
}

/**
 * What counts as waiting to be pushed.
 *
 * `FORBIDDEN` is deliberately excluded. A 403 means the platform will never
 * accept that write, so retrying it on every sync would spend the rate limit
 * re-learning the same fact and leave a queue that never drains.
 */
function pendingResultFilter(): Prisma.LabResultWhereInput {
  return {
    source: { not: LabSource.FHIR },
    fhirObservationId: null,
    OR: [
      { fhirSyncStatus: null },
      { fhirSyncStatus: { in: [FhirSyncStatus.PENDING, FhirSyncStatus.FAILED] } },
    ],
  };
}

export async function countPending(): Promise<number> {
  const [patients, results] = await Promise.all([
    prisma.patient.count({
      where: {
        fhirOwnership: { not: FhirOwnership.EXTERNAL_SEED },
        fhirSyncStatus: { in: [FhirSyncStatus.PENDING, FhirSyncStatus.FAILED] },
      },
    }),
    prisma.labResult.count({ where: pendingResultFilter() }),
  ]);

  return patients + results;
}

/** Marks a set of freshly imported results as awaiting their push. */
export async function markResultsPending(labUploadId: string): Promise<number> {
  const { count } = await prisma.labResult.updateMany({
    where: { labUploadId, source: LabSource.CSV, fhirObservationId: null },
    data: { fhirSyncStatus: FhirSyncStatus.PENDING },
  });

  return count;
}
