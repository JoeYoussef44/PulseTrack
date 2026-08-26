"use client";

import { useState } from "react";

import { bandTone } from "@/lib/assessments/bands";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, cx } from "@/components/ui";

/**
 * The Tier 3 panel: a machine-written trajectory note, shown beside the figures
 * it was written from.
 *
 * The layout is the safety argument made visible. The prose is never the only
 * thing on screen — the computed facts sit directly underneath it, so a
 * clinician reads the summary *against* its source rather than instead of it.
 * That is the part a prompt cannot guarantee and a check cannot fully replace.
 *
 * Five designed states, not one:
 *
 *  - **not configured** — a fresh clone has no AI key, and the panel says so
 *    plainly rather than showing a button that always fails.
 *  - **insufficient data** — fewer than two data points. Narrating one reading
 *    is padding.
 *  - **ungrounded** — the summary contained a number that is not in the facts,
 *    so it was discarded. The facts are still shown. This state is the whole
 *    design working, so it is worded as a safeguard rather than as an error.
 *  - **error** — the provider failed. The message is the classification, never
 *    the provider's body.
 *  - **ok** — prose, disclaimer, attribution, facts.
 */

/* ------------------------------------------------------------------ types -- */

interface Reading {
  date: string;
  value: number;
}

interface LabFact {
  testCode: string;
  name: string;
  unit: string;
  readings: number;
  first: Reading;
  latest: Reading;
  change: number | null;
  direction: "rising" | "falling" | "unchanged" | "single-reading";
  spanDays: number;
  refLow: number | null;
  refHigh: number | null;
  latestStatus: "below" | "within" | "above" | "no-range";
  outOfRangeCount: number;
}

interface AssessmentFacts {
  completed: number;
  latest: { date: string; score: number; band: string } | null;
  previous: { date: string; score: number; band: string } | null;
  change: number | null;
  direction: "worsened" | "improved" | "unchanged" | "single-assessment";
  bandChanged: boolean;
}

interface PatientFacts {
  ageYears: number;
  sex: string;
  labs: LabFact[];
  assessments: AssessmentFacts;
  daysSinceLastData: number | null;
  scoreRange: { min: number; max: number };
}

type Attribution = { provider: string; model: string } | null;

type Result =
  | { status: "ok"; summary: string; facts: PatientFacts; attribution: Attribution }
  | {
      status: "ungrounded";
      facts: PatientFacts;
      unsupported: number[];
      attribution: Attribution;
    }
  | { status: "insufficient-data"; facts: PatientFacts }
  | { status: "not-configured" }
  | { status: "error"; message: string; facts: PatientFacts | null };

type PanelState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: Result }
  | { phase: "failed"; message: string };

/**
 * The two responses that are *not* a `Result`: an unauthenticated request and a
 * malformed body. Both carry `error` and no `status`, which is what tells them
 * apart on the wire — 502 and 503 do carry a `Result`, because "the provider
 * failed" and "not configured" are states this panel is designed to render.
 */
interface ApiError {
  error: string;
}

function isApiError(body: unknown): body is ApiError {
  return (
    typeof body === "object" &&
    body !== null &&
    !("status" in body) &&
    typeof (body as ApiError).error === "string"
  );
}

/* ------------------------------------------------------------------ panel -- */

export function TrajectorySummary({
  patientId,
  configured,
}: {
  patientId: string;
  configured: boolean;
}) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  async function generate() {
    if (state.phase === "loading") return;
    setState({ phase: "loading" });

    try {
      const response = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId }),
      });

      const body: unknown = await response.json();

      // A 401 here means the session expired. It arrives as JSON rather than as
      // the login page because `/api/*` is exempt from the edge redirect —
      // without that exemption this would parse login HTML as a failed summary.
      if (isApiError(body)) {
        setState({ phase: "failed", message: body.error });
        return;
      }

      setState({ phase: "done", result: body as Result });
    } catch {
      setState({
        phase: "failed",
        message: "Could not reach the server. Check your connection and try again.",
      });
    }
  }

  const busy = state.phase === "loading";

  return (
    <Card>
      <CardHeader
        title="Trajectory summary"
        description="A short note written from this patient's recorded figures."
        action={
          configured ? (
            <Button onClick={generate} disabled={busy} variant="secondary">
              {busy
                ? "Writing…"
                : state.phase === "done"
                  ? "Regenerate"
                  : "Summarise"}
            </Button>
          ) : null
        }
      />

      <div className="px-5 py-4">
        {!configured ? (
          <EmptyState
            title="Not configured on this deployment"
            description="Set AI_PROVIDER and AI_API_KEY to enable the trajectory summary. The rest of the app runs without it."
          />
        ) : state.phase === "idle" ? (
          <EmptyState
            title="No summary yet"
            description="Summarise turns this patient's lab trends and questionnaire scores into a few sentences, alongside the figures they came from."
          />
        ) : state.phase === "loading" ? (
          <LoadingSummary />
        ) : state.phase === "failed" ? (
          <Alert tone="danger" title="The summary could not be generated">
            {state.message}
          </Alert>
        ) : (
          <Outcome result={state.result} />
        )}
      </div>
    </Card>
  );
}

/**
 * The skeleton matches the shape that replaces it — three prose lines and a
 * fact row — so the panel does not reflow when the content arrives. #27 was
 * exactly this defect in the FHIR page.
 */
function LoadingSummary() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/6" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

