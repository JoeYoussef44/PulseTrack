import { z } from "zod";

import { Sex } from "@/lib/generated/prisma/enums";

/**
 * Patient input validation.
 *
 * Two principles behind the choices here:
 *
 *  - Reject what is genuinely wrong (a birth date in the future, a malformed
 *    email), not what is merely unfamiliar. Over-strict validation is its own
 *    defect — a phone rule that rejects "+961 3 111 001" makes the app wrong
 *    for most of the world.
 *  - Normalise on the way in, so that "mrn-1001" and " MRN-1001 " cannot
 *    become two different patients despite the unique constraint.
 */

/** Nobody alive is older than this; anything beyond it is a typo. */
const MAX_AGE_YEARS = 130;

/** Empty optional fields arrive from HTML forms as "" rather than undefined. */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const patientSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(200, "Full name is too long."),

  mrn: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "MRN is required.")
    .max(64, "MRN is too long.")
    .regex(
      /^[A-Z0-9][A-Z0-9 _-]*$/,
      "MRN may only contain letters, numbers, spaces, hyphens and underscores.",
    ),

  dateOfBirth: z
    .string()
    .trim()
    .min(1, "Date of birth is required.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker or YYYY-MM-DD.")
    .refine(isRealCalendarDate, "That date does not exist.")
    .refine(isNotInFuture, "Date of birth cannot be in the future.")
    .refine(isPlausibleAge, `Date of birth must be within the last ${MAX_AGE_YEARS} years.`),

  sex: z.nativeEnum(Sex, { error: "Select a sex." }),

  email: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address.")
      .max(320)
      .optional(),
  ),

  phone: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(40, "Phone number is too long.")
      // Deliberately permissive: digits with common separators, so
      // international formats are accepted rather than rejected.
      .regex(
        /^[+]?[\d][\d\s().-]*$/,
        "Enter a phone number using digits, spaces, or + ( ) - characters.",
      )
      .optional(),
  ),
});

export type PatientInput = z.infer<typeof patientSchema>;

/* ------------------------------------------------------------------ dates -- */

/**
 * Guards against dates that match the pattern but do not exist — 2026-02-30,
 * 2026-13-01. Date parsing silently rolls these over, so the round-trip
 * comparison is what actually catches them.
 */
export function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isNotInFuture(value: string): boolean {
  return parseIsoDate(value).getTime() <= endOfTodayUtc().getTime();
}

function isPlausibleAge(value: string): boolean {
  const earliest = new Date();
  earliest.setUTCFullYear(earliest.getUTCFullYear() - MAX_AGE_YEARS);

  return parseIsoDate(value).getTime() >= earliest.getTime();
}

/**
 * Parses YYYY-MM-DD as a plain calendar date at UTC midnight.
 *
 * Using `new Date("2026-05-02")` directly is correct, but `new Date(2026, 4, 2)`
 * is not — it builds the date in local time, so west of UTC it stores the
 * previous day and every chart renders shifted. Every date in this codebase
 * goes through this function.
 */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Formats a stored date back to YYYY-MM-DD without a timezone shift. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}
