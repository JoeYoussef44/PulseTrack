# PulseTrack — current state

> **Living document. Update it at the end of every working session.**
> Last updated: **2026-08-25**, session 5 (deployed — CI/CD, the Tier 2
> explainer, the ugly CSV, and the whole app verified against the live URL).

---

## 1. Where we are

**Tier 1 and Tier 2 are complete and deployed.** B2 is cleared: the app is
live at **https://pulse-track-joe.vercel.app**, building from git, and every
Definition-of-Done item that needed a deployment has now been run against it.
Session 5 merged PRs #21–#25.

What remains before submitting is housekeeping and two graded QA items, all
listed in §9. Nothing is blocked.

| Phase | Status |
|---|---|
| 0 · Repo, gitignore, FHIR recon | ✅ Complete |
| 1 · Schema, migration, seed, auth | ✅ Complete locally |
| 2 · Patient CRUD | ✅ Complete |
| 3 · Assessment flow | ✅ Complete |
| 4 · CSV importer | ✅ Complete |
| 5 · Dashboards + charts | ✅ Complete |
| 10 · README + diagrams | ✅ Complete (PR #12) |
| 6 · Tier 1 gate — deploy + QA | ✅ Complete. Deployed and re-verified live |
| 7 · FHIR client + push | ✅ Complete (PR #19) |
| 8 · FHIR pull + pagination | ✅ Complete (PR #20) |
| 9 · Tier 2 gate | ✅ **Complete.** Import runs from the deployed URL — §1b |
| 13 · Deploy + CI/CD | ✅ Complete (PRs #22–#24) |
| 11 · Submit | ⬜ **NEXT** — due Wed 2026-08-26 |
| 12 · Tier 3 (conditional) | ⬜ Only if 0–11 done |

### Tier 1 against the brief's own six areas

| Requirement | Done |
|---|---|
| Authentication | 100% |
| Patient management | 100% |
| Email questionnaire flow | 100% |
| CSV lab upload | 100% |
| Dashboards | 100% |
| Documentation (README) | 100% |
| Live Vercel URL | 100% — https://pulse-track-joe.vercel.app |

### Tier 2 against the brief's own four requirements

| Requirement | Done |
|---|---|
| 1 · Push patients and lab results | 100% |
| 2 · Pull the seeded patients and history | 100% — 5 patients, 180 observations |
| 3 · Auth, failures, retries, no double-import | 100% |
| 4 · Integration diagram in the README | 100% |
| Import running from the **deployed** URL | 100% — 5/5 patients, slowest 3.4s of a 60s ceiling |

---

### 1a. The Tier 2 explainer

`.docs/04-tier2-fhir-integration.html` and its rendered PDF explain the FHIR
integration the way `02-project-overview.html` explains the product: the
ownership trap with the probe output quoted, the pagination findings, the
idempotency guarantees, the failure policy, the performance findings, and what
the integration deliberately does not do. Written for a reader who has not seen
the code — it is the document to hand someone before a walkthrough call.

### 1b. The deployment, and what was verified against it

**Live: https://pulse-track-joe.vercel.app** — production off `main`, a preview
off `dev`, both built from git by Vercel. CI is GitHub Actions. See §10.

Measured against the live URL on 2026-08-25, not inferred:

| Check | Result |
|---|---|
| **FHIR import from the deployed URL** | 5/5 patients, **slowest 3418ms** against a 60000ms ceiling. Closes Tier 2's DoD. |
| Idempotency in production | `unchanged=36` per patient — the re-run wrote nothing |
| **Ugly CSV imported through the real UI** | 29 rows → **11 / 14 / 4**, matching the classifier exactly, in 1.6s |
| Secrets in the client bundle | 11 chunks, 595KB scanned: **zero** hits for the FHIR key, Resend key, `AUTH_SECRET` or `DATABASE_URL` |
| Auth boundary | `/dashboard` signed out → 307 to `/login` |
| Charts on a patient page | 3 charts, 36 plotted points, chronological |
| Layout at 375px and 1280px | zero horizontal overflow, no console or network errors |

**Two things are still unproven on the live URL** and should not be claimed:

- **The Neon cold start.** Every measurement above was taken against a warm
  database (first response 741ms). The scenario that matters — an evaluator
  opening the link days later onto suspended compute — still has never been
  observed end to end. Leave it idle an hour and load `/login`.
- **A real assessment email.** Not tested, deliberately: two patient records
  carry real inboxes (§4), so sending one would email a real person.

### 1c. The acceptance checklist is now the authority on QA

`.docs/03-tier1-acceptance-checklist.html` and its rendered PDF are the
pre-submission test plan: **112 numbered checks** derived from the brief, the
official attachments and the Definition of Done, each with how to test it.

Standing at the end of session 5: the **6 deploy-blocked checks are unblocked
and passing** (§1b), and **the ugly CSV is done** — `.docs/lab-results-ugly.csv`
with `.docs/05-ugly-csv-expected-outcomes.md`, imported through the live UI and
matching its predicted 11/14/4.

Still to do before submitting:

- **9.1 — clone into a clean directory and follow the README literally.** The
  first thing an evaluator does, on a machine that is not ours, and the one
  check this machine cannot honestly perform on itself.
- **Look at the empty and loading states** (7.1–7.3). See the correction below.

#### Correction: the empty and loading states exist

Earlier revisions of this file said they had not been built. **That was wrong**
and it was repeated for two sessions. They are implemented:

- `EmptyState` is used in **seven** places — dashboard, patients list, patient
  detail, lab upload, the FHIR integration page, `patient-trends`, and
  `recent-uploads`.
- Loading states use **React Suspense with skeleton fallbacks** on the
  dashboard, patients list and lab upload, plus a route-level `loading.tsx` for
  `/integrations/fhir`. The patients list keys its boundary on the query, so
  the skeleton reappears per search rather than showing stale rows.

**The real gap is that none of them has ever been seen.** The database has
always had data, so no empty state has rendered once, and the skeletons pass
too fast to inspect. That is the project's recurring failure in its usual form:
the code existing and its presentation being correct are two separate claims,
and only the first was ever checked. Verify against a scratch empty database
and with the network throttled.

---

## 2. Deadline

- Interview: **Thursday 2026-08-27, noon.**
- Submission must be sent **Wednesday 2026-08-26, end of day.**
- The brief says 7 days; the candidate email says "before Thursday" and **the email wins**.

---

## 3. Open blockers and live actions

| # | Item | State |
|---|---|---|
| ~~B1~~ | ~~`git push` rejected~~ | **CLEARED.** `gh auth switch --user JoeYoussef44`. 17 merged PRs. |
| ~~B2~~ | ~~Vercel deployment~~ | **CLEARED, 2026-08-25.** Live at https://pulse-track-joe.vercel.app, deploying from git. Everything it blocked has been re-verified against it — §1b. |
| ~~B3~~ | ~~No Resend key~~ | **CLEARED.** Resend is configured and sending — see §4a for the constraint that comes with it. |
| **A1** | **Rotate the Resend API key** | The key was pasted into a chat transcript. Revoke and reissue at resend.com/api-keys. Verified it never reached git history or the client bundle, but treat it as exposed. |
| **A2** | **Two patient records carry real personal inboxes** | See §4. `MRN-444` (outlook.com) and `MRN-3410` (gmail.com), both named "Joe Hassib Youssef". The brief says fabricated data only, and **an evaluator clicking Send assessment emails a real person**. Rename to `@example.test`, or delete `MRN-3410` and rename `MRN-444`. |
| **A3** | **Demo figures no longer match older PR bodies** | Now 10 patients / 16 assessments / 69% / 190 labs. Nothing in the README quotes the old numbers any more, so this is cosmetic — but the live site should look deliberate. |

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
| `APP_BASE_URL` | ✅ | `http://localhost:3000` locally. On Vercel it is set for **Production only** — a preview carrying it would email assessment links that leave the preview. Unset, `lib/actions/assessments.ts` falls back to `VERCEL_URL`. |
| `FHIR_BASE_URL` / `FHIR_CANDIDATE_ID` | ✅ | `cand-joe-l` (not a secret) |
| `FHIR_API_KEY` | ✅ | **Secret.** Never commit, never log, never `NEXT_PUBLIC_`. |
| `EMAIL_PROVIDER` | ✅ | `resend` |
| `EMAIL_API_KEY` | ✅ | **Secret, and due for rotation — see A1.** |
| `EMAIL_FROM` | ✅ | `"PulseTrack <onboarding@resend.dev>"` — quotes and the `Name <addr>` form both parse correctly |
| `AI_*` | ⬜ | Tier 3 only |

**Database:** Neon, Postgres 17.11, AWS us-east-1 (matches Vercel's default `iad1`).

### The demo database has drifted from what the docs claim

Measured at the end of session 3:

```
before session 4:  patients=4   assessments=13  labs=10   uploads=1  rate=69%
after  session 4:  patients=9   assessments=13  labs=190  uploads=1  rate=69%
after  session 5:  patients=10  assessments=16  labs=190  uploads=1  rate=69%
                   labs: 180 FHIR + 10 CSV · patients: 5 EXTERNAL_SEED + 5 OWNED
```

The session-5 delta is manual testing on the live URL, not the app misbehaving.
The ugly-CSV import was **restored afterwards** — 11 rows and their upload
record deleted, back to 190/1 — after first confirming none had been pushed to
the national platform, where a write cannot be undone (D-QA-2).

**The FHIR-imported rows are not drift** — they are Tier 2 working, they are
reproducible with one click from `/integrations/fhir`, and an evaluator should
see them. The pre-existing drift is separate and still needs a decision:

The documented state — quoted in the README, several PR bodies and earlier
revisions of this file — is **3 patients, 8 assessments, 88%**. The drift came
from manual testing plus verification runs that sent real assessments.

Two things need a decision before submitting:

1. **Restore or re-document.** Either clean back to 3/8/10 and 88%, or update
   every place that quotes those figures. Do not leave them disagreeing.
2. **Two records carry real personal inboxes** — `MRN-444 Joe Hassib Youssef`
   (outlook.com, 6 assessments) and `MRN-3410 Joe Hassib Youssef Test`
   (gmail.com, 1 assessment). `MRN-444` was added so Resend would actually
   deliver (§4a); `MRN-3410` is a test row from session 5. Three reasons to fix
   before submitting, worst last: the brief asks for fabricated data only; a
   record named "…Test" beside Jane Doe reads as leftover debugging; and
   **anyone clicking Send assessment on either one emails a real person, with
   no way of knowing.** Rename to `@example.test` and keep the assessment
   history — it is useful demo data, and losing real delivery costs nothing
   because every evaluator lands on the copy-link path anyway (§4a).

Everything is reproducible from `npm run db:seed`, one upload of
`.docs/lab-results-sample-clean.csv` through `/labs/upload`, and one **Import**
on `/integrations/fhir`.

### 4a. Email now sends, with one hard constraint

`EMAIL_PROVIDER=resend` is configured and verified end to end: the app's
message changes from "No email provider is configured" to Resend's own reply.

**Resend's free tier only delivers to the account owner's own address** until a
domain is verified at resend.com/domains. Its exact words, captured from the
app:

> You can only send testing emails to your own email address. To send emails to
> other recipients, please verify a domain.

So a fabricated recipient like `jane.doe@example.test` can never receive mail —
verified domain or not, because that domain does not exist. **Every evaluator
will land on the copy-link path.** That is by design and the brief allows it:
*"Emailing to test inboxes you own is fine."*

Keep `EMAIL_PROVIDER` unset in `.env.example`, so a fresh clone works with no
key and falls back to the console adapter plus the in-app copy-link.

---

## 5. Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm start            # serve the build
npm run lint         # eslint
npm test             # vitest (264 tests)
npm run typecheck    # next typegen && tsc --noEmit — see §6d
npm run db:migrate   # prisma migrate dev
npm run db:deploy    # prisma migrate deploy (production)
npm run db:seed      # idempotent seed
npx prisma generate  # regenerate client into lib/generated/prisma
```

**Before starting a server, check nothing already holds the port.** This cost
real time in session 3 — see §6b.

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess } |
  Select-Object Id, ProcessName, StartTime
```

Kill it with:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

**Running a one-off script that imports `lib/` code:**

```bash
NODE_OPTIONS="--conditions=react-server" npx tsx script.ts
```

Without that flag, `server-only` throws — the guard working correctly, not a
bug. Three more traps in the same five minutes: the script needs
`import "dotenv/config"` first (tsx does not load `.env`), it must wrap its body
in `async function main()` (tsx compiles to CJS, so top-level `await` is a
syntax error), and it must live **inside the project** for `@/` to resolve.

---

## 6. Hard-won gotchas — do not rediscover these

| Area | Finding |
|---|---|
| **Neon scale-to-zero** | The free tier suspends compute after a few minutes idle. The next connection cold-starts it — measured **3118 ms**. With no pool timeout configured that first request fails `P1001 "Can't reach database server"` while the database is perfectly healthy, and the retry succeeds, so it reads as random. `lib/db.ts` now sets `connectionTimeoutMillis: 15s` and `max: 5`. **An evaluator opening a link days later hits exactly this on their very first request.** |
| **Prisma 7 P2002 shape** | With a driver adapter — mandatory in Prisma 7 — **`error.meta.target` is `undefined`**. The field list moves to `meta.driverAdapterError.cause.constraint.fields`. `instanceof` and `error.code` are both still correct, which is why code reading only `target` looks right and silently never matches. Read both shapes. |
| **React form reset** | React resets an uncontrolled form once its action resolves, and the reset lands on `defaultValue`. A failed submission therefore clears every field unless the action echoes the submission back through `defaultValue`. |
| **`<select>` + `defaultValue`** | React applies `defaultValue` to a select **only on mount**, so a select still resets even when the text inputs are fixed. Key it on the echoed value to force a remount. |
| **Next 16 error boundaries** | The recovery prop is **`retry`**, not `reset`. `global-error.tsx` must supply its own `<html>`/`<body>` and gets **no global CSS**, so Tailwind classes do nothing there — style it inline. |
| **Resend free tier** | Delivers only to the account owner's own address until a domain is verified. Fabricated recipients never receive mail regardless. See §4a. |
| **FHIR pagination** | The server's `next` link points at `http://hapi:8080` — its **internal Docker host**, unreachable externally. Following it verbatim (as the API guide instructs) silently truncates every import to page one. `lib/fhir/pagination.ts` rebases onto our configured public base. **Confirmed working end to end: 36 observations over 2 pages per patient.** |
| **FHIR page size** | Each seed patient has **36** observations, not 180. At the guide's `_count=50` nothing paginates. We use **`_count=20`** so the loop genuinely runs (20 + 16). |
| **FHIR `bundle.total`** | Absent on paged responses. Loop control must depend on the `next` link only. |
| **FHIR ownership** | Seed patients are tagged `cand-admin`, not us. `_tag` works as a search param. **We now own 4 Patients (816–819) and 10 Observations.** |
| **FHIR conditional create — RESOLVED** | `_tag` **is** honoured inside `If-None-Exist`. Proof rather than inference: five other candidates already hold `MRN-1001`, so an unscoped search matches five and returns `412`; the tag-scoped POST returned `201`, and an identical second POST returned `200` with the same id (816). Writes are still permanent — DELETE is disabled. |
| **FHIR `Location` header** | Also carries the internal `hapi:8080` host, so it must be parsed and never fetched. The id is the segment **before** `_history`, not the last segment — reading the last one stores the version number as the resource id. |
| **FHIR conditional-create body** | This server *does* return a body on both `201` and `200`. The empty-body case is still handled, because the id is recovered from `Location` either way. |
| **Prisma 7** | `datasourceUrl` is gone; a driver adapter is mandatory. We use `@prisma/adapter-pg`. Client generates as **TypeScript** into `lib/generated/prisma`. |
| **Next 16** | `middleware.ts` is now **`proxy.ts`**, and it needs a real function export. |
| **Auth.js v5** | Needs `trustHost: true` — it only auto-trusts on Vercel. Without it every request 500s with `UntrustedHost`. |
| **Auth.js sessions** | JWT strategy is mandatory: database sessions are incompatible with the Credentials provider. |
| **React purity** | `Date.now()` during render is a lint **error**. Derive time-dependent state before the render tree. |
| **Zod 4** | `errorMap` is now `error`. |
| **Dates** | Always `parseIsoDate` / `toIsoDate`. Constructing from local components shifts the day west of UTC. |
| **Edge proxy vs API routes** | The proxy redirected unauthenticated `/api/*` to `/login`; a `fetch` follows it, gets login HTML with a 200, and parses it as JSON — so an expired session showed an *empty report*, not an error. API paths are exempt from the redirect, never from `requireClinicianApi()`. **Any new route handler must authorise itself.** |
| **csv-parse ragged rows** | With `relax_column_count`, a short row yields a record **missing those keys entirely**, so inferring columns from row one rejects the whole file when the first data row is short. Capture the header from the `columns` callback. |
| **csv-parse `info.lines`** | The real file line number (header = 1), already correct across blank lines — the number to show a clinician fixing the file in Excel. |
| **`tsc --noEmit` passes locally, fails on a clean checkout** | Next 16 generates its route/layout helper types (`LayoutProps`, `PageProps`) into `.next/types` during `next dev` and `next build`. Anyone who has run the dev server has them; a fresh clone does not. CI caught this on its own first PR. Fix is `next typegen`, wired into `npm run typecheck` so local and CI run one command — §6d. |
| **`next dev` edits CLAUDE.md** | It appends an agent-rules block and re-adds it whenever removed. Committed deliberately. |
| **Recharts x-axis** | A string x-axis is **categorical**: points plot in array order at even spacing. Use `type="number"` + `scale="time"` with millisecond timestamps, and sort in `lib/labs/series.ts`. |
| **Recharts single point** | One reading makes `dataMin === dataMax`, a zero-width domain where the marker vanishes. `timeDomain()` pads a week either side. Every new patient hits this. |
| **Recharts + SSR** | Renders only a wrapper `<div>`; `renderToStaticMarkup` returns 127 bytes and jsdom has no layout. **This limits SSR and jsdom, not headless verification — see §6a.** |
| **Tailwind `-mx-*` breakout** | `-mx-5 overflow-x-auto sm:mx-0` is correct **only when the parent supplies matching padding**. `Card` has none, so a `-mx-5` inside a bare `Card` hangs the table 20px outside it and scrolls the page sideways. |
| **`truncate` in a fixed grid column** | Hides text at **every** width, not just mobile. A risk-band label read `not survey…` at 1280px for two sessions. |
| **Risk-band colours vs CVD** | A continuous green→yellow→orange→red ramp, so neighbours are always close: moderate↔high measured ΔE 8.0 normal / **0.4 deuteran**. Never put them in touching segments. |
| **Dashboard filters** | Completion rate is all-time and the risk distribution is a register snapshot, so a global date filter would falsify them. The date range scopes the uploads card only, by design. |

---

### 6c. Two performance traps in the sync, both found by timing it

Neither was a bug in the usual sense — both were correct code that was
needlessly slow, and both were only visible because the run was timed.

- **A sequential batch.** 14 records took **12.8s** pushed one at a time, a
  fifth of a Vercel function's budget, while the throttle's concurrency cap of
  4 sat unused because nothing ever ran concurrently. Now 3.2s.
  **But making it concurrent introduced a real race:** an Observation whose
  patient is not yet linked pushes that patient itself, so two results for one
  unlinked patient issue two conditional creates whose searches both complete
  before either insert lands — a duplicate Patient on a server where DELETE is
  disabled. `pushPendingBatch` now links every referenced patient *before*
  sending any observation.
- **A re-import that rewrote everything.** The first import ran at 2.4s per
  patient; the second took **10s**, writing 180 unchanged rows back one at a
  time inside a transaction whose timeout is 20s. Linked rows are now compared
  before being written, so an unchanged re-import writes nothing: 2.1s.

The general lesson: **idempotent is not the same as cheap.** Both re-runs were
correct — same counts, no duplicates — and both were quietly heading for a
function timeout at any real data volume.

### 6a. Browser verification works — and how to do it

Sessions 1 and 2 recorded that the charts "cannot be verified headlessly".
**That was wrong**, and it left two graded items unverified for two sessions.
Headless **Chrome has real layout** and renders Recharts exactly as a user sees
it. Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

Drive it with `puppeteer-core`, **installed in the scratchpad, never in
`package.json`** (D-QA-1) — it is how we check the work, not part of the
product.

```bash
cd <scratchpad> && npm init -y && npm install puppeteer-core
# launch: { executablePath: CHROME, headless: "new" }
```

What that pass is worth doing for, each of which found something real:

- **Measure `documentElement.scrollWidth - clientWidth` at 375px.** Anything
  above 1 means the page scrolls sideways.
- **Walk every element's `getBoundingClientRect().right`** to *name* the
  culprit rather than guessing.
- **Screenshot and actually look.** The truncated `not survey…` label passed
  the overflow check; only the image showed it.
- **`waitUntil: "domcontentloaded"`, not `networkidle0`** — the latter times out
  against this app. Then `waitForSelector`, and sleep ~1.2s before probing
  Recharts, which needs a client-side layout pass.
- **Open patient-facing pages in `browser.createBrowserContext()`** — a fresh
  cookie-less context. That is how a patient arrives, and it checks the page is
  authorised by its token alone.

**Two ways a probe lies, both hit in session 3:**

- `page.click('button[type="submit"]')` matches the **header's Sign out button**
  first, because it comes earlier in the DOM. The test logged itself out and
  reported the app was broken. Scope to the form:
  `form.querySelector('button[type="submit"]')`.
- `page.type` into an `<input type="date">` follows the browser's **locale
  mask** (dd/mm/yyyy), so `"1990-01-01"` becomes an invalid date and Zod rejects
  it before the code under test is ever reached. Set `.value` directly and
  dispatch `input`/`change`.

A green-looking probe that never reaches the code under test proves nothing.

### 6b. Stale dev servers cost an hour

A background `npm start` left running from an earlier verification held port
3000. A later `.env` change appeared to have no effect, because the browser was
talking to a server booted **twelve minutes before the file was saved**. Next
then started the new dev server on **3001**, so two servers were live with
different environments.

Symptoms that should trigger this suspicion immediately:

- An env change "not taking effect" after a restart.
- `Another next dev server is already running` naming a different port.
- 500s on `/_next/static/chunks/*.js` — a server serving a chunk manifest that a
  rebuild has already replaced.

**Check the port and the process start time before debugging anything else**
(§5). Do not leave background servers running at the end of a task.

---

### 6d. Deployment gotchas

- **Environment variables are read at build time.** Adding one to Vercel does
  nothing to a deployment that already exists — redeploy, or it silently keeps
  the old value. This is the deployment equivalent of §6b's stale dev server.
- **`APP_BASE_URL` must be Production-only.** Set for Preview as well, a
  preview deployment emails assessment links pointing at production: the
  clinician tests on `dev` and the patient lands on the live site.
- **`dev` and `main` share one Neon database, so migrations must be additive.**
  `dev` deploys first and applies a migration while production is still running
  the previous code. Adding a nullable column or a table is safe; a drop or a
  rename breaks production the moment `dev` deploys — on the URL nobody was
  testing. Expand-then-contract, or split onto separate Neon branches.
- **`prisma migrate deploy`, never `migrate dev`,** in the build command.
  `migrate dev` is interactive and local-only.
- **Vercel does not run the test suite.** It runs `next build`. A red suite
  deploys perfectly happily, which is the entire reason GitHub Actions exists
  here — see §10.

---

## 7. Architecture at a glance

```
app/(auth)/login          public
app/(dashboard)/*         requires a session
app/assessment/[token]    public — authorised by the token alone
app/api/auth/*            Auth.js
app/api/fhir/sync         push one bounded batch     [new, session 4]
app/api/fhir/import       pull one seeded MRN        [new, session 4]
app/(dashboard)/integrations/fhir   the integration page   [new, session 4]

app/error.tsx             public-route boundary        [new, session 3]
app/(dashboard)/error.tsx in-layout boundary, keeps nav [new, session 3]
app/global-error.tsx      root-layout failure           [new, session 3]
app/not-found.tsx         404                           [new, session 3]

lib/assessments/  definition (loads official JSON) · scoring (pure) · token · service
lib/labs/         test-catalog · parse · classify (pure) · series (pure) · service (IO)
lib/dashboard/    metrics (pure) · service (IO)
lib/fhir/         systems · pagination · mappers · reconcile   (pure, tested)
                  config · client · throttle · errors           (server-only, holds the key)
                  push · pull · status · sync-hooks             (services)
lib/email/        provider abstraction + console/resend adapters
lib/validation/   zod schemas
lib/actions/      server actions — every one calls requireClinician()
lib/db.ts         Prisma singleton (server-only), pool tuned for cold starts
```

**Authorization is three layers deep**, because any one can be misconfigured:
`proxy.ts` (edge cookie check) → `auth()` in each page → `requireClinician()` in
each mutation. The README documents all of this with Mermaid diagrams.

---

## 8. Decisions already made

Recorded in `.docs/01-challenge-analysis.md` §16 and now also in the **README's
"Decisions and tradeoffs" section**, which is the version an evaluator reads.

- **D-CSV-1** Required CSV columns are `mrn`, `collected_date`, `test_code`, `value`. Others optional — warn, don't reject.
- **D-CSV-2** A re-uploaded row with a changed value is **skipped and reported**, never silently overwritten.
- **D-CSV-3** Seed `MRN-1001/1002/1003` so the supplied sample imports 10/10 on a fresh database.
- **D-CSV row outcomes** Three states, not two: Accepted / Rejected / **Already imported**.
- **D-CSV-5** A mismatched `unit` is stored **exactly as reported** and flagged, never relabelled. Case/spacing differences normalise silently.
- **D-CSV-6** A malformed `ref_low`/`ref_high` warns and falls back to the catalog range; it never rejects the row.
- **D-DASH-2** Completion rate = completed ÷ all sent, all time. `—` when the denominator is zero.
- **D-DASH-3** Risk distribution counts each patient once, by their latest *completed* assessment.
- **D-DASH-4** Risk bands render as one labelled bar per band, never stacked or a pie.
- **D-DASH-5** The dashboard's date filter scopes the **uploads card only**.
- **D-CHART-1** One measure per chart, **never a dual axis**.
- **D-API-1** API routes are exempt from the edge redirect and authorise themselves with `requireClinicianApi()`.
- **D-FHIR-2** Never push back data we pulled.
- **D-FHIR-5** Rebase `next` links (see §6).
- **D-QA-1** Verification tooling (`puppeteer-core`) lives in the scratchpad, **never in `package.json`**.
- **D-QA-2** Restore the demo database after any test that mutates it — its figures are quoted in the README, `state.md` and several PR bodies. *(Currently violated; see §4.)*

New in session 4:

- **D-FHIR-6** `conditionalCreate()` appends the `_tag` scope itself, so no
  caller can omit it. Verified: `_tag` **is** honoured inside `If-None-Exist`.
- **D-FHIR-7** Ownership is read from the response's own `meta.tag` before a
  resource is treated as writable — never inferred from the request succeeding.
- **D-FHIR-8** A patient syncs **inline** (6s budget) because the brief asks for
  a patient to sync when created; lab results are **queued** because a CSV is
  thousands of rows at one request each against a 60s function.
- **D-FHIR-9** On an import collision with a locally-held measurement, the link
  is attached and the **stored value is never overwritten** — the same rule as
  D-CSV-2. Disagreements are counted and shown, not resolved.
- **D-FHIR-10** `/api/fhir/import` takes MRNs from an allow-list, so an
  authenticated session cannot be used to read arbitrary records off a shared
  server.
- **D-FHIR-11** Email and phone are **not** pushed as `telecom`. Reads are open
  to every other candidate on that server.

New in session 3:

- **D-DB-1** The pg pool is configured explicitly rather than left to defaults:
  `connectionTimeoutMillis: 15s` for Neon's cold start, `max: 5` because each
  serverless instance gets its own pool and uncapped pools exhaust Postgres
  connection slots (risk R5).
- **D-ERR-1** Error boundaries are **layered, not global**. The dashboard
  boundary sits inside the layout so a failure keeps the nav and reads as one
  broken panel, not a dead site. The public boundary is worded for a patient,
  who cannot debug and must not be told their answers were saved when they may
  not have been.
- **D-ERR-2** The 404 never says *why* a record is missing. "No such patient"
  and "not yours to see" must look identical, or the 404 becomes a way to
  enumerate ids.

---

## 8b. Git workflow — follow this for every remaining phase

Published at **https://github.com/JoeYoussef44/PulseTrack**, merge-based
topology, 20 merged PRs, branches kept after merge.

| PR | Branch | Contents |
|---|---|---|
| #1 | `feat/data-model-and-seed` | schema, scoring, test catalog, pagination helper, seed |
| #2 | `feat/clinician-auth` | Auth.js v5, three-layer authorization |
| #3 | `feat/patient-management` | CRUD, search, validation |
| #4 | `feat/dsma8-assessments` | token → email → public form → scoring |
| #6 | `feat/csv-lab-import` | parser, classifier, service, endpoint, report UI |
| #8 | `feat/dashboards-charts` | trend charts, clinic metrics, risk bands, seed history |
| #9 | `feat/dashboard-upload-filter` | recent imports + date-range filter |
| #12 | `docs/readme-and-diagrams` | README: setup, architecture, ERD, 15 decisions |
| #13 | `fix/mobile-layout-375` | three layout defects found in a real browser |
| #15 | `docs/tier1-acceptance-checklist` | 112-check QA plan + PDF |
| #16 | `fix/duplicate-mrn-and-error-states` | P2002 crash, form value retention, four boundaries |
| #17 | `fix/db-cold-start-timeout` | Neon cold start, bounded pool |
| #19 | `feat/fhir-push` | FHIR client, mappers, retry/throttle, push, integration page |
| #20 | `feat/fhir-pull-pagination` | seeded import, pagination, reconciliation, README diagram |
| #21 | `docs/tier2-explainer` | Tier 2 explainer HTML + 15-page PDF; four corrected numbers |
| #22 | `chore/vercel-cicd` | `vercel.json`, GitHub Actions CI, env-var script, README deploy section |
| #23 | `dev` → `main` | first promotion through the new flow |
| #24 | `dev` → `main` | deployment badge, outside production |
| #25 | `test/ugly-csv` | the deliberately ugly CSV + expected-outcomes document |

### The branch flow changed in session 5

`main` is Vercel **Production**; `dev` is the **Preview** URL; every other
branch gets its own preview deployment. Work now flows **feature → dev → main**,
and `CLAUDE.md` is updated to match — it previously said to branch off `main`
and PR into it.

Branch, incremental commits, tests green, PR with real output in the body,
`--merge` (never squash). CI now runs on every PR into `dev` and `main`.

---

## 9. Next session — start here

**Tier 1 and Tier 2 are complete, deployed and verified live.** Nothing is
blocked. What is left is one submission-blocking fix and a short QA tail, in
the order they should be done.

1. **Fix the two real email addresses (A2).** The only item that would actively
   count against the submission: the brief says fabricated data only, and an
   evaluator clicking *Send assessment* on either record emails a real person.
   Rename to `@example.test`, keep the assessment history.

2. **Rotate the Resend key (A1).** Joe's, and nobody else can. Verified never
   in git history or the client bundle, but it was pasted into a transcript.

3. **Look at the empty and loading states** (checklist 7.1–7.3). Explicitly
   graded — *"a dashboard with no data should look intentional, not broken"* is
   the brief's own sentence. **They are built; they have never been seen** (see
   the correction in §1c). Point a local run at a scratch empty database, walk
   all five pages, throttle the network to hold the skeletons still, and look.

4. **The fresh-clone dry run** (9.1). Clone into a clean directory and follow
   the README literally. The first thing an evaluator does, and the one check
   this machine cannot honestly perform on itself.

5. **Then the cold start.** Leave the deployment idle an hour and load
   `/login`. It is the single request an evaluator is guaranteed to make and
   the one path never observed working end to end (§1b).

6. **Write the submission email.** Repo link, live URL, what is built, what is
   deliberately not.

7. **Tier 3 stays out of scope** unless 1–6 are all done — its own Definition
   of Done opens with "Tier 1 and Tier 2 are complete, deployed and QA'd
   first," and the brief warns it evaluates *"judgment, not ambition."*

---

## 10. Deployment and CI/CD

| | |
|---|---|
| **Production** | https://pulse-track-joe.vercel.app — built from `main` |
| **Preview** | built from `dev`, and from every other branch |
| **CD** | Vercel git integration. Build command is in `vercel.json`, not the dashboard, so it is version-controlled: `prisma migrate deploy && next build` |
| **CI** | `.github/workflows/ci.yml` — lint, typecheck, tests on every PR into `dev` and `main`. Vercel does **not** run the suite, which is the whole reason this exists |
| **Env vars** | `bash scripts/vercel-env.sh` pushes `.env` to production and preview. Prints names only, never values. Holds back `APP_BASE_URL` (production-only) and `SEED_CLINICIAN_*` (never read by a build) |

CI does not run `next build` — Vercel builds every push already, so duplicating
it buys nothing and would need real environment variables to mean anything.

A small badge in the dashboard header shows `Preview · <sha>` on any
non-production deployment, so the two identical-looking URLs can be told apart
and you can see which commit is actually serving. It renders nothing in
production and nothing locally.

Full setup steps are in the README's **Deployment and CI/CD** section.

---

Deeper context: `.docs/01-challenge-analysis.md` (requirements matrix, security
analysis, evaluator edge cases), `.docs/03-tier1-acceptance-checklist.html`
(the QA plan), `.docs/04-tier2-fhir-integration.html` (Tier 2 explained),
`.docs/05-ugly-csv-expected-outcomes.md` (what the messy file should produce)
and `.docs/candidate-brief.md` (the authority on scope).