function Outcome({ result }: { result: Result }) {
  if (result.status === "not-configured") {
    return (
      <EmptyState
        title="Not configured on this deployment"
        description="Set AI_PROVIDER and AI_API_KEY to enable the trajectory summary."
      />
    );
  }

  if (result.status === "insufficient-data") {
    return (
      <EmptyState
        title="Not enough data to summarise"
        description="This patient needs at least two recorded data points — lab results, completed assessments, or one of each — before a trajectory can be described."
      />
    );
  }

  if (result.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="danger" title="The summary could not be generated">
          {result.message}
        </Alert>
        {result.facts ? <Facts facts={result.facts} /> : null}
      </div>
    );
  }

  if (result.status === "ungrounded") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title="Summary withheld">
          The generated note referred to {result.unsupported.length}{" "}
          {result.unsupported.length === 1 ? "figure" : "figures"} that
          {result.unsupported.length === 1 ? " does" : " do"} not appear in this
          patient&rsquo;s records, so it was discarded rather than shown. The
          recorded figures are below. Try again, or read them directly.
        </Alert>
        <Facts facts={result.facts} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-ink">{result.summary}</p>
      <Disclaimer attribution={result.attribution} />
      <Facts facts={result.facts} />
    </div>
  );
}

/**
 * Stated on every generated summary, not tucked into a tooltip.
 *
 * The three claims that matter to a clinician reading machine-written prose:
 * where it came from, that it is not advice, and that it is not part of the
 * record. The last is a real property of the system — nothing here is stored.
 */
function Disclaimer({ attribution }: { attribution: Attribution }) {
  return (
    <p className="text-xs leading-relaxed text-muted">
      Written by {attribution ? `${attribution.model} ` : "a language model "}
      from the figures below and nothing else — no name, MRN or contact details
      were sent. It is not clinical advice and is not stored as part of the
      record. Check it against the figures.
    </p>
  );
}

/* ------------------------------------------------------------------ facts -- */

const STATUS_LABELS: Record<LabFact["latestStatus"], string> = {
  below: "Below range",
  within: "In range",
  above: "Above range",
  "no-range": "No range",
};

function statusTone(status: LabFact["latestStatus"]) {
  if (status === "within") return "low" as const;
  if (status === "no-range") return "neutral" as const;
  return "high" as const;
}

/** Signed, because the sign is the trend. `+0.3` and `0.3` say different things. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function Facts({ facts }: { facts: PatientFacts }) {
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">
          Figures used
        </h3>
        <span className="text-xs text-muted">
          age {facts.ageYears} · {facts.sex.toLowerCase()}
          {facts.daysSinceLastData !== null
            ? ` · last data ${facts.daysSinceLastData} ${facts.daysSinceLastData === 1 ? "day" : "days"} ago`
            : null}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {facts.labs.map((lab) => (
          <FactCard key={lab.testCode} lab={lab} />
        ))}
        <AssessmentCard assessments={facts.assessments} range={facts.scoreRange} />
      </div>
    </div>
  );
}

function FactCard({ lab }: { lab: LabFact }) {
  return (
    <div className="rounded-md border border-rule bg-subtle/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">{lab.name}</span>
        <Badge tone={statusTone(lab.latestStatus)}>
          {STATUS_LABELS[lab.latestStatus]}
        </Badge>
      </div>

      <p className="mt-1 text-sm text-ink tabular-nums">
        {lab.direction === "single-reading" ? (
          <>
            {lab.latest.value} {lab.unit}
          </>
        ) : (
          <>
            {lab.first.value} <span className="text-muted">→</span>{" "}
            {lab.latest.value} {lab.unit}
            {lab.change !== null ? (
              <span
                className={cx(
                  "ml-1.5 text-xs",
                  lab.change === 0 ? "text-muted" : "text-ink-2",
                )}
              >
                ({signed(lab.change)})
              </span>
            ) : null}
          </>
        )}
      </p>

      <p className="mt-0.5 text-xs text-muted">
        {lab.readings} {lab.readings === 1 ? "reading" : "readings"}
        {lab.direction === "single-reading" ? null : ` over ${lab.spanDays} days`}
        {lab.outOfRangeCount > 0 ? ` · ${lab.outOfRangeCount} outside range` : null}
        {lab.refLow !== null && lab.refHigh !== null
          ? ` · ref ${lab.refLow}–${lab.refHigh}`
          : null}
      </p>
    </div>
  );
}

function AssessmentCard({
  assessments,
  range,
}: {
  assessments: AssessmentFacts;
  range: { min: number; max: number };
}) {
  if (assessments.completed === 0 || !assessments.latest) {
    return (
      <div className="rounded-md border border-rule bg-subtle/40 px-3 py-2.5">
        <span className="text-xs font-medium text-ink">DSMA-8</span>
        <p className="mt-1 text-sm text-muted">No completed assessment</p>
      </div>
    );
  }

  const { latest, previous, change } = assessments;

  return (
    <div className="rounded-md border border-rule bg-subtle/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">DSMA-8</span>
        <Badge tone={bandTone(latest.band)}>{latest.band}</Badge>
      </div>

      <p className="mt-1 text-sm text-ink tabular-nums">
        {previous ? (
          <>
            {previous.score} <span className="text-muted">→</span> {latest.score}
            <span className="text-muted">
              {" "}
              / {range.max}
            </span>
            {change !== null ? (
              <span className="ml-1.5 text-xs text-ink-2">({signed(change)})</span>
            ) : null}
          </>
        ) : (
          <>
            {latest.score}
            <span className="text-muted"> / {range.max}</span>
          </>
        )}
      </p>

      <p className="mt-0.5 text-xs text-muted">
        {assessments.completed}{" "}
        {assessments.completed === 1 ? "assessment" : "assessments"}
        {previous
          ? ` · ${assessments.direction}${assessments.bandChanged ? " · band changed" : ""}`
          : null}
        {" · higher is worse"}
      </p>
    </div>
  );
}
