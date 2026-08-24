import { describe, expect, it } from "vitest";

import { DSMA8, QUESTION_IDS } from "@/lib/assessments/definition";
import {
  InvalidAnswersError,
  bandForScore,
  scoreAssessment,
  validateAnswers,
} from "@/lib/assessments/scoring";

/** Build an answer set totalling exactly `target`, spread across the 8 items. */
function answersTotalling(target: number): Record<string, number> {
  const answers: Record<string, number> = {};
  let remaining = target;

  for (const id of QUESTION_IDS) {
    const value = Math.min(3, Math.max(0, remaining));
    answers[id] = value;
    remaining -= value;
  }

  return answers;
}

describe("DSMA-8 definition", () => {
  it("has exactly 8 items and 4 options", () => {
    expect(DSMA8.items).toHaveLength(8);
    expect(DSMA8.options).toHaveLength(4);
  });

  it("is internally consistent: 8 items x max option = declared max", () => {
    const maxOption = Math.max(...DSMA8.options.map((o) => o.value));
    expect(DSMA8.items.length * maxOption).toBe(DSMA8.scoring.max);
  });

  it("bands are contiguous and cover the whole range with no overlap", () => {
    const bands = [...DSMA8.scoring.bands].sort((a, b) => a.min - b.min);

    expect(bands[0].min).toBe(DSMA8.scoring.min);
    expect(bands[bands.length - 1].max).toBe(DSMA8.scoring.max);

    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].min).toBe(bands[i - 1].max + 1);
    }
  });

  it("assigns exactly one band to every possible total", () => {
    for (let score = DSMA8.scoring.min; score <= DSMA8.scoring.max; score += 1) {
      const matches = DSMA8.scoring.bands.filter(
        (b) => score >= b.min && score <= b.max,
      );
      expect(matches, `score ${score}`).toHaveLength(1);
    }
  });
});

describe("scoreAssessment - totals", () => {
  it("scores all-zero as 0", () => {
    expect(scoreAssessment(answersTotalling(0)).totalScore).toBe(0);
  });

  it("scores all-threes as 24", () => {
    const answers = Object.fromEntries(QUESTION_IDS.map((id) => [id, 3]));
    expect(scoreAssessment(answers).totalScore).toBe(24);
  });

  it("sums correctly for a mixed set", () => {
    const answers = { q1: 0, q2: 1, q3: 2, q4: 3, q5: 0, q6: 1, q7: 2, q8: 3 };
    expect(scoreAssessment(answers).totalScore).toBe(12);
  });
});

describe("scoreAssessment - band boundaries", () => {
  // The six numbers an evaluator will reach for first.
  const cases: Array<[number, string]> = [
    [0, "Low risk"],
    [6, "Low risk"],
    [7, "Moderate risk"],
    [12, "Moderate risk"],
    [13, "High risk"],
    [18, "High risk"],
    [19, "Very high risk"],
    [24, "Very high risk"],
  ];

  it.each(cases)("score %i falls in %s", (score, expectedLabel) => {
    const result = scoreAssessment(answersTotalling(score));
    expect(result.totalScore).toBe(score);
    expect(result.band.label).toBe(expectedLabel);
  });

  it("rejects a score outside the defined range", () => {
    expect(() => bandForScore(25)).toThrow(RangeError);
    expect(() => bandForScore(-1)).toThrow(RangeError);
  });
});

describe("validateAnswers", () => {
  it("accepts a complete, in-range set", () => {
    expect(validateAnswers(answersTotalling(10))).toEqual([]);
  });

  it("flags a missing item", () => {
    const answers = answersTotalling(10);
    delete answers.q5;

    const issues = validateAnswers(answers);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("q5");
  });

  it("flags every missing item at once, not just the first", () => {
    const answers = { q1: 1, q2: 1 };
    expect(validateAnswers(answers)).toHaveLength(6);
  });

  it("rejects a value above the option range", () => {
    const answers = { ...answersTotalling(0), q3: 4 };
    expect(validateAnswers(answers).join(" ")).toContain("q3");
  });

  it("rejects a negative value", () => {
    const answers = { ...answersTotalling(0), q3: -1 };
    expect(validateAnswers(answers).join(" ")).toContain("q3");
  });

  it("rejects a non-integer value", () => {
    const answers = { ...answersTotalling(0), q3: 1.5 };
    expect(validateAnswers(answers).join(" ")).toContain("whole number");
  });

  it("rejects an unknown question id", () => {
    const answers = { ...answersTotalling(0), q9: 1 };
    expect(validateAnswers(answers).join(" ")).toContain("q9");
  });

  it("throws InvalidAnswersError from scoreAssessment on bad input", () => {
    expect(() => scoreAssessment({ q1: 1 })).toThrow(InvalidAnswersError);
  });
});
