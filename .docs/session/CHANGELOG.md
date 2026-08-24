# Changelog

What happened, session by session. Newest first.

Not a git log — `git log` records *what* changed. This records *why*, what was
learned, and what was left undone, so a new session does not have to
reconstruct it from diffs.

---

## Session 2 — 2026-08-24 (Mon) — repo published, history restructured

### B1 cleared — the diagnosis in session 1 was wrong

`git push` was not failing for want of a login. All three GitHub accounts were
already in the keyring; `JoeYoussef44` simply was not the **active** one.
`gh auth switch --user JoeYoussef44` resolved it in one command — no
`gh auth login --web` needed. It has admin/push on the repo.

### History restructured into feature branches, before the first push

Joe asked that the work be published feature-by-feature rather than as one
linear push, so the incremental process is visible to the evaluators. Because
**nothing had ever been pushed** (`git ls-remote` returned zero refs), this was
free: no force-push, no rewritten public commit, no changed SHA.

The key mechanic: the nine commits were already sequential, so each feature
branch could be pointed at an **existing commit** rather than cherry-picked.
Each PR's merge base is therefore the previous feature's tip, and every PR shows
exactly its own diff with original authorship and timestamps intact.

Four PRs, opened and merged in order with `--merge` (never squash), each body
carrying what changed, why the non-obvious decisions were made, and the real
`vitest` output captured at that branch's own state (40 → 40 → 68 → 85 tests).
Branches kept after merge as part of the evidence.

**Verified:** `git diff backup/pre-restructure main` is empty — the published
tree is byte-identical to the pre-restructure tip. 85 tests pass on `main`.

No commit dates were faked. The merge commits are dated now; the underlying
commits keep their true authorship times.

### Secret scan before publishing

The repo is public, so every value in `.env` was grepped against the full
`git log --all -p`. All five real secrets — `DATABASE_URL`, `DIRECT_URL`,
`AUTH_SECRET`, `SEED_CLINICIAN_PASSWORD`, `FHIR_API_KEY` — are absent from
history. Four non-secrets do appear and are fine by design: the fabricated seed
login and `localhost:3000` in session notes, and the FHIR base URL and
`cand-joe-l` candidate id, both of which come from the official public
attachment.

### Phase 4 — CSV importer (PR #6)

Five commits: pure parser, pure classifier, service, endpoint, report UI.

**The design decision that mattered was three row outcomes, not two.** Under
accepted/rejected alone, re-uploading a corrected file reports its
already-good rows as *errors* — alarming, and false. Separating "already
imported" is what makes the brief's re-upload requirement read correctly.

Errors and warnings were separated for the same reason: data-integrity
failures reject the row, cosmetic mismatches import and are flagged. Rejecting
a row because a lab spelled a test name differently would fail rows an
evaluator considers valid.

Two clinical judgement calls, both documented in the code:

- A mismatched **unit** is stored exactly as reported and flagged, never
  relabelled to the canonical unit. Rewriting 5.8 mmol/L as 5.8 mg/dL would
  turn a normal glucose into a fatal-looking one while looking like a tidy-up.
  A pure case difference normalises silently.
- A **changed value** on re-upload is skipped and reported, never written over
  the top (D-CSV-2).

### Two defects found by probing rather than reasoning

1. **The header was inferred from the first data row's keys.** With
   `relax_column_count`, a short row yields a record missing those keys, so a
   file whose *first* data row was short got rejected whole — exactly the messy
   file this importer exists to survive. Caught by a test written before the UI.
   The header is now captured from csv-parse's own `columns` callback.

2. **`POST /api/labs/upload` returned 307 to `/login`, not 401.** The edge proxy
   matched first. Worse than it looks: `fetch` follows the redirect, receives
   login HTML with a 200, and parses it as JSON — so a session expiring while
   the page was open surfaced as an *empty report* rather than an error. A
   silent wrong answer. API paths are now exempt from the redirect, never from
   authorisation. Found only by curling the endpoint.

### Verified, not assumed

Against the live Neon database: the supplied sample imports **10/10** on a
fresh database, re-uploading it accepts 0 and rejects 0 with the row count
unchanged at 10, and a messy file imports 2 of 10 while explaining all eight
other outcomes. Then over real HTTP as the seeded clinician: page renders,
upload returns the report, `.txt` → 415, wrong-columns CSV → 422, unauthenticated
→ 401 JSON.

Test suite 85 → 151.

The database deliberately retains the ten sample lab results, so Phase 5's
charts have real data on first run.

### Phase 5 — dashboards and charts (PRs #8, #9)

Four single-series trend charts per patient (glucose, HbA1c, systolic, DSMA-8
score), and a clinic overview: hero patient count, completion-rate meter, risk
bands, and recent imports with a date-range filter.

**One measure per chart, never a dual axis.** Two y-scales align arbitrarily,
so a shared plot asserts a correlation the data does not contain. Three
measures, three charts.

### The palette decision, made on evidence

The risk distribution was built first as a stacked bar. Running the four band
colours through a colour-vision validator put **moderate↔high at ΔE 8.0 for
normal vision and 0.4 under deuteranopia** — the same colour, to a deuteranope.

Re-stepping the palette only moved the collision to orange↔red, which is the
tell: green→yellow→orange→red is a *continuous hue ramp*, so neighbouring steps
are always close, and stacking them makes hue the channel that has to separate
them. So the **form** changed rather than the colours: one labelled bar per
band. No two fills touch, every bar carries its own name and number, and each
band clears 3:1 against the surface alone. The questionnaire's traffic-light
semantics survive intact.

### A requirement I had missed

