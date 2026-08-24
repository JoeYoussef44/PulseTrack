import type { Meta } from "./types";

/**
 * The coding systems and identity helpers the integration is built on.
 *
 * Pure and free of environment access, deliberately: `config.ts` is
 * `server-only` because it reads the API key, and anything importing it
 * inherits that restriction. Keeping these constants and the two identity
 * predicates here is what lets the mappers stay unit-testable without a
 * server condition — and the mappers are the part most worth testing.
 */

/** The identifier system the shared server uses for medical record numbers. */
export const MRN_SYSTEM = "https://challenge.capadev.dev/mrn";

/** The ownership tag system. The server stamps our candidate id here. */
export const TAG_SYSTEM = "https://challenge.capadev.dev/tags";

/**
 * Our own identifier system for pushed lab results.
 *
 * Observations carry the local `LabResult` cuid here, which is what makes the
 * push idempotent: a cuid is unique by construction, so unlike an MRN it can
 * never collide with another candidate's data.
 */
export const LAB_RESULT_SYSTEM = "https://challenge.capadev.dev/lab-result";

export const LOINC_SYSTEM = "http://loinc.org";
export const UCUM_SYSTEM = "http://unitsofmeasure.org";

/** The five patients the API guide says are seeded for us to import. */
export const SEED_MRNS = [
  "MRN-2001",
  "MRN-2002",
  "MRN-2003",
  "MRN-2004",
  "MRN-2005",
] as const;

/**
 * Pulls the resource id out of a Location header.
 *
 * The header looks like `http://hapi:8080/fhir/Patient/816/_history/1`, which
 * carries two traps. The host is the server's *internal* container name — the
 * same root cause as the pagination links (pagination.ts) — so the URL must
 * never be fetched, only parsed. And the id is the segment before `_history`,
 * not the last segment; reading the last one stores the version number as the
 * resource id and every later write goes to a resource that does not exist.
 */
export function idFromLocation(location: string | null): string | null {
  if (!location) return null;

  const withoutHistory = location.split("/_history")[0];
  const segments = withoutHistory.split("/").filter(Boolean);
  const id = segments[segments.length - 1];

  // A bare origin ("http://hapi:8080") leaves a segment containing a colon,
  // which is a host and port rather than an id.
  return id && !id.includes(":") ? id : null;
}

/**
 * True when a resource carries our candidate's ownership tag.
 *
 * The check that has to be right: reads on this server are open but writes are
 * not, so a resource we can *see* is not necessarily one we may *change*. This
 * is asked of the server's own response rather than inferred from our request
 * having succeeded.
 */
export function isOwnedByUs(
  meta: Meta | undefined,
  candidateId: string,
): boolean {
  return Boolean(
    meta?.tag?.some((t) => t.system === TAG_SYSTEM && t.code === candidateId),
  );
}
