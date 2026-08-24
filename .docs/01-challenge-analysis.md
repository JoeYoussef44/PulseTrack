# PulseTrack — Challenge Analysis & Validated Plan

> **Status:** Analysis stage only. No application code has been written.
> **Author:** working analysis for Joe (candidate `cand-joe-l`).
> **Created:** 2026-08-24.
> **Secrets:** This file contains **no API keys**. The FHIR key lives only in `.env.local` / Vercel env vars.

---

## 1. Executive summary

PulseTrack is a 3-tier build: a clinician-facing remote patient monitoring platform (Tier 1), a HAPI FHIR R4 integration with a shared, ownership-enforcing server (Tier 2), and one grounded AI feature (Tier 3).

**Verdict on the existing implementation plan:** it is broadly accurate, well-structured, and correctly identifies the required stack, the questionnaire definition, the CSV rules, and the FHIR idempotency strategy. It faithfully reproduces the DSMA-8 definition and the LOINC mappings. It is a good roadmap.

**However it has three defects that would likely cost marks or break the evaluator demo**, plus a set of omissions:

1. **The shared FHIR server makes `If-None-Exist: identifier=…|MRN-1001` unsafe.** Reads are open across candidates. If another candidate already created `MRN-1001` (very likely — it is the MRN printed in the supplied CSV template), our conditional create will *match their resource*, return their id, and every subsequent `PUT` will return `403`. The conditional-create query and every ownership decision must be scoped by our candidate `_tag`.
2. **The supplied sample CSV references `MRN-1001/1002/1003`, which do not exist anywhere by default.** Unless we seed those patients locally, the evaluator uploads `lab-results-sample-clean.csv`, gets 10/10 rows rejected as "unknown MRN", and concludes the uploader is broken. The plan never mentions this.
3. **The real deadline is ~2.5 working days, not 7.** Today is Monday 2026-08-24; the interview is Thursday 2026-08-27 at noon, so the submission must be sent Wednesday evening at the latest. Scope discipline must be much harder than a 7-day plan implies. **Tier 3 should be treated as unlikely, not merely "last".**

Additional gaps: Vercel/Prisma/Neon connection pooling, Vercel function timeout on the FHIR import, `bcrypt` vs `bcryptjs`, Auth.js v5 edge-middleware split, `200 vs 201` handling on conditional create, UTF-8 BOM in CSV, date/timezone off-by-one on `collected_date`, and Resend's sandbox restriction (which will silently break the "send assessment" demo).

**Feasibility:** Tier 1 + Tier 2 are realistically implementable with the proposed architecture inside the window, *if* Tier 3 is dropped and the FHIR import is chunked per-patient. Tier 1 alone is explicitly a valid submission; Tier 2 is what differentiates.

---

## 2. Source-of-truth hierarchy

| Rank | Source | Authority |
|---|---|---|
| 1 | `candidate-brief.md` | Definitive on scope, tiers, stack, evaluation, submission |
| 1 | `fhir-api-guide.md` | Definitive on FHIR server behaviour, restrictions, seed data |
| 1 | `questionnaire-dsma8.json` | Definitive on items, options, scoring, bands |
| 1 | `lab-results-template.csv` | Definitive on CSV header/column order |
| 1 | `lab-results-sample-clean.csv` | Definitive on the "known good" data shape |
| 2 | Capadev email (quoted in the private plan) | Candidate-specific; **overrides the brief on deadline** (Thursday, not 7 days) and on the repo URL |
| 3 | `PRIVATE_CAPADEV_PULSETRACK_IMPLEMENTATION_PLAN.md` | Proposed interpretation. Non-authoritative. Superseded by this document where they differ |
| 4 | This document | Our working decisions of record |

**Conflicts found and resolved:**

| Conflict | Resolution |
|---|---|
| Brief: "7 calendar days" vs email: "before Thursday" | **Follow the email.** Submit by Wed 2026-08-26 EOD; interview Thu 2026-08-27 noon. |
| Brief submission section lists `https://github.com/hadyGhazi` as "Git repository link" | Template artefact from another candidate. **Use our own repository.** Do not reference that URL anywhere. |
| Plan treats `ref_low`/`ref_high`/`test_name`/`unit` as required CSV fields | Brief does not list them as required. **Treat as optional** (see §13) to avoid rejecting rows the evaluator considers valid. |
| Plan: "CSV parser does not execute formulas" | Misstatement — parsers never execute formulas. The real risk is **CSV injection on export**. Reframed in §11. |
| Plan proposes an optional `IntegrationSyncEvent` table | **Drop it.** Sync state lives on `Patient` and `LabResult`. Fewer moving parts. |

---

## 3. Challenge requirements summary

- **Product:** remote patient monitoring for a small diabetes clinic.
- **Stack (mandatory):** Next.js App Router (frontend + backend, one repo), PostgreSQL, an ORM with migrations, deployed live on Vercel. Everything else is our choice.
- **No patient accounts anywhere.** Patients reach the questionnaire only via a tokenized link.
- **A polished Tier 1 alone is a fully valid submission.** Quality beats quantity.
- **Security is evaluated everywhere:** expiring tokenized links, no secrets in repo, no sensitive data in logs or URLs, parameterized queries, server-side authorization. Fabricated data only.
- **Git history is evaluated.** Incremental, meaningful commits — not one squashed dump.
- **Submission:** repo link + live Vercel URL + a test clinician login + README, by reply to the challenge email.
- **Walkthrough call:** detailed questions about the code and decisions. Every choice must be defensible.

---

## 4. Tier 1 requirements (mandatory)

1. **Auth** — clinician email+password login. Auth.js or hand-rolled JWT, must be justified. No patient accounts.
2. **Patient management** — CRUD over `full name, date of birth, sex, MRN (unique), email, phone`. List view with search. Basic input validation.
3. **Email questionnaire flow** — Send assessment → email a unique tokenized link → public form with all 8 DSMA-8 items → completeness validation → submit. Links **expire after 7 days** and are **single-use**. Store responses, compute total score and risk band, track status `sent → completed | expired`. Clinician sees assessment history and scores on the patient page. Scheduled sending is explicitly optional ("could be on schedule as well").
4. **CSV lab upload** — template download from inside the app; upload with **row-level validation** (unknown MRN, malformed/future dates, non-numeric values, missing required fields, unknown test codes, duplicate rows = same MRN + date + test); a **validation report** stating per row accepted/rejected and *why*; **partial import**; re-uploading a corrected file must not create duplicates. *"We will test your uploader with a deliberately messy file."*
5. **Dashboards** —
   - *Patient view:* lab value trends over time (**at least glucose and HbA1c**) and questionnaire score history, as proper time-series charts with sensible axes.
   - *Clinic view:* aggregate stats, assessment completion rate, count of patients per risk band, recent uploads with **at least one filter** (e.g. date range).
   - Loading, empty, error states and responsiveness are explicitly evaluated. *"A dashboard with no data should look intentional, not broken."*
6. **README** — setup runnable in <10 min, **architecture diagram**, **ERD**, and a **"Decisions & tradeoffs"** section.

---

## 5. Tier 2 requirements (strongly recommended)

1. **Push** — on patient create/update, sync to FHIR as `Patient`; on lab import, push `Observation` resources linked to that patient.
2. **Pull** — import seeded patients `MRN-2001…MRN-2005` and their historical observations so they appear in dashboards **alongside locally-entered data**.
3. **Handle external-API reality** — authentication, failures, retries *or* clear error surfacing, and **not re-importing the same data twice**.
4. **Integration diagram** in the README showing data flow.

Server facts (from the API guide):

- Base URL `https://fhir-challenge.vihagent.net/fhir`; auth header `X-API-Key`; JSON only (`application/fhir+json` on both `Content-Type` and `Accept`).
- Rate limit **120 req/min**; `429` must be handled gracefully.
- MRN identifier system `https://challenge.capadev.dev/mrn`; candidate tag system `https://challenge.capadev.dev/tags`; our candidate id `cand-joe-l`.
- Ownership is **automatic and server-assigned**. Reads are open; **writes only to resources we created**. Seed and other candidates' resources are read-only.
- **Disabled:** `DELETE`; conditional update (`PUT`/`PATCH` with search params); update-as-create (`PUT` to a nonexistent id); non-`GET` `$operations`; XML. Transaction/batch bundles may contain only `GET` and `POST`.
- Idempotent creates = `POST` + `If-None-Exist`. Owned updates = `PUT` to the concrete id.
- Seed data: 5 patients × 12 months × 3 tests — HbA1c `4548-4`, Fasting Glucose `1558-6`, Systolic BP `8480-6`. **36 observations per patient (12 of each code); 180 across all five.** Verified 2026-08-24 — see §23.
- Suggested push mapping: `GLU-F → 1558-6`, `HBA1C → 4548-4`, `SBP → 8480-6`.
- Errors arrive as `OperationOutcome`; read `diagnostics`.

---

## 6. Tier 3 requirements (open-ended bonus)

One useful AI feature on a genuinely free key (Gemini or Groq). Evaluated on **judgment, not ambition**: grounded in real data, thoughtful hallucination handling in a clinical context, thoughtful prompt design, actually useful. *"A small, well-grounded feature beats an impressive-looking one that makes things up."*

---

## 7. Requirements matrix

Legend — **M** = mandatory, **O** = optional/enhancement. Source: `B` = candidate-brief, `Q` = questionnaire JSON, `C` = CSV files, `F` = FHIR guide, `E` = Capadev email, `D` = our engineering decision.

### 7.1 Foundation

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | Next.js App Router, one repo | 1 | M | B | Next.js 15 App Router, TypeScript strict | — | `next build` succeeds | Not Started |
| F2 | PostgreSQL | 1 | M | B | Neon free tier | Cold starts | Query from Vercel | Not Started |
| F3 | ORM with migrations | 1 | M | B | Prisma, migrations committed | `migrate deploy` in build | Migration files in git | Not Started |
| F4 | Live Vercel URL | 1 | M | B | Vercel Hobby | Env vars missing in prod | Full smoke test on live URL | Not Started |
| F5 | Git history intact | 1 | M | B | `git init` immediately, ~15 incremental commits | Repo not yet initialised | `git log` review | Not Started |
| F6 | No secrets in repo/history | 1 | M | B | `.gitignore` PRIVATE plan + `.env*` **before first commit**; redact key from plan file | Key already sits in `.docs/PRIVATE_*.md` | `git log -S` scan before push | Not Started |
| F7 | Seed script (clinician + demo patients) | 1 | M | B/D | Idempotent `prisma/seed.ts` | Non-idempotent reseed | Run twice, no duplicates | Not Started |

### 7.2 Authentication

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| A1 | Clinician email+password login | 1 | M | B | Auth.js v5 Credentials, **JWT session strategy** | DB sessions don't work with Credentials | Login with seeded creds | Not Started |
| A2 | Password hashing | 1 | M | B | `bcryptjs` (pure JS), cost 10–12 | native `bcrypt` breaks on Vercel build | Hash present, never plaintext | Not Started |
| A3 | Protected clinician routes | 1 | M | B | Middleware + per-page `auth()` check | Edge middleware can't use Prisma | Logged-out `GET /patients` → redirect | Not Started |
| A4 | Server-side authorization on every mutation | 1 | M | B | `requireClinician()` at top of every server action / route handler | UI-only gating | Direct `POST` without cookie → 401 | Not Started |
| A5 | Generic login error | 1 | O | D | "Invalid email or password" for both cases | User enumeration | Compare wrong-email vs wrong-password responses | Not Started |
| A6 | Logout | 1 | M | D | `signOut()` in header | — | Session cleared | Not Started |
| A7 | Test clinician login for evaluator | 1 | M | B | Seeded account; credentials in submission email + README | — | Works on live URL | Not Started |

