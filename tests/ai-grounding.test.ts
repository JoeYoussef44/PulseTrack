import { describe, expect, it } from "vitest";

import {
  ageInYears,
  buildPatientFacts,
  hasEnoughData,
  type AssessmentFactRow,
  type FactInput,
  type LabFactRow,
} from "@/lib/ai/facts";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { allowedNumbers, verifySummary } from "@/lib/ai/verify";
import { Sex, TestCode } from "@/lib/generated/prisma/enums";

/**
 * The Tier 3 grounding design, tested where it can actually fail.
 *
 * Everything here is pure, and deliberately so: the three failure modes that
 * matter — arithmetic, the score-direction inversion, and a fabricated number
 * getting past the check — all live in code that never touches the network.
 * The provider call is the part with no interesting logic in it.
 */

const utc = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dec = (value: number) => ({ toString: () => String(value) });

function lab(
  date: string,
  testCode: TestCode,
  value: number,
  range: { low: number; high: number } | null = null,
): LabFactRow {
  return {
    collectedDate: utc(date),
    testCode,
    value: dec(value),
    // Blank, so the catalog unit is used — the same fallback the importer has.
    unit: "",
    refLow: range ? dec(range.low) : null,
    refHigh: range ? dec(range.high) : null,
  };
}

function assessment(date: string | null, score: number | null): AssessmentFactRow {
  return { completedAt: date === null ? null : utc(date), totalScore: score };
}

function facts(overrides: Partial<FactInput> = {}) {
  return buildPatientFacts({
    dateOfBirth: utc("1971-08-19"),
    sex: Sex.FEMALE,
    labs: [],
    assessments: [],
    now: utc("2026-03-20"),
    ...overrides,
  });
}

/* ================================================================= age ==== */

describe("ageInYears", () => {
  it("counts whole years", () => {
    expect(ageInYears(utc("1971-08-19"), utc("2026-03-20"))).toBe(54);
  });

  it("does not add the year until the birthday has passed", () => {
    expect(ageInYears(utc("1990-06-15"), utc("2026-06-14"))).toBe(35);
    expect(ageInYears(utc("1990-06-15"), utc("2026-06-15"))).toBe(36);
  });

  it("reads the birth date in UTC", () => {
    // dateOfBirth is @db.Date, stored at UTC midnight. Reading it with local
    // getters west of UTC lands on the previous day and ages someone a year
    // early on their birthday.
    expect(ageInYears(utc("2000-01-01"), utc("2026-01-01"))).toBe(26);
  });
});

/* ================================================================ labs ==== */

describe("lab facts", () => {
  it("orders readings by date whatever order they arrive in", () => {
    // The defect this prevents is a summary that reports every trend
    // backwards, in fluent prose, with real numbers.
    const shuffled = facts({
      labs: [
        lab("2026-03-14", TestCode.HBA1C, 7.1),
        lab("2026-01-10", TestCode.HBA1C, 6.8),
      ],
    });

    const hba1c = shuffled.labs[0];
    expect(hba1c.first.value).toBe(6.8);
    expect(hba1c.latest.value).toBe(7.1);
    expect(hba1c.direction).toBe("rising");
  });

  it("computes the change without floating-point noise", () => {
    // 7.1 - 6.8 is 0.30000000000000027 in IEEE 754. Unrounded, the model is
    // shown that, and a faithful "0.3" would then fail verification.
    const f = facts({
      labs: [
        lab("2026-01-10", TestCode.HBA1C, 6.8),
        lab("2026-03-14", TestCode.HBA1C, 7.1),
      ],
    });

    expect(f.labs[0].change).toBe(0.3);
  });

  it("measures the span between first and latest", () => {
    const f = facts({
      labs: [
        lab("2026-01-10", TestCode.HBA1C, 6.8),
        lab("2026-03-14", TestCode.HBA1C, 7.1),
      ],
    });

    expect(f.labs[0].spanDays).toBe(63);
  });

  it("falls back to the catalog range and unit", () => {
    const f = facts({ labs: [lab("2026-01-10", TestCode.HBA1C, 6.8)] });

    expect(f.labs[0].refLow).toBe(4);
    expect(f.labs[0].refHigh).toBe(5.6);
    expect(f.labs[0].unit).toBe("%");
  });

  it("prefers a range supplied with the reading", () => {
    const f = facts({
      labs: [lab("2026-01-10", TestCode.GLU_F, 105, { low: 70, high: 110 })],
    });

    expect(f.labs[0].latestStatus).toBe("within");
    expect(f.labs[0].outOfRangeCount).toBe(0);
  });

  it("counts every reading outside its range, not only the latest", () => {
    const f = facts({
      labs: [
        lab("2026-01-10", TestCode.GLU_F, 130),
        lab("2026-02-10", TestCode.GLU_F, 92),
        lab("2026-03-10", TestCode.GLU_F, 140),
      ],
    });

    expect(f.labs[0].outOfRangeCount).toBe(2);
    expect(f.labs[0].latestStatus).toBe("above");
  });

  it("reports a single reading as such rather than as no change", () => {
    // "unchanged" would be a claim about a trend that has not been observed.
    const f = facts({ labs: [lab("2026-01-10", TestCode.SBP, 128)] });

    expect(f.labs[0].direction).toBe("single-reading");
    expect(f.labs[0].change).toBeNull();
  });

  it("returns the tests in catalog order", () => {
    const f = facts({
      labs: [
        lab("2026-01-10", TestCode.SBP, 128),
        lab("2026-01-10", TestCode.HBA1C, 6.8),
        lab("2026-01-10", TestCode.GLU_F, 92),
      ],
    });

    expect(f.labs.map((l) => l.testCode)).toEqual([
      TestCode.GLU_F,
      TestCode.HBA1C,
      TestCode.SBP,
    ]);
  });
});

