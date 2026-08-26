import type { PatientFacts } from "./facts";

/**
 * The check that makes the grounding claim testable.
 *
 * `facts.ts` computes every number the model is allowed to use, and the prompt
 * tells it to use no others. This module is what *enforces* that, after the
 * fact, on the text that came back: it pulls every number out of the prose and
 * asserts each one exists in the fact payload. A summary containing a figure
 * that is not in its own source is rejected and never shown.
 *
 * Why it is worth the ~120 lines: "we asked it nicely in the system prompt" is
 * the standard answer to hallucination in a clinical context, and it is not an
 * answer at all — it is unfalsifiable and it fails silently. Reducing the model
 * to a narrator of precomputed facts is what makes a mechanical check possible,
 * and the check is what turns the design into a guarantee with a failure mode
 * you can watch working.
 *
 * ## What this does not claim
 *
 * It catches **fabricated and mistyped numbers**, which is the failure mode that
 * matters here because every clinical statement in this summary is numeric. It
 * does not catch a fluent, entirely non-numeric wrong claim ("the patient is
 * managing well" over a deteriorating trend). Nothing mechanical would; that is
 * why the computed facts are rendered beside the prose, so a clinician reads the
 * summary against its source rather than instead of it.
 */

export interface VerificationResult {
  grounded: boolean;
  /** Numbers found in the prose that are not in the fact payload. */
  unsupported: number[];
  /** Every number the prose used, for the log line and the tests. */
  found: number[];
}

/**
 * Instrument and analyte names that contain digits.
 *
 * "HbA1c" and "DSMA-8" are not measurements, but a naive number scan reads a
 * `1` and an `8` out of them and reports the model invented two figures. They
 * are removed before anything is extracted.
 */
const NAMES_WITH_DIGITS = /\b(?:HbA1c|A1c|DSMA-?8|COVID-?19)\b/gi;

const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * Date expressions, removed before the numbers are counted.
 *
 * A date is not a clinical figure, and every rendering of one — `2026-03-14`,
 * `14 March 2026`, `March 2026` — is a fresh source of false positives. The
 * alternative, admitting every year, month and day number into the allowed set,
 * would let a fabricated score of `14` pass because some reading happened on
 * the 14th. Removing dates keeps the allowed set tight, which is the whole
 * point of the check.
 */
const DATE_EXPRESSIONS = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}\s+(?:${MONTH})\s+\d{4}\b`,
    String.raw`\b(?:${MONTH})\s+\d{1,2},?\s+\d{4}\b`,
    String.raw`\b(?:${MONTH})\s+\d{4}\b`,
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
  ].join("|"),
  "gi",
);

/**
 * A number, but only one standing on its own.
 *
 * The lookbehind is what stops `A1c` contributing a `1` if it survived the name
 * pass, and the lookahead stops a value being read out of an identifier.
 *
 * The lookahead excludes word characters only, **not** a full stop: a sentence
 * ending "…rose to 7.1." is the single most common shape in this output, and
 * excluding a trailing `.` there made the pattern fail to match the number at
 * all — so a fabricated figure at the end of a sentence would have sailed
 * through the check unread.
 */
const NUMBER = /(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?!\w)/g;

function toNumber(raw: string): number | null {
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every number in the fact payload, walked recursively.
 *
 * Recursive rather than a hand-written list of fields, because a hand-written
 * list is one added fact away from rejecting a correct summary — and the
 * failure would look like the model misbehaving rather than like a stale
 * allow-list.
 */
export function allowedNumbers(facts: PatientFacts): Set<number> {
  const allowed = new Set<number>();

  const walk = (value: unknown): void => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      allowed.add(value);
      // A change of -0.4 is narrated as "fell by 0.4". The sign is carried by
      // the sentence, so both forms have to be acceptable.
      allowed.add(Math.abs(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };

  walk(facts);

  return allowed;
}

/**
 * Whether a prose number is supported by the payload.
 *
 * Exact equality first, then the same comparison against each allowed value
 * rounded to two, one and zero decimal places. Rounding is a legitimate thing
 * for a narrator to do — "rose by 0.3" for a stored 0.33 is honest prose, and
 * failing it would train us to ignore the check.
 */
function isSupported(value: number, allowed: Set<number>): boolean {
  if (allowed.has(value)) return true;

  for (const candidate of allowed) {
    for (const dp of [2, 1, 0]) {
      const factor = 10 ** dp;
      if (Math.round(candidate * factor) / factor === value) return true;
    }
  }

  return false;
}

/**
 * Checks a summary against the facts it was generated from.
 *
 * Returns rather than throws: the caller's fallback is to show the computed
 * facts without the prose, which is a degraded but still useful panel, not an
 * error.
 */
export function verifySummary(
  summary: string,
  facts: PatientFacts,
): VerificationResult {
  const scrubbed = summary
    .replace(NAMES_WITH_DIGITS, " ")
    .replace(DATE_EXPRESSIONS, " ");

  const allowed = allowedNumbers(facts);

  const found: number[] = [];
  const unsupported: number[] = [];

  for (const match of scrubbed.matchAll(NUMBER)) {
    const value = toNumber(match[0]);
    if (value === null) continue;

    found.push(value);
    if (!isSupported(value, allowed)) unsupported.push(value);
  }

  return { grounded: unsupported.length === 0, unsupported, found };
}
