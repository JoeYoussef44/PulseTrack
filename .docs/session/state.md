# PulseTrack — current state

> **Living document. Update it at the end of every working session.**
> Last updated: **2026-08-24**, session 3 (README, browser QA).

---

## 1. Where we are

**Tier 1 is complete except the live deployment**, which is blocked on the
Vercel account and on nothing else. Phase 10 (README) shipped, and the two
graded items that had never been looked at by eye have now been verified in a
real browser.

| Phase | Status |
|---|---|
| 0 · Repo, gitignore, FHIR recon | ✅ Complete |
| 1 · Schema, migration, seed, auth | ✅ Complete locally |
| 2 · Patient CRUD | ✅ Complete |
| 3 · Assessment flow | ✅ Complete |
| 4 · CSV importer | ✅ Complete |
| 5 · Dashboards + charts | ✅ Complete |
| **10 · README + diagrams** | ✅ **Complete** (PR #12) |
| **6 · Tier 1 gate** — deploy + QA | 🟡 **QA done** (PR #13). Deploy blocked on B2 |
| 7 · FHIR client + push | ⬜ **NEXT** — not blocked |
| 8 · FHIR pull + pagination | ⬜ Not started |
| 9 · Tier 2 gate | ⬜ |
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
| Documentation (README) | **100%** |
| Live Vercel URL | 0% — **B2, the only thing outstanding** |

Definition of Done (`.docs/01-challenge-analysis.md` §19): **27 of 28 met.**

---

### 1a. What is actually left, item by item

| # | Item | State |
|---|---|---|
| 1 | Login works locally **and on the live Vercel URL** | ⚠️ Local ✅, live ❌ — **B2, and only Joe can clear it** |
| 26 | README: setup <10 min, architecture diagram, ERD, Decisions & tradeoffs | ✅ **Done** — PR #12 |
| 24 | Usable at 375px | ✅ **Verified in Chrome.** Three defects found and fixed (PR #13) |
| 20 | Patient time series | ✅ **Seen.** Charts render with correctly plotted, chronologically ordered points |

**Item 1 is the entire remaining Tier 1 scope.** Everything else is met and was
verified against the live database or a real browser, not inferred.

---

## 2. Deadline

- Interview: **Thursday 2026-08-27, noon.**
- Submission must be sent **Wednesday 2026-08-26, end of day.**
- The brief says 7 days; the candidate email says "before Thursday" and **the email wins**.

---

## 3. Open blockers

| # | Blocker | Needs | Impact |
|---|---|---|---|
| ~~B1~~ | ~~`git push` rejected~~ **CLEARED 2026-08-24** | `gh auth switch --user JoeYoussef44`. The account was in the keyring but not *active*. | Resolved. 13 merged PRs. |
| **B2** | **Vercel account recovery** | **Joe to finish account setup. Nobody else can do this.** | A live URL is **required, not optional** per the brief, and is now the *only* incomplete Tier 1 item. Also delays discovering production-only failures: serverless function timeout on the FHIR import, and Postgres connection exhaustion. |
| B3 | No Resend key | Optional | Email falls back to a console adapter. The flow still demos: the clinician gets a copy-link after sending. Resend's free tier only delivers to the account owner's own address anyway, so the console adapter is arguably the better demo. |

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

**What the demo database currently holds** — all fabricated, and all
reproducible from `npm run db:seed` plus one upload of the supplied sample CSV.
**Re-verified at the end of session 3:**

```
patients=3  assessments=8  completed=7  expired=1  labs=10  rate=88%
```

| | |
|---|---|
| 1 clinician | `clinician@pulsetrack.local` |
| 3 patients | `MRN-1001` Jane Doe · `MRN-1002` Samir Aoun · `MRN-1003` Rana Bitar |
| 8 assessments | 7 completed + 1 expired unanswered, so completion reads 88% not 100% |
| 10 lab results | the supplied `lab-results-sample-clean.csv`, source `CSV` |
| 1 lab upload | the import that produced them |

Leave the lab results in place: they are what gives the charts something to
draw on first run. If they are ever cleared, re-import
`.docs/lab-results-sample-clean.csv` through `/labs/upload`.

**If you send an assessment while testing, delete the row afterwards.** It adds a
9th assessment and moves the headline completion rate from 88% to 78%, which no
longer matches what this document and the PR bodies claim.

---

## 5. Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm start            # serve the build
npm run lint         # eslint
npm test             # vitest (188 tests)
npm run db:migrate   # prisma migrate dev
npm run db:deploy    # prisma migrate deploy (production)
npm run db:seed      # idempotent seed
npx prisma generate  # regenerate client into lib/generated/prisma
```

**Running a one-off script that imports `lib/` code:**

```bash
NODE_OPTIONS="--conditions=react-server" npx tsx script.ts
```

Without that flag, `server-only` throws — which is the guard working correctly,
not a bug. Two more traps in the same five minutes: the script needs
`import "dotenv/config"` as its first line (tsx does not load `.env` for you),
and it must wrap its body in `async function main()` — tsx compiles to CJS, so
a top-level `await` is a syntax error. The script must also live **inside the
project** for the `@/` path alias to resolve; a scratch copy outside it will not
import `@/lib/db`.

**Killing a stuck dev server** (Windows; `taskkill` flags get mangled through git-bash):

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

**Driving the app in a real browser — see §6a. This works, and it is how the
last two graded Tier 1 items were closed.**

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
| **tsx scripts** | No top-level `await` (cjs output), no automatic `.env`, and must sit inside the project for `@/` to resolve. |
| **Recharts x-axis** | A string x-axis is **categorical**: points plot in array order at even spacing whatever the labels say. A back-dated result draws a line that doubles back, and a year's gap looks like a day's. Use `type="number"` + `scale="time"` with millisecond timestamps, and sort in `lib/labs/series.ts`. |
| **Recharts single point** | One reading makes `dataMin === dataMax`, a zero-width domain where the marker vanishes or lands on the axis. `timeDomain()` pads a week either side. Every new patient hits this. |
| **Recharts + SSR** | Renders only a wrapper `<div>` on the server; `renderToStaticMarkup` returns 127 bytes and no `<svg>`, and jsdom has no layout either. **This is a limit of SSR and jsdom, not of headless verification — see §6a.** |
| **Tailwind `-mx-*` breakout** | The `-mx-5 overflow-x-auto sm:mx-0` edge-to-edge table pattern is only correct when the parent supplies matching padding. `Card` has **none** — it is `rounded-lg border bg-surface` — so a `-mx-5` inside a bare `Card` hangs the table 20px outside it, breaks the card border, and scrolls the whole page sideways. Correct inside a `px-5` wrapper (`upload-form.tsx`), wrong directly inside a `Card`. |
| **`truncate` in a fixed grid column** | Silently hides text at *every* width, not just mobile. The risk-band label read `not survey…` at 1280px for two sessions before anyone looked. Prefer wrapping over truncation for anything carrying meaning. |
| **Risk-band colours vs CVD** | The four band colours are a continuous green→yellow→orange→red ramp, so **any two neighbours are close**: moderate↔high measured ΔE 8.0 normal / **0.4 deuteran**. Never put them in touching segments (stacked bar, pie). Faceted rows with per-row labels are safe, and each band clears 3:1 on its own. |
| **Dashboard filters** | Completion rate is all-time (D-DASH-2) and the risk distribution is a register snapshot, so a global date filter would falsify them. The date range scopes the uploads card only, by design. |

---

### 6a. Browser verification works — this was previously believed impossible

Sessions 1 and 2 recorded that the charts "cannot be verified headlessly". **That
conclusion was wrong.** It was true of `renderToStaticMarkup` and of jsdom, and
was over-generalised to all headless verification. Headless **Chrome has real
layout**, so it renders Recharts exactly as a user sees it.

Chrome is installed at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
Drive it with `puppeteer-core`, **installed in the scratchpad, not the project**
— it is a verification tool, not a dependency, and adding it to `package.json`
would put a browser driver in a submission that does not need one.

```bash
cd <scratchpad> && npm init -y && npm install puppeteer-core
node shoot.js     # launch: { executablePath: CHROME, headless: "new" }
```

What that pass is worth doing for, each of which found something:

- **Measure `documentElement.scrollWidth - clientWidth` at 375px.** Anything
  above 1 means the page scrolls sideways. This found the `-mx-5` defect.
- **Walk every element's `getBoundingClientRect().right`** to name the culprit,
  rather than guessing which element overflowed.
- **Screenshot and actually look.** The truncated `not survey…` label passed the
  overflow check — it was only visible in the image.
- **Use `waitUntil: "domcontentloaded"`, not `networkidle0`.** `networkidle0`
  times out against this app.
- **Sleep ~1.2s after navigation before probing charts.** Recharts needs a
  client-side layout pass before `svg.recharts-surface` exists.
- **Open patient-facing pages in `browser.createBrowserContext()`** — a fresh
  cookie-less context. That is both how a patient actually arrives and a check
  that the page is authorised by its token alone.

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

**The README now documents all of this** with Mermaid diagrams, for the
evaluator rather than for us.

---

## 8. Decisions already made

Recorded in `.docs/01-challenge-analysis.md` §16 as `D-*` and §23, and now also
in the **README's "Decisions and tradeoffs" section**, which is the version an
evaluator reads. The ones that shape day-to-day work:

- **D-CSV-1** Required CSV columns are `mrn`, `collected_date`, `test_code`, `value`. `test_name`, `unit`, `ref_low`, `ref_high` are optional — warn, don't reject.
- **D-CSV-2** A re-uploaded row with a changed value is **skipped and reported**, never silently overwritten.
- **D-CSV-3** Seed `MRN-1001/1002/1003` so the supplied sample CSV imports 10/10 on a fresh database.
- **D-CSV row outcomes** Three states, not two: Accepted / Rejected / **Already imported**.
- **D-DASH-2** Completion rate = completed ÷ all sent, all time. `—` when the denominator is zero.
- **D-DASH-3** Risk distribution counts each patient once, by their latest *completed* assessment.
- **D-FHIR-2** Never push back data we pulled.
- **D-FHIR-5** Rebase `next` links (see §6).
- **D-CSV-5** A mismatched `unit` is stored **exactly as reported** and flagged, never relabelled to the canonical unit. A pure case/spacing difference (`MG/DL`) normalises silently.
- **D-CSV-6** A malformed or inverted `ref_low`/`ref_high` **warns and falls back to the catalog range**; it never rejects the row.
- **D-API-1** API routes are exempt from the edge redirect and authorise themselves with `requireClinicianApi()`. **Any new route handler must call it.**
- **D-DASH-4** Risk bands render as **one labelled bar per band, never a stacked bar or pie**.
- **D-DASH-5** The dashboard's date filter scopes the **uploads card only**.
- **D-CHART-1** One measure per chart, **never a dual axis**.

New in session 3:

- **D-QA-1** Browser verification tooling (`puppeteer-core`) lives in the
  scratchpad, **never in `package.json`**. It is how we check the work, not part
  of the product, and a submission should not ship a browser driver.
- **D-QA-2** After any test that mutates the demo database, restore it. The
  documented figures (88% completion, 3/8/10) appear in `state.md`, the README
  and several PR bodies; a stray test row silently falsifies all of them.

---

## 8b. Git workflow — follow this for every remaining phase

The repo is published at **https://github.com/JoeYoussef44/PulseTrack** with a
merge-based topology. History was restructured **before the first push**, so no
public commit was ever rewritten and no SHA changed.

| PR | Branch | Contents |
|---|---|---|
| #1 | `feat/data-model-and-seed` | schema, scoring, test catalog, pagination helper, seed |
| #2 | `feat/clinician-auth` | Auth.js v5, three-layer authorization |
| #3 | `feat/patient-management` | CRUD, search, validation |
| #4 | `feat/dsma8-assessments` | token → email → public form → scoring |
| #6 | `feat/csv-lab-import` | parser, classifier, service, endpoint, report UI |
| #8 | `feat/dashboards-charts` | trend charts, clinic metrics, risk bands, seed history |
| #9 | `feat/dashboard-upload-filter` | recent imports + date-range filter |
| **#12** | `docs/readme-and-diagrams` | **README: setup, architecture, ERD, 15 decisions** |
| **#13** | `fix/mobile-layout-375` | **three layout defects found in a real browser** |

**Every remaining phase ships the same way** — branch, incremental commits,
tests green, PR with real test output in the body, `--merge` (never squash),
branch kept after merge. The procedure is in `CLAUDE.md` under *Git workflow*.

Remaining branches: `feat/fhir-push`, `feat/fhir-pull-pagination`.

`backup/pre-restructure` is a **local-only** safety ref at the original
pre-restructure tip. `git diff backup/pre-restructure main` was verified empty.
Safe to delete once you are happy.

---

## 9. Next session — start here

**Tier 1 is done apart from the deployment.** The critical path now forks:

1. **B2 is Joe's, and it is the only incomplete Tier 1 item.** A live URL is
   required, not optional. Once the account is available:
   `vercel link`, set every `.env` value as a project env var, build command
   `prisma migrate deploy && next build`, then re-run the QA pass against the
   deployed origin. Deploying also flushes out the production-only failures
   nobody has seen: serverless function timeouts and Postgres connection
   exhaustion through the pooled URL.

2. **Tier 2 (Phase 7, `feat/fhir-push`) is not blocked and can start now.**
   Push first — it is the smaller, self-contained half. The three
   reconnaissance findings in §6 are the ones that will otherwise cost hours.
   The open question is still whether HAPI accepts `_tag` inside
   `If-None-Exist`; resolve it with a real write early, because **writes are
   permanent — DELETE is disabled on that server.**

   Note that Tier 2's own Definition of Done (§20) also requires the import to
   run to completion **from the deployed URL** without a function timeout, so
   Tier 2 cannot be fully closed while B2 is open either.

3. **Tier 2 adds to the README** — requirement 4 is an integration diagram, and
   §20 wants the idempotency design explained there. The README is structured to
   take that as a new section rather than a rewrite.

Tier 3 stays out of scope: its Definition of Done (§21) opens with "Tier 1 and
Tier 2 are complete, deployed and QA'd first."

Deeper context, if needed: `.docs/01-challenge-analysis.md` (requirements
matrix, security analysis, evaluator edge cases) and `.docs/candidate-brief.md`
(the authority on scope).
