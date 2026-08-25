import {
  MARK_PATH,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  MARK_VIEWBOX,
} from "@/lib/brand/mark";
import { cx } from "@/components/ui";

/**
 * The mark and the wordmark.
 *
 * Two tones, because the mark sits on two very different surfaces. `bare`
 * strokes the trace in `currentColor`, so it takes the colour of whatever text
 * it stands beside — that is the form used everywhere inside the app. `tile`
 * fills the accent square behind it, which a favicon needs because browser
 * chrome is light in one theme and dark in the other and a bare stroke would
 * vanish into one of them.
 *
 * Both are decorative: the wordmark next to them already says "PulseTrack", so
 * announcing it twice is noise to a screen reader.
 */
export function Mark({
  size = 22,
  tone = "bare",
  className,
}: {
  size?: number;
  tone?: "bare" | "tile";
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", tone === "tile" && "text-white", className)}
    >
      {tone === "tile" ? (
        <rect
          width="32"
          height="32"
          rx={MARK_TILE_RADIUS}
          className="fill-accent"
        />
      ) : null}
      <path
        d={MARK_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Mark plus name, in the two sizes the product uses: `sm` in the navigation
 * rail and the mobile bar, `lg` on the login page.
 *
 * Both the name and the eyebrow live here rather than being typed out at each
 * call site — there are four of those, and four copies of a string is four
 * chances for three of them to be updated.
 *
 * The eyebrow inherits its colour and drops to 70% opacity instead of naming a
 * token, so the same component works on the dark rail and on paper without a
 * colour prop.
 */
export function Wordmark({
  size = "sm",
  eyebrow = true,
  className,
}: {
  size?: "sm" | "lg";
  eyebrow?: boolean;
  className?: string;
}) {
  const large = size === "lg";

  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <Mark size={large ? 32 : 22} />
      <span className="flex flex-col gap-0.5">
        <span
          className={cx(
            "leading-none font-semibold tracking-tight",
            large ? "text-xl" : "text-sm",
          )}
        >
          PulseTrack
        </span>
        {eyebrow ? (
          <span className="font-mono text-[10px] leading-none tracking-[0.14em] uppercase opacity-70">
            Diabetes clinic
          </span>
        ) : null}
      </span>
    </span>
  );
}
