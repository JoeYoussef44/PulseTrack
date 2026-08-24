"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Alert, Badge, Button, Card, CardHeader, cx } from "@/components/ui";

/**
 * Imports the platform's seeded patients, one per request, from the browser.
 *
 * The loop is here for the same reason the push loop is: each patient is three
 * requests to the platform and 36 rows, and five of them in one function
 * invocation is the most likely thing in this app to hit Vercel's 60-second
 * ceiling. Per-patient also means the row for MRN-2003 can say what happened
 * to MRN-2003, which a single aggregate count cannot.
 */

interface Skip {
  reason: string;
  count: number;
}

interface PatientImportReport {
  mrn: string;
  found: boolean;
  patientId?: string;
  patientCreated?: boolean;
  imported: number;
  updated: number;
  unchanged: number;
  merged: number;
  conflicts: number;
  skipped: Skip[];
  pagesFetched: number;
  truncated: boolean;
  error?: string;
}

const SKIP_LABELS: Record<string, string> = {
  "unsupported-code": "a test this clinic does not track",
  "no-value": "no numeric result",
  "no-date": "no collection date",
  "no-id": "no identifier on the platform",
};

type RowState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: PatientImportReport }
  | { status: "error"; message: string };

export function ImportPanel({
  mrns,
  disabled,
  alreadyImported,
}: {
  mrns: readonly string[];
  disabled: boolean;
  alreadyImported: number;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  async function importAll() {
    if (busy || disabled) return;

    setBusy(true);
    setRows(Object.fromEntries(mrns.map((m) => [m, { status: "idle" }])));

    for (const mrn of mrns) {
      setRows((prev) => ({ ...prev, [mrn]: { status: "running" } }));

      try {
        const response = await fetch("/api/fhir/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mrn }),
        });

        const data = (await response.json().catch(() => null)) as
          | (PatientImportReport & { error?: string })
          | null;

        if (!response.ok || !data) {
          setRows((prev) => ({
            ...prev,
            [mrn]: {
              status: "error",
              message: data?.error ?? "The import failed.",
            },
          }));
          continue;
        }

        // A 200 that is not a report means an expired session returned the
        // login page. Reading it as an empty import would report success for
        // something that never ran.
        if (typeof data.imported !== "number") {
          setRows((prev) => ({
            ...prev,
            [mrn]: {
              status: "error",
              message:
                "Unexpected response — your session may have expired. Reload and sign in again.",
            },
          }));
          continue;
        }

        setRows((prev) => ({ ...prev, [mrn]: { status: "done", report: data } }));
      } catch {
        setRows((prev) => ({
          ...prev,
          [mrn]: { status: "error", message: "Could not reach the server." },
        }));
      }
    }

    setBusy(false);
    // The figures above and the patient list are server-rendered.
    router.refresh();
  }

  const entries = mrns.map((mrn) => [mrn, rows[mrn] ?? { status: "idle" }] as const);
  const hasRun = Object.keys(rows).length > 0;

  return (
    <Card>
      <CardHeader
        title="Import historical data"
        description="The platform holds twelve months of monthly results for five patients. They import into the same tables as local data, so they appear on the same charts."
        action={
          <Button onClick={importAll} disabled={disabled || busy}>
            {busy ? "Importing…" : alreadyImported > 0 ? "Import again" : "Import"}
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 py-5">
        {alreadyImported > 0 && !hasRun ? (
          <Alert tone="info">
            {alreadyImported} {alreadyImported === 1 ? "result" : "results"} have
            already been imported. Running this again is safe — it re-links what
            is here rather than duplicating it.
          </Alert>
        ) : null}

        <div className="-mx-5 overflow-x-auto sm:mx-0">
          {/* The negative margin is cancelled by this parent's px-5. Inside a
              bare Card it would hang the table outside the border. */}
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-y border-rule text-left">
                {["Patient", "Result", "Pages"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-2 font-mono text-[10px] tracking-[0.1em] text-muted uppercase sm:px-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(([mrn, state]) => (
                <tr key={mrn} className="border-b border-rule align-top last:border-0">
                  <td className="px-5 py-3 font-mono text-ink sm:px-3">
                    {state.status === "done" && state.report.patientId ? (
                      <Link
                        href={`/patients/${state.report.patientId}`}
                        className="text-accent hover:underline"
                      >
                        {mrn}
                      </Link>
                    ) : (
                      mrn
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <RowResult state={state} />
                  </td>
                  <td className="px-3 py-3 text-muted tabular-nums">
                    {state.status === "done" ? state.report.pagesFetched : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function RowResult({ state }: { state: RowState }) {
  if (state.status === "idle") {
    return <span className="text-muted">Not imported yet</span>;
  }

  if (state.status === "running") {
    return (
      <span className={cx("text-ink-2")} role="status">
        Importing…
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="critical">Failed</Badge>
        <p className="text-xs text-ink-2">{state.message}</p>
      </div>
    );
  }

  const { report } = state;

  if (report.error) {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="critical">Failed</Badge>
        <p className="text-xs text-ink-2">{report.error}</p>
      </div>
    );
  }

  if (!report.found) {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="neutral">Not on the platform</Badge>
        <p className="text-xs text-muted">
          No patient with this MRN. The other imports were unaffected.
        </p>
      </div>
    );
  }

  const parts: string[] = [];
  if (report.imported) parts.push(`${report.imported} imported`);
  if (report.updated) parts.push(`${report.updated} revised by the platform`);
  if (report.unchanged) parts.push(`${report.unchanged} already up to date`);
  if (report.merged) parts.push(`${report.merged} already held locally`);
  if (parts.length === 0) parts.push("no results");

  return (
    <div className="flex flex-col gap-1">
      <Badge tone={report.imported > 0 ? "low" : "neutral"}>
        {report.patientCreated ? "Patient added" : "Patient linked"}
      </Badge>
      <p className="text-xs text-ink-2">{parts.join(" · ")}</p>

      {report.conflicts > 0 ? (
        <p className="text-xs text-muted">
          {report.conflicts} already on file with a different value. The stored
          value was kept, not overwritten.
        </p>
      ) : null}

      {report.skipped.map((skip) => (
        <p key={skip.reason} className="text-xs text-muted">
          {skip.count} skipped — {SKIP_LABELS[skip.reason] ?? skip.reason}
        </p>
      ))}

      {report.truncated ? (
        <p className="text-xs font-medium text-danger">
          Stopped at the page limit — this patient has more results on the
          platform than were imported.
        </p>
      ) : null}
    </div>
  );
}