### 7.3 Patient management

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| P1 | Create patient | 1 | M | B | Server action + Zod | — | Create → appears in list | Not Started |
| P2 | Read / detail page | 1 | M | B | `/patients/[id]` | Bad id → 404 page | Random id → intentional 404 | Not Started |
| P3 | Update patient | 1 | M | B | Edit form, same Zod schema | — | Edit persists | Not Started |
| P4 | Delete patient | 1 | M | B | Hard delete + confirm dialog; cascade assessments/answers/labs | Orphaned FHIR resource (DELETE disabled remotely) | Delete → children gone, no FK error | Not Started |
| P5 | List view | 1 | M | B | Server-rendered table, paginated | Large lists | Renders | Not Started |
| P6 | Search | 1 | M | B | Case-insensitive `contains` on name + MRN (Prisma → parameterized) | SQL injection via raw SQL | Search by partial name & MRN | Not Started |
| P7 | **MRN unique** | 1 | M | B | `@unique` on `mrn` + friendly `P2002` catch | Race → raw Prisma error page | Create duplicate MRN → field-level error | Not Started |
| P8 | Input validation | 1 | M | B | Zod: name required; DOB valid & **not future** & not absurd (>130y); sex enum; email format; phone permissive | Over-strict phone rejects intl formats | Boundary tests | Not Started |
| P9 | Normalization | 1 | O | D | Trim all; lowercase email; MRN trimmed, uppercased | `mrn-1001` vs `MRN-1001` treated as different | Mixed-case MRN dedupes | Not Started |
| P10 | Empty / loading / error states | 1 | M | B | Skeletons + intentional empty states | — | Fresh DB looks deliberate | Not Started |

### 7.4 DSMA-8 assessment

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| Q1 | Exact 8 items, exact text | 1 | M | Q | Import `questionnaire-dsma8.json` verbatim as the single source | Retyped text drifts | Diff rendered text vs JSON | Not Started |
| Q2 | Exact 4 options 0–3 | 1 | M | Q | From same JSON | — | Visual check | Not Started |
| Q3 | Scoring = sum, all items required | 1 | M | Q | Pure `scoreAssessment()` fn | — | Unit tests | Not Started |
| Q4 | Risk bands 0–6 / 7–12 / 13–18 / 19–24 | 1 | M | Q | Band lookup from JSON | Off-by-one at boundaries | Unit tests at 0,6,7,12,13,18,19,24 | Not Started |
| Q5 | Send assessment action | 1 | M | B | Server action on patient page | Patient has no email | Send → row created, email dispatched | Not Started |
| Q6 | Cryptographically random token | 1 | M | B | `crypto.randomBytes(32)` → base64url | Weak/sequential token | Inspect entropy | Not Started |
| Q7 | **Store only `SHA-256(token)`** | 1 | M | D | `tokenHash` unique; raw token never persisted | Raw token in DB or logs | Inspect DB row | Not Started |
| Q8 | Expire after exactly 7 days | 1 | M | B | `expiresAt = sentAt + 7d`; lazily derived at read | Timezone drift | Backdate a row → shows expired | Not Started |
| Q9 | Single-use | 1 | M | B | `updateMany where {status: SENT}` guard inside transaction; count must be 1 | Double-submit race | Submit twice concurrently → one wins | Not Started |
| Q10 | Public form, no login | 1 | M | B | `/assessment/[token]` outside auth middleware | Route accidentally protected | Open in private window | Not Started |
| Q11 | Completeness validation client + **server** | 1 | M | B | Zod on server; disabled submit on client | Client-only validation | POST with 7 answers → rejected | Not Started |
| Q12 | **Server computes score** | 1 | M | B | Never accept a client-sent score | Trusting client total | POST with forged `score` → ignored | Not Started |
| Q13 | Status tracking `sent → completed \| expired` | 1 | M | B | Enum + derived expiry | — | Visible on patient page | Not Started |
| Q14 | Assessment history on patient page | 1 | M | B | Table: sent, status, completed, score, band | — | Multiple assessments listed | Not Started |
| Q15 | Invalid / expired / used token states | 1 | M | B | Three distinct, non-leaky screens | Leaking whether token exists | Manual test of each | Not Started |
| Q16 | Scheduled sending | 1 | **O** | B | Out of scope; note in README | — | — | Not Started |

### 7.5 Email

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| E1 | Email the tokenized link | 1 | M | B | `EmailService` interface + Resend adapter + console adapter | **Resend free tier only sends to your own verified address** | Receive real email | Not Started |
| E2 | Provider abstraction | 1 | O(strong) | B | One interface, swappable by env var | — | Swap to console provider | Not Started |
| E3 | **Copy-link fallback in UI** | 1 | O(strong) | D | Show/copy the link once in the success toast after send | Evaluator's demo dies if provider blocks the address | Send → link copyable | Not Started |
| E4 | Email content hygiene | 1 | M | B | No scores/MRN/history in the email; expiry stated | PHI in email body | Read the sent email | Not Started |
| E5 | Send failure surfaced | 1 | M | B | Mark send failed, don't leave a phantom `SENT` row | Silent failure | Break API key → clear error | Not Started |

### 7.6 CSV lab import

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| C1 | Template download in-app | 1 | M | B | `/public/templates/lab-results-template.csv` (byte-identical to supplied file) | Header drift from supplied file | `diff` downloaded vs supplied | Not Started |
| C2 | File upload | 1 | M | B | Route handler, multipart, ≤2 MB, `.csv` only | Vercel 4.5 MB body cap | Upload oversized file → clean error | Not Started |
| C3 | Robust parsing | 1 | M | B | `csv-parse` with `bom: true`, `relax_column_count`, `trim`, `skip_empty_lines` | **UTF-8 BOM**, CRLF, quoted fields, ragged rows | Feed each variant | Not Started |
| C4 | Header validation | 1 | M | C | Case/whitespace-insensitive match of the 8 columns | Wrong file uploaded | Upload a PDF/wrong CSV → clear message | Not Started |
| C5 | Unknown MRN | 1 | M | B | Resolve MRN → patient; reject row if absent | **Sample CSV MRNs must exist (see C15)** | Row-level reason shown | Not Started |
| C6 | Malformed date | 1 | M | B | Strict `YYYY-MM-DD` | `01/06/2026`, `2026-13-01`, `2026-02-30` | Each rejected with reason | Not Started |
| C7 | Future date | 1 | M | B | Reject `collected_date > today` (UTC) | Timezone edge at midnight | Tomorrow's date rejected | Not Started |
| C8 | Non-numeric value | 1 | M | B | Strict numeric; reject `abc`, `7,1`, `<5`, blank; reject negatives | Comma decimals | Each rejected | Not Started |
| C9 | Missing required fields | 1 | M | B | Required = `mrn`, `collected_date`, `test_code`, `value` | Over-strict (see D-CSV-1) | Blank cells rejected | Not Started |
| C10 | Unknown test code | 1 | M | B | Allow-list `GLU-F`, `HBA1C`, `SBP` (case-insensitive) | Rejecting valid-but-unlisted codes | `XYZ` rejected | Not Started |
| C11 | Duplicate rows (MRN+date+test) | 1 | M | B | Detect **within file** and **against DB** | First-wins vs last-wins | Duplicate pair → one accepted, one flagged | Not Started |
| C12 | Per-row validation report | 1 | M | B | Row number, status, human reason; accepted/rejected/skipped counts | Reasons too technical | Read the report | Not Started |
| C13 | Partial import | 1 | M | B | Insert valid rows regardless of invalid ones | All-or-nothing transaction | Mixed file → valid rows land | Not Started |
| C14 | **Re-upload creates no duplicates** | 1 | M | B | DB `@@unique([patientId, collectedDate, testCode])` + `skipDuplicates` | App-level check only | Upload sample twice → second is all "already imported" | Not Started |
| C15 | **Seed patients MRN-1001/1002/1003** | 1 | M | D | Seed script creates them so the supplied sample imports cleanly | Missing → evaluator sees 10/10 rejected | Fresh DB + supplied sample → 10 accepted | Not Started |
| C16 | `LabUpload` summary record | 1 | M | B | filename, clinician, timestamp, accepted/rejected counts | — | Appears in clinic dashboard | Not Started |
| C17 | Dates stored as DATE not timestamp | 1 | M | D | Prisma `@db.Date`, parse as UTC midnight | Off-by-one day in charts | `2026-05-02` renders as 2 May everywhere | Not Started |

### 7.7 Dashboards

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| D1 | Patient: glucose trend | 1 | M | B | Recharts line, x = date (time scale), y = mg/dL | Categorical x-axis mis-orders dates | Out-of-order inserts still render chronologically | Not Started |
| D2 | Patient: HbA1c trend | 1 | M | B | Same, unit `%` | — | Renders | Not Started |
| D3 | Patient: questionnaire score history | 1 | M | B | Line/scatter, y 0–24, band shading optional | Only completed assessments plotted | Renders | Not Started |
| D4 | Patient: SBP trend | 1 | O(strong) | F | Seed data contains SBP | — | Renders for MRN-2001 | Not Started |
| D5 | Sensible axes, units, tooltips | 1 | M | B | Explicit domains, formatted dates | Auto-domains look wrong | Visual check | Not Started |
| D6 | Patient: lab table with source | 1 | O | D | Date, test, value, unit, range, `CSV`/`FHIR` badge | — | Both sources visible | Not Started |
| D7 | Clinic: total patients | 1 | M | B | `count()` | Definition ambiguity (see D-DASH-1) | Matches list count | Not Started |
| D8 | Clinic: assessment completion rate | 1 | M | B | completed ÷ all sent, all-time | Divide-by-zero → misleading `0%` | Zero assessments → `—` | Not Started |
| D9 | Clinic: patients per risk band | 1 | M | B | Latest **completed** assessment per patient; each patient counted once; "No assessment" shown separately | Counting assessments not patients | Manual cross-check | Not Started |
| D10 | Clinic: recent uploads + ≥1 filter | 1 | M | B | Upload list + 7d/30d/all date filter | Filter not server-side | Filter changes result set | Not Started |
| D11 | Loading / empty / error / responsive | 1 | M | B | Suspense skeletons, designed empty states, error boundaries | *"should look intentional, not broken"* | Fresh DB + 375px viewport | Not Started |

