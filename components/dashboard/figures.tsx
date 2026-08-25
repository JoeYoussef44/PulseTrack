import { cx } from "@/components/ui";
import { NO_ASSESSMENT, segmentTone, type RiskSegment } from "@/lib/dashboard/metrics";

/**
 * Figures — the forms a dashboard uses when the data is a number rather than a
 * shape.
 *
 * All server components: none of this needs interactivity, and a one-bar bar
 * chart would be a worse answer than the number itself.
 *
 * There was a `HeroFigure` here — one oversized number per page. It went when
 * the overview moved to four equal tiles: a hero is for a sparse page, and this
 * one is no longer sparse.
 */

/* -------------------------------------------------------------- stat tile -- */

export function StatTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {caption ? <p className="text-xs text-muted">{caption}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ meter -- */

/**
 * A single ratio against its limit.
 *
 * A meter rather than a two-slice pie, and the unfilled track is a lighter step
 * of the same ramp rather than a neutral grey, so the state reads across the
 * whole bar instead of only the filled part.
 */
export function Meter({
  value,
  label,
}: {
  /** 0–1, or null when there is no ratio to show. */
  value: number | null;
  label: string;
}) {
  const pct = value === null ? 0 : Math.round(value * 100);

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-accent-soft"
      role="meter"
      aria-valuenow={value === null ? undefined : pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {value === null ? null : (
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------- risk distribution --- */

const SEGMENT_FILL: Record<string, string> = {
  low: "bg-band-low",
  moderate: "bg-band-moderate",
  high: "bg-band-high",
  critical: "bg-band-critical",
  neutral: "bg-rule-strong",
};

/**
 * Patients per risk band — one labelled bar per band, not one stacked bar.
 *
 * The stacked version was built first and rejected on evidence. Running the
 * four band colours through a CVD validator put the moderate/high pair at
 * ΔE 8.0 for normal vision and **0.4 under deuteranopia** — the same colour, to
 * a deuteranope. That is not a fault in the palette: green→yellow→orange→red is
 * a continuous hue ramp, so any two neighbouring steps are close, and stacking
 * them makes hue the channel that has to tell them apart.
 *
 * Faceting removes the problem rather than working around it. No two fills
 * touch, every bar carries its own name and number, and colour reinforces an
 * identity the label has already given. The four bands each clear 3:1 against
 * the surface on their own, which is the check that actually applies now.
 *
 * Bars share one baseline so the lengths are comparable, and empty bands keep
 * their row — a distribution that hides its empty bands changes shape as data
 * arrives and stops being comparable between two glances at it.
 */
export function RiskDistribution({
  segments,
  total,
}: {
  segments: RiskSegment[];
  total: number;
}) {
  return (
    <dl className="flex flex-col gap-3 px-5 py-5">
      {segments.map((segment) => (
        <div
          key={segment.label}
          className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3 sm:grid-cols-[13rem_minmax(0,26rem)_5rem] sm:gap-4"
        >
          <dt className="text-sm text-ink-2">
            {segment.label}
            {segment.label === NO_ASSESSMENT ? (
              <span className="ml-1 text-xs text-muted">· not surveyed</span>
            ) : null}
          </dt>

          {/* A single shared baseline, with the track showing the whole
              register so a share reads without arithmetic.

              The track is capped rather than fluid. Stretched across a wide
              monitor a 10% bar becomes a 40px mark adrift in 800px of grey,
              which is less legible than the same bar in a track you can take
              in at once — length only compares when the eye can hold both
              ends. */}
          <div className="h-3 w-full overflow-hidden rounded-sm bg-subtle">
            {segment.count > 0 ? (
              <div
                className={cx(
                  "h-full rounded-r-sm",
                  SEGMENT_FILL[segmentTone(segment.label)],
                )}
                style={{ width: `${Math.max(segment.share * 100, 1.5)}%` }}
              />
            ) : null}
          </div>

          {/* The value beside the bar, never inside it: a number set inside a
              3%-wide bar would be clipped, and clipped text is worse than none. */}
          <dd className="tabular text-right text-sm text-ink">
            {segment.count}
            <span className="ml-1.5 text-xs text-muted">
              {total > 0 ? `${Math.round(segment.share * 100)}%` : "—"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
