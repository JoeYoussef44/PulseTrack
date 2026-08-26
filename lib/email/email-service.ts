import "server-only";

import { CONSOLE_PROVIDER } from "./delivery";

/**
 * Email provider abstraction.
 *
 * The assessment flow must not know which vendor sends the mail. That is not
 * architecture for its own sake — it is what lets the app demo correctly when
 * the provider refuses a recipient, which Resend's free tier does for every
 * address except the account owner's.
 *
 * One interface, two adapters, chosen by an environment variable. No plugin
 * registry, no dependency injection container.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailResult {
  delivered: boolean;
  provider: string;
  /** Safe to show a clinician. Never contains a provider key or a raw body. */
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

/* ------------------------------------------------------------- adapters -- */

/**
 * Development adapter. Records that a send happened without contacting anyone,
 * and deliberately does not print the message body or the link — the token in
 * that URL is a live credential and logs are not a safe place for it.
 */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = CONSOLE_PROVIDER;

  async send(message: EmailMessage): Promise<EmailResult> {
    console.info(
      `[email:console] queued "${message.subject}" to a patient address`,
    );
    return { delivered: true, provider: this.name };
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return { delivered: true, provider: this.name };
      }

      // Read the provider's own explanation, but surface only its message —
      // never the full response, which echoes the recipient address back.
      const detail = await safeErrorMessage(response);
      return { delivered: false, provider: this.name, error: detail };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "The email provider did not respond in time."
          : "The email provider could not be reached.";

      return { delivered: false, provider: this.name, error: reason };
    }
  }
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string" && body.message.length < 300) {
      return body.message;
    }
  } catch {
    // fall through
  }
  return `The email provider rejected the message (HTTP ${response.status}).`;
}

/* -------------------------------------------------------------- factory -- */

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const configured = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (configured === "resend" && apiKey && from) {
    cached = new ResendEmailProvider(apiKey, from);
  } else {
    // Falling back rather than throwing keeps the app usable with no mail
    // configuration at all — the clinician still gets a copyable link.
    cached = new ConsoleEmailProvider();
  }

  return cached;
}

/** True when a real provider is configured, for honest UI messaging. */
export function isRealEmailConfigured(): boolean {
  return getEmailProvider().name !== CONSOLE_PROVIDER;
}
