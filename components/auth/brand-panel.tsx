import { Mark, Wordmark } from "@/components/brand/mark";

/**
 * The left half of the sign-in page.
 *
 * It exists to answer "what is this?" before an evaluator has credentials —
 * the login screen is the only page of the product anyone sees signed out, and
 * a lone centred box says nothing at all. Everything on it is a plain statement
 * of what the app does; there are no figures, no sample records and no
 * compliance language, because a public page is the wrong place for any of the
 * three.
 *
 * It is `--color-deep`, the same surface as the navigation rail, so signing in
 * and using the app read as one product rather than two designs. Below `lg` it
 * is not rendered at all: the mark and name move above the form, the way the
 * rail becomes a bar (D-UI-1).
 */

const CAPABILITIES = [
  "DSMA-8 self-assessments, sent as a single-use link and scored on the server.",
  "Lab results imported from CSV, with every rejected row explained by line.",
  "Two-way sync with the national FHIR platform.",
] as const;

export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-deep px-10 py-12 lg:flex xl:px-14">
      {/* The mark again, oversized and nearly invisible. Same geometry, so it
          cannot become a second, subtly different logo. `overflow-hidden` on
          the panel is what keeps it from widening the page. */}
      <Mark
        size={440}
        className="pointer-events-none absolute -right-20 -bottom-20 text-white/[0.04]"
      />

      {/* One centred column, so the panel does not read as a wall of colour
          with the words pushed into its left edge on a wide display. */}
      <div className="relative mx-auto flex w-full max-w-md flex-col justify-between">
        <Wordmark size="lg" className="text-white" />

        <div>
          <p className="max-w-md text-[1.75rem] leading-snug font-semibold tracking-tight text-white">
            Care that continues between appointments.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-deep-ink">
            Readings, self-reported answers and the trend they make — kept in
            one register between visits.
          </p>

          <ul className="mt-9 flex max-w-sm flex-col gap-4">
            {CAPABILITIES.map((capability) => (
              <li key={capability} className="flex gap-3 text-sm text-deep-ink">
                <span
                  aria-hidden="true"
                  className="mt-2.5 h-px w-4 shrink-0 bg-deep-ink/50"
                />
                <span className="leading-relaxed">{capability}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="font-mono text-[10px] tracking-[0.12em] text-deep-ink/70 uppercase">
          Demonstration environment · fabricated patient data
        </p>
      </div>
    </aside>
  );
}
