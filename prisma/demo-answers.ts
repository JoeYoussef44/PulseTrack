/**
 * How a seeded total is spread across the eight DSMA-8 items.
 *
 * This is demo-data generation, not product logic — which is why it lives in
 * `prisma/` beside the seed rather than in `lib/`. It is nonetheless a pure,
 * tested function, because the previous version was neither and it quietly
 * falsified a chart.
 *
 * ## What was wrong with the old one
 *
 * The seed used to fill greedily: take the total, put 3 in q1, 3 in q2, and
 * keep going until it ran out. A stored total of 17 therefore became
 * `[3,3,3,3,3,2,0,0]` — every time, for every patient.
 *
 * That is invisible while the only thing anyone reads is the total, which was
 * true until the clinic overview grew a per-question breakdown. Then it is not
 * invisible at all: it draws a staircase, and the staircase is an artefact of a
 * `for` loop rather than anything about diabetes. A clinician reading it would
 * conclude the practice is failing at medication adherence and flawless at foot
 * checks, when the data says nothing of the kind.
 *
 * ## What replaces it
 *
 * Each item carries a weight — how commonly it is reported on a real
 * self-management questionnaire — and the total is apportioned across those
 * weights by largest remainder, the same method used to allocate seats to votes.
 *
 * The weights are deliberately *stable across patients*. Randomising them per
 * assessment would produce a flat breakdown, which is just as fictional and
 * less useful: a clinic does have a shape, and "we are worst at foot checks and
 * diet" is the kind of thing the chart exists to show. Variation between
 * patients comes from their different totals, which is where it should come
 * from.
 *
 * None of this makes the data real. It makes it *shaped like* data, so a chart
 * drawn from it demonstrates the chart rather than the loop that filled it.
 */

/** Highest value any single item can take, from the questionnaire's options. */
const MAX_ITEM = 3;

/**
 * Relative likelihood of each item being reported, q1 … q8.
 *
 * Ordered to match `QUESTION_IDS`. The profile: dietary lapses, inactivity and
 * skipped foot checks are the commonly reported ones; hypoglycaemic episodes
 * are the rarest. Fabricated, like the instrument itself, but plausible — and
 * consistent, so the breakdown means the same thing on every read.
 */
export const ITEM_WEIGHTS: readonly number[] = [
  1.0, // q1  missed a medication dose
  1.3, // q2  did not check glucose
  1.6, // q3  ate badly for glucose control
  0.8, // q4  thirst / urination
  0.5, // q5  hypoglycaemic symptoms
  1.5, // q6  no physical activity
  1.8, // q7  did not check feet
  1.0, // q8  overwhelmed or discouraged
];

/**
 * Splits `total` across `weights.length` items, each 0…3, summing exactly.
 *
 * Deterministic — same inputs, same output — which is what keeps the seed
 * idempotent. Largest-remainder apportionment: floor every proportional share,
 * then hand out what is left over to the largest fractional parts first,
 * skipping any item already at its cap.
 *
 * Both saturating ends are handled rather than assumed. A total at or above the
 * maximum returns every item capped; a total of zero or less returns zeros.
 * Without the cap check the redistribution loop would spin looking for somewhere
 * to put a unit that has nowhere to go.
 */
export function distributeScore(
  total: number,
  weights: readonly number[] = ITEM_WEIGHTS,
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const ceiling = n * MAX_ITEM;
  if (total >= ceiling) return Array.from({ length: n }, () => MAX_ITEM);
  if (total <= 0) return Array.from({ length: n }, () => 0);

  const weightSum = weights.reduce((sum, w) => sum + Math.max(w, 0), 0);
  // A degenerate weight set must still produce a valid split rather than NaN.
  const shares =
    weightSum > 0
      ? weights.map((w) => (total * Math.max(w, 0)) / weightSum)
      : weights.map(() => total / n);

  const scores = shares.map((share) => Math.min(Math.floor(share), MAX_ITEM));

  // Largest fractional part first; index order breaks ties, so the result does
  // not depend on the sort's stability.
  const byRemainder = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .map((entry) => entry.index);

  let remaining = total - scores.reduce((sum, s) => sum + s, 0);

  while (remaining > 0) {
    let placed = false;

    for (const index of byRemainder) {
      if (remaining === 0) break;
      if (scores[index] < MAX_ITEM) {
        scores[index] += 1;
        remaining -= 1;
        placed = true;
      }
    }

    // Unreachable while total < ceiling, and a guard rather than a comment
    // because the alternative to being wrong here is an infinite loop.
    if (!placed) break;
  }

  return scores;
}
