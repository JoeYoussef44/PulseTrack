import { describe, expect, it } from "vitest";

import { DSMA8, QUESTION_IDS, SCORE_MAX } from "@/lib/assessments/definition";
import {
  MAX_ITEM_SCORE,
  itemShare,
  reviewAssessment,
} from "@/lib/assessments/review";
import { displayStatus, statusPresentation } from "@/lib/assessments/status";
import { CONSOLE_PROVIDER, wasEmailed } from "@/lib/email/delivery";
import { AssessmentStatus } from "@/lib/generated/prisma/enums";
import { ITEM_WEIGHTS, distributeScore } from "@/prisma/demo-answers";

/* --------------------------------------------------------------- review -- */

/** A complete answer set: q1 = 3, q2 = 3, the rest 0. Totals 6. */
const SIX: Array<{ questionId: string; score: number }> = [
  { questionId: "q1", score: 3 },
  { questionId: "q2", score: 3 },
  ...QUESTION_IDS.slice(2).map((questionId) => ({ questionId, score: 0 })),
];

describe("reviewAssessment", () => {
  it("returns every item in presentation order, answered or not", () => {
    const review = reviewAssessment([]);

    expect(review.items).toHaveLength(DSMA8.items.length);
    expect(review.items.map((i) => i.id)).toEqual([...QUESTION_IDS]);
    expect(review.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(review.items.every((i) => i.score === null)).toBe(true);
  });

  it("labels each answer with the option the patient actually chose", () => {
    const review = reviewAssessment(SIX);
    const first = review.items[0];

    expect(first.score).toBe(3);
    expect(first.answerLabel).toBe(
      DSMA8.options.find((o) => o.value === 3)!.label,
    );

    // 0 is a real answer with a real label, not an absence.
    expect(review.items[2].score).toBe(0);
    expect(review.items[2].answerLabel).toBe(
      DSMA8.options.find((o) => o.value === 0)!.label,
    );
  });

  it("recomputes the total from the answers rather than trusting the stored one", () => {
    const review = reviewAssessment(SIX, 6);

    expect(review.computedTotal).toBe(6);
    expect(review.answeredCount).toBe(8);
    expect(review.totalMismatch).toBe(false);
  });

  it("flags a stored total that disagrees with the answers on file", () => {
    const review = reviewAssessment(SIX, 11);

    expect(review.computedTotal).toBe(6);
    expect(review.totalMismatch).toBe(true);
  });

  it("does not claim a mismatch when there is no stored total to compare", () => {
    expect(reviewAssessment(SIX).totalMismatch).toBe(false);
    expect(reviewAssessment([], 11).totalMismatch).toBe(false);
  });

  it("reports a partial answer set as a gap, not as a complete one", () => {
    const review = reviewAssessment(SIX.slice(0, 5), 6);

    expect(review.answeredCount).toBe(5);
    expect(review.itemCount).toBe(8);
    expect(review.items[5].score).toBeNull();
    expect(review.items[5].answerLabel).toBeNull();
    // Only the answers that exist are summed — the gap is not read as zero.
    expect(review.computedTotal).toBe(6);
  });

  it("returns null rather than 0 for a total when nothing was answered", () => {
    // 0 is a valid score meaning "answered, perfectly" — the opposite fact.
    expect(reviewAssessment([]).computedTotal).toBeNull();
  });

  it("surfaces answers belonging to a different questionnaire instead of dropping them", () => {
    const review = reviewAssessment([
      ...SIX,
      { questionId: "q9", score: 3 },
      { questionId: "legacy-1", score: 1 },
    ]);

    expect(review.unknownAnswerIds).toEqual(["q9", "legacy-1"]);
    expect(review.items).toHaveLength(8);
    // The stray values must not silently inflate the total.
    expect(review.computedTotal).toBe(6);
  });

  it("renders a value outside the option set as a number with no label", () => {
    const review = reviewAssessment([{ questionId: "q1", score: 9 }]);

    expect(review.items[0].score).toBe(9);
    expect(review.items[0].answerLabel).toBeNull();
  });
});

describe("itemShare", () => {
  it("reads its denominator from the option set", () => {
    expect(MAX_ITEM_SCORE).toBe(Math.max(...DSMA8.options.map((o) => o.value)));
  });

  it("maps the scale ends to 0 and 1, and an unanswered item to 0", () => {
    expect(itemShare(0)).toBe(0);
    expect(itemShare(MAX_ITEM_SCORE)).toBe(1);
    expect(itemShare(null)).toBe(0);
  });
});

/* --------------------------------------------------------------- status -- */

const AT = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("displayStatus", () => {
  it("derives expiry from the timestamp, without a background sweep", () => {
    const sent = {
      status: AssessmentStatus.SENT,
      expiresAt: AT("2026-06-01"),
    };

    expect(displayStatus(sent, AT("2026-05-30"))).toBe(AssessmentStatus.SENT);
    expect(displayStatus(sent, AT("2026-06-02"))).toBe(AssessmentStatus.EXPIRED);
  });

  it("never reopens a completed assessment, whatever the expiry says", () => {
    const completed = {
      status: AssessmentStatus.COMPLETED,
      expiresAt: AT("2026-06-01"),
    };

    expect(displayStatus(completed, AT("2026-09-01"))).toBe(
      AssessmentStatus.COMPLETED,
    );
  });
});

describe("statusPresentation", () => {
  it("does not say an invitation is awaited when none was ever delivered", () => {
    expect(statusPresentation(AssessmentStatus.SENT, null).label).toBe(
      "Not emailed",
    );
  });

  it("says an invitation is awaited only once one was delivered", () => {
    expect(
      statusPresentation(AssessmentStatus.SENT, AT("2026-08-26")).label,
    ).toBe("Awaiting reply");
  });

  it("drops the delivery distinction once the question has been settled", () => {
    for (const status of [
      AssessmentStatus.COMPLETED,
      AssessmentStatus.EXPIRED,
    ]) {
      expect(statusPresentation(status, null)).toEqual(
        statusPresentation(status, AT("2026-08-26")),
      );
    }
  });
});

/* ------------------------------------------------------------- delivery -- */

describe("wasEmailed", () => {
  it("counts a real provider's acceptance", () => {
    expect(wasEmailed({ delivered: true, provider: "resend" })).toBe(true);
  });

  it("does not count the console adapter, which contacts nobody", () => {
    // It reports delivered so the flow works with no mail configuration at
    // all — the right answer to its own question, and the wrong thing to write
    // into a column a clinician reads as "the patient has this".
    expect(wasEmailed({ delivered: true, provider: CONSOLE_PROVIDER })).toBe(
      false,
    );
  });

  it("does not count a failed send", () => {
    expect(wasEmailed({ delivered: false, provider: "resend" })).toBe(false);
  });
});

/* -------------------------------------------------------- demo answers --- */

describe("distributeScore", () => {
  it("has one weight per questionnaire item", () => {
    expect(ITEM_WEIGHTS).toHaveLength(QUESTION_IDS.length);
  });

  it("sums to the requested total at every score in range", () => {
    for (let total = 0; total <= SCORE_MAX; total += 1) {
      const scores = distributeScore(total);

      expect(scores).toHaveLength(QUESTION_IDS.length);
      expect(scores.reduce((sum, s) => sum + s, 0)).toBe(total);
    }
  });

  it("keeps every item inside the option set at every score in range", () => {
    const valid = new Set(DSMA8.options.map((o) => o.value));

    for (let total = 0; total <= SCORE_MAX; total += 1) {
      for (const score of distributeScore(total)) {
        expect(valid.has(score)).toBe(true);
      }
    }
  });

  it("saturates rather than looping when the total fills every item", () => {
    expect(distributeScore(SCORE_MAX)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    // Above the ceiling is not reachable through the app, but must terminate.
    expect(distributeScore(SCORE_MAX + 5)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(distributeScore(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(distributeScore(-1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("is deterministic, which is what keeps the seed idempotent", () => {
    expect(distributeScore(13)).toEqual(distributeScore(13));
  });

  it("follows the item profile rather than filling the first items first", () => {
    const scores = distributeScore(13);

    // The old greedy fill produced [3,3,3,3,1,0,0,0] for 13: every unit went
    // to the earliest items and the last three were always zero. The point of
    // the rewrite is that the shape now comes from the weights.
    const heaviest = ITEM_WEIGHTS.indexOf(Math.max(...ITEM_WEIGHTS));
    const lightest = ITEM_WEIGHTS.indexOf(Math.min(...ITEM_WEIGHTS));

    expect(scores[heaviest]).toBeGreaterThan(scores[lightest]);
    expect(scores[scores.length - 1]).toBeGreaterThan(0);
  });

  it("still splits a total when every weight is zero", () => {
    const scores = distributeScore(8, [0, 0, 0, 0, 0, 0, 0, 0]);

    expect(scores.reduce((sum, s) => sum + s, 0)).toBe(8);
    expect(scores.every((s) => s >= 0 && s <= 3)).toBe(true);
  });
});
