"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Bucket, BucketStatus } from "@/lib/dashboard/insights";

/**
 * How one measurement is spread across the whole clinic.
 *
 * A histogram, not a trend: the question is "what does my register look like",
 * and the answer is a shape — clustered near the reference range, or a long
 * tail of patients nobody has caught up with.
 *
 * ## Two decisions worth stating
 *
 * **A categorical x-axis is correct here, and only here.** Every other chart in
 * this app uses a numeric time scale, because a categorical axis plots points in
 * array order at even spacing and would misstate the gaps between dates. Buckets
 * are different: they are equal-width by construction and already in order, so
 * even spacing is the truth rather than a distortion.
 *
 * **The fills are a status, not a series — and there are four of them.** There
 * used to be two: above the reference ceiling, or not. That painted a bucket of
 * hypoglycaemic readings in the same tone as a bucket of perfectly normal ones
 * and — worse — painted a bucket that *straddles* a limit as though all of it
 * were fine. A bucket is not normal because most of it is. So a bucket spanning
 * a limit takes a deliberately neutral tone and names the limit it spans, and
 * below-range buckets are told apart from in-range ones.
 *
 * Colour is never the only carrier, at three levels: the axis labels the values,
 * the legend names every state present in words, and the card's caption states
 * the counts in a sentence.
 */

const STATUS_FILL: Record<BucketStatus, string> = {
  // Unchanged from the two-tone version: in-range keeps the accent, above-range
  // keeps the alert tone. Only the two states that did not exist are new.
  within: "var(--color-accent)",
  above: "var(--color-band-high)",
  below: "var(--color-band-moderate)",
  // Neutral on purpose. This bucket is partly in range and partly out, and any
  // status colour would assert one of the two.
  straddles: "var(--color-rule-strong)",
};

const STATUS_TEXT: Record<BucketStatus, string> = {
  within: "Within reference range",
  above: "Above reference range",
  below: "Below reference range",
  straddles: "Spans a reference limit",
};

const LEGEND_ORDER: BucketStatus[] = ["below", "within", "straddles", "above"];

export function DistributionChart({
  buckets,
  unit,
  label,
}: {
  buckets: Bucket[];
  unit: string;
  label: string;
}) {
  // Only the states actually drawn. A fixed four-item legend would explain
  // colours that are not on the chart, which is its own small lie — and on a
  // register where every bucket is above range it would be three-quarters
  // noise.
  const present = LEGEND_ORDER.filter((status) =>
    buckets.some((b) => b.status === status),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="h-56 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={buckets}
            margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
            barCategoryGap={2}
          >
            <CartesianGrid
              stroke="var(--color-grid)"
              strokeWidth={1}
              vertical={false}
            />

            <XAxis
              dataKey="label"
              tick={{ fill: "var(--color-muted)", fontSize: 10 }}
              tickMargin={8}
              stroke="var(--color-rule)"
              interval="preserveStartEnd"
              // Wide enough for a label like "100–120" plus a gutter. At the
              // previous 4 the labels butted together on a phone and read as
              // one run of digits; Recharts drops ticks to honour this, which
              // is the right way to lose density — the bars all stay.
              minTickGap={16}
            />

            <YAxis
              // Counts are whole results. Letting Recharts pick 0.5 as a tick
              // offers half a result, which does not exist.
              allowDecimals={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickMargin={6}
              width={32}
              stroke="var(--color-rule)"
            />

            <Tooltip
              cursor={{ fill: "var(--color-subtle)" }}
              content={<DistributionTooltip unit={unit} />}
              isAnimationActive={false}
            />

            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {buckets.map((bucket) => (
                <Cell
                  key={bucket.label}
                  fill={STATUS_FILL[bucket.status]}
                  // The 2px surface gap that keeps adjacent bars from reading
                  // as one block.
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {present.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted">
          {present.map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: STATUS_FILL[status] }}
              />
              {STATUS_TEXT[status]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The tooltip, and the two things it has to be explicit about.
 *
 * **Which interval a bucket actually is.** "80–100" does not say where 100
 * went. Every bucket is half-open — 80 up to but not including 100 — except the
 * last, which is closed so the highest reading on file lands inside it rather
 * than falling off the end. Written in words rather than as `[80, 100)`,
 * because interval notation is not what a clinician reads.
 *
 * **Which limit a straddling bucket spans.** The neutral fill says "not a
 * simple answer"; this says what the answer is.
 */
function DistributionTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: Bucket }>;
  unit: string;
}) {
  if (!active || !payload?.length) return null;

  const bucket = payload[0].payload;

  return (
    <div className="max-w-64 rounded-md border border-rule bg-surface px-3 py-2 shadow-sm">
      <p className="text-xs text-muted">
        {bucket.closed
          ? `${bucket.from} to ${bucket.to} ${unit}, inclusive`
          : `${bucket.from} to under ${bucket.to} ${unit}`}
      </p>
      <p className="text-sm font-semibold text-ink">
        {bucket.count}
        <span className="ml-1 font-normal text-ink-2">
          {bucket.count === 1 ? "result" : "results"}
        </span>
      </p>

      <p className="mt-0.5 text-xs text-ink-2">
        {bucket.status === "straddles" && bucket.boundary !== null
          ? `Spans the reference limit of ${bucket.boundary} ${unit} — part of this range is in range and part is not.`
          : STATUS_TEXT[bucket.status]}
      </p>
    </div>
  );
}
