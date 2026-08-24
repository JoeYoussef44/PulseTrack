"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import Link from "next/link";

import { Button, Card } from "@/components/ui";

/**
 * Error boundary for every authenticated page.
 *
 * It lives inside the (dashboard) segment deliberately, so it renders *within*
 * the dashboard layout: the clinician keeps the nav and can carry on
 * elsewhere. An app-level boundary would replace the whole chrome and read as
 * "the site is down" — which is precisely the impression this exists to avoid.
 *
 * Next.js 16 names the recovery prop `retry`, not `reset`.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Server-side details never reach the browser in production; the digest is
    // the only handle that ties this screen to a server log line. No patient
    // data is logged here, by design.
    console.error("[dashboard] render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <Card className="mx-auto max-w-xl">
      <div className="flex flex-col items-start gap-3 px-6 py-10">
        <p className="text-sm font-semibold text-ink">Something went wrong</p>
        <p className="text-sm text-muted">
          This page could not be loaded. Nothing you were viewing has been
          changed or lost — trying again will usually resolve it.
        </p>

        {error.digest ? (
          <p className="font-mono text-[11px] text-muted">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" onClick={() => retry()}>
            Try again
          </Button>
          <Link href="/dashboard">
            <Button type="button" variant="ghost">
              Back to the clinic overview
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
