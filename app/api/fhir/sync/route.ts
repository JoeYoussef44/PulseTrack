import { NextResponse } from "next/server";

import { requireClinicianApi } from "@/lib/auth/session";
import { isFhirConfigured } from "@/lib/fhir/config";
import { FhirError } from "@/lib/fhir/errors";
import { pushPendingBatch } from "@/lib/fhir/push";

/**
 * Pushes one batch of pending records to the national platform.
 *
 * A Route Handler rather than a Server Action, for the same reason the CSV
 * upload is one: this needs `maxDuration`, precise status codes, and a shape
 * the client can call in a loop.
 *
 * **One batch per call, by design.** Vercel's Hobby plan caps a function at 60
 * seconds and the platform allows 120 requests a minute, so "push everything"
 * is a shape that works on a laptop and times out on the deployed URL. The
 * client calls this until `more` is false, which also gives it real progress
 * to show rather than a spinner of unknown length.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** Sized so a batch finishes well inside the function budget and the limit. */
const BATCH_SIZE = 20;

export async function POST() {
  // Layer three. This endpoint accepts a POST from anywhere, so it re-checks
  // the session itself rather than trusting the edge proxy or the layout.
  const clinician = await requireClinicianApi();
  if (!clinician) {
    return NextResponse.json(
      { error: "Sign in to sync with the national platform." },
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

  try {
    const result = await pushPendingBatch(BATCH_SIZE);
    return NextResponse.json(result);
  } catch (error) {
    // A FhirError has already been sanitised for display. Anything else has
    // not, so it is logged and replaced — an unhandled message can carry
    // schema details or row data.
    if (error instanceof FhirError) {
      console.warn(`[fhir] sync batch failed kind=${error.kind}`);
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === "auth" ? 502 : 500 },
      );
    }

    console.error(
      "[fhir] sync batch failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    return NextResponse.json(
      { error: "The sync failed partway through. Nothing was lost — try again." },
      { status: 500 },
    );
  }
}
