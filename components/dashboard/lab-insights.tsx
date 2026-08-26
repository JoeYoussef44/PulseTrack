import { DistributionChart } from "@/components/charts/distribution-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { Card, CardHeader, EmptyState } from "@/components/ui";

import { DISPLAY_DECIMALS } from "@/lib/dashboard/insights";

import type {
  MonthPoint,
  TestInsight,
  VolumePoint,
} from "@/lib/dashboard/insights";

/**
 * The three measures this clinic exists to move, at clinic scale.
 *
 * Each test gets two charts because it answers two different questions, and one
 * chart cannot answer both:
 *
 *  - **Where is the register now?** A histogram of every result on file, with
 *    each bucket coloured by where it sits against the reference range.
 *  - **Which way is it going?** The clinic's monthly figure, on the same
 *    time-scaled trend chart the patient pages use, with the reference range
 *    shaded behind it.
 *
 * Never on one pair of axes. A count and a concentration share no scale, and
 * putting them together needs two y-axes whose alignment is arbitrary — which
 * makes the chart assert a relationship the data does not contain. That rule is
 * why the patient page has three charts instead of one, and it does not stop
 * applying because the numbers got bigger.
 *
 * ## Both figures count patients, not results
 *
 * The headline is the **median of each patient's latest reading**, not the mean
 * of every reading: one patient at 221 mg/dL drags a mean of eight readings up
 * by fifteen and makes the register look worse than any individual patient is.
 *
 * The trend is the **mean of each patient's own monthly mean** — see
 * `monthlyClinicMeans`. A patient measured three times in a month would
 * otherwise carry three times the weight of a patient measured once, and the
 * line would track the appointment book as much as the population.
 *
 * Only the histogram plots every result, deliberately: the shape of the whole
 * record is what a distribution is for.
 */

export interface TestPanel extends TestInsight {
  trend: MonthPoint[];
}

