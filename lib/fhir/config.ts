import "server-only";

/**
 * FHIR server configuration.
 *
 * Three values, one of which is a secret. `FHIR_API_KEY` must never be
 * prefixed `NEXT_PUBLIC_`, never logged, and never returned in a response —
 * this module carries `server-only` so an accidental import from a client
 * component fails the build rather than shipping the key to a browser.
 *
 * The candidate id is deliberately *not* a secret: the API guide puts it in
 * search URLs, and the server stamps it on everything we create.
 *
 * The coding systems live in `systems.ts` rather than here, so that the pure
 * mappers can use them without inheriting this module's server restriction.
 */

export interface FhirConfig {
  baseUrl: string;
  candidateId: string;
  apiKey: string;
}

/**
 * Reads the configuration, or returns null when the integration is not set up.
 *
 * Null rather than a throw: a fresh clone with no FHIR key must still run the
 * whole of Tier 1. The integration page then says so plainly instead of the
 * app failing to boot.
 */
export function readFhirConfig(): FhirConfig | null {
  const baseUrl = process.env.FHIR_BASE_URL?.trim();
  const candidateId = process.env.FHIR_CANDIDATE_ID?.trim();
  const apiKey = process.env.FHIR_API_KEY?.trim();

  if (!baseUrl || !candidateId || !apiKey) return null;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), candidateId, apiKey };
}

/** True when every FHIR variable is present. Safe to expose — no secret. */
export function isFhirConfigured(): boolean {
  return readFhirConfig() !== null;
}

/**
 * Which of the three variables are missing, for the integration page.
 * Names only — never values.
 */
export function missingFhirConfig(): string[] {
  return (["FHIR_BASE_URL", "FHIR_CANDIDATE_ID", "FHIR_API_KEY"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );
}
