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

import type { Bucket } from "@/lib/dashboard/insights";

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
 * **The two fills are a status, not two series.** Bars at or above the reference
 * ceiling take the alert tone; the rest take the accent. That is the same
 * information the reference range carries as a shaded wash on the patient trend
 * charts, drawn the way a bucketed axis allows. Colour is never the only
 * carrier: the axis labels the values, the bars above the range are physically
 * to the right, and the card's caption states the count in words.
 */
export function DistributionChart({
  buckets,
  unit,
  label,
}: {
  buckets: Bucket[];
  unit: string;
  label: string;
}) {
  return (
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
            minTickGap={4}
          />

          <YAxis
            // Counts are whole patients. Letting Recharts pick 0.5 as a tick
            // offers a half-result, which does not exist.
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
                fill={
                  bucket.aboveRange
                    ? "var(--color-band-high)"
                    : "var(--color-accent)"
                }
                // The 2px surface gap that keeps adjacent bars from reading as
                // one block.
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

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
    <div className="rounded-md border border-rule bg-surface px-3 py-2 shadow-sm">
      <p className="text-xs text-muted">
        {bucket.label} {unit}
      </p>
      <p className="text-sm font-semibold text-ink">
        {bucket.count}
        <span className="ml-1 font-normal text-ink-2">
          {bucket.count === 1 ? "result" : "results"}
        </span>
      </p>
      {bucket.aboveRange ? (
        <p className="mt-0.5 text-xs text-band-high">Above reference range</p>
      ) : null}
    </div>
  );
}