export function LabInsights({
  tests,
  excludedForUnit,
}: {
  tests: TestPanel[];
  excludedForUnit: number;
}) {
  const withData = tests.filter((t) => t.resultCount > 0);

  // Nothing usable anywhere. Two very different reasons for that, and a reader
  // who is told the wrong one goes looking in the wrong place: an empty
  // register is a clinic that has not started, whereas a register whose every
  // result is in the wrong unit is a clinic with data it cannot yet use.
  if (withData.length === 0) {
    return (
      <Card>
        <CardHeader title="Lab results across the clinic" />
        {excludedForUnit > 0 ? (
          <EmptyState
            title="No results in a standard unit yet"
            description={`All ${excludedForUnit} lab ${
              excludedForUnit === 1 ? "result" : "results"
            } on file are recorded in a unit other than the standard one for their test, so there is nothing here that can be combined into a clinic figure. Every one of them is kept exactly as reported on the patient's own record.`}
          />
        ) : (
          <EmptyState
            title="No lab results yet"
            description="Import a CSV or pull patient histories from the national platform, and the clinic's HbA1c, fasting glucose and blood pressure will be summarised here."
          />
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {excludedForUnit > 0 ? (
        <p className="text-xs text-muted">
          {excludedForUnit}{" "}
          {excludedForUnit === 1 ? "result is" : "results are"} recorded in a
          unit other than the standard one for their test, so{" "}
          {excludedForUnit === 1 ? "it is" : "they are"} not included in the
          clinic figures on this page — a single average cannot span two units.
          Each is kept exactly as reported on the patient&rsquo;s own record, and
          nothing has been converted.
        </p>
      ) : null}

      {tests.map((test) =>
        test.resultCount === 0 ? (
          <MissingTest key={test.testCode} test={test} />
        ) : (
          <div
            key={test.testCode}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(28rem,100%),1fr))] gap-6"
          >
            <Card>
              <CardHeader
                title={`${test.name} — distribution`}
                description={`${test.resultCount} ${
                  test.resultCount === 1 ? "result" : "results"
                } on file. Reference range ${refRange(test)}. ${describeLatest(test)}`}
              />
              <div className="px-2 pt-2 pb-4">
                <DistributionChart
                  buckets={test.buckets}
                  unit={test.unit}
                  label={distributionLabel(test)}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`${test.name} — clinic monthly average`}
                description={describeTrend(test)}
              />
              <div className="px-2 pt-2 pb-4">
                <TrendChart
                  points={test.trend.map((p) => ({
                    t: p.t,
                    value: p.mean,
                    date: p.month,
                    heading: monthLabel(p.t),
                    // The support behind the point. A clinician reading a
                    // downward line needs to know whether it rests on eight
                    // patients or on one, and the line itself cannot say.
                    detail: [
                      {
                        label: "Patients represented",
                        value: String(p.patientCount),
                      },
                      {
                        label: "Results collected",
                        value: String(p.resultCount),
                      },
                    ],
                  }))}
                  unit={test.unit}
                  refLow={test.refLow}
                  refHigh={test.refHigh}
                  tickFormat="month"
                  label={trendLabel(test)}
                />
              </div>
            </Card>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * A test with nothing to chart, said out loud rather than left out.
 *
 * A panel that silently disappears is indistinguishable from one that failed to
 * render, and the two cases below are worth telling apart: a test nobody has
 * ordered is a coverage gap, and a test whose every result is in a non-standard
 * unit is data the clinic has but cannot aggregate.
 *
 * One slim card rather than the usual pair — there is one sentence to say, and
 * two empty chart frames would say it worse.
 */
function MissingTest({ test }: { test: TestPanel }) {
  return (
    <Card>
      <CardHeader
        title={test.name}
        description={
          test.excludedForUnit > 0
            ? `All ${test.excludedForUnit} ${test.name.toLowerCase()} ${
                test.excludedForUnit === 1 ? "result" : "results"
              } on file are recorded in a unit other than ${test.unit}, so none can be used for clinic-level analysis. Each is kept as reported on the patient's own record.`
            : `No ${test.name.toLowerCase()} results are available for clinic-level analysis.`
        }
      />
    </Card>
  );
}

/**
 * A reference limit at the measure's own precision.
 *
 * HbA1c'''s floor is stored as 4.0 and renders as "4" untouched, beside a
 * histogram axis that labels the same edge "4.0". A reader should not have to
 * decide which of two spellings of one number to trust.
 */
function limit(value: number, test: TestInsight): string {
  return `${value.toFixed(DISPLAY_DECIMALS[test.testCode] ?? 1)} ${test.unit}`;
}

function refRange(test: TestInsight): string {
  const decimals = DISPLAY_DECIMALS[test.testCode] ?? 1;

  return `${test.refLow.toFixed(decimals)}–${test.refHigh.toFixed(decimals)} ${test.unit}`;
}

/** "June 2026" — what a monthly point actually covers. */
function monthLabel(t: number): string {
  // UTC, like every other date formatter here: the month key is built from UTC
  // parts, and a local formatter would render 1 July as June west of Greenwich
  // and file the point under the wrong month name.
  return new Date(t).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The trend card's caption, and the two things it has to say.
 *
 * **What the number is.** "Mean of every result collected each month" was both
 * the old wording and the old calculation; it is now a mean of each patient's
 * own monthly mean, and a caption that describes the previous arithmetic is
 * worse than none.
 *
 * **Where the reference band went.** The band is drawn as a wash behind the
 * line, but only where it falls inside the plotted domain. For HbA1c and
 * systolic pressure on this register every monthly figure is above the ceiling,
 * so the band sits entirely below the y-axis and is not drawn at all. The chart
 * is not wrong; it is silent, and a reader seeing a line trending downward
 * could reasonably conclude the clinic is in range when nothing in it is. Where
 * the visual channel has nothing to show, the caption says it in words.
 */
function describeTrend(test: TestPanel): string {
  if (test.trend.length === 0) return "No results collected yet.";

  const base =
    test.trend.length < 2
      ? "Monthly clinic average, giving each patient equal weight within the month. One month of data so far — the trend fills in as results arrive."
      : `Monthly clinic average across ${test.trend.length} months, giving each patient equal weight within the month.`;

  const allAbove = test.trend.every((p) => p.mean > test.refHigh);

  return allAbove
    ? `${base} Every month sits above the reference ceiling of ${limit(test.refHigh, test)}, so the reference band is off the bottom of this chart.`
    : base;
}

/**
 * The clinically actionable sentence: how many patients are out of range now.
 *
 * Each patient counted once, at their latest reading. Below-range is stated
 * whenever it is not zero — for glucose that is hypoglycaemia, which the
 * previous wording could not distinguish from a clinic in range.
 */
function describeLatest(test: TestInsight): string {
  if (test.patientCount === 0) return "";

  const median =
    test.medianLatest === null
      ? ""
      : `Median latest ${test.medianLatest} ${test.unit}. `;

  const n = test.patientCount;

  if (test.aboveRangeCount === 0 && test.belowRangeCount === 0) {
    return `${median}Every patient's latest reading is within range.`;
  }

  const parts: string[] = [];
  if (test.aboveRangeCount > 0) parts.push(`${test.aboveRangeCount} above`);
  if (test.belowRangeCount > 0) parts.push(`${test.belowRangeCount} below`);

  return `${median}Of ${n} ${n === 1 ? "patient" : "patients"} on their latest reading: ${parts.join(", ")} range.`;
}

/**
 * The histogram's accessible description.
 *
 * It carries the counts, not just the subject, because the marks themselves are
 * unreadable to a screen reader and "a bar chart of glucose" tells that reader
 * nothing they could act on.
 */
function distributionLabel(test: TestInsight): string {
  return [
    `Distribution of ${test.name} results in ${test.unit}`,
    `${test.resultCount} results from ${test.patientCount} patients`,
    `reference range ${refRange(test)}`,
    `on their latest reading, ${test.withinRangeCount} of ${test.patientCount} patients are within range, ${test.aboveRangeCount} above and ${test.belowRangeCount} below`,
  ].join(", ");
}

function trendLabel(test: TestPanel): string {
  const latest = test.trend[test.trend.length - 1];

  return [
    `Monthly clinic average ${test.name} in ${test.unit}, each patient weighted equally within the month`,
    `${test.trend.length} ${test.trend.length === 1 ? "month" : "months"}`,
    latest
      ? `latest ${monthLabel(latest.t)} at ${latest.mean} ${test.unit} from ${latest.patientCount} ${latest.patientCount === 1 ? "patient" : "patients"}`
      : "no months with data",
  ].join(", ");
}

export function LabVolume({ points }: { points: VolumePoint[] }) {
  const total = points.reduce((sum, p) => sum + p.total, 0);
  const quiet = points.filter((p) => p.total === 0).length;

  return (
    <Card>
      <CardHeader
        title="Results collected by month"
        description={
          points.length === 0
            ? "How much lab data is arriving, and when."
            : `${total} results across ${points.length} months${
                quiet > 0
                  ? `, including ${quiet} with nothing collected`
                  : ", every month covered"
              }.`
        }
      />
      {points.length === 0 ? (
        <EmptyState
          title="Nothing imported yet"
          description="Once lab results are on file this shows how much data is arriving each month, and where the gaps are."
        />
      ) : (
        <div className="px-2 pt-2 pb-4">
          <VolumeChart
            points={points}
            label={`Lab results collected per month, ${total} results across ${points.length} months`}
          />
        </div>
      )}
    </Card>
  );
}
