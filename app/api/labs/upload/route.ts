import { NextResponse } from "next/server";

import { requireClinicianApi } from "@/lib/auth/session";
import { importLabCsv } from "@/lib/labs/service";
import { MAX_FILE_BYTES } from "@/lib/labs/parse";

/**
 * CSV upload endpoint.
 *
 * A Route Handler rather than a Server Action, deliberately: this needs
 * multipart handling, a body-size limit, precise status codes, and an extended
 * `maxDuration`. Server Actions give none of those cleanly.
 *
 * The response is always JSON — a report on success, `{ error }` on failure —
 * so the client has exactly one shape to render.
 */

export const runtime = "nodejs";

/**
 * Vercel's Hobby plan caps a function at 60s. A 10 000-row file is two queries
 * and one bulk insert, so this is generous; it exists so that a pathological
 * file fails as a timeout we chose rather than one the platform imposed.
 */
export const maxDuration = 60;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  // Layer three. The dashboard layout already checked the session and the edge
  // proxy already checked the cookie, but this endpoint accepts a POST from
  // anywhere, so it re-checks. This is the boundary that actually holds.
  const clinician = await requireClinicianApi();
  if (!clinician) return fail(401, "Sign in to upload lab results.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "That upload was not a valid form submission.");
  }

  const file = form.get("file");

  if (!file || typeof file === "string") {
    return fail(400, "Choose a CSV file to upload.");
  }

  const filename = file.name || "upload.csv";

  if (!filename.toLowerCase().endsWith(".csv")) {
    return fail(
      415,
      "Only .csv files can be imported. If this came from Excel, use File → Save As → CSV.",
    );
  }

  if (file.size === 0) {
    return fail(400, "That file is empty.");
  }

  // Checked before reading, so an oversized file is never pulled into memory.
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      413,
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit. Split it into smaller files.`,
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail(400, "That file could not be read.");
  }

  try {
    const outcome = await importLabCsv({
      filename,
      text,
      clinicianId: clinician.id,
    });

    if (!outcome.ok) return fail(422, outcome.error);

    return NextResponse.json(outcome);
  } catch (error) {
    // The message is logged for the operator but never returned: it can carry
    // schema details, and on a constraint violation it can carry row data.
    console.error(
      "[labs] import failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return fail(
      500,
      "The import failed partway through. No partial file was left behind — try again, and if it keeps failing the file may be malformed.",
    );
  }
}
