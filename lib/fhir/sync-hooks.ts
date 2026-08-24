import "server-only";

import { isFhirConfigured } from "./config";
import { markPatientPending, markResultsPending, pushPatient } from "./push";

/**
 * The seam between the app's own writes and the national platform.
 *
 * Patient CRUD and the CSV importer call into here and nothing else. They do
 * not import the client, do not handle FHIR errors, and cannot be broken by
 * one: every function below either succeeds quietly or leaves a record queued.
 *
 * That containment is the point. Tier 1 has to keep working with no FHIR key
 * configured at all, and it has to keep working when the platform is down.
 */

/**
 * Waited on inline after a patient is saved.
 *
 * Short, and shorter than the client's own 15s request timeout, because this
 * sits between a clinician pressing Save and the page they get back. A sync
 * that has not landed inside this budget is not lost — the record is already
 * marked pending, so the queue picks it up — it simply stops being something
 * the clinician waits for.
 */
const INLINE_SYNC_BUDGET_MS = 6_000;

/**
 * Called after a patient is created or edited.
 *
 * Order matters: the record is marked pending *first*, so that if this process
 * dies mid-push the work is still queued. Then the push is attempted inline,
 * because "create a patient and it appears on the platform" is the behaviour
 * the brief asks for and a queue the clinician has to go and drain by hand is
 * not that.
 *
 * Never throws. A failure here must not turn a successful save into an error
 * page — the patient is already committed, and the sync state is recorded on
 * the row for the integration page to show.
 */
export async function syncPatientAfterWrite(patientId: string): Promise<void> {
  if (!isFhirConfigured()) return;

  try {
    await markPatientPending(patientId);

    await Promise.race([
      pushPatient(patientId),
      new Promise((resolve) => setTimeout(resolve, INLINE_SYNC_BUDGET_MS)),
    ]);
  } catch (error) {
    // Ids only. The message could carry resource content.
    console.warn(
      `[fhir] deferred patient sync local=${patientId}: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
  }
}

/**
 * Called after a CSV import commits.
 *
 * Queued rather than pushed inline, which is the opposite of the patient case
 * and for a concrete reason: an import is up to thousands of rows, one request
 * each, against a server that allows 120 a minute. Pushing them inside the
 * upload request would exceed a Vercel function's 60 seconds long before it
 * exceeded the rate limit, and the first thing to fail would be the import
 * report the clinician is waiting for.
 *
 * So the upload returns immediately with a count, and the push runs as a
 * bounded, resumable batch the UI drives and can show progress for.
 *
 * @returns how many results are now waiting to be pushed.
 */
export async function queueUploadForSync(labUploadId: string): Promise<number> {
  if (!isFhirConfigured()) return 0;

  try {
    return await markResultsPending(labUploadId);
  } catch (error) {
    console.warn(
      `[fhir] could not queue upload=${labUploadId}: ${
        error instanceof Error ? error.name : "unknown error"
      }`,
    );
    return 0;
  }
}