/* ========================================================= assessments ==== */

describe("assessment facts", () => {
  it("treats a RISING DSMA-8 score as worsening", () => {
    // The inversion trap, and the reason it is stated twice in the payload.
    // Every DSMA-8 item is negatively worded, so a higher total is a patient
    // doing worse — the opposite of the prior a model brings to a score /24.
    const f = facts({
      assessments: [assessment("2026-01-10", 8), assessment("2026-03-14", 14)],
    });

    expect(f.assessments.change).toBe(6);
    expect(f.assessments.direction).toBe("worsened");
  });

  it("treats a falling score as improvement", () => {
    const f = facts({
      assessments: [assessment("2026-01-10", 12), assessment("2026-03-14", 5)],
    });

    expect(f.assessments.change).toBe(-7);
    expect(f.assessments.direction).toBe("improved");
  });

  it("labels bands from the official definition", () => {
    const f = facts({
      assessments: [assessment("2026-01-10", 8), assessment("2026-03-14", 14)],
    });

    expect(f.assessments.previous?.band).toBe("Moderate risk");
    expect(f.assessments.latest?.band).toBe("High risk");
    expect(f.assessments.bandChanged).toBe(true);
  });

  it("takes the two most recent, whatever order they arrive in", () => {
    const f = facts({
      assessments: [
        assessment("2026-03-14", 14),
        assessment("2025-06-01", 3),
        assessment("2026-01-10", 8),
      ],
    });

    expect(f.assessments.completed).toBe(3);
    expect(f.assessments.latest?.score).toBe(14);
    expect(f.assessments.previous?.score).toBe(8);
  });

  it("ignores assessments that were sent but never completed", () => {
    // A sent-and-unanswered questionnaire has no score. Counting it would put
    // a null into the trend.
    const f = facts({
      assessments: [assessment("2026-01-10", 8), assessment(null, null)],
    });

    expect(f.assessments.completed).toBe(1);
    expect(f.assessments.direction).toBe("single-assessment");
    expect(f.assessments.change).toBeNull();
  });
});

/* ============================================================== payload ==== */

