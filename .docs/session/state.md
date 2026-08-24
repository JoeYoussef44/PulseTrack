# PulseTrack — current state

> **Living document. Update it at the end of every working session.**
> Last updated: **2026-08-24**, end of session 1.

---

## 1. Where we are

**Phase 3 of 12 complete.** Tier 1 is roughly 50% done.

| Phase | Status |
|---|---|
| 0 · Repo, gitignore, FHIR recon | ✅ Complete |
| 1 · Schema, migration, seed, auth | ✅ Complete locally (live deploy outstanding) |
| 2 · Patient CRUD | ✅ Complete |
| 3 · Assessment flow | ✅ Complete |
| **4 · CSV importer** | ⬜ **NEXT** |
| 5 · Dashboards + charts | ⬜ Not started |
| 6 · **Tier 1 gate** — deploy + QA | ⬜ Blocked on Vercel |
| 7 · FHIR client + push | ⬜ Not started |
| 8 · FHIR pull + pagination | ⬜ Not started |
| 9 · **Tier 2 gate** | ⬜ |
| 10 · README + diagrams | ⬜ Not started |
| 11 · Submit | ⬜ Due Wed 2026-08-26 |
| 12 · Tier 3 (conditional) | ⬜ Only if 0–11 done |

### Tier 1 against the brief's own six areas

| Requirement | Done |
|---|---|
| Authentication | 100% |
| Patient management | 100% |
| Email questionnaire flow | 100% |
| CSV lab upload | 0% |
| Dashboards | 15% — assessment table only, **no charts yet** |
| Documentation (README) | 0% — still the create-next-app default |
| Live Vercel URL | 0% |

Definition of Done (`.docs/01-challenge-analysis.md` §19): **15 of 28 met**, 4 partial, 9 outstanding.

---

## 2. Deadline

- Interview: **Thursday 2026-08-27, noon.**
- Submission must be sent **Wednesday 2026-08-26, end of day.**
- The brief says 7 days; the candidate email says "before Thursday" and **the email wins**.

---

## 3. Open blockers

| # | Blocker | Needs | Impact |
|---|---|---|---|
| ~~B1~~ | ~~**`git push` rejected**~~ **CLEARED 2026-08-24** | Root cause was *not* a missing login: `JoeYoussef44` was already in the keyring but was not the **active** account. `gh auth switch --user JoeYoussef44` fixed it. That account has admin/push. | Resolved. Repo is published with 4 merged PRs. |
| B2 | **Vercel account recovery** | Joe to finish account setup | A live URL is **required, not optional** per the brief. Also delays discovering production-only failures: serverless function timeout on the FHIR import, and Postgres connection exhaustion. |
| B3 | **No Resend key** | Optional | Email falls back to a console adapter. The flow still demos: the clinician gets a copy-link after sending. Resend's free tier only delivers to the account owner's own address anyway. |

---

## 4. Environment

Secrets live in **`.env`** (gitignored, never committed). `.env.example` holds the key names only.

| Variable | Set? | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon **pooled** (`-pooler` host). Used at runtime. |
| `DIRECT_URL` | ✅ | Neon direct. Used by `prisma migrate`. |
| `AUTH_SECRET` | ✅ | 32 random bytes |
| `SEED_CLINICIAN_EMAIL` | ✅ | `clinician@pulsetrack.local` |
| `SEED_CLINICIAN_PASSWORD` | ✅ | Generated — read it from `.env` |
| `APP_BASE_URL` | ✅ | `http://localhost:3000` |
| `FHIR_BASE_URL` / `FHIR_CANDIDATE_ID` | ✅ | `cand-joe-l` (not a secret) |
| `FHIR_API_KEY` | ✅ | **Secret.** Never commit, never log, never `NEXT_PUBLIC_`. |
| `EMAIL_*` | ⬜ | Unset → console adapter |
| `AI_*` | ⬜ | Tier 3 only |

