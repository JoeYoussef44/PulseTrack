import definition from "./dsma8.json";

/**
 * The DSMA-8 definition is loaded from a verbatim copy of the official
 * `questionnaire-dsma8.json` supplied with the challenge. Item text, option
 * labels, score values and band boundaries are never retyped into TypeScript
 * literals — a copy that drifts from the source is exactly the kind of defect
 * this challenge is looking for. `tests/questionnaire-definition.test.ts`
 * asserts the copy still matches the original byte for byte.
 */

export interface QuestionnaireOption {
  value: number;
  label: string;
}

export interface QuestionnaireItem {
  id: string;
  text: string;
}

export interface RiskBandDefinition {
  min: number;
  max: number;
  label: string;
  color: string;
  guidance: string;
}

export interface QuestionnaireDefinition {
  id: string;
  version: string;
  title: string;
  instructions: string;
  options: QuestionnaireOption[];
  items: QuestionnaireItem[];
  scoring: {
    method: string;
    min: number;
    max: number;
    allItemsRequired: boolean;
    bands: RiskBandDefinition[];
  };
  notes: string;
}

export const DSMA8: QuestionnaireDefinition =
  definition as QuestionnaireDefinition;

export const QUESTIONNAIRE_ID = DSMA8.id;
export const QUESTIONNAIRE_VERSION = DSMA8.version;

/** The eight question ids, in presentation order: q1 … q8. */
export const QUESTION_IDS: readonly string[] = DSMA8.items.map((i) => i.id);

/** The permitted answer values: 0, 1, 2, 3. */
export const OPTION_VALUES: readonly number[] = DSMA8.options.map(
  (o) => o.value,
);

export const SCORE_MIN = DSMA8.scoring.min;
export const SCORE_MAX = DSMA8.scoring.max;

/** Links expire 7 days after being sent (candidate brief, Tier 1 §3). */
export const ASSESSMENT_TTL_DAYS = 7;
