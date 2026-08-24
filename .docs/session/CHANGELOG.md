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

### Left undone

Unchanged from session 1 — Phase 4 (CSV importer) is still the next build task.
B2 (Vercel) is still open.

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
