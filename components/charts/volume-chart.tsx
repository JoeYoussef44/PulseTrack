"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { findByCode } from "@/lib/labs/test-catalog";

import type { VolumePoint } from "@/lib/dashboard/insights";
import type { TestCode } from "@/lib/generated/prisma/enums";

/**
 * How many results arrived each month.
 *
 * The coverage question rather than the clinical one: not "how are my patients",
 * but "do I actually have data on them, and when did it stop coming in". A month
 * with nothing in it is the thing worth seeing, which is why `monthlyVolume`
 * fills empty months with a zero while `monthlyMeans` leaves them out — a month
 * with no results has a real volume of nought and no mean at all.
 *
 * **One bar per month, not three stacked ones.** Stacking the three tests would
 * need three categorical hues to say something the reader can already get from
 * the tooltip, and it would put the two shorter segments on a floating baseline
 * where their lengths stop being comparable. One series needs no legend, and the
 * per-test split lives in the tooltip, where it is asked for rather than
 * imposed.
 */
export function VolumeChart({
  points,
  label,
}: {
  points: VolumePoint[];
  label: string;
}) {
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
          barCategoryGap={2}
        >
          <CartesianGrid
            stroke="var(--color-grid)"
            strokeWidth={1}
            vertical={false}
          />

          {/* Months are evenly spaced by construction and every month in the
              span is present, including the empty ones — so a categorical axis
              states the truth here rather than hiding a gap, which is not true
              of the dated trend charts. */}
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickMargin={8}
            stroke="var(--color-rule)"
            interval="preserveStartEnd"
            minTickGap={4}
          />

          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickMargin={6}
            width={32}
            stroke="var(--color-rule)"
          />

          <Tooltip
            cursor={{ fill: "var(--color-subtle)" }}
            content={<VolumeTooltip />}
            isAnimationActive={false}
          />

          <Bar
            dataKey="total"
            fill="var(--color-accent)"
            radius={[4, 4, 0, 0]}
            stroke="var(--color-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** `2026-07` -> `Jul 26`. UTC parts, so no month shifts west of Greenwich. */
function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function VolumeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: VolumePoint }>;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-rule bg-surface px-3 py-2 shadow-sm">
      <p className="text-xs text-muted">{formatMonth(point.month)}</p>
      <p className="text-sm font-semibold text-ink">
        {point.total}
        <span className="ml-1 font-normal text-ink-2">
          {point.total === 1 ? "result" : "results"}
        </span>
      </p>

      {point.total > 0 ? (
        <dl className="mt-1.5 flex flex-col gap-0.5">
          {Object.entries(point.byTest)
            .filter(([, count]) => count > 0)
            .map(([code, count]) => (
              <div key={code} className="flex justify-between gap-4 text-xs">
                <dt className="text-muted">
                  {findByCode(code as TestCode).displayName}
                </dt>
                <dd className="tabular text-ink-2">{count}</dd>
              </div>
            ))}
        </dl>
      ) : (
        <p className="mt-0.5 text-xs text-muted">Nothing collected</p>
      )}
    </div>
  );
}
