import { DSMA8 } from "@/lib/assessments/definition";

/**
 * Clinic-level metrics, as pure functions.
 *
 * These are three small calculations with three well-known ways to get them
 * subtly wrong, which is exactly why they are here rather than inline in the
 * page:
 *
 *   - a completion rate that divides by zero and renders a confident "0%"
 *     when the truth is "nothing has been sent yet"
 *   - a risk distribution that counts *assessments* rather than *patients*,
 *     so one keen patient with four completed questionnaires appears four
 *     times and the clinic looks four times sicker than it is
 *   - a distribution that silently drops the patients who have no assessment,
 *     so the segments sum to less than the register and no one notices
 *
 * All three are testable at a boundary because nothing here touches the
 * database.
 */

/* ------------------------------------------------------- completion rate -- */

export interface CompletionRate {
  sent: number;
  completed: number;
  /**
   * Completed ÷ sent, or `null` when nothing has been sent.
   *
   * `null` rather than 0 (D-DASH-2). A clinic that has sent nothing has no
   * completion rate — rendering "0%" states a fact that is not in evidence and
   * reads as a failing practice rather than a new one. The UI shows an em dash.
   */
  rate: number | null;
}

/**
 * Counted over all assessments ever sent, not a rolling window (D-DASH-2).
 *
 * An expired assessment stays in the denominator deliberately: it was sent and
 * it was not completed, which is precisely what this number is meant to
 * measure. Excluding expiries would flatter the clinic by discarding its
 * failures.
 */
export function completionRate(sent: number, completed: number): CompletionRate {
  if (sent <= 0) return { sent: 0, completed: 0, rate: null };

  return { sent, completed, rate: completed / sent };
}

/** `0.6667` -> `"67%"`, and `null` -> `"—"`. */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/* --------------------------------------------------- risk distribution --- */

/** The label used for patients who have never completed an assessment. */
export const NO_ASSESSMENT = "No assessment";

export interface RiskSegment {
  label: string;
  count: number;
  /** Share of all patients, 0–1. Zero when there are no patients at all. */
  share: number;
}

/**
 * One entry per patient: the risk band of their most recent *completed*
 * assessment, or null if they have never completed one.
 */
export interface PatientRisk {
  riskBand: string | null;
}

/**
 * Patients per risk band, each patient counted exactly once (D-DASH-3).
 *
 * Bands come from the official questionnaire definition and are returned in
 * severity order — including bands with a count of zero, because a distribution
 * that hides its empty bands changes shape as data arrives and stops being
 * comparable between two glances at it.
 *
 * "No assessment" is a segment of its own rather than an omission. Those
 * patients are the clinic's actual blind spot, and leaving them out would make
 * the segments sum to less than the register with nothing to explain the gap.
 */
export function riskDistribution(patients: PatientRisk[]): RiskSegment[] {
  const counts = new Map<string, number>();

  for (const band of DSMA8.scoring.bands) counts.set(band.label, 0);
  counts.set(NO_ASSESSMENT, 0);

  for (const patient of patients) {
    // A band label we do not recognise (an older questionnaire version, say)
    // is counted as "no assessment" rather than silently dropped, so the
    // segments always sum to the number of patients.
    const key =
      patient.riskBand && counts.has(patient.riskBand)
        ? patient.riskBand
        : NO_ASSESSMENT;

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = patients.length;

  return [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    share: total > 0 ? count / total : 0,
  }));
}

/** Maps a band label to the UI tone, so the chart and the badges agree. */
export function segmentTone(
  label: string,
): "low" | "moderate" | "high" | "critical" | "neutral" {
  switch (label) {
    case "Low risk":
      return "low";
    case "Moderate risk":
      return "moderate";
    case "High risk":
      return "high";
    case "Very high risk":
      return "critical";
    default:
      return "neutral";
  }
}

/**
 * Patients whose latest completed assessment put them in the top two bands.
 *
 * The number a clinician acts on, as opposed to the number that describes the
 * register. It reads from the same segments the distribution chart draws, so
 * the tile and the chart can never disagree — and it counts each patient once,
 * because `riskDistribution` already did (D-DASH-3).
 *
 * Bands with no patients are still present as segments with a count of zero,
 * so this is a sum over a filter rather than a lookup that can miss.
 */
export function higherRiskCount(segments: RiskSegment[]): number {
  return segments
    .filter((s) => {
      const tone = segmentTone(s.label);
      return tone === "high" || tone === "critical";
    })
    .reduce((total, s) => total + s.count, 0);
}

/* ------------------------------------------------------- upload window --- */

/**
 * The date-range filter on the clinic view's recent uploads.
 *
 * A closed set of windows rather than two free date inputs, deliberately: a
 * clinician asking "what came in lately" wants one click, and two date pickers
 * introduce a whole class of invalid states — end before start, a future start,
 * a range spanning nothing — for a question nobody actually asks that precisely.
 *
 * Parsing lives here, and is total: an absent, unknown or hand-edited value
 * resolves to the default rather than throwing or querying on NaN.
 */
export const UPLOAD_WINDOWS = [
  { key: "7", days: 7, label: "7 days" },
  { key: "30", days: 30, label: "30 days" },
  { key: "90", days: 90, label: "90 days" },
  { key: "all", days: null, label: "All time" },
] as const;

export type UploadWindowKey = (typeof UPLOAD_WINDOWS)[number]["key"];

export interface UploadWindow {
  key: UploadWindowKey;
  days: number | null;
  label: string;
  /** The cutoff to query from, or null for all time. */
  since: Date | null;
}

export const DEFAULT_UPLOAD_WINDOW: UploadWindowKey = "30";

export function parseUploadWindow(
  raw: string | undefined,
  now: Date = new Date(),
): UploadWindow {
  const match =
    UPLOAD_WINDOWS.find((w) => w.key === raw) ??
    UPLOAD_WINDOWS.find((w) => w.key === DEFAULT_UPLOAD_WINDOW)!;

  return {
    key: match.key,
    days: match.days,
    label: match.label,
    since:
      match.days === null
        ? null
        : new Date(now.getTime() - match.days * 86_400_000),
  };
}
