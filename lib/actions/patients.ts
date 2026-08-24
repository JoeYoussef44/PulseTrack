"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { syncPatientAfterWrite } from "@/lib/fhir/sync-hooks";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseIsoDate, patientSchema } from "@/lib/validation/patient";

export interface PatientFormState {
  /** Field-level messages, keyed by input name. */
  errors?: Record<string, string>;
  /** Anything that is not attributable to one field. */
  message?: string;
  /**
   * What the clinician actually typed, echoed back on failure.
   *
   * React resets an uncontrolled form once its action resolves, so without
   * this a rejected submission clears all six fields and the clinician retypes
   * everything to fix one of them. The reset lands on `defaultValue`, so
   * feeding these back through it is what preserves the input.
   */
  values?: Record<string, string>;
}

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * The column names a P2002 refers to, across the two shapes Prisma 7 emits.
 *
 * With the classic query engine the list is `meta.target`. With a **driver
 * adapter** — which Prisma 7 makes mandatory, and we use `@prisma/adapter-pg` —
 * `meta.target` is `undefined` and the list moves to
 * `meta.driverAdapterError.cause.constraint.fields`.
 *
 * Reading only `target` finds nothing, silently, so the caller falls through
 * and rethrows: a duplicate MRN then crashed the whole page instead of marking
 * one field. Verified against the live database — the real payload is
 * `{"modelName":"Patient","driverAdapterError":{"cause":{"originalCode":"23505",
 * "constraint":{"fields":["mrn"]}}}}`.
 *
 * Both shapes are read, so this keeps working if the adapter changes again.
 */
function uniqueViolationFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta as Record<string, unknown> | undefined;
  if (!meta) return [];

  const target = meta.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];

  const fields = (
    meta.driverAdapterError as
      | { cause?: { constraint?: { fields?: unknown } } }
      | undefined
  )?.cause?.constraint?.fields;

  if (Array.isArray(fields)) return fields.map(String);
  if (typeof fields === "string") return [fields];

  return [];
}

/**
 * Turns a unique-constraint violation into something a clinician can act on.
 *
 * The unique index is the real guarantee — an application-level "does this MRN
 * exist?" check would still lose a race between two simultaneous submissions —
 * so this translates the database's answer rather than trying to pre-empt it.
 */
function uniqueViolationState(error: unknown): PatientFormState | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code !== UNIQUE_VIOLATION) return null;

  const fields = uniqueViolationFields(error);

  if (fields.some((f) => f.toLowerCase().includes("mrn"))) {
    return { errors: { mrn: "A patient with this MRN already exists." } };
  }

  // A duplicate we could not attribute to a field is still a duplicate. Saying
  // so is worse than a precise message and far better than a crash — and the
  // other unique column, fhirPatientId, is not something a clinician typed.
  return {
    message: "That patient conflicts with one already on file.",
  };
}

/** The raw submission, as strings, for echoing back on a failed attempt. */
function rawValues(formData: FormData): Record<string, string> {
  const keys = ["fullName", "mrn", "dateOfBirth", "sex", "email", "phone"];
  const out: Record<string, string> = {};

  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") out[key] = value;
  }

  return out;
}

function readForm(formData: FormData) {
  return {
    fullName: formData.get("fullName"),
    mrn: formData.get("mrn"),
    dateOfBirth: formData.get("dateOfBirth"),
    sex: formData.get("sex"),
    email: formData.get("email"),
    phone: formData.get("phone"),
  };
}

export async function createPatient(
  _prevState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  // Layer three: re-authorise inside the mutation itself. The proxy and the
  // page check are conveniences; this is what holds when someone posts here
  // directly.
  await requireClinician();

  const parsed = patientSchema.safeParse(readForm(formData));
  const submitted = rawValues(formData);

  if (!parsed.success) {
    return { errors: flattenZodErrors(parsed.error), values: submitted };
  }

  const data = parsed.data;
  let patientId: string;

  try {
    const created = await prisma.patient.create({
      data: {
        fullName: data.fullName,
        mrn: data.mrn,
        dateOfBirth: parseIsoDate(data.dateOfBirth),
        sex: data.sex,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
      select: { id: true },
    });
    patientId = created.id;
  } catch (error) {
    const state = uniqueViolationState(error);
    if (state) return { ...state, values: submitted };
    throw error;
  }

  // Tier 2, requirement 1. After the local commit, never before it: a platform
  // outage must not stop a clinician entering a patient, and this call cannot
  // throw back into the action.
  await syncPatientAfterWrite(patientId);

  revalidatePath("/patients");
  revalidatePath("/dashboard");
  redirect(`/patients/${patientId}`);
}

export async function updatePatient(
  patientId: string,
  _prevState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  await requireClinician();

  const parsed = patientSchema.safeParse(readForm(formData));
  const submitted = rawValues(formData);

  if (!parsed.success) {
    return { errors: flattenZodErrors(parsed.error), values: submitted };
  }

  const data = parsed.data;

  try {
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        fullName: data.fullName,
        mrn: data.mrn,
        dateOfBirth: parseIsoDate(data.dateOfBirth),
        sex: data.sex,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
    });
  } catch (error) {
    const state = uniqueViolationState(error);
    if (state) return { ...state, values: submitted };

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { message: "That patient no longer exists." };
    }

    throw error;
  }

  // An edit re-pushes, which is a PUT to the resource we already own rather
  // than a second create. Idempotent either way.
  await syncPatientAfterWrite(patientId);

  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

export async function deletePatient(patientId: string): Promise<void> {
  await requireClinician();

  // Assessments, answers and lab results cascade — they have no meaning
  // without the patient. The FHIR resource cannot be removed: the server
  // disables DELETE, so a deleted patient leaves an orphaned remote record.
  // That is documented rather than hidden.
  await prisma.patient.delete({ where: { id: patientId } });

  revalidatePath("/patients");
  revalidatePath("/dashboard");
  redirect("/patients");
}

function flattenZodErrors(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    // Keep the first message per field: showing three complaints about one
    // input is noise, not help.
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}
