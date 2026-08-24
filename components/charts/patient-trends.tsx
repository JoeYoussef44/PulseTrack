import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { SCORE_MAX, SCORE_MIN } from "@/lib/assessments/definition";

import type { LabSeries, ScorePoint } from "@/lib/labs/series";

/**
 * The patient's trends, as small multiples.
 *
 * One card per measure rather than one chart with several lines. Glucose,
 * HbA1c and systolic pressure have no common scale, so a shared plot would need
 * two y-axes — and the alignment between two y-axes is arbitrary, which makes
 * the chart assert a relationship the data does not contain.
 *
 * Every chart here has a table twin further down the page, so no value is
 * reachable only by hovering.
 */

export function LabTrends({ series }: { series: LabSeries[] }) {
  if (series.length === 0) {
    return (
      <Card>
        <CardHeader title="Lab trends" />
        <EmptyState
          title="No lab results yet"
          description="Import a CSV of lab results and this patient's glucose, HbA1c and blood pressure trends will appear here."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {series.map((s) => {
        const latest = s.points[s.points.length - 1];
        const banded = s.refLow != null && s.refHigh != null;
        const outOfRange =
          banded && (latest.value < s.refLow! || latest.value > s.refHigh!);

        return (
          <Card key={s.testCode}>
            <CardHeader
              title={`${s.name} (${s.unit})`}
              description={
                banded
                  ? `Reference range ${s.refLow}–${s.refHigh} ${s.unit}. Latest ${latest.value} on ${latest.date}${outOfRange ? " — outside range" : ""}.`
                  : `Latest ${latest.value} ${s.unit} on ${latest.date}.`
              }
            />
            <div className="px-2 pt-2 pb-4">
              <TrendChart
                points={s.points}
                unit={s.unit}
                refLow={s.refLow}
                refHigh={s.refHigh}
                label={`${s.name} trend, ${s.points.length} ${
                  s.points.length === 1 ? "reading" : "readings"
                }, latest ${latest.value} ${s.unit} on ${latest.date}`}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function ScoreTrend({ points }: { points: ScorePoint[] }) {
  if (points.length === 0) {
    return (
      <Card>
        <CardHeader
          title="DSMA-8 score history"
          description="Completed assessments only."
        />
        <EmptyState
          title="No completed assessments"
          description="Once this patient completes a DSMA-8 questionnaire their score will be plotted here over time."
        />
      </Card>
    );
  }

  const latest = points[points.length - 1];

  return (
    <Card>
      <CardHeader
        title={`DSMA-8 score history (0–${SCORE_MAX})`}
        description={`Higher is worse. Latest ${latest.score}${
          latest.band ? ` — ${latest.band.toLowerCase()}` : ""
        } on ${latest.date}.`}
      />
      <div className="px-2 pt-2 pb-4">
        <TrendChart
          // Fixed to the questionnaire's full range, not to the data. An
          // auto-domain would rescale between visits and make a two-point
          // improvement look like a collapse.
          domain={[SCORE_MIN, SCORE_MAX]}
          points={points.map((p) => ({ t: p.t, value: p.score, date: p.date }))}
          unit={`/ ${SCORE_MAX}`}
          label={`DSMA-8 score history, ${points.length} completed ${
            points.length === 1 ? "assessment" : "assessments"
          }, latest ${latest.score} out of ${SCORE_MAX} on ${latest.date}`}
        />
      </div>
    </Card>
  );
}
