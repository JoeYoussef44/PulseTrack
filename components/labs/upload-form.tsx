"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Badge, Button, Card, CardHeader, cx } from "@/components/ui";
import type { RowStatus } from "@/lib/labs/classify";

/**
 * The upload form and its validation report.
 *
 * The report is the feature. Anyone can accept a well-formed file; what the
 * brief actually asks for is that a *messy* file explains itself — which row,
 * what was wrong with it, and what was imported anyway. So the outcome is
 * rendered per row, with the file's own line numbers, rather than as a count.
 */

interface ReportRow {
  line: number;
  mrn: string;
  collectedDate: string;
  testCode: string;
  value: string;
  status: RowStatus;
  reasons: string[];
  warnings: string[];
}

interface Report {
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  skippedDuplicateCount: number;
  rows: ReportRow[];
}

interface Outcome {
  uploadId: string;
  filename: string;
  report: Report;
  note?: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  accepted: "Imported",
  rejected: "Rejected",
  skipped: "Already imported",
};

const STATUS_TONE: Record<RowStatus, "low" | "critical" | "neutral"> = {
  accepted: "low",
  rejected: "critical",
  skipped: "neutral",
};

type Filter = "all" | RowStatus;

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/labs/upload", {
        method: "POST",
        body,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "The upload failed. Try again.");
        return;
      }

      // A 200 that is not the report means something answered in our place —
      // in practice a session that expired and produced a login page. Without
      // this guard the report silently renders empty, which reads as "your
      // file imported nothing" rather than "you are signed out".
      if (!data?.report) {
        setError(
          "The server returned an unexpected response. Your session may have expired — reload the page, sign in, and try again.",
        );
        return;
      }

      setOutcome(data as Outcome);
      setFilter(data.report.rejectedCount > 0 ? "rejected" : "all");

      // The recent-uploads list and the patient charts are server-rendered, so
      // they need a refresh to reflect what just landed.
      router.refresh();
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setOutcome(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const report = outcome?.report;
  const visibleRows =
    report?.rows.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Import lab results"
          description="CSV only, up to 2 MB. Rows are validated individually — valid rows import even if others fail."
          action={
            <a
              href="/templates/lab-results-template.csv"
              download
              className="text-sm font-medium text-accent hover:underline"
            >
              Download template
            </a>
          }
        />

        <form onSubmit={upload} className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="file" className="text-sm font-medium text-ink">
              CSV file
            </label>
            <input
              ref={inputRef}
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setOutcome(null);
                setError(null);
              }}
              className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
            />
            <p className="text-xs text-muted">
              Required columns: <code>mrn</code>, <code>collected_date</code>,{" "}
              <code>test_code</code>, <code>value</code>. Anything else is
              optional.
            </p>
          </div>

          {error ? <Alert title="That file was not imported">{error}</Alert> : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!file || busy}>
              {busy ? "Importing…" : "Import"}
            </Button>
            {file && !busy ? (
              <Button type="button" variant="ghost" onClick={reset}>
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {report ? (
        <Card>
          <CardHeader
            title={`Import report — ${outcome.filename}`}
            description={`${report.totalRows} ${report.totalRows === 1 ? "row" : "rows"} read.`}
          />

          <div className="grid grid-cols-1 gap-px border-b border-rule bg-rule sm:grid-cols-3">
            <Stat
              label="Imported"
              value={report.acceptedCount}
              tone="text-band-low"
            />
            <Stat
              label="Rejected"
              value={report.rejectedCount}
              tone="text-band-critical"
            />
            <Stat
              label="Already imported"
              value={report.skippedDuplicateCount}
              tone="text-ink-2"
            />
          </div>

          <div className="flex flex-col gap-4 px-5 py-5">
            {report.acceptedCount === 0 && report.rejectedCount === 0 ? (
              <Alert tone="info" title="Nothing new to import">
                Every row in this file is already on file. Re-uploading a file
                never creates duplicates.
              </Alert>
            ) : null}

            {outcome.note ? <Alert tone="info">{outcome.note}</Alert> : null}

            <div className="flex flex-wrap gap-1">
              {(["all", "rejected", "skipped", "accepted"] as const).map((f) => {
                const count =
                  f === "all"
                    ? report.totalRows
                    : report.rows.filter((r) => r.status === f).length;

                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    disabled={count === 0 && f !== "all"}
                    className={cx(
                      "rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      filter === f
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-ink-2 hover:bg-subtle",
                    )}
                  >
                    {f === "all" ? "All rows" : STATUS_LABEL[f]} ({count})
                  </button>
                );
              })}
            </div>

            <div className="-mx-5 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="border-y border-rule text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2 font-medium sm:px-3">
                      Line
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      MRN
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Test
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Value
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Outcome
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.line}
                      className="border-b border-rule align-top last:border-0"
                    >
                      <td className="px-5 py-2.5 text-muted tabular-nums sm:px-3">
                        {row.line}
                      </td>
                      <td className="px-3 py-2.5 text-ink">{row.mrn || "—"}</td>
                      <td className="px-3 py-2.5 text-ink-2 tabular-nums">
                        {row.collectedDate || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {row.testCode || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2 tabular-nums">
                        {row.value || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <Badge tone={STATUS_TONE[row.status]}>
                            {STATUS_LABEL[row.status]}
                          </Badge>
                          {row.reasons.map((reason) => (
                            <p key={reason} className="text-xs text-ink-2">
                              {reason}
                            </p>
                          ))}
                          {row.warnings.map((warning) => (
                            <p key={warning} className="text-xs text-muted">
                              Note: {warning}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cx("mt-0.5 text-2xl font-semibold tabular-nums", tone)}>
        {value}
      </p>
    </div>
  );
}
