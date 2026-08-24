import "server-only";

import type { EmailMessage } from "./email-service";

/**
 * The assessment invitation.
 *
 * Contains the minimum needed to act: who it is from, what it is for, that it
 * expires, and the link. Deliberately no MRN, no date of birth, no previous
 * scores and no clinical history — an inbox is not a secure channel, and the
 * message may sit in it for years.
 */
export function assessmentInviteEmail({
  to,
  patientFirstName,
  url,
  expiresAt,
}: {
  to: string;
  patientFirstName: string;
  url: string;
  expiresAt: Date;
}): EmailMessage {
  const expiry = expiresAt.toISOString().slice(0, 10);
  const greeting = patientFirstName ? `Hello ${patientFirstName},` : "Hello,";

  const text = [
    greeting,
    "",
    "Your diabetes clinic has asked you to complete a short self-assessment.",
    "It is eight questions about the last two weeks and takes about two minutes.",
    "",
    "Open your assessment:",
    url,
    "",
    `This link works once and expires on ${expiry}.`,
    "",
    "If you were not expecting this, you can ignore this email.",
    "",
    "PulseTrack",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1a17;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d8e2dd;border-radius:8px;padding:28px;">
    <p style="margin:0 0 18px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#63756e;">PulseTrack</p>
    <p style="margin:0 0 14px;font-size:15px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
      Your diabetes clinic has asked you to complete a short self-assessment.
      It is eight questions about the last two weeks and takes about two minutes.
    </p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;background:#0a5a6b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;font-weight:500;">
        Start the assessment
      </a>
    </p>
    <p style="margin:0 0 14px;font-size:13px;color:#31423c;">
      This link works once and expires on ${escapeHtml(expiry)}.
    </p>
    <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #d8e2dd;font-size:12px;color:#63756e;">
      If you were not expecting this, you can ignore this email.
    </p>
  </div>
</body>
</html>`;

  return {
    to,
    subject: "Your diabetes self-assessment",
    text,
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
