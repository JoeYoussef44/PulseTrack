# PulseTrack — current state

> **Living document. Update it at the end of every working session.**
> Last updated: **2026-08-26**, session 7 (the sign-in page and the mark, the
> user guide, and a sweep of the leftovers).

---

## 1. Where we are

**Tier 1 and Tier 2 are complete and deployed.** B2 is cleared: the app is
live at **https://pulse-track-joe.vercel.app**, building from git, and every
Definition-of-Done item that needed a deployment has now been run against it.
Session 5 merged PRs #21–#25; session 6 merged #26–#30; session 7 merged
#31–#34.

**A2 is cleared** — no record carries a real identity any more (§4b) — the
empty and loading states have now been *seen*, not merely counted (§1d), and
the dashboard, register and patient page were rebuilt around a clinical frame
(§1e) which is **live in production and verified there**.

Session 7 rebuilt the **sign-in page** and gave the product a **mark and a real
favicon** (§1f, live), wrote the **user guide** an evaluator can read before a
walkthrough call (§1g), and swept the repo's scaffold leftovers.

What remains before submitting is in §9. Nothing is blocked. **`main` is three
commits behind `dev`** — #34 was merged to `dev` only.

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
| 14 · Clinical UI layout | ✅ Complete and live (PRs #29, #30) |
| 15 · Sign-in page, mark, favicon | ✅ Complete and live (PRs #32, #33) |
| 16 · User guide + repo sweep | ✅ Complete on `dev` (PR #34) |
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

Standing at the end of session 6: the **6 deploy-blocked checks are unblocked
and passing** (§1b), **the ugly CSV is done** — `.docs/lab-results-ugly.csv`
with `.docs/05-ugly-csv-expected-outcomes.md`, imported through the live UI and
matching its predicted 11/14/4 — and **7.1–7.3 are done**: the empty and
loading states have been rendered and looked at (§1d).

Still to do before submitting:

- **9.1 — clone into a clean directory and follow the README literally.** The
  first thing an evaluator does, on a machine that is not ours, and the one
  check this machine cannot honestly perform on itself.
- **Re-run the layout checks that the UI rebuild touches** on the live URL as
  part of the final pass. §1e and §1f record what has been measured there
  already — the dashboard, register and patient page after #30, and the
  sign-in page at five widths after #33.

#### How this section read for two sessions, and why

Earlier revisions of this file said the empty and loading states had not been
built. **That was wrong** and it was repeated for two sessions. They are
implemented:

- `EmptyState` is used in **seven** places — dashboard, patients list, patient
  detail, lab upload, the FHIR integration page, `patient-trends`, and
  `recent-uploads`.
- Loading states use **React Suspense with skeleton fallbacks** on the
  dashboard, patients list and lab upload, plus a route-level `loading.tsx` for
  `/integrations/fhir`. The patients list keys its boundary on the query, so
  the skeleton reappears per search rather than showing stale rows.

Session 5 then narrowed the gap to **none of them had ever been seen** — the
database has always had data, so no empty state had rendered once, and the
skeletons pass too fast to inspect. Session 6 closed it: §1d. The lesson is
worth keeping in its general form, because it recurs here in new places every
session — **the code existing and its presentation being correct are two
separate claims, and only the first is ever cheap to check.**

### 1d. The empty and loading states have now been seen

Session 5 corrected the claim that they had not been built. Session 6 closed the
narrower gap that correction left open: **they had never been looked at**,
because the database has always had data.

Method, repeatable: create a scratch Neon database (`CREATE DATABASE
pulsetrack_empty` over `DIRECT_URL`), `prisma migrate deploy` into it, seed the
clinician *only*, then serve a **production build** against it. Skeletons were
held still with CDP throttling at 40 kbit/s and 400 ms latency.

Result: **nine empty states, all of which read as intentional** — dashboard,
patients list, no-match search, lab upload, FHIR page, and four on a
freshly-created patient. Plus the state nobody had thought about, one patient
with no activity: `1 · 0 assessed · 1 not yet`, completion `—`, all bands zero.
Zero horizontal overflow at 375 and 1280; no stuck skeletons.

Two defects came out of it, both fixed:

- **`/integrations/fhir`'s `loading.tsx` had stopped matching its page** — four
  figures in four columns against the page's six in three, so the grid reflowed
  when content arrived, while the file's own comment claimed it would not. It
  drifted when the pull side added two figures in PR #20. Fixed in **#27**; the
  heading now lives in one file imported by both, because writing it out twice
  is what let them diverge.
- **The empty dashboard left a dead half-row** once the body became two columns
  — fixed with an `auto-fit` grid (§1e).

The scratch database was dropped afterwards. **Recreate it rather than trusting
this note** if the empty states need re-checking.

### 1e. The clinical UI layout (PRs #29 and #30, live)

The shell was `max-w-6xl` centred, so it rendered **1104px of content on every
monitor**: 86% of a 1280px screen, 77% of 1440, **57% of 1920 with 408px of dead
margin each side**. The diagnosis was not "too narrow" but "one column" —
widening alone would only have given the risk bars more empty track.

| | Before | After |
|---|---|---|
| Content width at 1920 | 1104px (57%) | fluid to 1600px |
| Patient page, 3 lab series | 1631px tall | **1366px**, four charts at once |
| Horizontal overflow at 375px | 0 | **0**, all five pages |
| Tests | 264 | **268** |

What changed: navigation moved to a fixed 232px rail on a new `--color-deep`
(the frame Epic, Athenahealth, Elation and Medplum share); a `PageHeader`
primitive gives every page one title row with one action slot; the patient
page's details card became a sticky identity banner with the four charts in one
grid and the two record tables abreast; the dashboard leads with four equal
tiles and puts the distribution beside the imports; the register gained **latest
band** and **last result**.

What deliberately did not change: **the palette**. It is derived from
`questionnaire-dsma8.json` and documented in `globals.css`; four tokens were
added, none replaced, and the risk ramp is byte-for-byte identical.

**Verified on production**, not on a local build: all five pages at 1920 and
375px, zero horizontal overflow, no console or network errors.

### 1f. The sign-in page, the mark and the favicon (PRs #32, #33, live)

Two facts settled the shape of this before anything was built. The login page
was **1104px of centred box on an empty field** — #29's diagnosis, one page
later. And `app/favicon.ico` was **still the `create-next-app` file**,
untouched since the initial commit, so the live site had been showing the
Next.js logo in the browser tab for the whole project.

Now: a pulse-trace mark, deliberately short on vertices because a favicon is
read at 16px; a split page with the product on `--color-deep` — the rail's own
surface, so signing in and using the app read as one product — beside the form;
the panel dropped below `lg` with the mark moving above the card, the way the
rail becomes a bar; and one `<Wordmark/>` serving the rail, the mobile bar and
the login page in place of four hand-typed copies of two strings.

**The geometry is defined once**, in `lib/brand/mark.ts`. The React component
and the generated `app/icon.svg` both import it — see D-BRAND-1.
`app/favicon.ico` is rasterised from that SVG at 16/32/48 by the scratchpad's
headless Chrome and committed as a binary; `scripts/build-icons.ts` regenerates
the SVG and its header says how the ICO is redone.

Measured on a production build and then on production itself:

| Check | Result |
|---|---|
| Horizontal overflow | **0** at 1920, 1440, 1280, 768 and 375 |
| Icons served | `/icon.svg` 200 `image/svg+xml`; `/favicon.ico` 200 `image/x-icon` |
| Icons **decode** | 48×48 and 32×32 in-browser — a favicon that 404s looks identical to one that works |
| Live `favicon.ico` | byte-identical to the committed blob |
| Sign-in | still works end to end |

One correction worth keeping: the first cut pinned the panel's text to the left
edge of a 960px column at 1920 and left a dead middle. **The screenshot said so;
the overflow measurement did not.**

### 1g. The user guide (PR #34, on `dev`)

`.docs/06-using-pulsetrack.html` and a 16-page PDF: every screen, what happens
when you click, and the rules the app will not break, across both tiers. It
exists because the three documents already in `.docs` explain the product, the
QA plan and the integration, and **none of them answers "what happens when I
press this button."**

Written from the code, not from memory — the CSV rejection rules, the token
lifecycle, the band thresholds, the batch sizes and the page counts were each
read out of the implementation before being written down.

Rendering it found **four defects invisible in the markup**: text bleeding out
of nine boxes across all three diagrams, a dashed rule 100 units past its
viewBox, six cards in a four-column grid leaving two empty cells as a bare grey
block, and a PDF rendering **dark-theme text onto the print stylesheet's white
page**. See §6e for the two that generalise.

The preview URL could not be checked from here — Vercel deployment protection
puts previews behind an SSO login, so a preview answers `200` and then redirects
to a Vercel sign-in. **Preview verification is a human step**; scripted checks
have to run against a local production build or against production itself.

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
| ~~A1~~ | ~~Rotate the Resend API key~~ | **CLOSED by Joe, session 6** — "not an issue any more". Recorded rather than silently dropped: the key was pasted into a chat transcript, and it was verified never to have reached git history or the client bundle. |
| ~~A2~~ | ~~Two patient records carry real personal inboxes~~ | **CLEARED, session 6.** Both renamed to fabricated identities and re-pushed to the platform — §4b. |
| **A3** | **Demo figures no longer match older PR bodies, and drifted again** | Now **10 patients / 16 assessments / 69% / 201 labs / 2 uploads** — the ugly-CSV rows are back in the shared database, imported during a verification run and not restored (D-QA-2 not honoured). Found by accident, in the corner of a screenshot taken for something else. Nothing in the README quotes the old numbers, so this is cosmetic — but the live site should look deliberate. |
| ~~A4~~ | ~~PR #29 is on `dev`, not production~~ | **CLEARED, session 6.** Promoted in #30 and verified live — §1e. |
| **A5** | **`main` is three commits behind `dev`** | #34 — the user guide, the charset fix and the scaffold-asset removal — was merged to `dev` only, as asked. Documentation and dead assets, no schema change, so promoting is a merge whenever it is wanted. |

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
| `EMAIL_API_KEY` | ✅ | **Secret.** Rotation was considered and closed by Joe — see A1 in §3. |
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
seen   session 7:  patients=10  assessments=16  labs=201  uploads=2  rate=69%
```

The session-5 delta is manual testing on the live URL, not the app misbehaving.
The ugly-CSV import was **restored afterwards** — 11 rows and their upload
record deleted, back to 190/1 — after first confirming none had been pushed to
the national platform, where a write cannot be undone (D-QA-2).

**It came back.** Session 7 read 201 labs and two uploads off the live
dashboard, with `lab-results-ugly.csv` in recent imports: the same 11 rows,
re-imported by a later verification run and not restored. Nobody was looking
for it — it was legible in a screenshot taken to check the navigation rail.
D-QA-2 is only as good as the person remembering it, which is the argument for
deciding A3 rather than re-cleaning a third time.

**The FHIR-imported rows are not drift** — they are Tier 2 working, they are
reproducible with one click from `/integrations/fhir`, and an evaluator should
see them. The pre-existing drift is separate and still needs a decision:

The documented state — quoted in the README, several PR bodies and earlier
revisions of this file — is **3 patients, 8 assessments, 88%**. The drift came
from manual testing plus verification runs that sent real assessments.

One thing still needs a decision before submitting (A3):

**Restore or re-document.** Either clean back to 3/8/10 and 88%, or accept
10/16/190 as the demo state. Nothing in the README quotes the old figures any
more, so this is presentation, not correctness — but do not leave two numbers
disagreeing anywhere an evaluator reads.

*(The second item here, the two records carrying real personal inboxes, was
fixed in session 6 — §4b.)*

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

### 4b. The two real identities are gone — what was done, and what could not be

`MRN-444` and `MRN-3410` both carried Joe's real name, a real inbox, a real
mobile number and a real date of birth. Session 6 replaced both with fabricated
identities, keeping their assessment history:

| MRN | Now | Kept |
|---|---|---|
| `MRN-444` | Nour Chalhoub · `nour.chalhoub@example.test` · +961 3 111 444 · 1971-08-19 | 6 assessments |
| `MRN-3410` | Elias Mansour · `elias.mansour@example.test` · +961 3 111 410 · 1989-03-17 | 1 assessment |

**Probed before changing anything.** Both were `OWNED`/`SYNCED` on the national
platform (resources 819 and 830), so the real **name and date of birth were on a
shared, publicly readable server**. D-FHIR-11 held — no `telecom` was ever
pushed — so the email and phone never left this machine. Both resources were
re-pushed through `pushPatient`'s PUT path and now read the fabricated names.

**One thing that cannot be undone, and must not be claimed otherwise:**
`GET /Patient/819/_history/1` still returns `200` with the original name. That
server disables DELETE, so the superseded version stays in its history. The
current version — what any read, search or import returns — is clean.

Verified against **production**, not inferred: signed in to
`/patients` on the live URL and grepped the rendered page for `Joe`, `Hassib`,
`Youssef`, `Test`, `outlook`, `gmail`. All absent.

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

npx tsx scripts/build-icons.ts   # rewrite app/icon.svg from the mark geometry
```

Regenerating **`app/favicon.ico`** is a separate, deliberate step: it is
rasterised from `app/icon.svg` at 16/32/48 by the scratchpad's headless Chrome
and committed as a binary, because the rasteriser stays out of `package.json`
(D-QA-1, D-BRAND-2). The script's header says how.

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
| **Tailwind utility conflicts** | Two utilities for the same property are resolved by **their order in the generated stylesheet**, not the order they appear in `class`. Passing `text-deep-ink` alongside a variant's `text-ink-2` is a coin toss — and it lost, rendering the rail's Sign out near-invisible. Add a variant instead; a variant cannot conflict with itself. |
| **Grid tracks blow out at 375px** | A CSS grid track sized `auto` takes its minimum from the item's **min-content**, so a card holding a `min-w-[520px]` table drags the whole column past the viewport — 283px of it. A column flexbox does not do this, which is why wrapping cards in a grid regressed a layout that had been clean. Tailwind's numbered `grid-cols-*` are `minmax(0, 1fr)` and cannot: **always name the single-column case**, `grid-cols-1`, not bare `grid`. |
| **A grid with one child** | `xl:grid-cols-2` leaves a dead half-row when one child renders `null` — which the dashboard does when there are no patients. `repeat(auto-fit, minmax(min(30rem, 100%), 1fr))` collapses the empty track, and the `min()` is what keeps the track from being wider than a phone. |
| **A file open in Excel blocks `git checkout` and `git pull`** | `unable to unlink … Invalid argument`, then `Device or resource busy`. The working tree sat on a 22-commit-stale `main` for part of session 7 because `.docs/lab-results-ugly.csv` was open. Nothing is wrong with git — close the file and pull. |
| **`.html` opens nothing on this machine** | The association is `.html → htmlfile → "C:Program FilesInternet Exploreriexplore.exe"`, and IE does not run on Windows 11, so a double-click hands the file to a browser that is not there. The per-user default is Edge; anything going through the classic association misses it. Open with `start msedge "<path>"`. **The `.docs` HTML files are fine** — this is why they looked broken. |
| **An HTML file with no `<meta charset>`** | Chrome sniffs UTF-8; a browser opening a `file://` URL under a Windows locale is entitled to fall back to windows-1252 and render every em dash as `â€"`. Three of the four `.docs` documents were relying on the guess. **Do not fix it with a doctype** — adding one switches quirks mode to standards mode and can move a layout whose PDF has already been rendered. |
| **`emulateMediaFeatures` does not survive `emulateMediaType("print")`** | A PDF rendered under a dark OS setting comes out as dark-theme text on the print stylesheet's white page — unreadable, and it looks fine on screen right up until the PDF is opened. Set the stylesheet's own `data-theme="light"` opt-out instead, and assert `getComputedStyle(body).color` before writing the file. |
| **The Next dev overlay hides the bottom-left corner** | The dev-tools badge sits exactly where the rail's Sign out button is, so every development screenshot showed it covered rather than broken. **Any UI claim about that corner has to come from a production build.** |

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

**It recurred in session 6, in a worse form.** A verification run against a
deliberately *empty* database reported clean, intentional empty states — and it
was reporting on the **real** database. The previous server still held port
3000, so `next start` had died with `EADDRINUSE` and the probe talked to the
server that was already there. The output looked exactly like a pass.

Two lessons on top of the original:

- **Killing the shell that launched a server does not kill the server.** Kill by
  port, then assert the port is free, before starting the next one.
- **Read the server log, not only the probe output.** The give-away was
  `EADDRINUSE` in the log and "10 patients" in an empty-state screenshot — the
  probe itself was perfectly happy.

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

### 6e. Two ways verification lied in session 7, in opposite directions

Both are the same lesson from sessions 3, 5 and 6, and both are worth writing
out because each arrived wearing new clothes.

**A red probe that lied.** The sign-in probe reported a failure that was not
real: it read `page.url()` after `waitForNavigation`, but a server action
redirects **client-side**, so it checked before the redirect landed. The
credentials were correct all along. Every previous instance in this file is a
*green* probe passing without reaching the code under test; this is the mirror
image, and it is more dangerous, because the reflex — "the app is broken" —
sends you to fix the wrong thing. **A probe's verdict is a claim about the
probe until its mechanism is understood.** Wait on the pathname changing, not
on a navigation event.

**A checker that only looked one way.** The document checker compared SVG text
against *text* and reported clean. Nine labels were bleeding out of their
boxes. Session 5's checker had the opposite blind spot — it tested text against
boxes and missed a text-on-text collision — so between the two sessions the
same figure class has now been wrong in both directions. Adding the missing
direction found **two more, in a diagram that already looked clean**.

The general form, third session running: **a check that passes tells you only
about the thing it checks.** When one is written to catch a defect, ask what
its mirror image would be and write that too.

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

components/shell/nav.tsx  rail + bar navigation, active state [new, session 6]
components/brand/mark.tsx Mark + Wordmark, both tones      [new, session 7]
components/auth/brand-panel.tsx  the login page's left half [new, session 7]

app/icon.svg              generated from lib/brand/mark.ts [new, session 7]
app/favicon.ico           rasterised from app/icon.svg     [new, session 7]

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
lib/brand/        mark geometry — the one definition (D-BRAND-1)
lib/db.ts         Prisma singleton (server-only), pool tuned for cold starts

scripts/build-icons.ts    writes app/icon.svg from lib/brand/mark.ts
scripts/vercel-env.sh     pushes .env to Vercel, names only

components/ui/    Button · Field · Input · Select · Card · CardHeader · Alert
                  PageHeader · EmptyState · Skeleton · Badge   — no UI library
components/patients/identity-banner.tsx   sticky patient identity [session 6]
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
- **D-QA-2** Restore the demo database after any test that mutates it — its figures are quoted in the README, `state.md` and several PR bodies. *(Honoured since session 5: the ugly-CSV rows and the session-6 scratch database were both removed afterwards. The pre-existing drift is A3.)*

New in session 7:

- **D-BRAND-1** The mark's geometry lives in `lib/brand/mark.ts` and nowhere
  else. The React component and the generated `app/icon.svg` both import it,
  because drawing one shape twice in a `.tsx` and an `.svg` is exactly how the
  FHIR loading skeleton drifted from its own page (#27). `app/favicon.ico` is
  rasterised from that SVG rather than drawn again.
- **D-BRAND-2** The favicon rasteriser is the scratchpad's headless Chrome, so
  the `.ico` is a committed binary rather than a build step. Keeping
  `puppeteer-core` out of `package.json` (D-QA-1) matters more than making one
  small binary reproducible from a committed script.
- **D-DOC-1** A rendered document is verified by **measuring the render** —
  overflow, text against its box, text against text, shapes against the
  viewBox, empty grid cells, and clipping at print width — and then by looking
  at it. Four defects in the user guide were invisible in the markup.
- **D-DOC-2** The `.docs` HTML files declare `<meta charset="utf-8">` but
  **not** a doctype. A doctype switches quirks mode to standards mode and can
  move a layout whose PDF has already been rendered and shipped.

New in session 6:

- **D-UI-1** Navigation is a **fixed rail** from `lg` up and the previous
  horizontal bar below it. One list in `components/shell/nav.tsx` renders both,
  so a new destination cannot appear in one and silently not the other.
- **D-UI-2** The work area is **fluid to 1600px**, not full-bleed. Unbounded
  line length is its own defect and a register still has to be scannable.
- **D-UI-3** Every page's title and primary action go through `PageHeader`.
  Each page had been inventing its own, and the action ended up wherever that
  page happened to put it.
- **D-UI-4** The palette is **not** re-chosen. It is derived from
  `questionnaire-dsma8.json` and documented in `globals.css`; the rebuild adds
  four tokens and replaces none. The risk ramp is byte-for-byte identical,
  because moderate↔high sit at ΔE 0.4 under deuteranopia and every band must
  keep its written label.
- **D-UI-5** Risk bars are **capped at 26rem** rather than fluid. A 10% bar in
  an 800px track is a mark adrift; length only compares when the eye can hold
  both ends.
- **D-UI-6** The dashboard's fourth tile is **higher risk**, not "not yet
  assessed" — tile one and the distribution both already say the latter. It
  comes from `higherRiskCount`, a pure function over the same segments the
  chart draws, asserted against the chart in a test so the two cannot disagree.
- **D-UI-7** `clinicMetrics` is wrapped in React `cache`. The tiles and the
  distribution stream into different columns and so cannot share one `await`;
  without it that is two identical sets of four queries per load.
- **D-QA-3** A UI claim is made from a **production build**, never the dev
  server. Three real defects survived every development screenshot this session
  — see §6.

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
topology, 30 merged PRs, branches kept after merge.

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
| #26 | `docs/session-5` | the session 5 record |
| #27 | `fix/fhir-loading-skeleton` | the loading state that had stopped matching its page |
| #28 | `dev` → `main` | promotion of #25–#27 |
| #29 | `feat/clinical-ui-layout` | the rail, the fluid work area, the patient banner, the four tiles, the register columns |
| #30 | `dev` → `main` | promotion of #29 — the new UI is live |
| #31 | `docs/session-6` | the session 6 record |
| #32 | `feat/login-and-brand-mark` | the split sign-in page, the mark, and a favicon that is not the scaffold's |
| #33 | `dev` → `main` | promotion of #31 and #32 — the new login page is live |
| #34 | `docs/user-guide` | the user guide + PDF, the charset fix, and the scaffold-asset sweep — **on `dev`, not yet promoted** |

### The branch flow changed in session 5

`main` is Vercel **Production**; `dev` is the **Preview** URL; every other
branch gets its own preview deployment. Work now flows **feature → dev → main**,
and `CLAUDE.md` is updated to match — it previously said to branch off `main`
and PR into it.

Branch, incremental commits, tests green, PR with real output in the body,
`--merge` (never squash). CI now runs on every PR into `dev` and `main`.

---

## 9. Next session — start here

**Tier 1 and Tier 2 are complete, deployed and verified live**, and the new UI,
the sign-in page and the mark are live too. Nothing is blocked. Sessions 5–7
cleared everything that was submission-blocking; what is left is two checks
this machine cannot fake, one cosmetic decision, one promotion, and the email.

1. **The fresh-clone dry run** (checklist 9.1). Clone into a clean directory
   and follow the README literally, on a machine that is not this one. The
   first thing an evaluator does, and the one check this machine cannot
   honestly perform on itself. CI has already caught one defect of this class —
   the `LayoutProps` typegen failure in session 5.

2. **The cold start.** Leave the deployment idle an hour and load `/login`. It
   is the single request an evaluator is guaranteed to make and the one path
   never observed working end to end (§1b).
   **Correction to the session 6 plan:** the clock **cannot** run in parallel
   with other work. Every deploy runs `prisma migrate deploy`, which connects
   to Neon and wakes the compute, so this has to be **the last thing done,
   after the final deploy** — not the first.

3. **Promote #34 to `main`** (A5). The user guide, the charset fix and the
   scaffold-asset removal are on `dev` only. Documentation and dead assets, no
   schema change — a `dev → main` PR and a merge.

4. **Decide A3, the demo figures.** Restore, or accept 10/16/201/2 and say so.
   Cosmetic, but do not leave two numbers disagreeing anywhere an evaluator
   reads — and note the ugly-CSV rows have now come back **twice**, so
   restoring a third time without changing the habit will not hold.

5. **Write the submission email.** Repo link, live URL, what is built, what is
   deliberately not, and the things measured rather than claimed — the FHIR
   import timing, the ugly-CSV outcome, the layout numbers. Point at
   `.docs/06-using-pulsetrack.html` (§1g): it is the document to hand someone
   before a walkthrough call.

6. **Optional, only if 1–5 are done:** phases D and E of the interface plan —
   the density/table pass and chart reference bands. Both are real improvements
   with a poorer ratio than A–C. Phase F (icons) is cut: a new dependency and a
   new licence question the night before a deadline.

7. **Tier 3 stays out of scope** unless 1–5 are all done — its own Definition
   of Done opens with "Tier 1 and Tier 2 are complete, deployed and QA'd
   first," and the brief warns it evaluates *"judgment, not ambition."*

### Closed in session 7, do not redo

- ~~The sign-in page and the favicon~~ — done and **live**, §1f.
- ~~A document explaining how to use the app~~ — done, §1g. On `dev`.
- ~~The `.docs` HTML files "cannot be opened"~~ — not the files; it is this
  machine's `.html` → Internet Explorer association. §6. The files were kept:
  they are the sources the PDFs are rendered from.
- ~~Scaffold leftovers in `public/`~~ — the five scaffold SVGs are gone.
  Everything else was checked and is in use.

### Closed in session 6, do not redo

- ~~Fix the two real email addresses (A2)~~ — done, §4b.
- ~~Rotate the Resend key (A1)~~ — **closed by Joe**, not by a rotation. §3.
- ~~Look at the empty and loading states~~ — done, §1d.
- ~~Promote the UI rebuild (A4)~~ — merged as #30 and verified on the live URL.

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

A small badge shows `Preview · <sha>` on any non-production deployment, so the
two identical-looking URLs can be told apart and you can see which commit is
actually serving. It renders nothing in production and nothing locally. Since
session 6 it lives in the navigation rail rather than the header.

**Preview deployments are behind Vercel deployment protection.** A preview URL
answers `200` but redirects to a Vercel SSO login, so it cannot be checked with
`curl` or a headless browser — only in a browser signed in to the Vercel
account. Production is open. Plan preview verification as a human step.

Full setup steps are in the README's **Deployment and CI/CD** section.

---

Deeper context: `.docs/01-challenge-analysis.md` (requirements matrix, security
analysis, evaluator edge cases), `.docs/03-tier1-acceptance-checklist.html`
(the QA plan), `.docs/04-tier2-fhir-integration.html` (Tier 2 explained),
`.docs/05-ugly-csv-expected-outcomes.md` (what the messy file should produce)
and `.docs/candidate-brief.md` (the authority on scope).
