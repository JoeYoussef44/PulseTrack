import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { ASSESSMENT_TTL_DAYS } from "./definition";

/**
 * Assessment links are capability URLs. Patients have no account, so holding
 * the link IS the authorisation — which makes three properties mandatory:
 *
 *   unguessable  — 32 bytes of CSPRNG output, never derived from patient data
 *   short-lived  — stops working 7 days after it is sent
 *   single-use   — enforced in the database by a conditional status update
 *
 * We persist only SHA-256(token). The raw token exists in memory for the
 * duration of one request and in the patient's inbox, so a database dump does
 * not yield working links to outstanding questionnaires.
 */

const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Goes in the emailed URL. Never persisted, never logged. */
  rawToken: string;
  /** The only copy we store. */
  tokenHash: string;
  expiresAt: Date;
}

export function issueToken(now: Date = new Date()): IssuedToken {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");

  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: addDays(now, ASSESSMENT_TTL_DAYS),
  };
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two token hashes. Lookups are by unique index so
 * this is belt-and-braces, but comparing secrets with === is a habit worth not
 * having.
 */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Builds the public URL the patient receives. The token is a path segment, and
 * nothing else about the patient appears in the URL — no id, no MRN, no email.
 */
export function assessmentUrl(rawToken: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/assessment/${rawToken}`;
}