### 7.8 Tier 2 — FHIR

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| H1 | Server-only FHIR client | 2 | M | F | `lib/fhir/client.ts`, `import 'server-only'`, never imported by client components | Key in browser bundle | Grep built bundle for key | Not Started |
| H2 | Headers on every request | 2 | M | F | `X-API-Key`, `Accept`/`Content-Type: application/fhir+json` | Missing header when following `next` link | Network trace | Not Started |
| H3 | Env-var config | 2 | M | F | `FHIR_BASE_URL`, `FHIR_CANDIDATE_ID`, `FHIR_API_KEY` | `NEXT_PUBLIC_` prefix leak | `.env.example` has placeholders only | Not Started |
| H4 | Patient push, conditional create | 2 | M | F | `POST /Patient` + `If-None-Exist: identifier=…\|MRN` **AND** `&_tag=…\|cand-joe-l` | **Cross-candidate MRN collision** | Run twice → one resource | Not Started |
| H5 | Verify ownership tag before marking OWNED | 2 | M | D | Check returned resource's `meta.tag` contains our candidate id | Storing another candidate's id → 403 on update | Inspect stored `fhirOwnership` | Not Started |
| H6 | Handle 200 vs 201 + `Location` header | 2 | M | D | Parse id from body, else `Location`/`Content-Location`, else re-search | Empty body on 200 match | Repeat push, id resolves | Not Started |
| H7 | Owned patient update | 2 | M | F | `PUT /Patient/{id}` only, never conditional | `405` from conditional update | Edit patient → FHIR reflects | Not Started |
| H8 | Never push to seed/external resources | 2 | M | F | `fhirOwnership = EXTERNAL_SEED` blocks push | 403 storm | Edit MRN-2001 → no push attempted | Not Started |
| H9 | Observation push on lab import | 2 | M | B | LOINC map, `valueQuantity` with UCUM, `subject` ref, `status: final` | Wrong LOINC | Fetch created Observation | Not Started |
| H10 | Observation stable identifier | 2 | M | D | `system: https://challenge.capadev.dev/lab-result`, `value = <local LabResult cuid>` | Non-unique value across candidates | Two pushes → one resource | Not Started |
| H11 | Observation conditional create | 2 | M | F | `POST` + `If-None-Exist: identifier=…\|<id>&_tag=…` | `412` on multiple matches | Retry → no duplicate | Not Started |
| H12 | Never push back pulled data | 2 | M | D | `source = FHIR` rows are never pushed | Echoing seed data as our own | Import then check remote count | Not Started |
| H13 | Pull seeded patients 2001–2005 | 2 | M | F | Search by MRN identifier, upsert local by MRN, mark `EXTERNAL_SEED` | Local MRN collision | Import → 5 patients | Not Started |
| H14 | Pull observations, **follow `next`** | 2 | M | F | Loop on `bundle.link[rel=next]`, absolute URL, auth header re-sent, max-page + seen-URL guard | Internal `next` host; infinite loop; silent truncation | 36 obs per patient at `_count=20` = 2 pages | Not Started |
| H15 | Pull idempotency | 2 | M | B | Upsert by `fhirObservationId` (unique) + natural-key guard | Duplicate labs on re-run | Import twice → identical counts | Not Started |
| H16 | Local upsert merges with local data | 2 | M | B | Same `LabResult` table, `source` discriminator | Separate tables → charts split | MRN-2001 chart shows history | Not Started |
| H17 | 429 handling | 2 | M | F | Honour `Retry-After`; bounded exponential backoff + jitter; global request throttle | Retry storm | Simulated 429 → backs off | Not Started |
| H18 | 5xx / timeout retry | 2 | M | B | Bounded retries (≤3) on 502/503/504 + network errors; `AbortSignal.timeout` | Infinite retry, hung request | Point at dead host → clean failure | Not Started |
| H19 | 4xx non-retryable | 2 | M | F | 400/401/403/404/405/412 → fail fast, distinct messages | Retrying an auth failure | Wrong key → clear "auth failed" | Not Started |
| H20 | `OperationOutcome` diagnostics surfaced | 2 | M | F | Parse `issue[].diagnostics`, sanitize, show in UI | Raw dump with PHI | Trigger a 403 | Not Started |
| H21 | Sync status visible per record | 2 | O(strong) | B | `fhirSyncStatus` + `fhirLastError` on Patient/LabResult | — | Badge on patient page | Not Started |
| H22 | Integration page (manual trigger) | 2 | O(strong) | D | Connection check, per-MRN import buttons, result summary; **candidate id shown, key never** | Long-running request timeout | Import runs from live URL | Not Started |
| H23 | Import chunked per patient | 2 | M | D | One request per seed MRN + `export const maxDuration = 60` | **Vercel function timeout** | Import completes on Vercel | Not Started |
| H24 | Integration diagram in README | 2 | M | B | Mermaid | — | Renders on GitHub | Not Started |

### 7.9 Documentation & delivery

| # | Requirement | Tier | M/O | Src | Proposed implementation | Risks / edge cases | Verification | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | Setup runnable in <10 min | 1 | M | B | Copy `.env.example`, `migrate dev`, `db seed`, `dev` | Missing step | Fresh clone dry run | Not Started |
| R2 | Architecture diagram | 1 | M | B | Mermaid | — | Renders | Not Started |
| R3 | ERD | 1 | M | B | Mermaid `erDiagram` matching final schema | Drifts from schema | Compare to `schema.prisma` | Not Started |
| R4 | Decisions & tradeoffs | 1 | M | B | *"We read this carefully"* — 10–15 real decisions with reasons | Generic filler | Peer read | Not Started |
| R5 | Security notes | 1 | O(strong) | B | Token hashing, authz, secrets, PHI-in-logs policy | Claiming HIPAA compliance | Peer read | Not Started |
| R6 | Test clinician credentials | 1 | M | B | In submission email; README points to it | Publishing prod password in a public repo | Evaluator can log in | Not Started |
| R7 | Submission email | 1 | M | B/E | Repo + live URL + login + README, by Wed 2026-08-26 | Missing the Thursday interview | Sent | Not Started |

---

## 8. Validated technical stack

| Choice | Classification | Verdict / notes |
|---|---|---|
| **Next.js (App Router)** | **Required by Capadev** | Use v15, TypeScript strict. Server Actions for mutations, Route Handlers for upload/FHIR/public submit. |
| **TypeScript** | Recommended | Not literally required, but expected. Strict mode. |
| **PostgreSQL (Neon)** | **Required by Capadev** (Postgres); Neon Recommended | Neon free, no credit card, matches the brief's own recommendation. **Use the pooled connection string at runtime and `directUrl` for migrations.** |
| **Prisma** | Recommended (an ORM with migrations is **Required**) | Best DX under time pressure; migrations are first-class; type-safe; parameterized queries by default (a security point the brief explicitly cares about). Drizzle equally valid — justify on DX and migration tooling. |
| **Auth.js v5 (Credentials)** | Recommended (auth itself is **Required**) | Brief explicitly allows Auth.js *or* hand-rolled JWT. Use Credentials + **JWT session strategy** (DB sessions are incompatible with Credentials). Split config (`auth.config.ts` edge-safe, `auth.ts` with Prisma) so middleware stays on edge. **Fallback:** if v5 fights us for more than ~1 hour, hand-roll a `jose`-signed httpOnly cookie session — ~80 lines, fully explainable in the interview. |
| **bcryptjs** | Recommended | Pure JS — avoids native-binary build failures on Vercel. Plan said `bcrypt`; **change this**. |
| **Zod** | Recommended | One schema shared by client and server validation. Not required, but the cheapest route to "basic input validation" done well. |
| **Tailwind CSS + shadcn/ui** | Recommended | Fastest path to the polished loading/empty/error/responsive states the brief explicitly grades. shadcn is copy-in, not a runtime dependency. |
| **Recharts** | Recommended (charts are **Required**) | *Risk:* Recharts 2.x has React 19 peer-dependency friction. **Use Recharts 3.x with React 19**, or pin React 18. Verify at install time. |
| **`csv-parse`** | Recommended (CSV parsing is **Required**) | Streaming, battle-tested, `bom: true`, `relax_column_count`, per-row error handling. Preferred over Papa Parse for server-side use. |
| **Email provider abstraction** | Recommended | Brief says the provider is our choice; the abstraction is our decision. One `EmailService` interface + Resend adapter + console/dev adapter. **Small, one file — do not build a plugin system.** |
| **Resend** | Recommended | Free tier. **Known limitation: without a verified domain it only delivers to your own address.** Mitigate with the copy-link fallback (E3) and by seeding a demo patient with your own email. |
| **FHIR integration service** | **Required by Capadev** (Tier 2) | Hand-rolled typed client. **Do not add a FHIR SDK** — an SDK hides exactly the behaviour being evaluated (conditional create, pagination, `OperationOutcome`). |
| **Vitest** | Recommended | Small suite over scoring, CSV validation, FHIR mappers, pagination helper. High signal per minute; the brief rewards demonstrable correctness. |
| **date-fns** | Optional | Convenient; `Intl` would do. Keep if it saves time. |
| **AI provider (Gemini/Groq)** | Optional (Tier 3 is a bonus) | Only if Tier 1+2 are deployed and green. |
| **Vercel** | **Required by Capadev** | Hobby tier. |

### Explicitly **not** needed — do not build

- A FHIR SDK / full R4 type package (`@types/fhir` is fine; a client library is not).
- `IntegrationSyncEvent` / audit-log table — sync state on `Patient` + `LabResult` is sufficient. *(Removes a table, a service, and a UI from the plan.)*
- A job queue / outbox / cron worker. Assessment expiry is **derived**, not swept. Say so in the README as a deliberate tradeoff.
- Redis / caching layer.
- React Hook Form — Server Actions + `useActionState` + Zod cover these forms. Add it only if a form genuinely fights us.
- A design system beyond shadcn; no Storybook.
- Docker / compose — Neon is remote; it adds setup time and works against the "<10 minutes" README requirement.
- E2E tests (Playwright). A manual acceptance checklist is the right trade at this deadline.
- Patient auth of any kind — the brief forbids patient accounts.
- Soft delete + restore UI. Hard delete with cascade and a confirm dialog, documented.
- i18n, dark-mode toggle, real-time/websockets.

---

## 9. Architecture assessment

The proposed layering (UI → action/route → service → data, with a separate integration layer) is **correct and proportionate**. Keep it, with these refinements:

```
app/                    routes: clinician (protected group), public /assessment/[token], api handlers
lib/auth/               session helpers, requireClinician()
lib/patients/           patient service (create/update also triggers FHIR push)
lib/assessments/        definition.ts (loads the official JSON), scoring.ts (pure), token.ts
lib/labs/               parser.ts, validation.ts, import-service.ts, test-catalog.ts
lib/fhir/               client.ts, mappers, pagination.ts, sync-service.ts
lib/email/              email-service.ts + adapters
lib/db/                 prisma client singleton
```

**Assessment of the plan's architecture, point by point:**

- ✅ Service layer separate from routes — right; it is what makes "the same import logic from CSV and from FHIR" possible.
- ✅ Pure scoring function — right, and it is the cheapest unit test with the highest evaluator value.
- ✅ FHIR code out of components — right, and it is simultaneously the **security** control that keeps the key server-only.
- ⚠️ **Server Actions vs Route Handlers.** Use Route Handlers (not Server Actions) for: CSV upload (multipart + `maxDuration`), the public assessment submit (unauthenticated, needs precise status codes), and FHIR import (needs `maxDuration = 60`). Use Server Actions for patient CRUD and send-assessment. The plan does not distinguish; this matters for timeouts and file handling.
- ⚠️ **Vercel serverless realities the plan omits:**
  - **Function duration.** Hobby default is 10s. The full seed import (5 patients × ~4 bundle pages + ~900 upserts) will exceed it. **Mitigation: `export const maxDuration = 60` on the import route AND one request per seed MRN, driven by a client-side loop with progress.** This is also better UX and naturally resumable.
  - **Connection pooling.** Prisma + serverless exhausts Postgres connections. **Use Neon's `-pooler` URL for `DATABASE_URL` and the direct URL for `directUrl`.**
  - **Body size.** 4.5 MB request cap; enforce our own 2 MB CSV limit with a clean error.
  - **Edge middleware** cannot run Prisma or bcrypt — keep middleware to a cookie/JWT presence check and do the real authorization in the Node runtime.
