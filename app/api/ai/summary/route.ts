import { NextResponse } from "next/server";

import { requireClinicianApi } from "@/lib/auth/session";
import { generateTrajectorySummary } from "@/lib/ai/summary";

/**
 * Generates a trajectory summary for one patient.
 *
 * A route handler rather than a server action because the summary is requested
 * on demand from a button and the panel needs the three non-error outcomes —
 * grounded, ungrounded, insufficient data — as data it can render differently,
 * not as a thrown error.
 *
 * **It authorises itself** (D-API-1). The edge proxy exempts `/api/*` from the
 * redirect to `/login`, precisely so that an expired session gets a 401 here
 * instead of a 200 carrying the login page's HTML — which a `fetch` would
 * happily parse as a failed summary rather than as a signed-out session.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const clinician = await requireClinicianApi();
  if (!clinician) {
    return NextResponse.json(
      { error: "Sign in to generate a summary." },
      { status: 401 },
    );
  }

  let patientId: unknown;
  try {
    ({ patientId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof patientId !== "string" || patientId.length === 0) {
    return NextResponse.json({ error: "A patient id is required." }, { status: 400 });
  }

  const result = await generateTrajectorySummary(patientId);

  // Every outcome is a 200 with a discriminated body except the two that are
  // genuinely about this request being unanswerable. The panel renders
  // "ungrounded" and "insufficient data" as designed states, not as failures.
  if (result.status === "not-configured") {
    return NextResponse.json(result, { status: 503 });
  }

  if (result.status === "error") {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
