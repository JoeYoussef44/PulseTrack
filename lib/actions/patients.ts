"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireClinician } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseIsoDate, patientSchema } from "@/lib/validation/patient";

export interface PatientFormState {
  /** Field-level messages, keyed by input name. */
  errors?: Record<string, string>;
  /** Anything that is not attributable to one field. */
  message?: string;
}

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

function fieldErrors(error: unknown): Record<string, string> | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_VIOLATION) {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target : [String(target ?? "")];

      if (fields.some((f) => String(f).includes("mrn"))) {
        return { mrn: "A patient with this MRN already exists." };
      }
    }
  }
  return null;
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

  if (!parsed.success) {
    return { errors: flattenZodErrors(parsed.error) };
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
    // The unique index is the real guarantee — an application-level "does this
    // MRN exist" check would still lose a race between two submissions.
    const errors = fieldErrors(error);
    if (errors) return { errors };
    throw error;
  }

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

  if (!parsed.success) {
    return { errors: flattenZodErrors(parsed.error) };
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
    const errors = fieldErrors(error);
    if (errors) return { errors };

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { message: "That patient no longer exists." };
    }

    throw error;
  }

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