- ⚠️ **The public route must be excluded from the auth middleware matcher** — easy to get wrong; `/assessment/[token]` and the template download must stay public.

**Verdict:** the architecture is suitable and not over-engineered, once `IntegrationSyncEvent` is dropped and the serverless constraints above are designed in from the start.

---

## 10. Data-model assessment

The proposed entities are correct and sufficient. Detailed constraint analysis:

### Clinician
`id (cuid, PK)`, `email (unique, lowercased)`, `passwordHash`, `name`, `createdAt`, `updatedAt`.
No role field needed — one role exists.

### Patient
`id (PK)`, `mrn (UNIQUE, NOT NULL)`, `fullName`, `dateOfBirth (@db.Date)`, `sex (enum: MALE|FEMALE|OTHER|UNKNOWN)`, `email (nullable)`, `phone (nullable)`, `fhirPatientId (nullable, UNIQUE)`, `fhirOwnership (enum: NONE|OWNED|EXTERNAL_SEED, default NONE)`, `fhirSyncStatus (enum, nullable)`, `fhirLastSyncedAt (nullable)`, `fhirLastError (nullable)`, timestamps.

- **Unique:** `mrn`; `fhirPatientId` (Postgres allows multiple NULLs under a unique index — exactly what we want).
- **Index:** `fullName` (search); `mrn` covered by the unique index.
- **Nullable:** `email`, `phone` — the brief lists them as fields, but sending an assessment requires email; enforce at send time, not at create time. *(Decision D-PAT-1.)*
- **Sex enum values map to FHIR `gender`** — `male|female|other|unknown`. Aligning now avoids a mapping table later.
- `dateOfBirth` as `@db.Date` — avoids timezone off-by-one.

### Assessment
`id (PK)`, `patientId (FK → Patient, onDelete: Cascade)`, `questionnaireId`, `questionnaireVersion`, `tokenHash (UNIQUE)`, `sentAt`, `expiresAt`, `completedAt (nullable)`, `status (enum SENT|COMPLETED|EXPIRED)`, `totalScore (Int, nullable)`, `riskBand (String, nullable)`, timestamps.

- **Unique:** `tokenHash` — also the lookup index for the public route.
- **Cascade** on patient delete (assessments have no independent meaning).
- `totalScore`/`riskBand` nullable until completion — correct; do not default to 0, because **0 is a valid score**.
- Storing `questionnaireVersion` is good practice and a cheap interview talking point.
- **Supports single-use** via the conditional `updateMany(where status = SENT)` guard.
- **Supports expiry** via `expiresAt` + derived status. No cron needed.
- **Supports history** — many assessments per patient, ordered by `sentAt`.

### AssessmentAnswer
`id (PK)`, `assessmentId (FK → Assessment, onDelete: Cascade)`, `questionId`, `score (Int, 0–3)`, optional `questionText` snapshot.

- **Unique:** `(assessmentId, questionId)` — the DB-level guarantee that a double-submit cannot create 16 answers.
- The question-text snapshot is optional; version pinning already covers it. Skip unless time allows.

### LabUpload
`id (PK)`, `filename`, `uploadedByClinicianId (FK → Clinician, onDelete: Restrict)`, `uploadedAt`, `totalRows`, `acceptedCount`, `rejectedCount`, `skippedDuplicateCount`.

- **Restrict** on clinician delete — an upload record must not vanish; and we never delete clinicians anyway.
- Adding `skippedDuplicateCount` separates "your file was wrong" from "already imported" in the report. *(Not in the plan; recommended.)*

### LabResult
`id (PK, cuid)`, `patientId (FK → Patient, onDelete: Cascade)`, `labUploadId (FK → LabUpload, nullable, onDelete: SetNull)`, `collectedDate (@db.Date)`, `testCode (enum GLU_F|HBA1C|SBP)`, `testName`, `value (Decimal)`, `unit`, `refLow (nullable)`, `refHigh (nullable)`, `source (enum CSV|FHIR|MANUAL)`, `fhirObservationId (nullable, UNIQUE)`, `fhirSyncStatus (enum, nullable)`, `fhirLastError (nullable)`, `createdAt`.

- **Critical unique:** `@@unique([patientId, collectedDate, testCode])` — backs the brief's duplicate rule at the DB level.
- **Second unique:** `fhirObservationId` — backs pull idempotency.
- **Index:** `[patientId, testCode, collectedDate]` for chart queries.
- `labUploadId` nullable + `SetNull` so FHIR-pulled rows have no upload, and deleting an upload record never destroys clinical data.
- `refLow`/`refHigh` **nullable** — FHIR seed observations may carry no reference range, and the brief does not make them required in CSV.
- `value` as `Decimal(10,3)` avoids float display artefacts (`7.1000000001`); `Float` is acceptable if we format on render. **Decision: `Decimal`.**
- The `source` discriminator is what lets CSV and FHIR data share one table and one chart — which is exactly what Tier 2 requirement 2 asks for.

### Constraint-to-requirement traceability

| Requirement | Enforced by |
|---|---|
| Unique MRNs | `Patient.mrn @unique` + friendly `P2002` handling |
| Assessment expiration | `expiresAt` + derived status at read |
| Single-use tokens | `tokenHash @unique` + conditional `updateMany` + `AssessmentAnswer @@unique(assessmentId, questionId)` |
| Scoring & history | `totalScore`/`riskBand` nullable, many-per-patient |
| Partial CSV imports | Per-row validation, no all-or-nothing transaction |
| CSV duplicate prevention | `@@unique([patientId, collectedDate, testCode])` |
| Lab source tracking | `source` enum + `labUploadId` |
| FHIR Patient mapping | `fhirPatientId @unique`, `fhirOwnership` |
| FHIR Observation mapping | `fhirObservationId @unique` |
| Owned vs seeded/read-only | `fhirOwnership` gate before any `PUT`/`POST` |
| Repeatable FHIR imports | Upsert on `fhirObservationId`, plus natural-key guard |

### One unresolved data conflict

`@@unique([patientId, collectedDate, testCode])` and `fhirObservationId @unique` can disagree: if the seed server holds **two** observations of the same code on the same date for one patient, the second upsert violates the natural key. **Decision D-DATA-1:** on natural-key conflict during a FHIR pull, *update the existing row* and attach the `fhirObservationId`, counting it as "merged" in the report — never fail the whole import. Verify empirically during the first pull.

---

## 11. Security analysis

Ranked by severity for this challenge.

### Critical

| # | Risk | Attack / failure | Control |
|---|---|---|---|
| S1 | **Secret in git history** | The private plan file currently contains the live FHIR API key and this directory is not yet a git repo. One careless `git add .` publishes it permanently. | Add `.docs/PRIVATE_*.md` and `.env*` to `.gitignore` **in the very first commit**; redact the key from the plan file and point it at `.env.local`; secret-scan before pushing. |
| S2 | **Missing server-side authorization** | Evaluator `curl`s a mutation endpoint with no cookie, or fetches `/api/patients/<id>` while logged out. | `requireClinician()` as the first line of *every* server action and route handler — never rely on middleware or hidden UI alone. |
| S3 | **Trusting a client-supplied score** | POST to the assessment submit endpoint with `{score: 0}` and a high-risk answer set. | The server ignores any submitted total and recomputes from stored answers with the pure scoring function. |
| S4 | **Weak or guessable assessment token** | Sequential ids, UUIDv1, or `patientId` in the URL. | 32 bytes from `crypto.randomBytes`, base64url. No patient identifier anywhere in the URL. |
| S5 | **Raw token stored** | A DB read (or leaked backup) yields working links to every outstanding assessment. | Persist `SHA-256(token)` only. The raw token exists in memory for one request and in the email. |
| S6 | **Authentication bypass via middleware-only gating** | Middleware matcher misconfigured, or the route is a Server Action invoked directly. | Defense in depth: middleware **and** per-page `auth()` **and** per-mutation check. |

### High

| # | Risk | Attack / failure | Control |
|---|---|---|---|
| S7 | **Expired / reused questionnaire links accepted** | Evaluator saves a link, submits twice, or backdates. | Reject unless `status = SENT && expiresAt > now`, checked **server-side at submit**, not only at render. The conditional update guarantees single-use under concurrency. |
| S8 | **FHIR key reaching the browser** | Accidental `NEXT_PUBLIC_` prefix, or a client component imports the FHIR module. | Server-only module boundary (`import 'server-only'`), no `NEXT_PUBLIC_` for secrets, grep the production bundle before submitting. |
| S9 | **PHI in logs** | `console.log(patient)`, logging FHIR request/response bodies, logging the token. | Explicit logging policy: log ids and counts, never names/emails/MRNs/answers/tokens. Sanitize `OperationOutcome` before display or log. |
| S10 | **Cross-candidate FHIR write attempt** | Our conditional create matches another candidate's `MRN-1001`; we store their id and `PUT` to it. | Tag-scoped `If-None-Exist`; verify `meta.tag` before marking `OWNED`; treat 403 as a permanent, non-retryable, clearly-surfaced state. |
| S11 | **Malformed CSV causing crash or partial corruption** | 50 MB file, binary file, ragged rows, 1M rows, BOM, `=cmd()` cells. | Size + extension + MIME checks; streaming parse; per-row try/catch; row cap; never `dangerouslySetInnerHTML` (React escapes cell text by default). |
| S12 | **Token leaked via `Referer`** | The public assessment page loads any third-party asset and the token goes out in the referrer header. | No external resources on that route; set `Referrer-Policy: no-referrer` for `/assessment/*`. |

### Medium

| # | Risk | Control |
|---|---|---|
| S13 | SQL injection | Prisma parameterizes everything. **No `$queryRawUnsafe` anywhere.** State this explicitly in the README's security notes. |
| S14 | User enumeration on login | Identical error message and comparable timing for unknown-email vs wrong-password. |
| S15 | Credential brute force | No rate limiter in scope; document as a known limitation with the production answer (edge rate limiting / lockout). |
| S16 | External API failure degrading the app | FHIR/email failures never block core flows; local writes commit first, sync state recorded separately. |
| S17 | Duplicate data from ambiguous network failures | Conditional creates + DB unique constraints on both sides (see §12.7). |
| S18 | Publishing the production clinician password in a public README | Credentials go in the **submission email**; the README explains where to find them. |

### Tier 3 only

| # | Risk | Control |
|---|---|---|
| S19 | AI receives unnecessary PII | Send derived age and sex only — never name, MRN, email, phone, DOB, or token. |
| S20 | AI hallucinates clinical content | The model narrates **precomputed** facts only; explicit prompt prohibitions on diagnosis/treatment; source data rendered next to the summary; disclaimer; never persisted as a clinical record. |
| S21 | AI key exposure | Server-side only, same controls as S8. |

