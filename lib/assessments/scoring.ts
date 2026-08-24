import {
  DSMA8,
  OPTION_VALUES,
  QUESTION_IDS,
  type RiskBandDefinition,
} from "./definition";

/**
 * Pure scoring. No I/O, no framework, no database — so it is trivially
 * testable and can be called identically from the public submit route and
 * from any backfill.
 *
 * This function is the ONLY place a total score is produced. A score arriving
 * from the browser is never trusted: the submitted answers are validated and
 * re-summed here, because the resulting number becomes a clinical record.
 */

export type AnswerMap = Record<string, number>;

export class InvalidAnswersError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid questionnaire answers: ${issues.join("; ")}`);
    this.name = "InvalidAnswersError";
    this.issues = issues;
  }
}

export interface ScoredAssessment {
  totalScore: number;
  band: RiskBandDefinition;
}

/**
 * Validates a complete set of answers and returns the total and its risk band.
 * Throws InvalidAnswersError when anything is missing, unknown or out of range.
 */
export function scoreAssessment(answers: AnswerMap): ScoredAssessment {
  const issues = validateAnswers(answers);

  if (issues.length > 0) {
    throw new InvalidAnswersError(issues);
  }

  const totalScore = QUESTION_IDS.reduce((sum, id) => sum + answers[id], 0);

  return { totalScore, band: bandForScore(totalScore) };
}

/**
 * Returns a list of human-readable problems with the answer set. Empty means
 * valid. Collecting all issues rather than throwing on the first lets the form
 * highlight every unanswered question at once.
 */
export function validateAnswers(answers: AnswerMap): string[] {
  const issues: string[] = [];

  if (answers === null || typeof answers !== "object") {
    return ["No answers were submitted."];
  }

  // The definition says allItemsRequired: every one of q1..q8 must be present.
  for (const id of QUESTION_IDS) {
    const value = answers[id];

    if (value === undefined || value === null) {
      issues.push(`${id} is unanswered.`);
      continue;
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
      issues.push(`${id} must be a whole number.`);
      continue;
    }

    if (!OPTION_VALUES.includes(value)) {
      issues.push(
        `${id} must be one of ${OPTION_VALUES.join(", ")} (received ${value}).`,
      );
    }
  }

  // Reject unknown ids rather than silently ignoring them — a payload with
  // extra keys means the client and server disagree about the instrument.
  for (const id of Object.keys(answers)) {
    if (!QUESTION_IDS.includes(id)) {
      issues.push(`${id} is not part of this questionnaire.`);
    }
  }

  return issues;
}

/**
 * Maps a total to its band by reading the boundaries out of the official
 * definition, rather than hard-coding an if/else chain that could drift.
 */
export function bandForScore(totalScore: number): RiskBandDefinition {
  const band = DSMA8.scoring.bands.find(
    (b) => totalScore >= b.min && totalScore <= b.max,
  );

  if (!band) {
    throw new RangeError(
      `Score ${totalScore} falls outside every defined band (${DSMA8.scoring.min}-${DSMA8.scoring.max}).`,
    );
  }

  return band;
}
