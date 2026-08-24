import { isOperationOutcome, type OperationOutcome } from "./types";

/**
 * How a failed FHIR request is classified, and what a clinician is told.
 *
 * Kept pure and separate from the client so the policy can be unit-tested
 * without a network: "is a 429 retried?" and "does a 403 ever retry?" are
 * exactly the questions worth pinning down in a test, and they are decisions
 * rather than plumbing.
 *
 * The governing distinction is **transient vs terminal**. A 403 is not a
 * failure to retry — it is a permanent state of the world (we do not own that
 * resource), and retrying it burns rate limit to learn nothing.
 */

export type FhirErrorKind =
  | "config" // the integration is not set up
  | "auth" // 401 — bad or missing key
  | "forbidden" // 403 — not ours to write, or a disabled operation
  | "not_found" // 404
  | "conflict" // 412 — If-None-Exist matched more than one resource
  | "method" // 405 — we issued a disabled operation. A programming error.
  | "invalid" // 400/422 — our resource is malformed
  | "rate_limit" // 429
  | "server" // 5xx
  | "network" // timeout, DNS, connection reset
  | "unexpected"; // a 2xx we could not parse, or anything unclassified

export class FhirError extends Error {
  readonly kind: FhirErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  /** The server's own explanation, already sanitised. */
  readonly diagnostics?: string;

  constructor(
    kind: FhirErrorKind,
    message: string,
    options: { status?: number; diagnostics?: string } = {},
  ) {
    super(message);
    this.name = "FhirError";
    this.kind = kind;
    this.status = options.status;
    this.diagnostics = options.diagnostics;
    this.retryable = RETRYABLE.has(kind);
  }

  /**
   * What is safe to store in `fhirLastError` and show in the UI.
   *
   * Bounded, because it is written to a database column and rendered in a
   * table; and never the raw response body, which can echo back resource
   * content.
   */
  toRecord(): string {
    const parts = [this.message];
    if (this.diagnostics && this.diagnostics !== this.message) {
      parts.push(this.diagnostics);
    }
    return parts.join(" — ").slice(0, 500);
  }
}

const RETRYABLE = new Set<FhirErrorKind>(["rate_limit", "server", "network"]);

/** Maps an HTTP status onto a kind and a message a clinician can act on. */
export function classifyStatus(status: number): {
  kind: FhirErrorKind;
  message: string;
} {
  switch (status) {
    case 400:
    case 422:
      return {
        kind: "invalid",
        message: "The national platform rejected the record as invalid.",
      };
    case 401:
      return {
        kind: "auth",
        message:
          "The national platform rejected our credentials. Check FHIR_API_KEY.",
      };
    case 403:
      return {
        kind: "forbidden",
        message:
          "The national platform owns this record — it was created by someone else and cannot be changed from here.",
      };
    case 404:
      return {
        kind: "not_found",
        message: "That record no longer exists on the national platform.",
      };
    case 405:
      return {
        kind: "method",
        message: "The national platform does not allow that operation.",
      };
    case 412:
      return {
        kind: "conflict",
        message:
          "The national platform holds more than one matching record, so it could not tell which one to use.",
      };
    case 429:
      return {
        kind: "rate_limit",
        message: "The national platform is rate-limiting us.",
      };
    default:
      if (status >= 500) {
        return {
          kind: "server",
          message: "The national platform is unavailable.",
        };
      }
      return {
        kind: "unexpected",
        message: `The national platform returned an unexpected response (${status}).`,
      };
  }
}

/**
 * Pulls the first useful line out of an OperationOutcome.
 *
 * Errors before warnings, because HAPI often returns both and the warning is
 * usually about a profile we do not care about. Truncated, because
 * `diagnostics` can run to a full stack trace.
 */
export function readDiagnostics(body: unknown): string | undefined {
  if (!isOperationOutcome(body)) return undefined;

  const issues = (body as OperationOutcome).issue ?? [];
  const worst =
    issues.find((i) => i.severity === "fatal" || i.severity === "error") ??
    issues[0];

  const text = worst?.diagnostics?.trim();
  if (!text) return undefined;

  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * How long to wait before retry `attempt` (1-based).
 *
 * Honours `Retry-After` when the server sends one — it knows better than our
 * backoff curve — and otherwise doubles from 1s with jitter. The jitter
 * matters because a lab import retries many records at once: without it every
 * one of them retries at the same instant and re-triggers the rate limit.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterHeader?: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }

  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}
