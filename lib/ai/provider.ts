import "server-only";

import { readAiConfig, type AiConfig } from "./config";
import type { PromptRequest } from "./prompt";

/**
 * The only module that talks to the model provider, and the only one that holds
 * the AI key — the same shape as `lib/fhir/client.ts`, for the same reasons.
 *
 * Everything above it is pure: the facts, the prompt and the verifier can all
 * be tested without a network or a key, which is where the interesting logic
 * lives. What is left here is one POST, a timeout, and a retry policy.
 */

export type AiErrorKind =
  | "config" // the feature is not set up on this deployment
  | "auth" // 401/403 — bad key
  | "rate_limit" // 429 — a free tier doing what free tiers do
  | "invalid" // 400 — our request is malformed
  | "server" // 5xx
  | "network" // timeout, DNS, connection reset
  | "empty" // a 2xx carrying no usable text
  | "truncated" // a 2xx carrying half a sentence — see readText
  | "unexpected";

const RETRYABLE = new Set<AiErrorKind>(["rate_limit", "server", "network"]);

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE.has(kind);
  }
}

/**
 * What a clinician is told when the provider fails.
 *
 * Never the provider's own body: it can echo the request back, and the request
 * contains the patient's fact payload. The same rule as `FhirError` — surface
 * the classification, not the response.
 */
export function messageFor(kind: AiErrorKind): string {
  switch (kind) {
    case "config":
      return "The summary feature is not configured on this deployment.";
    case "auth":
      return "The AI provider rejected our credentials.";
    case "rate_limit":
      return "The AI provider's free tier is rate-limited right now. Try again shortly.";
    case "invalid":
      return "The AI provider rejected the request.";
    case "server":
      return "The AI provider is having trouble. Try again shortly.";
    case "network":
      return "Could not reach the AI provider.";
    case "empty":
      return "The AI provider returned an empty response.";
    case "truncated":
      return "The AI provider cut the summary off partway. Try again, or set AI_MODEL to a model that does not spend its output budget on reasoning.";
    default:
      return "The summary could not be generated.";
  }
}

/**
 * 20 seconds, well inside the 60-second function ceiling.
 *
 * A clinician is watching a spinner, so the useful timeout is far shorter than
 * the platform's: a summary that takes longer than this has already failed as
 * a piece of interaction design, whatever the provider eventually returns.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Two attempts, not three.
 *
 * The FHIR client retries three times because an import is a background
 * operation nobody is watching. This one is in front of a person, and a second
 * 20-second wait is already at the edge of what a button click can justify.
 */
const MAX_ATTEMPTS = 2;

const RETRY_DELAY_MS = 1_200;

function requireConfig(): AiConfig {
  const config = readAiConfig();
  if (!config) throw new AiError("config", messageFor("config"));
  return config;
}

function classify(status: number): AiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "server";
  return "unexpected";
}

/** The subset of the OpenAI chat-completions response we actually read. */
interface ChatCompletion {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

/**
 * One completion, with the retry policy applied.
 *
 * Retries only what is transient. A 401 fails identically however often it is
 * sent, and a 400 means our own request is wrong — retrying either burns a free
 * tier's quota to learn nothing.
 */
export async function complete(prompt: PromptRequest): Promise<string> {
  const config = requireConfig();
  const url = `${config.baseUrl}/chat/completions`;

  let lastError: AiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          temperature: prompt.temperature,
          max_tokens: prompt.maxOutputTokens,
          // Omitted entirely unless configured. A provider that does not know
          // the parameter rejects the whole request with a 400 — Gemini does
          // exactly that for `reasoning_effort: "none"`.
          ...(config.reasoningEffort
            ? { reasoning_effort: config.reasoningEffort }
            : {}),
        }),
        // A hung connection must not hold the function until the platform kills
        // it — that turns a slow provider into a 60-second blank screen.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      lastError = new AiError(
        "network",
        error instanceof Error && error.name === "TimeoutError"
          ? "The AI provider did not respond in time."
          : messageFor("network"),
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const kind = classify(response.status);
      // The body is deliberately not read. A provider that echoes the request
      // back would put the fact payload into a log line.
      const error = new AiError(kind, messageFor(kind), response.status);

      if (error.retryable && attempt < MAX_ATTEMPTS) {
        lastError = error;
        await sleep(retryDelay(response));
        continue;
      }
      throw error;
    }

    const { text, truncated } = readText(await safeJson(response));

    // Truncation is not retried. The budget will be identical next time, so a
    // second attempt produces a second fragment and doubles the wait.
    if (truncated) {
      throw new AiError("truncated", messageFor("truncated"), response.status);
    }

    if (text) return text;

    lastError = new AiError("empty", messageFor("empty"), response.status);

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new AiError("unexpected", messageFor("unexpected"));
}

/**
 * Honours `Retry-After` when the provider sends one.
 *
 * Capped, because a free tier answering "retry in 3600" is telling us the
 * quota is gone for the day, and waiting an hour inside a request handler is
 * not a retry — it is a hang.
 */
function retryDelay(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return RETRY_DELAY_MS;

  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_DELAY_MS;

  return Math.min(seconds * 1000, 5_000);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The text, and whether the provider stopped because it ran out of budget.
 *
 * `finish_reason: "length"` has to be treated as a failure, and this was found
 * the hard way against a real provider. Gemini 3.x is a reasoning model whose
 * thinking tokens are charged against `max_tokens`, and thinking expands to
 * consume whatever budget it is given: at a 400-token cap it spent 396 on
 * reasoning and 13 on output, returning the fragment
 * "HBA1C (Hemoglobin A1c): 3".
 *
 * That fragment is the dangerous case, because **the grounding check cannot
 * catch it.** `3` genuinely is one of the patient's figures, so `verify.ts`
 * passes it and a clinician is shown half a sentence as a finished summary.
 * Truncation is not fabrication, and it needs its own guard.
 *
 * The default model is now a non-reasoning one, which makes this rare. It is
 * checked anyway, because the model is configurable and the next person to set
 * `AI_MODEL` will not know any of the above.
 */
function readText(body: unknown): { text: string | null; truncated: boolean } {
  const choice = (body as ChatCompletion | null)?.choices?.[0];
  const content = choice?.message?.content;

  const text =
    typeof content === "string" && content.trim().length > 0
      ? content.trim()
      : null;

  return { text, truncated: choice?.finish_reason === "length" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
