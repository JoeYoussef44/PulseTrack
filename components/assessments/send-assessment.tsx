"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button } from "@/components/ui";
import {
  sendAssessment,
  type SendAssessmentState,
} from "@/lib/actions/assessments";

function SendButton({ hasEmail }: { hasEmail: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || !hasEmail}>
      {pending ? "Sending…" : "Send assessment"}
    </Button>
  );
}

/**
 * The link is shown to the clinician once, immediately after sending.
 *
 * That is a deliberate choice, not a leak: the clinician is already authorised
 * to see this patient's data, and it keeps the flow working when the mail
 * provider refuses the recipient — which Resend's free tier does for every
 * address except the account owner's. Only the hash is ever stored, so this is
 * the single moment the raw token exists outside the patient's inbox.
 */
export function SendAssessment({
  patientId,
  hasEmail,
}: {
  patientId: string;
  hasEmail: boolean;
}) {
  const action = sendAssessment.bind(null, patientId);
  const [state, formAction] = useActionState<SendAssessmentState, FormData>(
    action,
    {},
  );
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <SendButton hasEmail={hasEmail} />
      </form>

      {!hasEmail ? (
        <p className="text-xs text-muted">
          Add an email address to this patient before sending an assessment.
        </p>
      ) : null}

      {state.error && !state.ok ? (
        <Alert tone="danger">{state.error}</Alert>
      ) : null}

      {state.ok ? (
        <Alert tone={state.emailDelivered ? "success" : "info"}>
          <div className="flex flex-col gap-2">
            <p>
              {state.emailProvider === "console"
                ? "Assessment created. No email provider is configured, so use the link below."
                : state.emailDelivered
                  ? "Assessment sent by email."
                  : `The email could not be delivered: ${state.error} Use the link below instead.`}
            </p>

            {state.link ? (
              <div className="flex flex-col gap-2">
                <code className="block overflow-x-auto rounded border border-rule bg-surface px-2 py-1.5 font-mono text-[11px] text-ink-2">
                  {state.link}
                </code>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={copyLink}
                    className="px-3 py-1.5"
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Shown once. It is not stored — only its hash is.
                </p>
              </div>
            ) : null}
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
