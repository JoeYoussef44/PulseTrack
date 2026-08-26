import "server-only";

/**
 * AI provider configuration.
 *
 * `server-only` for the same reason `lib/fhir/config.ts` carries it: this
 * module holds an API key, and an accidental import from a client component
 * should fail the build rather than ship the key to a browser. `AI_API_KEY`
 * must never be prefixed `NEXT_PUBLIC_`, never logged and never returned in a
 * response body.
 *
 * ## Why the provider is an OpenAI-compatible endpoint rather than an SDK
 *
 * The brief requires a genuinely free key and names Gemini and Groq as
 * examples. Both — along with OpenRouter, Cerebras and Mistral — expose the
 * same `/chat/completions` request shape, so one small client covers all of
 * them and switching provider is two environment variables rather than a
 * rewrite. That matters for one practical reason: this feature depends on a
 * free tier, and a free tier can rate-limit at the wrong moment. Being able to
 * repoint it without a deployment is worth more here than an SDK's ergonomics.
 *
 * It also keeps a dependency out of `package.json` for what is, in the end,
 * one `fetch` of a documented JSON shape.
 */

export interface AiConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * Defaults per provider, so a working setup is two variables rather than four.
 *
 * The model ids are the free-tier defaults at the time of writing. Model names
 * change more often than endpoints, which is why `AI_MODEL` overrides this
 * without touching code.
 */
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
};

/**
 * Reads the configuration, or returns null when the feature is not set up.
 *
 * Null rather than a throw, exactly as the FHIR config does: a fresh clone with
 * no AI key must still run the whole of Tier 1 and Tier 2. The panel then says
 * the feature is not configured on this deployment, instead of the app failing
 * to boot over an optional bonus.
 */
export function readAiConfig(): AiConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;

  const provider = (process.env.AI_PROVIDER?.trim() || "gemini").toLowerCase();
  const defaults = PROVIDER_DEFAULTS[provider];

  const baseUrl = process.env.AI_BASE_URL?.trim() || defaults?.baseUrl;
  const model = process.env.AI_MODEL?.trim() || defaults?.model;

  // An unknown provider with no explicit base URL and model is a
  // misconfiguration, not a default worth guessing at.
  if (!baseUrl || !model) return null;

  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
  };
}

/** True when the feature is configured. Safe to expose — carries no secret. */
export function isAiConfigured(): boolean {
  return readAiConfig() !== null;
}

/**
 * The provider and model in use, for the UI's attribution line.
 *
 * Deliberately excludes the key. A clinician reading a machine-written summary
 * should be able to see what wrote it.
 */
export function aiAttribution(): { provider: string; model: string } | null {
  const config = readAiConfig();
  if (!config) return null;
  return { provider: config.provider, model: config.model };
}