After Phase 5 I checked the work against the Definition of Done rather than
assuming it was complete, and found the brief asks the clinic view for
*"recent uploads with at least one filter (e.g. date range)"*. PR #8 had the
aggregates and risk bands but no uploads panel and no filter. PR #9 closes it.

Its one deliberate deviation: the filter scopes that card, not the page.
Completion rate is all-time by decision (D-DASH-2) and the risk distribution is
a register snapshot, so a global date filter would not narrow those to a smaller
truth — it would make them a different and misleading one.

### Seed

A fresh install previously showed four empty states, so the charts demonstrated
nothing. The seed now creates an assessment history with real trajectories
(Jane improves 17→11→6, Samir holds, Rana deteriorates 13→20), plus one expired
unanswered invitation so the completion rate is honestly 7/8 rather than a
suspicious 7/7.

Every seeded assessment is completed or expired. That is what makes a
*deterministic* token hash safe — which is in turn what keeps the seed
idempotent — because the gate refuses both states before it looks at anything
else. No seeded row carries a working link. Answers are generated to genuinely
sum to the stored score.

### Verified against the live database

The risk distribution was the interesting one. Jane has three completed
assessments including a High-risk one, and **High risk renders 0** — she is
counted once, by her latest. If the code counted assessments rather than
patients, that cell would read 1. Completion rate showed 88% (7 of 8), and the
counts summed to the patient total.

All three patients' charts were checked over authenticated HTTP through their
`role="img"` labels, which carry the real values — including the single-reading
case that exercises the zero-width-domain padding.

**Stated limitation:** no browser tooling was available, and Recharts renders
its SVG client-side (`renderToStaticMarkup` returns a 127-byte wrapper and no
`<svg>`; jsdom would not help, having no layout). So the chart *data*,
structure and accessible labels are verified, but **the plotted charts were
never seen**. Same for 375px usability. Both need a browser before submission.

Test suite 151 → 188.

### Left undone

**Tier 1 is feature-complete.** What remains is the README — one of the six
graded areas, still the create-next-app default — and the deployment.
**B2 (Vercel) is still the only open blocker**, and the README does not depend
on it.

---

## Session 1 — 2026-08-24 (Mon)

**Phases 0 → 3 complete.** Tier 1 ~50%. 8 commits, none containing a secret.

### Analysis, before any code

- Read all five official Capadev attachments plus the pre-existing planning
  document, and produced `.docs/01-challenge-analysis.md`.
- Validated the planning doc against the originals. It was broadly accurate,
  but had **three defects** that would have cost real time or marks:
  1. Its `If-None-Exist` strategy was unsafe on a shared FHIR server — an
     un-scoped MRN match can bind us to another candidate's resource, making
     every later `PUT` a 403.
  2. It never noticed that the supplied sample CSV references
     `MRN-1001/1002/1003`, which exist nowhere by default — so an evaluator's
     first upload would reject all ten rows and look broken.
  3. It treated the deadline as 7 days. The candidate email says "before
     Thursday", which is ~2.5 working days.
- Produced `.docs/02-project-overview.html` (published as an Artifact) and
  `PulseTrack-Project-Brief.pdf` — a visual brief for the walkthrough call.

### Phase 0 — repo and reconnaissance

- Moved the FHIR API key out of the planning doc into `.env`, redacted the
  original, and gitignored both before the first commit.
- Probed the live FHIR server read-only. **Three of my own assumptions were
  wrong**; all corrected in analysis §23 and summarised in `state.md` §6. The
  significant one: pagination `next` links point at an unreachable internal
  host, so following them as documented silently truncates every import.

### Phase 1 — schema, auth, deploy skeleton

- Prisma schema with the two constraints that carry the brief's guarantees:
  unique `(patientId, collectedDate, testCode)` and unique
  `(assessmentId, questionId)`.
- Migration applied to Neon (Postgres 17.11). Idempotent seed: one clinician
  plus `MRN-1001/1002/1003`.
- Auth.js v5, Credentials + JWT, three-layer authorization.
- **Deploy did not happen** — Vercel account blocked. This is a deviation from
  the plan's deploy-early strategy and carries real risk (see `state.md` B2).

### Phase 2 — patient management

- CRUD, search, validation. Verified against the real database that duplicate
  MRN is rejected by the index, dates round-trip without timezone drift, and
  case-insensitive search works.

### Phase 3 — assessment flow

- Token issue → email → public form → server-side scoring → history.
- Verified 12 security properties against the real database, including a
  **concurrent double-submit producing exactly one completion and eight
  answers, not sixteen**.

### Problems hit and how they were resolved

| Problem | Resolution |
|---|---|
| `create-next-app` refused the folder name (npm forbids capitals) | Scaffolded into a temp subdirectory and moved the files up |
| Prisma 7 removed `datasourceUrl` | Added `@prisma/adapter-pg` |
| Prisma init dumped `.agents/`, `.windsurf/`, `skills-lock.json` | Deleted — noise |
| Next 16 deprecated `middleware.ts` and rejected the destructured export | Migrated to `proxy.ts` with a real default export |
| Auth.js 500ing on every request | Read the server log rather than guessing: `UntrustedHost`. Added `trustHost: true` |
| Zod 4 renamed `errorMap` | Changed to `error` |
| Lint error: `Date.now()` during render | Moved the derivation into the service, so the two views share one implementation |
| Screenshot of the assessment page came back 404 | An empty shell variable, not a routing bug. Caught only because the screenshot was actually looked at |

### Left undone

- CSV importer (Phase 4) — not started.
- Dashboards and charts (Phase 5) — assessment table only, no charts.
- README — still the create-next-app default.
- Nothing pushed to GitHub; nothing deployed.
