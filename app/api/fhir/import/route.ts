import { NextResponse } from "next/server";

import { requireClinicianApi } from "@/lib/auth/session";
import { isFhirConfigured } from "@/lib/fhir/config";
import { FhirError } from "@/lib/fhir/errors";
import { importSeedPatient } from "@/lib/fhir/pull";
import { SEED_MRNS } from "@/lib/fhir/systems";

/**
 * Imports one seeded patient's history from the national platform.
 *
 * **One MRN per request.** Five patients at 36 observations each is roughly 15
 * requests to the platform plus a few hundred database writes; doing all five
 * in one invocation is the single most likely thing in this app to meet
 * Vercel's 60-second function ceiling, and the failure mode there is a half
 * -finished import with no report. Per-patient, the client loops, one patient
 * failing does not take the others with it, and progress is real rather than a
 * spinner.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const clinician = await requireClinicianApi();
  if (!clinician) {
    return NextResponse.json(
      { error: "Sign in to import from the national platform." },
      { status: 401 },
    );
  }

  if (!isFhirConfigured()) {
    return NextResponse.json(
      {
        error:
          "The national platform integration is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  let mrn: unknown;
  try {
    ({ mrn } = await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // An allow-list rather than a validated string. This endpoint exists to
  // import the platform's documented seed cohort; letting it fetch an
  // arbitrary MRN would turn an authenticated clinician session into a lookup
  // tool for every record on a server shared with other organisations.
  if (typeof mrn !== "string" || !SEED_MRNS.includes(mrn as never)) {
    return NextResponse.json(
      { error: "That is not one of the platform's seeded patients." },
      { status: 400 },
    );
  }

  try {
    const report = await importSeedPatient(mrn);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof FhirError) {
      console.warn(`[fhir] import failed kind=${error.kind}`);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    console.error(
      "[fhir] import failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    return NextResponse.json(
      {
        error:
          "The import failed partway through. Anything already imported was kept — running it again is safe.",
      },
      { status: 500 },
    );
  }
}