### Deliberate non-goals (state in README)

No audit log, no field-level encryption, no MFA, no RBAC, no rate limiting, no BAA. **Do not claim HIPAA or GDPR compliance** — describe what a production system would additionally need.

---

## 12. FHIR integration analysis

### 12.1 Authentication and configuration

```env
FHIR_BASE_URL=https://fhir-challenge.vihagent.net/fhir
FHIR_CANDIDATE_ID=cand-joe-l
FHIR_API_KEY=            # from the challenge email — never committed
```

Every request: `X-API-Key: <key>`, `Accept: application/fhir+json`, and on writes `Content-Type: application/fhir+json`. The candidate id is **not** a secret (the guide has us put it into search URLs); the API key is. `.env.example` carries placeholders only.

**Non-obvious:** the `next` link returned in a bundle is an absolute URL that may not equal our configured base. The auth header must be attached to that request too — a plain `fetch(nextUrl)` without headers returns `401` and silently truncates the import.

### 12.2 Patient push

**Mapping**

| Local | FHIR |
|---|---|
| `mrn` | `identifier[0]` `{system: https://challenge.capadev.dev/mrn, value: mrn}` |
| `fullName` | `name[0]` — last whitespace-separated token → `family`, the rest → `given[]` |
| `sex` | `gender` (`male\|female\|other\|unknown`) |
| `dateOfBirth` | `birthDate` (`YYYY-MM-DD`) |

The single-`fullName` → structured-name split is a documented simplification; production would collect structured names. Email/phone as `telecom` is optional — **omit them**, since minimizing PHI sent to a shared multi-candidate server is the better-defended choice, and say so.

**Conditional create — corrected**

The plan proposes:
```
POST /Patient
If-None-Exist: identifier=https://challenge.capadev.dev/mrn|MRN-1001
```

**This is unsafe on a shared server.** Reads are open, so this search matches *any* candidate's `MRN-1001` — and `MRN-1001` is the MRN printed in the supplied CSV template, so other candidates have almost certainly created it. A match returns their resource id, which we would store and later `PUT` to, earning a permanent `403`.

**Use instead:**
```
POST /Patient
If-None-Exist: identifier=https://challenge.capadev.dev/mrn|MRN-1001&_tag=https://challenge.capadev.dev/tags|cand-joe-l
```

`_tag` is a standard search parameter and conditional create accepts arbitrary search params, so this scopes idempotency to our own resources. **Belt and braces:** after any create-or-match, read `meta.tag` on the returned resource and only set `fhirOwnership = OWNED` if our candidate id is present; otherwise record `EXTERNAL` and never attempt a write. If HAPI rejects `_tag` inside `If-None-Exist` (verify in the Phase-0 probe), fall back to: tag-filtered `GET` search first → if found, `PUT`; if not, plain `POST` and verify the tag on the response.

**Response handling the plan omits:**
- `201 Created` → new resource; id from the `Location` header and/or the response body.
- `200 OK` → an existing match; **HAPI may return an empty body**, so read `Content-Location`/`Location`, and fall back to a tag-filtered search.
- `412 Precondition Failed` → the `If-None-Exist` search matched more than one resource. Do not retry; surface it.

**Update:** `PUT /Patient/{id}` with the full representation, only when `fhirOwnership = OWNED`. Never `PUT` to a nonexistent id (update-as-create is disabled) and never a conditional `PUT` (disabled → `405`).

**Seed patients:** `fhirOwnership = EXTERNAL_SEED` blocks all writes. Local edits to a seeded patient are local-only. **Decision D-FHIR-1:** disable editing MRN/DOB/sex/name for `EXTERNAL_SEED` patients and show a "read-only on the national platform" badge. Documented, honest, and avoids guaranteed 403s.

### 12.3 Observation push

**Mapping**

```jsonc
{
  "resourceType": "Observation",
  "status": "final",
  "identifier": [{ "system": "https://challenge.capadev.dev/lab-result", "value": "<local LabResult id>" }],
  "code": { "coding": [{ "system": "http://loinc.org", "code": "1558-6", "display": "Fasting Glucose" }] },
  "subject": { "reference": "Patient/<fhirPatientId>" },
  "effectiveDateTime": "2026-06-01",
  "valueQuantity": { "value": 105, "unit": "mg/dL", "system": "http://unitsofmeasure.org", "code": "mg/dL" }
}
```

LOINC map: `GLU-F → 1558-6`, `HBA1C → 4548-4`, `SBP → 8480-6`. Adding `category: laboratory` (and `vital-signs` for SBP) is optional polish.

**Stable identifier:** the local `LabResult` id is a cuid — globally unique, so cross-candidate collision is not a concern here (unlike MRN). Still add `&_tag=…` to the `If-None-Exist` for symmetry and safety.

**Precondition:** the patient must have a resolvable `fhirPatientId`. If missing, push the Patient first (itself idempotent), then the Observation.

**Decision D-FHIR-2 — what gets pushed:**
- `source = CSV` labs for `OWNED` patients → push. ✅
- `source = FHIR` labs → **never push**. Pushing pulled data back would create duplicate remote records of the seed data and misrepresent provenance.
- `source = CSV` labs for `EXTERNAL_SEED` patients → attempt the push (we own the Observation even though we do not own the Patient it references); on `403`, record it as a sync failure with a clear reason rather than retrying.

### 12.4 Seeded pull

Per MRN in `MRN-2001…MRN-2005`:

