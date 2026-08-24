# PulseTrack — current state

> **Living document. Update it at the end of every working session.**
> Last updated: **2026-08-24**, session 2 (phases 4 and 5).

---

## 1. Where we are

**Phase 5 of 12 complete.** Tier 1 is feature-complete; only the README and
the live deployment remain.

| Phase | Status |
|---|---|
| 0 · Repo, gitignore, FHIR recon | ✅ Complete |
| 1 · Schema, migration, seed, auth | ✅ Complete locally (live deploy outstanding) |
| 2 · Patient CRUD | ✅ Complete |
| 3 · Assessment flow | ✅ Complete |
| 4 · CSV importer | ✅ Complete |
| 5 · Dashboards + charts | ✅ Complete |
| **6 · Tier 1 gate** — deploy + QA | ⬜ **NEXT** — blocked on Vercel (B2) |
| 7 · FHIR client + push | ⬜ Not started |
| 8 · FHIR pull + pagination | ⬜ Not started |
| 9 · **Tier 2 gate** | ⬜ |
| **10 · README + diagrams** | ⬜ **Do this even if B2 stays blocked** |
| 11 · Submit | ⬜ Due Wed 2026-08-26 |
| 12 · Tier 3 (conditional) | ⬜ Only if 0–11 done |

### Tier 1 against the brief's own six areas

| Requirement | Done |
|---|---|
| Authentication | 100% |
| Patient management | 100% |
| Email questionnaire flow | 100% |
| CSV lab upload | 100% |
| Dashboards | 100% |
| Documentation (README) | 0% — still the create-next-app default |
| Live Vercel URL | 0% |

Definition of Done (`.docs/01-challenge-analysis.md` §19): **26 of 28 met**, 1 partial, 1 outstanding — see §1a.

---

### 1a. What is actually left, item by item

Checked against `.docs/01-challenge-analysis.md` §19, not assumed.

| # | Item | State |
|---|---|---|
| 26 | README: setup <10 min, architecture diagram, ERD, Decisions & tradeoffs | ❌ **Not started** — still the create-next-app default |
| 1 | Login works locally **and on the live Vercel URL** | ⚠️ Local ✅, live ❌ (B2) |
| 24 | Usable at 375px | ⚠️ **Unverified.** Responsive classes are in place but nobody has looked at a narrow viewport |
| 20 | Patient time series | ✅ built — but the **plotted charts were never seen** (see §6) |

Everything else on the list is met and was verified against the live database
rather than inferred.

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
| **Edge proxy vs API routes** | The proxy matched `/api/*` and **redirected** unauthenticated requests to `/login`. A `fetch` follows that, gets login HTML with a 200, and parses it as JSON — so an expired session showed an *empty report*, not an error. API paths are now exempt from the redirect (never from `requireClinicianApi()`). Any new API route must authorise itself. |
| **csv-parse ragged rows** | With `relax_column_count`, a short row yields a record **missing those keys entirely**. Inferring the file's columns from row one therefore rejects the whole file whenever the first data row is short. Capture the header from the `columns` callback instead. |
| **csv-parse `info.lines`** | Is the real file line number (header = 1), already correct across blank lines — so it is the number to show a clinician fixing the file in Excel. |
| **`next dev` edits CLAUDE.md** | It appends an agent-rules block and re-adds it whenever removed. Committed deliberately, so the tree stays clean. |
| **tsx scripts** | No top-level `await` (cjs output) and no automatic `.env` — wrap in `async function main()` and `import "dotenv/config"` first. |
| **Recharts x-axis** | A string x-axis is **categorical**: points plot in array order at even spacing whatever the labels say. A back-dated result draws a line that doubles back, and a year's gap looks like a day's. Use `type="number"` + `scale="time"` with millisecond timestamps, and sort in `lib/labs/series.ts`. |
| **Recharts single point** | One reading makes `dataMin === dataMax`, a zero-width domain where the marker vanishes or lands on the axis. `timeDomain()` pads a week either side. Every new patient hits this. |
| **Recharts + SSR** | Renders only a wrapper `<div>` on the server; the SVG needs client-side layout. So **charts cannot be verified headlessly** — `renderToStaticMarkup` returns 127 bytes and no `<svg>`. jsdom would not help either (no layout). Verify chart *data* through the `role="img"` aria-labels, which carry the real values; verify *appearance* in a browser. |
| **Risk-band colours vs CVD** | The four band colours are a continuous green→yellow→orange→red ramp, so **any two neighbours are close**: moderate↔high measured ΔE 8.0 normal / **0.4 deuteran**. Never put them in touching segments (stacked bar, pie). Faceted rows with per-row labels are safe, and each band clears 3:1 on its own. |
| **Dashboard filters** | Completion rate is all-time (D-DASH-2) and the risk distribution is a register snapshot, so a global date filter would falsify them. The date range scopes the uploads card only, by design. |

---

## 7. Architecture at a glance

```
app/(auth)/login          public
app/(dashboard)/*         requires a session
app/assessment/[token]    public — authorised by the token alone
app/api/auth/*            Auth.js

lib/assessments/  definition (loads official JSON) · scoring (pure) · token · service
lib/labs/         test-catalog · parse · classify (pure) · series (pure) · service (IO)
lib/dashboard/    metrics (pure) · service (IO)
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
| #6 | `feat/csv-lab-import` | parser, classifier, service, endpoint, report UI |
| #8 | `feat/dashboards-charts` | trend charts, clinic metrics, risk bands, seed history |
| #9 | `feat/dashboard-upload-filter` | recent imports + date-range filter |

**Every remaining phase ships the same way** — branch, incremental commits,
tests green, PR with real test output in the body, `--merge` (never squash),
branch kept after merge. The procedure is in `CLAUDE.md` under *Git workflow*.

Remaining branches: `docs/readme-and-diagrams`, `feat/fhir-push`,
`feat/fhir-pull-pagination`.

`backup/pre-restructure` is a **local-only** safety ref at the original
pre-restructure tip. `git diff backup/pre-restructure main` was verified empty.
Safe to delete once you are happy.

---

## 9. Next session — start here

**Tier 1 is feature-complete.** Two things stand between this and a valid
submission, and one of them does not depend on Vercel.

1. **Write the README (Phase 10), on `docs/readme-and-diagrams`.** It is one of
   the brief's six graded areas and is still the create-next-app default. It
   needs: setup a stranger can follow in under 10 minutes, an **architecture
   diagram**, an **ERD**, and a **"Decisions & tradeoffs"** section — the brief
   says outright *"We read this carefully."*

   Most of the raw material already exists: the `D-*` decisions in
   `.docs/01-challenge-analysis.md` §16, the schema reasoning in §10, and the
   defect write-ups in `CHANGELOG.md`. Mermaid renders on GitHub.

2. **Deploy (Phase 6), the moment B2 clears.** A live URL is required, not
   optional. Deploying also flushes out the production-only failures nobody has
   seen yet: serverless function timeouts, and Postgres connection exhaustion
   through the pooled URL.

3. **Look at the app in a browser at 375px.** Two graded items rest on this and
   neither has been checked by eye — the charts (Recharts draws client-side, so
   no headless check is possible) and mobile usability.

Only then Tier 2 (`feat/fhir-push`, `feat/fhir-pull-pagination`). Tier 2 is
"strongly recommended", but a polished Tier 1 is explicitly a complete
submission, and an undocumented Tier 2 scores worse than a documented Tier 1.

Deeper context, if needed: `.docs/01-challenge-analysis.md` (requirements
matrix, security analysis, evaluator edge cases) and `.docs/candidate-brief.md`
(the authority on scope).
