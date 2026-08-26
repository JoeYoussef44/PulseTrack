"use client";

import { timeDomain } from "@/lib/labs/series";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * One measure, over time, on one scale.
 *
 * Deliberately single-series. Glucose, HbA1c and blood pressure share no scale,
 * and putting two of them on one plot needs two y-axes — whose alignment is
 * arbitrary, so the chart invents a correlation that is not in the data. Three
 * measures means three charts.
 *
 * Being single-series also means no legend: there is one colour, and the card's
 * title already names what is plotted. A legend box with a single swatch just
 * restates the heading.
 *
 * Colours are CSS custom properties rather than literals, so the chart is bound
 * to the same tokens as the rest of the app and cannot drift from them.
 */

export interface TrendPoint {
  t: number;
  value: number;
  date: string;
  /**
   * Tooltip heading, when the raw date string is not the right one to show. A
   * clinic point covers a whole month, so it reads "June 2026" rather than the
   * first of the month, which would suggest a reading taken that day.
   */
  heading?: string;
  /**
   * Context lines under the value. An aggregate needs them: a mean of one
   * patient and a mean of thirty look identical on a line, and the difference
   * is the whole question of how much to trust the point.
   */
  detail?: Array<{ label: string; value: string }>;
}

export interface TrendChartProps {
  points: TrendPoint[];
  unit: string;
  /** Fixed y-domain, for a bounded scale like the DSMA-8's 0–24. */
  domain?: [number, number];
  /** Shaded reference band, when one applies to every point. */
  refLow?: number | null;
  refHigh?: number | null;
  /** Accessible description, since the marks alone are not a label. */
  label: string;
  /**
   * Whether a tick names a day or a month.
   *
   * A monthly series formatted by day reads "1 Jun, 1 Jul, 1 Aug" — three
   * identical-looking labels whose leading 1 is noise, and which invite the
   * reading that something happened on the first. Months also need a wider tick
   * gap: "Jun 2026" is nearly twice the width of "1 Jun", so the density that
   * fits one collides in the other, and it collides first on a phone.
   */
  tickFormat?: "day" | "month";
}

// UTC throughout: the dates are stored as plain calendar dates, and a local
// formatter would render 2026-05-02 as 1 May for anyone west of Greenwich.
const TICK_FORMAT = {
  day: { day: "numeric", month: "short", timeZone: "UTC" },
  month: { month: "short", year: "numeric", timeZone: "UTC" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Enough room for the widest label each format produces, plus a gutter. */
const TICK_GAP = { day: 24, month: 44 };

function formatTick(t: number, format: "day" | "month"): string {
  return new Date(t).toLocaleDateString("en-GB", TICK_FORMAT[format]);
}

export function TrendChart({
  points,
  unit,
  domain,
  refLow,
  refHigh,
  label,
  tickFormat = "day",
}: TrendChartProps) {
  const xDomain = timeDomain(points);

  return (
    <div
      // The height covers the plot *and* the x-axis band. Sizing it to the plot
      // alone leaves the tick labels outside the box and gives the card a tiny
      // nested scrollbar.
      className="h-56 w-full"
      role="img"
      aria-label={label}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 12, right: 44, bottom: 4, left: 4 }}
        >
          {/* Hairline, solid, one step off the surface. Never dashed: dashing
              reads as "threshold" or "projection" when it is only a grid.

              Its own token, a step lighter than --color-rule: the chart now
              sits in a card beside three others, and a gridline drawn in the
              same value as the card borders made the plot read as a table. */}
          <CartesianGrid
            stroke="var(--color-grid)"
            strokeWidth={1}
            vertical={false}
          />

          {/* The reference range, as a wash rather than a pair of lines, so it
              reads as background context and not as two more data series. */}
          {refLow != null && refHigh != null ? (
            <ReferenceArea
              y1={refLow}
              y2={refHigh}
              fill="var(--color-band-low)"
              fillOpacity={0.08}
              stroke="none"
            />
          ) : null}

          {/* A numeric, time-scaled axis — not the dates as labels. A
              categorical axis plots points in array order at even spacing, so a
              back-dated result draws a line that doubles back and readings a
              year apart sit as close as readings a day apart. */}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(t: number) => formatTick(t, tickFormat)}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickMargin={8}
            stroke="var(--color-rule)"
            minTickGap={TICK_GAP[tickFormat]}
          />

          <YAxis
            domain={domain ?? ["auto", "auto"]}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickMargin={6}
            width={44}
            stroke="var(--color-rule)"
            allowDecimals
          />

          <Tooltip
            // The crosshair, which is what makes a sparse line readable
            // between its points.
            cursor={{ stroke: "var(--color-rule-strong)", strokeWidth: 1 }}
            content={<TrendTooltip unit={unit} />}
            // Recharts snaps to the nearest point, so the hit target is the
            // whole column rather than the 8px dot.
            isAnimationActive={false}
          />

          <Line
            type="linear"
            dataKey="value"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // r=4 gives an 8px marker; the 2px stroke in the surface colour is
            // the ring that keeps it legible where it crosses the line.
            dot={{
              r: 4,
              fill: "var(--color-accent)",
              stroke: "var(--color-surface)",
              strokeWidth: 2,
            }}
            activeDot={{
              r: 5,
              fill: "var(--color-accent)",
              stroke: "var(--color-surface)",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
            label={<EndpointLabel count={points.length} />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The latest reading, labelled on the line itself.
 *
 * Only the endpoint. A number beside every dot is chaos and goes unread — the
 * axis and the tooltip carry the rest, and the table below carries all of it.
 */
function EndpointLabel(props: {
  count?: number;
  index?: number;
  x?: number;
  y?: number;
  value?: number;
}) {
  const { count = 0, index = 0, x, y, value } = props;

  if (index !== count - 1 || x == null || y == null) return null;

  return (
    <text
      x={x + 8}
      y={y}
      dy={4}
      // Text wears a text token, never the series colour: the coloured dot
      // beside it already carries the identity.
      fill="var(--color-ink)"
      fontSize={12}
      fontWeight={600}
    >
      {value}
    </text>
  );
}

function TrendTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  unit: string;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-rule bg-surface px-3 py-2 shadow-sm">
      <p className="text-xs text-muted">{point.heading ?? point.date}</p>
      <p className="text-sm font-semibold text-ink">
        {point.value}
        <span className="ml-1 font-normal text-ink-2">{unit}</span>
      </p>

      {/* The support behind an aggregate, when the point is one. `text-ink-2`
          rather than `text-muted`: this is the half of the tooltip that says
          whether to believe the number above it, and muted grey on white is
          the wrong weight for that. */}
      {point.detail?.length ? (
        <dl className="mt-1.5 flex flex-col gap-0.5 border-t border-rule pt-1.5 text-xs text-ink-2">
          {point.detail.map((row) => (
            <div key={row.label} className="flex gap-3">
              <dt className="grow">{row.label}</dt>
              <dd className="font-medium tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