1. `GET /Patient?identifier=https://challenge.capadev.dev/mrn|MRN-200X` (no `_tag` — this is deliberately someone else's data).
2. Zero results → report "not found on server", continue with the others; do not abort the run.
3. Map and **upsert locally by MRN**. If the MRN already exists locally, update FHIR linkage fields (`fhirPatientId`, `fhirOwnership = EXTERNAL_SEED`) and **do not overwrite locally-edited demographics** — *Decision D-FHIR-3: remote wins on first import, local wins thereafter.* Documented.
4. `GET /Observation?subject=Patient/<id>&_sort=date&_count=20`, then follow pagination to exhaustion. **`_count=20` not `50`** — there are only 36 observations per patient, so `_count=50` returns everything in one page and the pagination path never executes (§23).
5. Map each entry: LOINC → local test code (`1558-6 → GLU-F`, `4548-4 → HBA1C`, `8480-6 → SBP`); `effectiveDateTime` / `effectivePeriod.start` → `collectedDate`; `valueQuantity.value` / `.unit` → value/unit; `id` → `fhirObservationId`; `source = FHIR`; `refLow`/`refHigh` from `referenceRange[0]` if present, else null.
6. Skip entries with an unmapped LOINC or a non-`valueQuantity` value, counting them as "skipped (unsupported)" — visible, not silent.

Seed resources are **read-only**: never `PUT`, never `DELETE` (disabled anyway), never re-push.

### 12.5 Pagination

```
url = `${base}/Observation?subject=Patient/${id}&_sort=date&_count=20`
seen = new Set()
pages = 0
while (url && pages < MAX_PAGES) {
    if (seen.has(url)) break            // loop guard
    seen.add(url); pages++
    bundle = GET(url, { headers })      // headers MUST be re-sent on the absolute next URL
    process(bundle.entry ?? [])
    url = bundle.link?.find(l => l.relation === 'next')?.url
}
if (url) report('truncated at MAX_PAGES')   // never silently truncate
```

Non-negotiable details: take the **query** from the server's `next` link (never construct offsets by hand) but **re-base it onto our configured public base URL** — the server returns an unreachable internal host (§23); re-send `X-API-Key` and `Accept`; guard against loops and unbounded runs; **report truncation rather than hiding it**. Do not use `bundle.total` for loop control — HAPI omits it on paged responses.

### 12.6 Failure handling

| Condition | Retryable | Behaviour |
|---|---|---|
| `400 Bad Request` | No | Our resource is malformed. Show `OperationOutcome.diagnostics`. Fix, do not retry. |
| `401 Unauthorized` | No | Missing/invalid API key. Surface "FHIR authentication failed — check `FHIR_API_KEY`". Stop the run. |
| `403 Forbidden` | No | Attempted a write on a resource we do not own, or a disabled operation. Mark the record `SYNC_FORBIDDEN` with the diagnostics. This is a *state*, not a transient error. |
| `404 Not Found` | No | Resource id gone or bad path. Clear the stale `fhirPatientId` and re-run the conditional create. |
| `405 Method Not Allowed` | No | We issued a disabled operation (DELETE / conditional update / update-as-create). A **programming error** — fail loudly in dev. |
| `412 Precondition Failed` | No | `If-None-Exist` matched multiple resources. Surface for manual inspection. |
| `429 Too Many Requests` | **Yes** | Honour `Retry-After` if present, else exponential backoff with jitter (1s → 2s → 4s), max 3 attempts. Also throttle proactively — cap concurrency at ~4 and stay well under 120 req/min. |
| `5xx` | **Yes** (502/503/504) | ≤3 bounded retries with backoff. `500` retried once, then surfaced. |
| Network timeout / reset | **Yes** | `AbortSignal.timeout(15000)`. Retry ≤2. **Because the write may have succeeded, retries must be conditional creates** — see §12.7. |
| `OperationOutcome` on any status | — | Parse `issue[].severity` + `.diagnostics`, sanitize, show the first useful message. Never dump the raw body into the UI or logs. |
| Malformed / non-JSON response | No | Wrap parsing in try/catch; return a typed "unexpected response" error. |

### 12.7 Idempotency — the core Tier 2 requirement

| Scenario | Guarantee | Mechanism |
|---|---|---|
| Repeat Patient sync | No duplicate remote Patient | `POST` + tag-scoped `If-None-Exist` on the MRN identifier. The second call returns `200` + the existing id. |
| Repeat Observation sync | No duplicate remote Observation | `POST` + `If-None-Exist` on `lab-result\|<cuid>`, a value unique by construction. |
| Repeat full FHIR import | No duplicate local rows | Upsert Patients by unique `mrn`; upsert LabResults by unique `fhirObservationId`; `@@unique([patientId, collectedDate, testCode])` as the second guard. Re-running reports 0 created / N updated. |
| **Retry after an ambiguous network failure** (the server created it, we never saw the response) | Still no duplicate | This is exactly why `If-None-Exist` is used rather than a plain `POST`. The retry's conditional search finds the resource the lost response created, returns `200`, and we recover its id from the header or a follow-up search. |
| Local write vs remote sync failure | No local data loss | Local commit happens **first**; FHIR sync is a separate step recorded in `fhirSyncStatus`. A failed push never rolls back an imported lab result. |
| Duplicate CSV rows | No duplicate local rows | In-file dedupe by `(mrn, date, testCode)` + the DB unique constraint. |

**Where the plan's assumptions were wrong or thin:** (a) the un-scoped `If-None-Exist` on MRN — corrected above; (b) no handling of `200`-with-empty-body or `412`; (c) no requirement to verify the ownership tag before treating a resource as writable; (d) no guard against re-pushing pulled seed data.

---

## 13. CSV import analysis

**Header (exact, from both supplied files):**
```
mrn,collected_date,test_code,test_name,value,unit,ref_low,ref_high
```
Both files are LF-terminated with a trailing newline. The template contains two example rows for `MRN-1001` dated `2026-06-01`. The clean sample contains ten rows for `MRN-1001`, `MRN-1002`, `MRN-1003`, dated 2026-05-02 → 2026-06-20 — all in the past relative to today.

**Test catalog**

| `test_code` | `test_name` | Unit | LOINC |
|---|---|---|---|
| `GLU-F` | Fasting Glucose | mg/dL | 1558-6 |
| `HBA1C` | Hemoglobin A1c | % | 4548-4 |
| `SBP` | Systolic Blood Pressure | mmHg | 8480-6 |

### Decision D-CSV-1 — required vs optional columns

The brief lists rejection reasons as: *unknown MRN, malformed/future dates, non-numeric values, missing required fields, unknown test codes, duplicate rows*. It never says which fields are required. The existing plan treats **all eight** as required — that is over-strict and risks rejecting rows the evaluator considers valid.

| Column | Rule |
|---|---|
| `mrn` | **Required.** Trim, uppercase. Must resolve to a local patient. |
| `collected_date` | **Required.** Strict `YYYY-MM-DD`, a real calendar date, not in the future. |
| `test_code` | **Required.** Case-insensitive, must be in the catalog. |
| `value` | **Required.** Strict numeric, finite, non-negative. |
| `test_name` | **Optional.** If blank, use the canonical name. If present but mismatched, accept and use the canonical name (record a warning). |
| `unit` | **Optional.** If blank, use the canonical unit. If mismatched, **accept with a warning** — do not reject. |
| `ref_low` / `ref_high` | **Optional / nullable.** If present must be numeric; if both present, `ref_low ≤ ref_high` else warn. |

Rationale: reject on data-integrity failures; warn on cosmetic mismatches. Documented in the README so the behaviour reads as a decision, not an accident.

### Parsing rules

Tolerate (do not reject): UTF-8 **BOM** (Excel's default export — the classic trap that turns the first header into `﻿mrn`); CRLF and LF; quoted fields and embedded commas; leading/trailing whitespace in cells; header case and spacing variance; trailing blank lines; rows with fewer columns than the header (missing cells → empty).

Reject the **file** (not row-by-row) only for: not `.csv`; over the size limit; unparseable as CSV; header missing required columns; zero data rows; more than the row cap.

### Row outcome taxonomy — three states, not two

| State | Meaning | Counted as |
|---|---|---|
| **Accepted** | Inserted | `acceptedCount` |
| **Rejected** | Failed validation, with a specific human reason | `rejectedCount` |
| **Skipped (already imported)** | Identical `MRN + date + test` already in the DB | `skippedDuplicateCount` |

Separating "skipped" from "rejected" is what makes the *re-upload a corrected file* requirement read correctly: the previously-good rows come back as "already imported", the previously-bad rows now import, and nothing duplicates. The plan collapsed these into one bucket.

### Import pipeline

1. Validate the file envelope (type, size).
2. Stream-parse with `csv-parse` (`bom: true`, `columns: normalizedHeader`, `relax_column_count`, `skip_empty_lines`, `trim`).
3. Validate the header set.
4. Batch-load every referenced MRN in **one** query (avoid N+1).
5. Batch-load existing `(patientId, collectedDate, testCode)` keys for those patients in one query.
6. Per row, collect **all** errors (not just the first) → classify Accepted / Rejected / Skipped. Dedupe within the file as we go, first occurrence wins; later identical rows are Skipped with reason "duplicate of row N".
7. Insert accepted rows with `createMany({ skipDuplicates: true })` — the DB constraint is the last line of defence against a race.
8. Write the `LabUpload` summary.
9. **Then** (Tier 2) enqueue FHIR pushes. A push failure never unwinds step 7.
10. Render the report: totals + a per-row table (row number, MRN, status, reason).

### Decision D-CSV-2 — value conflict on re-upload

If a row matches an existing `(MRN, date, test)` but carries a **different value**, we **skip and report** ("already imported with value X; delete and re-import to change") rather than overwrite. Rationale: the import stays deterministic and idempotent, and silently mutating a stored clinical result on re-upload is the wrong default in a clinical system. Documented.

### Decision D-CSV-3 — seed the sample MRNs

`prisma/seed.ts` creates patients `MRN-1001`, `MRN-1002`, `MRN-1003` (fabricated demographics) so the **supplied clean sample imports 10/10 on a fresh database**. Without this, the evaluator's first action produces a wall of "unknown MRN" and looks like a broken feature. This is the single highest-value item missing from the existing plan.

### CSV injection

The real risk is on **export**, not import: a cell like `=HYPERLINK(...)` written into a CSV we generate executes when opened in Excel. If we add any CSV export (e.g. a rejected-rows report), prefix cells beginning with `= + - @ \t \r` with a `'`. On import there is no execution risk, and React escapes cell text on render — the plan's phrasing ("parser does not execute formulas") was confused; the correct control is stated here.

---

## 14. Questionnaire analysis

**Verified line by line against `questionnaire-dsma8.json`** — the existing plan reproduces it correctly.

- `id: dsma-8`, `version: 1.0`, title *Diabetes Self-Management Assessment (DSMA-8)*.
- Instructions: *"Over the last 2 weeks, how often have the following applied to you? There are no right or wrong answers."*
- Options: `0 Never`, `1 A few days`, `2 More than half the days`, `3 Nearly every day`.
- 8 items `q1…q8`, texts as supplied (all negatively framed — a higher score means worse self-management; **no reverse scoring**).
- Scoring: `method: sum`, `min: 0`, `max: 24`, `allItemsRequired: true`. 8 × 3 = 24 ✓ internally consistent.
- Bands: `0–6 Low risk` (green, "Routine follow-up."), `7–12 Moderate risk` (yellow, "Review at next appointment."), `13–18 High risk` (orange, "Clinician should contact the patient."), `19–24 Very high risk` (red, "Prompt clinical review recommended."). Contiguous, non-overlapping, complete coverage of 0–24 ✓.

**Implementation rule:** import the JSON file itself as the single source of truth — do not retype the item text or the bands into TypeScript literals. Text drift is exactly the kind of detail an evaluator diffs.

**Scoring function** (pure, unit-tested):
```
scoreAssessment(answers: Record<questionId, 0|1|2|3>) → { total, band }
```
- Throws if any of `q1…q8` is missing, if an unknown `questionId` appears, or if a value is outside 0–3.
- Band lookup by `min ≤ total ≤ max` from the JSON, never a hard-coded `if` chain.
- Boundary tests: 0→Low, 6→Low, 7→Moderate, 12→Moderate, 13→High, 18→High, 19→Very high, 24→Very high.

**Token lifecycle**

| Stage | Behaviour |
|---|---|
| Generate | `crypto.randomBytes(32)` → base64url (~43 chars). The raw token is held in memory only. |
| Persist | `SHA-256(raw)` into `tokenHash` (unique). `expiresAt = now + 7 days`. `status = SENT`. |
| Deliver | Emailed as `${APP_BASE_URL}/assessment/${raw}`; also offered once as a copy-link in the clinician UI. |
| Render | Hash the path param, look up by `tokenHash`. Not found → generic "link not valid". Completed → "already submitted". `expiresAt < now` → "expired" (and lazily persist `EXPIRED`). |
| Submit | Re-run every check server-side; validate all 8 answers; compute the score server-side; in one transaction insert the answers, then `updateMany({ where: { id, status: SENT }, data: { status: COMPLETED, … } })` and assert the count is 1. |
| After | The link is dead. The raw token is never stored and never logged. |

Multiple outstanding assessments per patient are allowed (each token independent) — the simplest behaviour, and it matches the "assessment history" requirement.

---

## 15. Expected evaluator edge cases

Written from the evaluator's chair. Each of these should have a defined, intentional outcome.

### Auth & authorization
1. Log in with the supplied test credentials on the **live Vercel URL**. → works.
2. Wrong password / unknown email. → identical generic error.
3. Visit `/dashboard`, `/patients`, `/patients/<id>`, `/labs/upload`, `/integrations/fhir` while logged out. → redirect to login, no flash of content.
4. `curl -X POST` a mutation route / invoke a Server Action with no session cookie. → 401/403, nothing written.
5. Log out, press Back. → no cached protected content.
6. Manipulate a session cookie. → rejected.

### Patients
7. Create a patient with a **duplicate MRN**. → clean field-level error, not a Prisma stack trace.
8. Same MRN in a different case (`mrn-1001`). → treated as a duplicate (normalization).
9. **Malformed email** (`joe@`, `joe@@x.com`, empty). → validation error.
10. **Future DOB**, and a DOB in 1850. → validation error.
11. Empty required fields; a 500-character name; unicode/emoji name; leading/trailing spaces. → handled.
12. Phone in international format `+961 3 123456`. → **accepted** (not over-restricted).
13. Delete a patient with assessments and labs. → cascades cleanly, no FK error, list updates.
14. Search partial name, partial MRN, wrong case, no matches, empty query. → correct results; "no matches" ≠ "no patients".
15. Visit `/patients/<random-cuid>`. → intentional 404.

### Assessment
16. Send an assessment; check the email arrives with a working link.
17. Send to a patient **with no email**. → blocked with a clear message.
18. Open the link **logged out / in a private window**. → the form renders.
19. Submit with **one question unanswered**. → blocked client-side *and* server-side.
20. Tamper with the POST to include a forged total score. → the server recomputes and ignores it.
21. Submit values outside 0–3. → rejected.
22. **Score boundary cases** — craft answer sets totalling 0, 6, 7, 12, 13, 18, 19, 24 and check the band each time.
23. **Reuse the link** after completing. → "already submitted".
24. **Invalid / random / truncated token.** → generic "not valid", no information leak.
25. **Expired link** (they may ask us to demo this — have a way to show it). → "expired".
26. Double-submit (two tabs, simultaneously). → exactly one completion, 8 answers not 16.
27. Check the DB/UI for the raw token. → only a hash exists.
28. Send two assessments to one patient. → both tracked in history.

### CSV
29. **Download the template**, then upload it unmodified. → imports (or reports duplicates on the second attempt).
30. **Upload the supplied clean sample.** → **10/10 accepted** (requires the seeded MRNs).
31. **Upload the same file again.** → 0 new, 10 "already imported", no duplicates.
32. Upload a **deliberately messy file** — explicitly promised in the brief. Expect a mix of: unknown MRN, `01/06/2026`, `2026-13-45`, a future date, `abc` as a value, blank cells, `XYZ` test code, two identical rows, a row duplicating something already imported, and a valid row at the bottom. → per-row reasons, **and that last valid row must import**.
33. Upload a CSV **saved from Excel** (UTF-8 BOM + CRLF). → parses.
34. Upload a `.txt` / `.pdf` / an image renamed `.csv`. → clean file-level error.
35. Upload an **empty file**, and a header-only file. → clean message, not a crash.
36. Upload a file with **wrong/missing columns**, or with columns reordered. → clean message.
37. Upload a large file (thousands of rows). → completes or fails gracefully, no timeout crash.
38. Check a chart afterwards: does `2026-05-02` render as **2 May** (timezone off-by-one)?
39. Check the report actually says *why*, per row, in human language.

### Dashboards
40. Log in on a **fresh/empty database**. → every panel looks intentional, not broken.
41. A patient with **no labs and no assessments**. → designed empty states.
42. A patient with **one** data point. → the chart still renders sensibly.
43. Labs entered out of chronological order. → the line is still chronological (not category-ordered).
44. Verify total patients, completion rate, and risk distribution **by hand** against the data.
45. Zero assessments sent. → completion rate shows `—`, not `0%` or `NaN`.
46. A patient with several assessments. → counted once in the risk distribution, using the latest completed one.
47. Change the recent-uploads filter. → the result set actually changes (server-side).
48. **Resize to 375px** / open on a phone. → tables and charts remain usable.
49. Throttle the network. → loading states appear, not a blank screen.

### FHIR
50. Run the seed import. → 5 patients + full history appear **in the same dashboards** as local data.
51. **Run it a second time.** → zero duplicates; the report says created 0 / updated N.
52. Check pagination actually happened — 36 observations per patient across 2 pages, not one truncated page.
53. Create a patient locally, then query the FHIR server by that MRN filtered by our tag. → the resource exists.
54. Edit that patient. → the remote resource updates (`PUT`, not a second create).
55. Import a CSV lab, then find the corresponding Observation on the server with the right LOINC, value, unit, date and subject.
56. Push the same lab twice. → one Observation.
57. **Break the API key** in env. → a clear "authentication failed" is surfaced; the rest of the app still works.
58. Point at an unreachable host / simulate a timeout. → clean failure, no hang, no crash.
59. Simulate `429`. → backoff, not a retry storm.
60. Try to edit a seeded (MRN-2001) patient. → intentional read-only behaviour, no 403 spam.
61. Grep the production JS bundle for the API key. → absent.
62. Check server logs for patient names / MRNs / tokens. → absent.

### Repo, docs, deployment
63. Fresh clone + README → running locally in under 10 minutes.
64. `git log` — incremental, meaningful history, not one squashed commit.
65. Scan the whole history for secrets. → none.
66. Read "Decisions & tradeoffs" — is it real reasoning or filler?
67. Are the architecture diagram, ERD, and FHIR integration diagram present and accurate?
68. Does the ERD match `schema.prisma`?
69. Do migrations exist and apply cleanly to an empty database?
70. Is the live URL up, and does the test login work *on it*?

---

## 16. Risks and ambiguities

### Top technical risks

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **~2.5 working days, not 7** | Unfinished submission | High | Cut Tier 3. Ship Tier 1 complete before starting Tier 2. Deploy on day 1, not day 3. |
| R2 | **Cross-candidate MRN collision on `If-None-Exist`** | Tier 2 push silently binds to another candidate's resource; every update 403s | High | Tag-scoped conditional create + verify `meta.tag` before marking `OWNED` (§12.2). **Probe this on the live server before building on it.** |
| R3 | **Sample CSV MRNs not seeded** | The evaluator's first upload rejects 10/10 and looks broken | High | Seed `MRN-1001/1002/1003` (D-CSV-3). |
| R4 | **Vercel function timeout on the FHIR import** | Tier 2 works locally, fails on the live URL | Medium-High | `maxDuration = 60` + one request per seed MRN + a client-driven progress loop. |
| R5 | **Prisma connection exhaustion on serverless** | Intermittent 500s under the evaluator's clicking | Medium-High | Neon pooled URL + `directUrl`; Prisma client singleton. |
| R6 | **Resend only delivers to your own address** | "Send assessment" appears broken during the demo | High | Copy-link fallback in the UI + seed a demo patient with your own address + document the constraint. |
| R7 | **The API key already sits in `.docs/PRIVATE_*.md`; the repo is not yet initialised** | Permanent secret leak in a repo you are submitting | Medium | `.gitignore` before the first commit; redact the key from that file now; secret-scan before push. |
| R8 | **Recharts / React 19 peer conflict** | Install or build failure late in the build | Medium | Verify versions at install time; Recharts 3.x, or pin React 18. |
| R9 | **Auth.js v5 + Prisma + edge middleware friction** | Hours lost on config | Medium | Split-config pattern, JWT strategy, `bcryptjs`. Hard timebox: 1 hour, then hand-roll a `jose` cookie session. |
| R10 | **Date timezone off-by-one** | Charts and tables show the wrong day — very visible | Medium | `@db.Date`, parse and format in UTC consistently. |
| R11 | **Unknown FHIR server behaviour** (`_tag` in `If-None-Exist`, empty 200 body, exact seed volume) | Rework mid-Tier-2 | Medium | Phase-0 read-only probe with `curl` before writing the client. |
| R12 | **Over-strict CSV validation** | Rejects rows the evaluator thinks are valid | Medium | D-CSV-1: required = mrn/date/code/value; warn on cosmetic mismatches. |
| R13 | **Vercel build must run `prisma generate` / migrations** | Deploy fails or the schema drifts | Medium | `postinstall: prisma generate`; `prisma migrate deploy` in the build command. |

### Ambiguities resolved by documented decision (no need to email Capadev)

| ID | Ambiguity | Decision |
|---|---|---|
| D-PAT-1 | Are patient email/phone required? | Nullable at create; email **required at send-assessment time** with a clear message. |
| D-PAT-2 | Delete strategy? | Hard delete with confirm, cascading assessments/answers/labs. Documented, including that the remote FHIR resource cannot be deleted (the server disables DELETE). |
| D-CSV-1 | Which CSV columns are required? | `mrn`, `collected_date`, `test_code`, `value`. Others optional/warned. |
| D-CSV-2 | Re-upload with a changed value? | Skip and report; never silently overwrite a stored result. |
| D-CSV-3 | Sample MRNs don't exist | Seed `MRN-1001/1002/1003`. |
| D-CSV-4 | Unknown `test_code`? | Reject the row (the brief lists it explicitly as a rejection reason). |
| D-DASH-1 | "Total patients" definition | All patients in the system, local and FHIR-imported, since hard delete means there are no inactive rows. |
| D-DASH-2 | "Assessment completion rate" | `completed ÷ all sent`, all-time. Expired counts as not completed. `—` when the denominator is 0. |
| D-DASH-3 | "Patients per risk band" | Each patient counted once by their **latest completed** assessment; "No assessment" shown as its own bucket. |
| D-FHIR-1 | Editing seeded patients | FHIR identity fields read-only, badge shown, never pushed. |
| D-FHIR-2 | What gets pushed | CSV-sourced labs only; never re-push pulled data; attempt-and-surface for CSV labs on seed patients. |
| D-FHIR-3 | Pull vs local demographics | Remote wins on first import; local wins on subsequent imports. |
| D-DATA-1 | Two seed observations, same patient/date/code | Merge into the existing row and attach the FHIR id; count as "merged". |
| D-ASSESS-1 | Multiple outstanding assessments | Allowed; each token independent. |
| D-SEC-1 | Test credentials placement | Submission email; the README points there rather than publishing a live password. |

### The only genuinely open questions

Neither blocks starting work; both are answerable by a five-minute read-only probe of the FHIR server, which should be Phase 0's first task:

1. Does HAPI accept `_tag` as a search parameter inside an `If-None-Exist` header? *(Fallback defined in §12.2 if not.)*
2. Does a matched `If-None-Exist` return the resource body, or a bare `200` with a `Content-Location` header? *(Both paths are defined; the probe just tells us which is the fast path.)*

Nothing here warrants emailing Capadev. **One non-technical item does need attention:** the email asked for a reply confirming interest — confirm that was sent.

---

## 17. Recommended implementation sequence

The existing plan's Phase 0–9 order is sound. Two changes: **deploy earlier** (Vercel-specific failures are the ones that bite late), and **treat Tier 3 as out of scope unless everything else is green with time to spare**.

| Phase | Work | **Checkpoint — must pass before moving on** |
|---|---|---|
| **0. Repo & recon** | `git init`; `.gitignore` (`.env*`, `.docs/PRIVATE_*.md`) **in the first commit**; redact the key from the plan file; Next.js + TS + Tailwind scaffold; Neon DB provisioned; `.env.example`; **read-only `curl` probe of the FHIR server** (seed patient search, one page of observations, note the pagination shape, test `_tag` in a conditional-create header). | `git log` shows a clean first commit with **no secret**; `curl` returns a seeded patient; the two open questions in §16 are answered. |
| **1. Schema, auth, deploy skeleton** | Prisma schema + first migration; seed clinician **and MRN-1001/1002/1003**; Auth.js credentials login; protected layout; **deploy to Vercel now**. | Login works **on the live Vercel URL** with the seeded clinician; a logged-out request to a protected route redirects; migrations applied to the production DB. |
| **2. Patient CRUD** | Zod schemas; list + search; create/edit/detail/delete; validation and error states. | Duplicate MRN gives a field-level error; future DOB rejected; search by partial name and MRN works; the empty state looks intentional. |
| **3. Assessment flow** | Load the official JSON; pure scoring fn + unit tests; token generate/hash; send action; `EmailService` + Resend adapter + copy-link fallback; public form; submit with server-side scoring and the single-use guard; history on the patient page. | Full loop: send → receive link → complete → score and band correct on the clinician page. Reusing the link fails. A backdated row shows expired. Boundary unit tests pass. |
| **4. CSV importer** | Template download; parser with BOM/CRLF tolerance; validation engine; three-state row taxonomy; partial import; `LabUpload` summary; report UI; unit tests including a hand-built messy file. | **The supplied clean sample imports 10/10 on a fresh DB. Re-uploading it creates zero duplicates. A messy file imports its valid rows and explains every rejection.** |
| **5. Dashboards** | Patient charts (glucose, HbA1c, score history, SBP); lab + assessment tables; clinic aggregates; recent-uploads filter; loading/empty/error/responsive polish. | Aggregates match a hand count; an empty DB looks designed; 375px viewport usable; dates render on the correct day. |
| **6. Tier 1 gate — deploy & QA** | Redeploy; run the §15 Tier 1 edge cases against the **live URL**; grep the bundle for secrets. | **Every Tier 1 Definition-of-Done box is ticked on the live URL.** This is the point at which the submission is already valid. Do not start Tier 2 before this passes. |
| **7. FHIR client & push** | Typed server-only client (headers, timeout, `OperationOutcome` parsing, retry/backoff, throttle); Patient mapper; tag-scoped conditional create + tag verification; owned `PUT`; Observation mapper + idempotent create; sync status on records; unit tests for mappers. | Create a patient → the resource exists on the server under our tag. Edit → updates, does not duplicate. Push a lab twice → one Observation. Wrong key → clean auth error, app still usable. |
| **8. FHIR pull** | Seed patient search; **paginated** observation pull with loop guards; local upserts; integration page with per-MRN import and progress; error surfacing. | 5 patients + 180 observations total (36 each) imported over 2 pages per patient (proving pagination); **running the import twice changes nothing**; charts show FHIR data alongside CSV data. |
| **9. Tier 2 gate — deploy & QA** | Redeploy with FHIR env vars; **run the import from the live URL**; run the §15 FHIR edge cases. | The import completes on Vercel **without a timeout**; the second run is a no-op; no key in the bundle or logs. |
| **10. Documentation** | README: overview, tier coverage, stack, <10-min setup, env vars, architecture diagram, ERD, FHIR integration diagram, CSV rules, security notes, **Decisions & tradeoffs**, testing, limitations. Remove debug logs and dead code; run lint/typecheck/test/build; fresh-clone dry run; scan git history for secrets. | A fresh clone runs in under 10 minutes following only the README. All three diagrams render on GitHub. The ERD matches the schema. |
| **11. Submit** | Reply to the challenge email: repo link, live URL, test clinician login, README pointer. | Sent by **Wed 2026-08-26 EOD** — ahead of the Thursday-noon interview. |
| **12. Tier 3 — only if genuinely safe** | Grounded trajectory summary (§18). | Only start if Phases 0–11 are complete and deployed. If it is not finished and stable, ship without it — an unfinished Tier 3 is worse than no Tier 3. |

**Hard rule:** phases 0–6 are the submission. Everything after is upside.

---

## 18. Tier 3 assessment (analysis only — not to be implemented yet)

**Does the proposed "grounded patient trajectory summary" satisfy Tier 3?** Yes. The brief's own first example is *"a natural-language summary of a patient's trajectory for a clinician"*, and it is grounded in real stored data, which is the stated evaluation axis.

**Recommended refinement — cheaper *and* safer than the plan's version.** Rather than handing the model raw series and asking it to spot trends (where it can invent a number), **compute the facts in TypeScript and let the model only narrate them**:

Computed deterministically in code: first/latest value and delta per test; direction and magnitude of change; count of out-of-reference-range results; latest assessment score, band, and the change since the previous one; days since last data; explicit "insufficient data" flags.

The model receives only that fact object and writes 4–6 sentences. Every number in the prose already exists in the payload, so a fabricated figure becomes trivially detectable — and we can render the computed facts directly beside the summary so a clinician can check it at a glance. This is *less* code than the plan's version, not more.

**Data to send:** age (derived from DOB, not the DOB itself), sex, the computed fact object.
**Data to never send:** name, MRN, email, phone, exact DOB, tokens, free text, anything about other patients.

**Safeguards:** low temperature; a system prompt forbidding diagnosis, treatment or medication advice, and forbidding any number not present in the input; output rendered as plain text; a fixed disclaimer; the computed source facts shown alongside; never persisted as a clinical record; graceful "not enough data" and "provider unavailable" states; API key server-side only.

**Scope control:** one button on the patient page, one server route, one prompt module. No chat, no history, no streaming, no RAG. Target: a single focused session. **If Phase 11 is not complete, do not start.**

**Lower-complexity alternative if time is very short:** a purely deterministic "clinical flags" panel (rule-based: HbA1c rising ≥0.5% over 3 months, ≥2 out-of-range glucose readings, risk band worsening) with **no LLM at all**. It is genuinely useful and hallucination-proof — but it does not satisfy Tier 3, which explicitly asks for an AI-powered feature. Build it only as the substrate for the narration above, not as a replacement.

---

## 19. Definition of Done — Tier 1

- [ ] Clinician login works locally **and on the live Vercel URL**; the evaluator's test account is valid.
- [ ] Every protected route and every mutation rejects unauthenticated access server-side.
- [ ] Passwords stored only as bcrypt hashes.
- [ ] Patient create / read / update / delete / list / search all work.
- [ ] MRN uniqueness enforced at the DB level with a friendly UI error.
- [ ] Validation: required fields, future DOB, email format, sex enum — all with clear messages.
- [ ] Send assessment emails a unique tokenized link (and the link is recoverable in-app).
- [ ] Token is ≥32 random bytes; only its SHA-256 hash is persisted.
- [ ] The link expires exactly 7 days after sending and is single-use.
- [ ] All 8 questions and 4 options render exactly as in the official JSON.
- [ ] The server computes the score and band; a client-supplied score is ignored.
- [ ] All four risk bands verified at both boundaries.
- [ ] Status tracked `sent → completed | expired`; history visible on the patient page.
- [ ] Invalid / expired / already-used links each have a distinct, non-leaky screen.
- [ ] CSV template downloadable in-app and byte-identical to the supplied file.
- [ ] **The supplied clean sample imports 10/10 on a fresh database.**
- [ ] A deliberately messy file yields per-row accept/reject reasons **and still imports its valid rows**.
- [ ] Re-uploading any file creates zero duplicates; duplicates are reported as "already imported".
- [ ] BOM/CRLF/quoted/ragged CSVs parse; wrong file types fail cleanly.
- [ ] The patient page shows glucose, HbA1c and questionnaire-score time series with correct chronology, units and tooltips.
- [ ] The clinic dashboard shows total patients, completion rate, per-band patient counts, and recent uploads with a working filter.
- [ ] Aggregates verified by hand against the underlying data.
- [ ] Loading, empty and error states designed for every panel; an empty DB looks intentional.
- [ ] Usable at 375px width.
- [ ] Dates render on the correct calendar day everywhere.
- [ ] README: setup in <10 min, architecture diagram, ERD, Decisions & tradeoffs.
- [ ] No secrets in the repo, in git history, in the client bundle, or in logs.
- [ ] Incremental, meaningful git history.

## 20. Definition of Done — Tier 2

- [ ] FHIR base URL, candidate id and API key all from env vars; the key is never `NEXT_PUBLIC_`, never in the bundle, never logged.
- [ ] `X-API-Key` and FHIR JSON headers on **every** request, including followed `next` links.
- [ ] Patient push uses `POST` + **tag-scoped** `If-None-Exist`; running it twice creates one resource.
- [ ] The returned resource's ownership tag is verified before it is treated as writable.
- [ ] `200` (matched), `201` (created) and `Location`-header-only responses all resolve to an id.
- [ ] Owned patient updates use `PUT /Patient/{id}` — never a conditional update, never update-as-create.
- [ ] Seeded/external patients are never written to, and this is visible in the UI.
- [ ] CSV labs push as `Observation` with the correct LOINC, value, UCUM unit, date and subject.
- [ ] Observation pushes carry a stable identifier and are conditional; a retry cannot duplicate.
- [ ] Pulled (`source = FHIR`) results are never pushed back.
- [ ] `MRN-2001…MRN-2005` and their full histories import.
- [ ] Bundle pagination follows the server's `next` link to exhaustion, with loop and page-count guards, and reports truncation rather than hiding it.
- [ ] **Re-running the entire import produces zero new local rows.**
- [ ] Imported data appears in the same dashboards and charts as local data.
- [ ] `429` honours `Retry-After` with bounded backoff; transient 5xx and timeouts retry; 400/401/403/404/405/412 fail fast with distinct messages.
- [ ] `OperationOutcome.diagnostics` surfaced safely; raw bodies never dumped to UI or logs.
- [ ] A FHIR outage never breaks the rest of the app, and never destroys locally-committed data.
- [ ] Per-record sync status and last error are visible.
- [ ] **The import runs to completion from the deployed Vercel URL** without a function timeout.
- [ ] The README contains the FHIR integration diagram and explains the idempotency design.

## 21. Definition of Done — Tier 3

- [ ] Tier 1 and Tier 2 are complete, deployed and QA'd first.
- [ ] Exactly one AI feature, genuinely useful to a clinician.
- [ ] Grounded in facts computed from the patient's real stored data.
- [ ] No name, MRN, email, phone, DOB or token sent to the model.
- [ ] The prompt forbids diagnosis, treatment advice, and any number absent from the input.
- [ ] Computed source facts rendered beside the summary for verification.
- [ ] Fixed disclaimer; never stored as a clinical record.
- [ ] Insufficient-data and provider-failure states handled.
- [ ] API key server-side only, on a genuinely free tier.
- [ ] The README explains the grounding strategy, hallucination handling, and limitations.

---

## 22. Immediate next actions (on your go-ahead)

1. Redact the API key from `.docs/PRIVATE_CAPADEV_PULSETRACK_IMPLEMENTATION_PLAN.md` and move it to `.env.local`.
2. `git init` + `.gitignore` + first commit — **before** any other file is added.
3. Read-only `curl` probe of the FHIR server to close the two open questions in §16.
4. Begin Phase 1.

---

## 23. Phase 0 reconnaissance — verified server behaviour

Read-only probe of the live FHIR server, **2026-08-24**. These are measurements, not assumptions, and three of them contradict what this document originally said.

### Confirmed

| Check | Result |
|---|---|
| Auth via `X-API-Key` | Works. `HTTP 200`, ~1.4s first response. |
| Seed patients | All five present. `MRN-2001…2005` → resource ids `1, 38, 75, 112, 149`. |
| Seed ownership tag | `cand-admin` — **not** our candidate id. Confirms they are read-only to us and that an ownership check must require *our* tag specifically. |
| `_tag` as a search parameter | Supported. `Patient?_tag=…|cand-joe-l` returns `total: 0` — we own nothing yet. |
| Observation shape | `status: final`, `category: laboratory`, `effectiveDateTime` as a plain date, `valueQuantity` with UCUM. |
| Reference ranges on seed data | **Absent.** `referenceRange` is not present → `refLow`/`refHigh` must be nullable, as designed (§10). |
| Data window | 2025-07-20 onward, monthly, 12 months. |

### Correction 1 — volume was wrong

**36 observations per patient**, not ~180. Each patient has exactly 12 of each of the three codes (`4548-4`, `1558-6`, `8480-6`). 180 is the total across all five patients. This document previously stated 180 *per patient*; corrected throughout.

### Correction 2 — `_count=50` never paginates

At the API guide's suggested `_count=50`, all 36 observations return in a single page with **no `next` link**. The pagination code path would never execute, and an evaluator checking that pagination was implemented would see a single-page response.

**Decision D-FHIR-4:** pull with **`_count=20`**, which yields 2 pages per patient (20 + 16) and exercises the loop for real. Documented in the README as a deliberate choice rather than an arbitrary number.

### Correction 3 — the `next` link is unreachable *(most important)*

The server returns pagination links pointing at its own internal container host:

```
next -> http://hapi:8080/fhir?_getpages=c9b366f6-…&_getpagesoffset=20&_count=20&_bundletype=searchset
```

`hapi:8080` is a Docker-internal hostname. Fetching it from outside returns **HTTP 000 / connection failed** — verified.

This directly contradicts the API guide's instruction to *"follow the bundle's `next` link"*, and contradicts what §12.5 of this document originally said. Following the link verbatim silently truncates every import to its first page.

**Decision D-FHIR-5:** take the `next` link's **path tail and query string**, discard its origin, and re-base onto our configured `FHIR_BASE_URL`. Verified working: the re-based URL returned the remaining 16 entries (20 + 16 = 36 ✓).

```ts
function rebaseNextLink(nextUrl: string, base: string): string {
  const u = new URL(nextUrl);
  const i = u.pathname.indexOf('/fhir');
  const tail = i >= 0 ? u.pathname.slice(i + '/fhir'.length) : u.pathname;
  return `${base.replace(/\/$/, '')}${tail}${u.search}`;
}
```

This is a strong walkthrough talking point: it is exactly the class of defect that only surfaces against a real server, and it is invisible at `_count=50`.

### Correction 4 — do not trust `bundle.total`

`total` is present on an unpaged search (`36`) but **absent** on a paged one. Loop control must depend on the presence of a `next` link, never on comparing a running count against `total`.

### Still open — deferred to Phase 7

Whether `_tag` is accepted *inside* an `If-None-Exist` header. Not testable without a write, and writes are permanent (`DELETE` is disabled server-side), so this is resolved with the first real conditional create. The fallback in §12.2 — tag-filtered `GET` first, then plain `POST`, then verify `meta.tag` on the response — covers it either way.
