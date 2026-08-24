# PulseTrack

Remote patient monitoring for a diabetes clinic. A timed engineering challenge
for **Capadev**, built in three tiers.

## Read these first

At the start of a session, before writing or changing anything:

1. **`.docs/session/state.md`** — where the work currently stands, what is next,
   open blockers, environment, commands, and the gotchas already paid for.
   **Always read this.**
2. **`.docs/session/CHANGELOG.md`** — what happened in previous sessions and why.
3. **`.docs/01-challenge-analysis.md`** — the authoritative analysis: full
   requirements matrix, data model reasoning, security analysis, FHIR
   integration design, evaluator edge cases, and the numbered `D-*` decisions.
   Read the sections relevant to the task rather than the whole thing.
4. **`.docs/candidate-brief.md`** — the challenge itself. The authority on scope.

Update `state.md` and `CHANGELOG.md` at the end of each session.

## Source-of-truth order

1. The five official Capadev attachments in `.docs/` — `candidate-brief.md`,
   `fhir-api-guide.md`, `questionnaire-dsma8.json`, `lab-results-template.csv`,
   `lab-results-sample-clean.csv`
2. The candidate email (quoted in the private plan) — **overrides the brief on
   the deadline**: submission is due Wed 2026-08-26, not in seven days
3. `.docs/01-challenge-analysis.md`
4. `.docs/PRIVATE_*.md` — the earlier planning document. Superseded, and
   gitignored because it references credentials.

If anything conflicts, the official attachments win.

## Non-negotiables

- **Never commit a secret.** `.env` and `.docs/PRIVATE_*.md` are gitignored.
  Scan before pushing: `git log --all -p | grep <value>`. The repo is public.
- **Never log patient data** — no names, emails, MRNs, answers or tokens. Log
  ids and counts.
- **Never expose `FHIR_API_KEY` or any secret through `NEXT_PUBLIC_`.**
- **Authorize server-side in every mutation** via `requireClinician()`. Hidden
  UI and edge middleware are conveniences, not the boundary.
- **Never trust a score from the browser.** Assessment totals are always
  recomputed server-side from stored answers.
- **Only fabricated patient data.**
- **Keep git history incremental and meaningful** — it is explicitly evaluated.
  Do not squash.
- **Do not claim HIPAA or GDPR compliance.** Good practice is not compliance.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Prisma 7 on
Neon Postgres 17 · Auth.js v5 (Credentials + JWT) · Zod 4 · Recharts 3 ·
Vitest. Deployment target: Vercel.

## Conventions

- Business logic lives in `lib/`, not in components. Pages fetch and render.
- Pure, testable functions for anything an evaluator will probe: scoring, CSV
  validation, FHIR mapping, pagination.
- Dates always go through `parseIsoDate` / `toIsoDate` in
  `lib/validation/patient.ts`. Never construct from local components.
- Server-only modules import `server-only`. Running a script that imports them
  needs `NODE_OPTIONS="--conditions=react-server" npx tsx script.ts`.
- Empty, loading and error states are part of the work, not an afterthought —
  the brief grades them explicitly.
- Prefer a simple implementation that can be explained on a call over a clever
  one that cannot.

## Git workflow

Every phase ships as a **feature branch and a pull request**, never a direct
commit to `main`. The incremental history is explicitly evaluated, and the PR
list is the most legible evidence of it.

1. `git checkout -b feat/<phase-name>` off current `main`.
2. Commit incrementally as the work progresses. Do not squash.
3. `npm test` and `npm run lint` must pass before the PR is opened.
4. `gh pr create --base main` with a body that states **what** changed, **why**
   the non-obvious decisions were made, and the **actual test output**.
5. `gh pr merge <n> --merge` — a merge commit, so the branch topology survives.
6. Merge as each phase completes; `main` must always be deployable.

Branches are kept after merge, not deleted — they are part of the evidence.

**Push as `JoeYoussef44`.** The machine has three GitHub accounts in the
keyring; `CoperonDev` is read-only on this repo. If a push is rejected, run
`gh auth switch --user JoeYoussef44` rather than re-authenticating.

## Verify, don't assume

This project is judged on correctness under hostile input. Before reporting
something works: run it, read the actual output, and look at the actual page.
Several defects this session were found only because output was inspected
rather than inferred — a 404 behind a 200-looking flow, an auth failure whose
cause was in the server log, and three wrong assumptions about the FHIR server
that only a live probe disproved.

## Commands

```bash
npm run dev / build / start / lint
npm test              # vitest
npm run db:migrate    # prisma migrate dev
npm run db:seed       # idempotent
npx prisma generate   # -> lib/generated/prisma
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
