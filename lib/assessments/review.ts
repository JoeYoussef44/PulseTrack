import {
  DSMA8,
  QUESTION_IDS,
  SCORE_MAX,
  type QuestionnaireOption,
} from "./definition";

/**
 * Turning stored answers back into something a clinician can read.
 *
 * A completed assessment is persisted as eight `(questionId, score)` rows plus
 * a total. That is the right storage shape and the wrong reading shape: `q6: 2`
 * tells a nurse nothing. This module rejoins those rows to the questionnaire
 * definition — the item text and the option label the patient actually chose —
 * so the review page renders what the patient saw, not what the database holds.
 *
 * Pure, and separate from `service.ts`, for two reasons. It has no I/O, so it is
 * testable at a boundary. And `service.ts` carries `server-only`, which this
 * does not need.
 *
 * ## It recomputes the total rather than trusting the stored one
 *
 * The submit path already recomputes the score from the submitted answers and
 * ignores anything the browser sends. This does the same thing again at read
 * time, from the rows on file, and reports a disagreement rather than papering
 * over it.
 *
 * That is not paranoia about our own writes. The stored total and the stored
 * answers are two records of one fact, written in one transaction today — but a
 * backfill, a questionnaire version change or a hand-edited row can separate
 * them, and the failure mode is silent: the header says 11 and the eight rows
 * below it add to 14, and nobody adds them up. A clinical record that disagrees
 * with itself should say so on its own page.
 */

const OPTION_BY_VALUE = new Map<number, QuestionnaireOption>(
  DSMA8.options.map((option) => [option.value, option]),
);

/** One questionnaire item with whatever the patient answered for it. */
export interface ReviewedItem {
  id: string;
  /** 1-based, matching the numbering the patient saw on the form. */
  position: number;
  text: string;
  /** Null when this item has no stored answer. */
  score: number | null;
  /** "More than half the days" — null when unanswered or the value is unknown. */
  answerLabel: string | null;
}

export interface AssessmentReview {
  items: ReviewedItem[];
  answeredCount: number;
  itemCount: number;
  /**
   * The sum of the stored answers, or null when nothing has been answered.
   *
   * Null rather than 0, for the same reason `completionRate` returns null: an
   * unanswered questionnaire has no score, and 0 is a valid score that means
   * "answered, perfectly" — the opposite thing.
   */
  computedTotal: number | null;
  /** The maximum this instrument can score, so the page need not know it. */
  maxTotal: number;
  /**
   * True when a stored total was supplied and disagrees with the answers.
   * False when there is no stored total to compare against.
   */
  totalMismatch: boolean;
  /**
   * Stored answers whose question id is not part of this questionnaire.
   *
   * Surfaced rather than dropped. An id we do not recognise means the row was
   * written against a different instrument or version, and silently ignoring it
   * would show a clinician a partial record as if it were the whole one.
   */
  unknownAnswerIds: string[];
}

/** The shape this module needs from a stored answer row. */
export interface StoredAnswer {
  questionId: string;
  score: number;
}

/**
 * Rejoins stored answers to the questionnaire, in presentation order.
 *
 * Every item appears, answered or not: an assessment missing q5 must render as
 * seven answers and a gap, not as seven answers.
 */
export function reviewAssessment(
  answers: StoredAnswer[],
  storedTotal: number | null = null,
): AssessmentReview {
  const byQuestion = new Map<string, number>();
  const unknownAnswerIds: string[] = [];

  for (const answer of answers) {
    if (QUESTION_IDS.includes(answer.questionId)) {
      byQuestion.set(answer.questionId, answer.score);
    } else {
      unknownAnswerIds.push(answer.questionId);
    }
  }

  const items: ReviewedItem[] = DSMA8.items.map((item, index) => {
    const score = byQuestion.get(item.id);

    return {
      id: item.id,
      position: index + 1,
      text: item.text,
      score: score ?? null,
      // A stored value outside the option set gets no label rather than a
      // wrong one. The number still renders, so the anomaly stays visible.
      answerLabel:
        score === undefined ? null : (OPTION_BY_VALUE.get(score)?.label ?? null),
    };
  });

  const answeredCount = items.filter((i) => i.score !== null).length;

  const computedTotal =
    answeredCount === 0
      ? null
      : items.reduce((sum, item) => sum + (item.score ?? 0), 0);

  return {
    items,
    answeredCount,
    itemCount: items.length,
    computedTotal,
    maxTotal: SCORE_MAX,
    totalMismatch:
      storedTotal !== null &&
      computedTotal !== null &&
      storedTotal !== computedTotal,
    unknownAnswerIds,
  };
}

/**
 * The share of the maximum an item's answer represents, 0–1.
 *
 * Used to draw the bar beside each answer. Every item on this instrument has
 * the same 0–3 range, so one denominator is correct for all eight — but it is
 * read from the option set rather than written as `3`, so a future instrument
 * with a different scale does not silently draw bars that are all too short.
 */
export const MAX_ITEM_SCORE = Math.max(...DSMA8.options.map((o) => o.value));

export function itemShare(score: number | null): number {
  if (score === null || MAX_ITEM_SCORE <= 0) return 0;
  return score / MAX_ITEM_SCORE;
}
