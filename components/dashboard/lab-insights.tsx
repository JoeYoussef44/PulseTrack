import { DistributionChart } from "@/components/charts/distribution-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { Card, CardHeader, EmptyState } from "@/components/ui";

import type { MonthPoint, TestInsight, VolumePoint } from "@/lib/dashboard/insights";

/**
 * The three measures this clinic exists to move, at clinic scale.
 *
 * Each test gets two charts because it answers two different questions, and one
 * chart cannot answer both:
 *
 *  - **Where is the register now?** A histogram of every result on file, with
 *    the buckets above the reference ceiling in the alert tone.
 *  - **Which way is it going?** The clinic's monthly mean, on the same
 *    time-scaled trend chart the patient pages use, with the reference range
 *    shaded behind it.
 *
 * Never on one pair of axes. A count and a concentration share no scale, and
 * putting them together needs two y-axes whose alignment is arbitrary — which
 * makes the chart assert a relationship the data does not contain. That rule is
 * why the patient page has three charts instead of one, and it does not stop
 * applying because the numbers got bigger.
 *
 * The headline figure is the **median** of each patient's latest reading, not
 * the mean. One patient at 221 mg/dL drags a mean of eight readings up by
 * fifteen and makes the register look worse than any individual patient is.
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

  if (withData.length === 0) {
    return (
      <Card>
        <CardHeader title="Lab results across the clinic" />
        <EmptyState
          title="No lab results yet"
          description="Import a CSV or pull patient histories from the national platform, and the clinic's HbA1c, fasting glucose and blood pressure will be summarised here."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {excludedForUnit > 0 ? (
        <p className="text-xs text-muted">
          {excludedForUnit}{" "}
          {excludedForUnit === 1 ? "result is" : "results are"} recorded in a
          unit other than the test&rsquo;s standard one and{" "}
          {excludedForUnit === 1 ? "is" : "are"} left out of every figure on this
          page. They are kept exactly as reported on the patient&rsquo;s own
          record — averaging them in would be adding millimoles to milligrams.
        </p>
      ) : null}

      {tests.map((test) =>
        test.resultCount === 0 ? null : (
          <div
            key={test.testCode}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(28rem,100%),1fr))] gap-6"
          >
            <Card>
              <CardHeader
                title={`${test.name} — distribution`}
                description={`${test.resultCount} ${
                  test.resultCount === 1 ? "result" : "results"
                } on file. Reference range ${test.refLow}–${test.refHigh} ${test.unit}. ${describeLatest(test)}`}
              />
              <div className="px-2 pt-2 pb-4">
                <DistributionChart
                  buckets={test.buckets}
                  unit={test.unit}
                  label={`Distribution of ${test.name} results in ${test.unit}, ${test.resultCount} results, ${test.aboveRangeCount} of ${test.patientCount} patients above the reference range on their latest reading`}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`${test.name} — clinic monthly mean`}
                description={describeTrend(test)}
              />
              <div className="px-2 pt-2 pb-4">
                <TrendChart
                  points={test.trend.map((p) => ({
                    t: p.t,
                    value: p.mean,
                    date: p.month,
                  }))}
                  unit={test.unit}
                  refLow={test.refLow}
                  refHigh={test.refHigh}
                  label={`Clinic monthly mean ${test.name} in ${test.unit}, ${test.trend.length} months`}
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
 * The trend card's caption, and the reason it has to mention the range.
 *
 * The reference band is drawn as a wash behind the line — but only when it
 * falls inside the plotted domain. For HbA1c and systolic pressure on this
 * register every monthly mean is above the ceiling, so the band sits entirely
 * below the y-axis and is not drawn at all. The chart is not wrong; it is
 * silent, and a reader seeing a line trending downward could reasonably
 * conclude the clinic is in range when nothing in it is.
 *
 * So when the whole trend sits above the ceiling, the caption says so in words.
 * That is the case where the visual channel has nothing to show.
 */
function describeTrend(test: TestPanel): string {
  if (test.trend.length === 0) return "No results collected yet.";

  const base =
    test.trend.length < 2
      ? "One month of data so far. The trend fills in as results arrive."
      : `Mean of every result collected each month, across ${test.trend.length} months.`;

  const allAbove = test.trend.every((p) => p.mean > test.refHigh);

  return allAbove
    ? `${base} Every month sits above the reference ceiling of ${test.refHigh} ${test.unit}, so the reference band is off the bottom of this chart.`
    : base;
}

/** The clinically actionable sentence: how many patients are out of range now. */
function describeLatest(test: TestInsight): string {
  if (test.patientCount === 0) return "";

  const median =
    test.medianLatest === null ? "" : `Median latest ${test.medianLatest} ${test.unit}. `;

  return test.aboveRangeCount === 0
    ? `${median}No patient's latest reading is above range.`
    : `${median}${test.aboveRangeCount} of ${test.patientCount} patients are above range on their latest reading.`;
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
