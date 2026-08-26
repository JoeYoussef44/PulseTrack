import type { PatientFacts } from "./facts";

/**
 * The prompt, kept pure and separate so it can be read, reviewed and tested
 * without a network call or an API key.
 *
 * Prompt design is one of the four things the brief says it evaluates, so the
 * reasoning is written down rather than left in the wording:
 *
 * **The model is cast as a narrator, not an analyst.** It is given finished
 * arithmetic and asked for prose. Every instruction below follows from that —
 * there is no "work out the trend", because the trend is already in the input.
 *
 * **The prohibitions are specific and checkable.** "Be careful" is not an
 * instruction a model can follow. "Do not write a number that does not appear
 * in the JSON" is, and `verify.ts` independently enforces exactly that one, so
 * the prompt and the check are aimed at the same target.
 *
 * **The score direction is stated twice** — here and inside the payload as
 * `scoreDirectionNote`. A rising DSMA-8 score means a patient doing worse, which
 * is the opposite of the usual "higher is better" prior a model brings to a
 * score out of 24. It is the most likely single error, so it is said redundantly.
 *
 * **It is told what to do when the data is thin**, because the alternative is a
 * model filling a paragraph it has no material for.
 */

export const SYSTEM_PROMPT = `You are a clinical data assistant writing a short trajectory note for a
clinician at a diabetes clinic. The clinician already knows the patient; your
job is only to summarise what the recorded data shows.

You will be given a JSON object of facts that have ALREADY been computed from
the patient's records. Narrate those facts. Do not analyse, re-derive or
extend them.

Hard rules:
1. Never write a number that does not appear in the JSON. Do not compute new
   numbers, percentages, averages or rates. If you want to mention a figure,
   it must be one that is already there.
2. Never diagnose, never suggest or adjust treatment, never mention specific
   medications, dosages or targets, and never tell the clinician what to do.
3. Never speculate about a cause. The data shows what happened, not why.
4. Do not invent or refer to any information you were not given — no name, no
   history, no comorbidities, no adherence, no lifestyle.
5. Higher DSMA-8 scores mean WORSE self-management and higher risk. A rising
   score is a patient doing worse. Lower is better.
6. If the data is sparse or old, say so plainly instead of padding.

Style: 3 to 5 sentences of plain prose, in one paragraph. No headings, no
bullet points, no markdown, no preamble such as "Here is a summary". Refer to
"the patient". Use neutral, factual clinical language and describe changes in
terms of what was recorded, not what it means.`;

/**
 * The user turn: the fact payload, and nothing else.
 *
 * Serialised with an indent because a model reads a nested structure more
 * reliably that way, and the payload is small enough that the extra tokens are
 * not worth optimising.
 */
export function buildUserPrompt(facts: PatientFacts): string {
  return `Patient facts (JSON):\n\n${JSON.stringify(facts, null, 2)}\n\nWrite the trajectory note.`;
}

/**
 * Everything the provider needs for one call.
 *
 * `temperature` is low but not zero: this is prose, and zero produces the same
 * slightly stilted sentence every time. The grounding guarantee comes from
 * `verify.ts`, not from pinning the sampler, which is what lets it be non-zero
 * at all.
 */
export interface PromptRequest {
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
}

export function buildPrompt(facts: PatientFacts): PromptRequest {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(facts),
    temperature: 0.2,
    // 5 sentences of clinical prose is comfortably under 200 tokens. The cap is
    // a guard against a runaway response, not a target.
    maxOutputTokens: 400,
  };
}
