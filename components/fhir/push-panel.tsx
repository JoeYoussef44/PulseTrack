"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Card, CardHeader } from "@/components/ui";

/**
 * Drives the push queue from the browser, one batch at a time.
 *
 * The loop lives here rather than on the server because a serverless function
 * has 60 seconds and a lab import can hold thousands of rows at one request
 * each. Calling a bounded endpoint repeatedly is what makes a large push
 * finish on the deployed URL at all — and it means the clinician watches a
 * real count go down instead of a spinner with no end in sight.
 *
 * The loop stops on three conditions, all of them explicit: the queue drains,
 * the server reports it made no progress, or a hard cap is reached. A retry
 * loop against an external service needs a stop condition that does not depend
 * on that service behaving.
 */

interface BatchResult {
  patientsPushed: number;
  resultsPushed: number;
  failed: number;
  more: boolean;
  remaining: number;
  firstError?: string;
}

/** 20 records a batch — enough for 20 000 records before this bites. */
const MAX_BATCHES = 1000;

export function PushPanel({
  pending,
  failed,
  forbidden,
  disabled,
}: {
  pending: number;
  failed: number;
  forbidden: number;
  disabled: boolean;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState<{ patients: number; results: number } | null>(
    null,
  );
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function push() {
    if (busy || disabled) return;

    setBusy(true);
    setError(null);
    setPushed(null);
    setRemaining(pending);

    let patients = 0;
    let results = 0;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const response = await fetch("/api/fhir/sync", { method: "POST" });
        const data = (await response.json().catch(() => null)) as
          | (BatchResult & { error?: string })
          | null;

        if (!response.ok) {
          setError(data?.error ?? "The sync failed. Try again.");
          break;
        }

        // A 200 that is not a batch result means something answered in our
        // place — in practice an expired session returning the login page.
        // Without this the loop reads it as "nothing left to do" and reports
        // success for a push that never happened.
        if (!data || typeof data.remaining !== "number") {
          setError(
            "The server returned an unexpected response. Your session may have expired — reload the page and sign in again.",
          );
          break;
        }

        patients += data.patientsPushed;
        results += data.resultsPushed;

        setPushed({ patients, results });
        setRemaining(data.remaining);

        if (data.firstError && !data.more) setError(data.firstError);
        if (!data.more) break;
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      // The counts on this page are server-rendered.
      router.refresh();
    }
  }

  const nothingToDo = pending === 0;

  return (
    <Card>
      <CardHeader
        title="Push to the national platform"
        description="Patients and locally-imported lab results are reported to the platform. Data pulled from it is never sent back."
        action={
          <Button onClick={push} disabled={disabled || busy || nothingToDo}>
            {busy ? "Pushing…" : nothingToDo ? "Nothing queued" : `Push ${pending}`}
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 py-5">
        {busy || pushed ? (
          <div
            role="status"
            className="rounded-md border border-rule bg-subtle px-4 py-3 text-sm text-ink"
          >
            {busy ? "Pushing… " : "Finished. "}
            <span className="tabular-nums">
              {pushed?.patients ?? 0} {pushed?.patients === 1 ? "patient" : "patients"}
              {" and "}
              {pushed?.results ?? 0} {pushed?.results === 1 ? "result" : "results"} sent
            </span>
            {remaining !== null && remaining > 0 ? (
              <span className="text-muted"> · {remaining} still queued</span>
            ) : null}
          </div>
        ) : null}

        {error ? <Alert title="The push did not finish">{error}</Alert> : null}

        {failed > 0 && !busy ? (
          <Alert tone="info">
            {failed} {failed === 1 ? "record" : "records"} failed on a previous
            attempt and {failed === 1 ? "is" : "are"} included in the queue above.
            Failures are retried; they are not lost.
          </Alert>
        ) : null}

        {forbidden > 0 ? (
          <Alert tone="info" title="Some records cannot be sent">
            The platform refused {forbidden} {forbidden === 1 ? "record" : "records"}{" "}
            because {forbidden === 1 ? "it belongs" : "they belong"} to another
            organisation. That is a permanent answer, so these are not retried —
            see the list below.
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
