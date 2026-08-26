/**
 * What counts as "this reached the patient".
 *
 * Pure, and in its own file rather than inside `email-service.ts`, because that
 * module carries `server-only` and this predicate decides what goes into a
 * clinical record — so it has to be exercisable at a boundary.
 *
 * The distinction it draws is the whole point. `EmailResult.delivered` answers
 * "did the send path succeed", which the console adapter answers `true` to
 * without contacting anybody — deliberately, so the assessment flow works in a
 * fresh clone with no mail configuration. That is the right answer to its own
 * question and the wrong one to write into `Assessment.emailDeliveredAt`, which
 * a clinician reads as "the patient has this in their inbox".
 */

/** The name reported by the development adapter, which contacts nobody. */
export const CONSOLE_PROVIDER = "console";

/** The shape this module needs from an `EmailResult`. */
export interface DeliveryOutcome {
  delivered: boolean;
  provider: string;
}

/**
 * True only when a real provider accepted the message for delivery.
 *
 * Note what this is not: a delivery receipt. A provider accepting a message is
 * not the same as an inbox receiving it, and nothing here claims otherwise —
 * the UI wording says "emailed", not "read".
 */
export function wasEmailed(result: DeliveryOutcome): boolean {
  return result.delivered && result.provider !== CONSOLE_PROVIDER;
}
