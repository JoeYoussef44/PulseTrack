import { Card, CardHeader, EmptyState, cx } from "@/components/ui";
import { DSMA8 } from "@/lib/assessments/definition";
import { MAX_ITEM_MEAN, type ItemBreakdown } from "@/lib/dashboard/insights";

/**
 * How the whole clinic answered each DSMA-8 question.
 *
 * The chart a total score cannot give you. Two patients scoring 12 can be
 * failing at completely different things — one skipping medication, one never
 * moving — and the intervention is different. Sorted worst-first, because the
 * reason to open it is to decide where to put an hour of clinic time.
 *
 * ## Why this is CSS and not Recharts
 *
 * It is eight stacked bars with no axis, no tooltip and no layout maths. A
 * charting library would ship a client bundle to draw eight `<div>`s, and this
 * renders on the server with none. The other three panels genuinely need
 * Recharts — axes, ticks, hover — and this one does not.
 *
 * ## The colours are a ramp, not a set
 *
 * The four options are a scale, so they take one hue from light to dark.
 * Painting them four different hues would say they are four unrelated
 * categories, and the reader would lose the ordering that is the entire point.
 * The steps are validated for monotone lightness and adjacent separation, and
 * the pale end clears the surface — see `app/globals.css`.
 *
 * Colour is never the only carrier. Every segment has a title with its own
 * count, the legend is always present, and the counts are also written out as
 * text beside each bar, which is the table view the segments would otherwise
 * need.
 */

const SEGMENT_FILL = [
  "bg-scale-1",
  "bg-scale-2",
  "bg-scale-3",
  "bg-scale-4",
] as const;

export function ItemBreakdownCard({
  items,
  assessmentCount,
}: {
  items: ItemBreakdown[];
  assessmentCount: number;
}) {
  const answered = items.filter((i) => i.n > 0).length;

  return (
    <Card>
      <CardHeader
        title="Where the clinic struggles most"
        description={
          assessmentCount === 0
            ? "Every DSMA-8 question, once assessments have been completed."
            : `Every DSMA-8 question across ${assessmentCount} completed ${
                assessmentCount === 1 ? "assessment" : "assessments"
              }, worst first. Higher means reported more often.`
        }
      />

      {answered === 0 ? (
        <EmptyState
          title="No completed assessments yet"
          description="Once patients start returning their DSMA-8 questionnaires, this shows which self-management behaviours the practice is losing ground on."
        />
      ) : (
        <>
          <Legend />

          <ol className="flex flex-col">
            {items.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-1 gap-2 border-b border-rule px-5 py-4 last:border-0 sm:grid-cols-[1fr_11rem] sm:items-center sm:gap-5"
              >
                <div className="flex min-w-0 gap-2.5">
                  <span className="tabular font-mono text-xs text-muted">
                    {item.position}.
                  </span>
                  <p className="text-sm text-ink">{item.text}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  {item.n === 0 ? (
                    <p className="text-xs text-muted sm:text-right">
                      Not yet answered
                    </p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-muted">
                          {item.frequentCount} of {item.n} often
                        </span>
                        <span className="tabular font-mono text-sm font-semibold text-ink">
                          {item.mean?.toFixed(2)}
                          <span className="font-normal text-muted">
                            {" "}
                            / {MAX_ITEM_MEAN}
                          </span>
                        </span>
                      </div>

                      {/* One stacked bar per question: the share of patients
                          choosing each option, in scale order. Segments carry a
                          2px surface gap so two adjacent steps of one hue never
                          read as a single longer segment. */}
                      <div
                        className="flex h-3 w-full overflow-hidden rounded-sm bg-subtle"
                        role="img"
                        aria-label={describe(item)}
                      >
                        {item.counts.map((count, index) =>
                          count === 0 ? null : (
                            <div
                              key={DSMA8.options[index].value}
                              title={`${DSMA8.options[index].label}: ${count}`}
                              className={cx(
                                SEGMENT_FILL[index],
                                "border-r-2 border-surface last:border-r-0",
                              )}
                              style={{ width: `${(count / item.n) * 100}%` }}
                            />
                          ),
                        )}
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3">
      {DSMA8.options.map((option, index) => (
        <span
          key={option.value}
          className="flex items-center gap-1.5 text-xs text-muted"
        >
          <span
            aria-hidden
            className={cx("h-2.5 w-2.5 rounded-sm", SEGMENT_FILL[index])}
          />
          {option.label}
        </span>
      ))}
    </div>
  );
}

/** The bar's accessible text: the same counts the segments encode. */
function describe(item: ItemBreakdown): string {
  const parts = item.counts
    .map((count, index) => `${DSMA8.options[index].label} ${count}`)
    .join(", ");

  return `${item.text} — ${parts}. Mean ${item.mean} of ${MAX_ITEM_MEAN}.`;
}
