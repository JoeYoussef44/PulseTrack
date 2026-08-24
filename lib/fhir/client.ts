import "server-only";

import { readFhirConfig, type FhirConfig } from "./config";
import {
  classifyStatus,
  FhirError,
  readDiagnostics,
  retryDelayMs,
} from "./errors";
import { rebaseBundleLink } from "./pagination";
import { idFromLocation, TAG_SYSTEM } from "./systems";
import { sleep, Throttle } from "./throttle";
import type { Bundle, FhirResource } from "./types";

/**
 * The only module in the app that talks to the FHIR server, and the only one
 * that holds the API key. `server-only` makes an import from a client
 * component a build error rather than a leaked credential.
 *
 * Everything above it — mappers, push, pull — is either pure or works through
 * this interface, which is what keeps the key in one place and the retry
 * policy in one place.
 */

/** Shared across requests in a process so the rate limit is respected overall. */
const throttle = new Throttle();

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export interface FhirRequest {
  /** Path relative to the FHIR base, e.g. `/Patient`, or an absolute URL. */
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  /** Conditional-create search query, sent as `If-None-Exist`. */
  ifNoneExist?: string;
}

export interface FhirResponse<T> {
  status: number;
  body: T | null;
  /** Resource id parsed from Location/Content-Location, when present. */
  locationId: string | null;
}

export function requireConfig(): FhirConfig {
  const config = readFhirConfig();
  if (!config) {
    throw new FhirError(
      "config",
      "The national platform integration is not configured. Set FHIR_BASE_URL, FHIR_CANDIDATE_ID and FHIR_API_KEY.",
    );
  }
  return config;
}

/**
 * One request, with the retry policy applied.
 *
 * Retries only what `errors.ts` classifies as transient, at most MAX_ATTEMPTS
 * times. Everything else throws on the first response, because a 403 or a
 * malformed resource fails identically no matter how often it is sent.
 */
export async function fhirRequest<T>({
  path,
  method = "GET",
  body,
  ifNoneExist,
}: FhirRequest): Promise<FhirResponse<T>> {
  const config = requireConfig();
  const url = path.startsWith("http")
    ? rebaseBundleLink(path, config.baseUrl)
    : `${config.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  let lastError: FhirError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    await throttle.acquire();
    try {
      response = await fetch(url, {
        method,
        headers: buildHeaders(config, { body, ifNoneExist }),
        body: body === undefined ? undefined : JSON.stringify(body),
        // A hung connection must not hold a serverless function until the
        // platform kills it — that turns one slow record into a failed import.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      // Includes the abort. The request may in fact have been *received*, which
      // is precisely why every write in this app is a conditional create: a
      // retry after an ambiguous failure matches what the lost response created
      // instead of duplicating it.
      lastError = new FhirError(
        "network",
        error instanceof Error && error.name === "TimeoutError"
          ? "The national platform did not respond in time."
          : "Could not reach the national platform.",
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      throttle.release();
    }

    const parsed = await readBody(response);

    if (response.ok) {
      return {
        status: response.status,
        body: parsed as T,
        locationId: idFromLocation(
          response.headers.get("location") ??
            response.headers.get("content-location"),
        ),
      };
    }

    const { kind, message } = classifyStatus(response.status);
    lastError = new FhirError(kind, message, {
      status: response.status,
      diagnostics: readDiagnostics(parsed),
    });

    if (!lastError.retryable || attempt === MAX_ATTEMPTS) throw lastError;

    await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
  }

  throw (
    lastError ??
    new FhirError("unexpected", "The request could not be completed.")
  );
}

function buildHeaders(
  config: FhirConfig,
  options: { body?: unknown; ifNoneExist?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    // Re-sent on every request including followed pagination links: a plain
    // fetch of a `next` URL without this returns 401 and truncates the import.
    "X-API-Key": config.apiKey,
    Accept: "application/fhir+json",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/fhir+json";
  }

  if (options.ifNoneExist) {
    headers["If-None-Exist"] = options.ifNoneExist;
  }

  return headers;
}

/**
 * Parses a response body, tolerating an empty one.
 *
 * A conditional create that matches is documented as possibly returning `200`
 * with no body at all. This server does return one, but the caller recovers the
 * id from `Location` either way, so an empty body must not throw.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ operations -- */

export interface ConditionalCreateResult<T> {
  id: string;
  /** False when the conditional search matched an existing resource. */
  created: boolean;
  resource: T | null;
}

/**
 * `POST` with `If-None-Exist` — the idempotent create.
 *
 * The search query MUST be scoped by our ownership tag, and this function
 * appends that scope itself so no caller can forget it.
 *
 * Verified on the live server, 2026-08-24: five other candidates have already
 * created `MRN-1001`, the MRN printed in the supplied CSV template. An
 * unscoped `identifier=…|MRN-1001` therefore matches five foreign resources
 * and the server answers `412`; had it matched exactly one, we would have
 * stored someone else's id and every later write to it would earn a permanent
 * 403. With `&_tag=…|cand-…` appended the same call returned `201`, and a
 * second identical call returned `200` with the same id — which is the whole
 * idempotency guarantee, measured rather than assumed.
 */
export async function conditionalCreate<T extends FhirResource>(
  resourceType: "Patient" | "Observation",
  resource: T,
  searchQuery: string,
): Promise<ConditionalCreateResult<T>> {
  const config = requireConfig();
  const scoped = `${searchQuery}&_tag=${TAG_SYSTEM}|${config.candidateId}`;

  const response = await fhirRequest<T>({
    path: `/${resourceType}`,
    method: "POST",
    body: resource,
    ifNoneExist: scoped,
  });

  const id =
    (response.body as { id?: string } | null)?.id ?? response.locationId;

  if (!id) {
    throw new FhirError(
      "unexpected",
      "The national platform accepted the record but did not say where it stored it.",
      { status: response.status },
    );
  }

  return { id, created: response.status === 201, resource: response.body };
}

/**
 * `PUT /{type}/{id}` — update a resource we own.
 *
 * Only ever called with an id the server itself gave us, for a resource
 * carrying our tag. Never a conditional PUT and never a PUT to an id that does
 * not exist: the server disables both, and issuing one is a programming error
 * that surfaces as a 405.
 */
export async function updateResource<T extends FhirResource>(
  resourceType: "Patient" | "Observation",
  id: string,
  resource: T,
): Promise<T | null> {
  const response = await fhirRequest<T>({
    path: `/${resourceType}/${id}`,
    method: "PUT",
    body: { ...resource, id },
  });

  return response.body;
}

export async function searchBundle<T>(
  resourceType: "Patient" | "Observation",
  params: Record<string, string | number>,
): Promise<Bundle<T>> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );

  const response = await fhirRequest<Bundle<T>>({
    path: `/${resourceType}?${query.toString()}`,
  });

  return response.body ?? { resourceType: "Bundle" };
}

/** Fetches an already-built (and rebased) page URL. */
export async function fetchBundlePage<T>(url: string): Promise<Bundle<T>> {
  const response = await fhirRequest<Bundle<T>>({ path: url });
  return response.body ?? { resourceType: "Bundle" };
}