**Database:** Neon, Postgres 17.11, region AWS us-east-1 (matches Vercel's default `iad1`).

---

## 5. Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm start            # serve the build
npm run lint         # eslint
npm test             # vitest (85 tests)
npm run db:migrate   # prisma migrate dev
npm run db:deploy    # prisma migrate deploy (production)
npm run db:seed      # idempotent seed
npx prisma generate  # regenerate client into lib/generated/prisma
```

**Running a one-off script that imports `lib/` code:**

```bash
NODE_OPTIONS="--conditions=react-server" npx tsx script.ts
```

Without that flag, `server-only` throws — which is the guard working correctly, not a bug.

**Killing a stuck dev server** (Windows; `taskkill` flags get mangled through git-bash):

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

---

## 6. Hard-won gotchas — do not rediscover these

| Area | Finding |
|---|---|
| **FHIR pagination** | The server's `next` link points at `http://hapi:8080` — its **internal Docker host**, unreachable externally. Following it verbatim (as the API guide instructs) silently truncates every import to page one. `lib/fhir/pagination.ts` rebases the query onto our configured public base. |
| **FHIR page size** | Each seed patient has **36** observations, not 180. At the guide's `_count=50` nothing paginates. We use **`_count=20`** so the loop genuinely runs (20 + 16). |
| **FHIR `bundle.total`** | Absent on paged responses. Loop control must depend on the `next` link only. |
| **FHIR ownership** | Seed patients are tagged `cand-admin`, not us. `_tag` works as a search param. We currently own 0 resources. |
| **FHIR conditional create** | Untested — needs a write, and writes are permanent (DELETE is disabled). Resolve during Phase 7. Scope `If-None-Exist` with our `_tag` or a cross-candidate MRN collision binds us to someone else's resource. |
| **Prisma 7** | `datasourceUrl` is gone; a **driver adapter is mandatory**. We use `@prisma/adapter-pg`. Client generates as **TypeScript** into `lib/generated/prisma`. |
| **Next 16** | `middleware.ts` is now **`proxy.ts`**, and it needs a real function export (a destructured `export const { auth }` is not recognised). |
| **Auth.js v5** | Needs `trustHost: true` — it only auto-trusts on Vercel. Without it every request 500s with `UntrustedHost`. |
| **Auth.js sessions** | JWT strategy is mandatory: database sessions are incompatible with the Credentials provider. |
| **React purity** | `Date.now()` during render is a lint **error**. Derive time-dependent state before the render tree. |
| **Zod 4** | `errorMap` is now `error`. |
| **Dates** | Always `parseIsoDate` / `toIsoDate` (`lib/validation/patient.ts`). Constructing from local components shifts the day west of UTC. |

---

## 7. Architecture at a glance

```
app/(auth)/login          public
app/(dashboard)/*         requires a session
app/assessment/[token]    public — authorised by the token alone
app/api/auth/*            Auth.js

lib/assessments/  definition (loads official JSON) · scoring (pure) · token · service
lib/labs/         test-catalog  [parser + validation still to build]
lib/fhir/         pagination    [client + mappers still to build]
lib/email/        provider abstraction + console/resend adapters
lib/validation/   zod schemas
lib/actions/      server actions — every one calls requireClinician()
lib/db.ts         Prisma singleton (server-only)
```

**Authorization is three layers deep**, because any one can be misconfigured:
`proxy.ts` (edge cookie check) → `auth()` in each page → `requireClinician()` in each mutation.

---

## 8. Decisions already made

Recorded in `.docs/01-challenge-analysis.md` §16 as `D-*` and §23. The ones that shape day-to-day work:

- **D-CSV-1** Required CSV columns are `mrn`, `collected_date`, `test_code`, `value`. `test_name`, `unit`, `ref_low`, `ref_high` are optional — warn, don't reject.
- **D-CSV-2** A re-uploaded row with a changed value is **skipped and reported**, never silently overwritten.
- **D-CSV-3** Seed `MRN-1001/1002/1003` so the supplied sample CSV imports 10/10 on a fresh database. Already done.
- **D-CSV row outcomes** Three states, not two: Accepted / Rejected / **Already imported**.
- **D-DASH-2** Completion rate = completed ÷ all sent, all time. `—` when the denominator is zero.
- **D-DASH-3** Risk distribution counts each patient once, by their latest *completed* assessment.
- **D-FHIR-2** Never push back data we pulled.
- **D-FHIR-5** Rebase `next` links (see §6).

---

## 8b. Git workflow — follow this for every remaining phase

The repo is published at **https://github.com/JoeYoussef44/PulseTrack** with a
merge-based topology. History was restructured **before the first push**, so no
public commit was ever rewritten and no SHA changed — each feature branch was
pointed at the commit that already existed.

| PR | Branch | Contents |
|---|---|---|
| #1 | `feat/data-model-and-seed` | schema, scoring, test catalog, pagination helper, seed |
| #2 | `feat/clinician-auth` | Auth.js v5, three-layer authorization |
| #3 | `feat/patient-management` | CRUD, search, validation |
| #4 | `feat/dsma8-assessments` | token → email → public form → scoring |

**Every remaining phase ships the same way** — branch, incremental commits,
tests green, PR with real test output in the body, `--merge` (never squash),
branch kept after merge. The procedure is in `CLAUDE.md` under *Git workflow*.

Planned branches: `feat/csv-lab-import`, `feat/dashboards-charts`,
`feat/fhir-push`, `feat/fhir-pull-pagination`, `docs/readme-and-diagrams`.

`backup/pre-restructure` is a **local-only** safety ref at the original
pre-restructure tip. `git diff backup/pre-restructure main` was verified empty.
Safe to delete once you are happy.

---

## 9. Next session — start here

1. Read `.docs/session/state.md` (this file) and `CLAUDE.md`.
2. Check whether B1 and B2 have cleared.
3. **Build Phase 4, the CSV importer.** Checkpoint: the supplied `lab-results-sample-clean.csv` imports **10/10** on a fresh database, re-uploading it creates **zero** duplicates, and a deliberately messy file still imports its valid rows while explaining every rejection.
4. Then Phase 5, dashboards and charts.

Deeper context, if needed: `.docs/01-challenge-analysis.md` (requirements matrix, security analysis, evaluator edge cases) and `.docs/candidate-brief.md` (the authority on scope).
