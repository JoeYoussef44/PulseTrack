"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * Fallback boundary for routes outside the dashboard — chiefly the public
 * assessment page, which a patient reaches by token.
 *
 * The wording matters here. A patient who hits this is not a clinician and
 * cannot debug anything, so it says what they should do rather than what
 * failed, and it never implies their answers were stored when they may not
 * have been.
 *
 * Next.js 16 names the recovery prop `retry`, not `reset`.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[app] render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
      <p className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
        Diabetes clinic
      </p>

      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Something went wrong
      </h1>

      <p className="text-sm text-muted">
        This page could not be loaded. Please try again. If it keeps happening,
        contact your clinic — do not reply to the email with your answers.
      </p>

      {error.digest ? (
        <p className="font-mono text-[11px] text-muted">
          Reference: {error.digest}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