describe("the fact payload", () => {
  it("measures how stale the data is", () => {
    const f = facts({
      labs: [lab("2026-03-14", TestCode.HBA1C, 7.1)],
      now: utc("2026-03-20"),
    });

    expect(f.daysSinceLastData).toBe(6);
  });

  it("is null when there is no data at all", () => {
    expect(facts().daysSinceLastData).toBeNull();
  });

  it("needs two data points before it is worth narrating", () => {
    expect(hasEnoughData(facts())).toBe(false);
    expect(
      hasEnoughData(facts({ labs: [lab("2026-01-10", TestCode.HBA1C, 6.8)] })),
    ).toBe(false);
    expect(
      hasEnoughData(
        facts({
          labs: [lab("2026-01-10", TestCode.HBA1C, 6.8)],
          assessments: [assessment("2026-01-10", 8)],
        }),
      ),
    ).toBe(true);
  });

  it("carries no identifying field of any kind", () => {
    // S19. The payload is the entire contents of what leaves this machine for
    // a third-party model, so the assertion is made on the serialised string
    // rather than on the type — a type cannot fail at runtime.
    const serialised = buildUserPrompt(
      facts({
        labs: [lab("2026-01-10", TestCode.HBA1C, 6.8)],
        assessments: [assessment("2026-01-10", 8)],
      }),
    );

    for (const forbidden of [
      "fullName",
      "mrn",
      "MRN-",
      "email",
      "phone",
      "dateOfBirth",
      "tokenHash",
      "1971-08-19",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }

    // Age survives; the birth date it came from does not.
    expect(serialised).toContain('"ageYears": 54');
  });

  it("states the score direction inside the payload, not only in the system prompt", () => {
    expect(buildUserPrompt(facts())).toContain("Higher DSMA-8 scores mean worse");
    expect(SYSTEM_PROMPT).toContain("Higher DSMA-8 scores mean WORSE");
  });

  it("forbids unsourced numbers in the system prompt", () => {
    expect(SYSTEM_PROMPT).toContain(
      "Never write a number that does not appear in the JSON",
    );
  });
});

/* =============================================================== verify ==== */

describe("verifySummary", () => {
  const grounded = facts({
    labs: [
      lab("2026-01-10", TestCode.HBA1C, 6.8),
      lab("2026-03-14", TestCode.HBA1C, 7.1),
    ],
    assessments: [assessment("2026-01-10", 8), assessment("2026-03-14", 14)],
  });

  it("accepts prose that only uses numbers from the payload", () => {
    const summary =
      "The patient's HbA1c rose from 6.8 to 7.1 over 63 days, with both readings above the 4 to 5.6 reference range. Their DSMA-8 score rose from 8 to 14.";

    expect(verifySummary(summary, grounded).grounded).toBe(true);
  });

  it("catches a fabricated figure", () => {
    const summary = "The patient's HbA1c rose from 6.8 to 9.4.";

    const result = verifySummary(summary, grounded);
    expect(result.grounded).toBe(false);
    expect(result.unsupported).toContain(9.4);
  });

  it("catches a plausible number that is simply wrong", () => {
    // The failure mode that matters: not nonsense, but a figure that reads
    // exactly like the real one. 0.4 is a believable HbA1c delta; the actual
    // change is 0.3.
    const result = verifySummary(
      "HbA1c rose by 0.4 over the period.",
      grounded,
    );

    expect(result.grounded).toBe(false);
    expect(result.unsupported).toEqual([0.4]);
  });

  it("accepts the magnitude of a negative change", () => {
    const improving = facts({
      assessments: [assessment("2026-01-10", 12), assessment("2026-03-14", 5)],
    });

    // change is -7; "fell by 7" carries the sign in the verb.
    expect(verifySummary("The score fell by 7.", improving).grounded).toBe(true);
  });

  it("accepts a number the narrator rounded", () => {
    const f = facts({
      labs: [
        lab("2026-01-10", TestCode.GLU_F, 98.37),
        lab("2026-03-14", TestCode.GLU_F, 131.62),
      ],
    });

    expect(verifySummary("Fasting glucose reached 131.6.", f).grounded).toBe(true);
    expect(verifySummary("Fasting glucose reached 132.", f).grounded).toBe(true);
  });

  it("does not read figures out of instrument names", () => {
    // "HbA1c" and "DSMA-8" would otherwise contribute a 1 and an 8 and be
    // reported as two inventions.
    const result = verifySummary(
      "The DSMA-8 and HbA1c results were both recorded.",
      grounded,
    );

    expect(result.found).toEqual([]);
    expect(result.grounded).toBe(true);
  });

  it("does not read figures out of dates", () => {
    const result = verifySummary(
      "Readings were taken on 2026-01-10, on 14 March 2026 and again in March 2026.",
      grounded,
    );

    expect(result.found).toEqual([]);
  });

  it("reads a number that ends a sentence", () => {
    // The trailing full stop is the most common position for a figure, and a
    // lookahead that excluded it would skip the number entirely — a
    // fabrication at the end of a sentence would never be checked.
    const result = verifySummary("HbA1c reached 9.4.", grounded);

    expect(result.found).toEqual([9.4]);
    expect(result.grounded).toBe(false);
  });

  it("collects every number in the payload, however nested", () => {
    const allowed = allowedNumbers(grounded);

    expect(allowed.has(6.8)).toBe(true);
    expect(allowed.has(7.1)).toBe(true);
    expect(allowed.has(0.3)).toBe(true);
    expect(allowed.has(14)).toBe(true);
    expect(allowed.has(63)).toBe(true);
    expect(allowed.has(9.4)).toBe(false);
  });
});
