import { DSMA8 } from "./definition";

/**
 * Risk-band presentation, kept out of `service.ts` so a client component can
 * use it.
 *
 * `service.ts` carries `server-only` because it holds Prisma queries, which is
 * correct — but it also held `bandTone`, a pure four-case mapping that the
 * Tier 3 summary panel needs on the client. The alternative was to retype the
 * four labels there, and retyping one definition in two files is exactly how
 * the FHIR loading skeleton drifted from its own page in #27.
 *
 * So it moves here, pure, and `service.ts` re-exports it: one definition, both
 * environments, no change at any existing call site.
 */

export type BandTone = "neutral" | "low" | "moderate" | "high" | "critical";

/** Maps a risk band to the UI tone used by the Badge component. */
export function bandTone(label: string | null | undefined): BandTone {
  switch (label) {
    case "Low risk":
      return "low";
    case "Moderate risk":
      return "moderate";
    case "High risk":
      return "high";
    case "Very high risk":
      return "critical";
    default:
      return "neutral";
  }
}

/** Band metadata for rendering a stored score. */
export function bandByLabel(label: string) {
  return DSMA8.scoring.bands.find((b) => b.label === label);
}
