# Capadev Software Engineer Challenge "PulseTrack"

Welcome! This challenge asks you to build a small **remote patient monitoring platform**. It mirrors the kind of work we do every day: healthcare data, clinical integrations, and dashboards that clinicians actually use.

It is designed in **tiers**. **A complete, polished Tier 1 submission is a fully valid submission.** Tiers 2 and 3 let you show more depth, quality beats quantity every time. We would rather see a smaller scope done excellently than everything done halfway.

**Time expectation:** You have **7 calendar days** from receiving this brief. You should not need to pay for anything, every service referenced has a genuinely free tier that does not require a credit card.

---

## The scenario

A small diabetes clinic needs a web platform where clinicians can:

1. Manage their patients
2. Email patients a self-assessment questionnaire and track responses
3. Upload lab results in bulk via CSV
4. Monitor everything through dashboards
5. *(Tier 2)* Exchange data with the national health data platform (a FHIR server we host)
6. *(Tier 3)* Get AI-assisted insights from the data

---

## Required stack

- **Next.js** (App Router): frontend and backend in one project
- **PostgreSQL**: we recommend [Neon](https://neon.tech) (free, no credit card) or [Supabase](https://supabase.com)
- An ORM of your choice (Prisma, Drizzle, …) — schema design and migrations are part of the evaluation
- **Deployed live on [Vercel](https://vercel.com)** (free Hobby tier): a working URL is required, not optional
- Anything else (UI library, chart library, email provider) is your choice

---

## Tier 1: Core platform (required)

### 1. Authentication
Clinician accounts with email + password login (Auth.js, or hand-rolled JWT, your call, but be ready to justify it). No patient accounts exist anywhere in this system.

### 2. Patient management
CRUD for patients: full name, date of birth, sex, MRN (unique medical record number), email, phone. List view with search. Basic input validation.

### 3. Email questionnaire flow
We provide one predefined assessment: the **Diabetes Self-Management Assessment (DSMA-8)**, see `questionnaire-dsma8.json` for the exact items, options, scoring, and risk bands.

Required flow:
- Clinician clicks **Send assessment** on a patient → the system emails the patient a **unique tokenized link** (the patient does *not* log in, could be on schedule as well)
- The public form renders the 8 questions, validates completeness, and submits
- Links **expire after 7 days** and are **single-use**
- The system stores the responses, computes the total score and risk band, and tracks status per assessment: `sent → completed` or `sent → expired`
- The clinician sees assessment history and scores on the patient's page

Use any free email service: [Resend](https://resend.com) (free tier) or [Brevo](https://www.brevo.com). For development, [Mailtrap](https://mailtrap.io)'s sandbox is convenient. Emailing to test inboxes you own is fine.

### 4. CSV lab results upload
We provide a fixed template: `lab-results-template.csv`. Implement:

- Template download from within the app
- File upload with **row-level validation**: unknown MRN, malformed/future dates, non-numeric values, missing required fields, unknown test codes, duplicate rows (same MRN + date + test)
- A **validation report**: which rows were accepted, which rejected, and *why* per row
- Valid rows import even when other rows fail (partial import), and re-uploading a corrected file must not create duplicates

We will test your uploader with a deliberately messy file. Ugly data is the point.

### 5. Dashboards
- **Patient view:** lab value trends over time (at least glucose and HbA1c) and questionnaire score history, proper time-series charts with sensible axes
- **Clinic view:** aggregate stats, assessment completion rate, count of patients per risk band, recent uploads with at least one filter (e.g., date range)
- We care about the details: loading states, empty states, error states, and responsiveness. A dashboard with no data should look intentional, not broken.

### 6. Documentation (in your README)
- Setup instructions (someone should be able to run it locally in under 10 minutes)
- **Architecture diagram** and **ERD**
- A short **"Decisions & tradeoffs"** section: what you chose, what you'd do differently with more time. We read this carefully.

---

## Tier 2: FHIR integration (strongly recommended, makes a big difference)

We host a **HAPI FHIR (R4) server**, think of it as the national health data platform your clinic must report to. You will receive a **base URL and a personal API key** with this brief. Full API documentation is in `fhir-api-guide.md`.

Requirements:

1. **Push:** when a patient is created or updated in your app, sync them to the FHIR server as a `Patient` resource; when lab results are imported, push them as `Observation` resources linked to that patient
2. **Pull:** the server contains **pre-seeded historical data** for several patients (identified by MRN, listed in the API guide). Import these patients and their historical observations into your system so they appear in your dashboards alongside locally-entered data
3. Handle the realities of an external API: authentication, failures, retries or clear error surfacing, and not re-importing the same data twice
4. Add an **integration diagram** to your README showing the data flow between your app and the FHIR server

You'll need to read enough of the [FHIR R4 spec](https://hl7.org/fhir/R4/) to work with `Patient` and `Observation`. That's deliberate, we want to see how you approach an unfamiliar standard.

---

## Tier 3: AI feature (open-ended bonus)

Build **one useful AI-powered feature** on top of the data, using any model with a genuinely free API key e.g., **Google Gemini** (free tier) or **Groq** (free tier). No paid keys.

The feature is your call. Ideas, purely as inspiration: a natural-language summary of a patient's trajectory for a clinician; automatic flagging of concerning patterns across labs + questionnaire scores; RAG over a clinical guideline document; "ask questions about this patient" chat grounded in their actual data.

We evaluate **judgment, not ambition**: Is it grounded in the real data? How do you handle hallucination risk in a clinical context? Is the prompt design thoughtful? Is it actually useful, or a demo for its own sake? A small, well-grounded feature beats an impressive-looking one that makes things up.

---

## Rules & policies

- **AI coding assistants are of course allowed**, we use them too. You must fully understand what you submit: the walkthrough call will include detailed questions about your code and decisions.
- **Security matters everywhere.** This is healthcare. We look for: tokenized links that expire, no secrets in the repo, no sensitive data in logs or URLs, parameterized queries, and sensible authorization checks. Use only fabricated data.
- **The FHIR server is shared between candidates and enforces isolation**: everything you create is automatically tagged to you, and you can only modify your own resources, seed data and other candidates' data are read-only. Details in the API guide.
- Keep your git history intact, we look at how you work, not just the end state.

## Submission

Reply to the challenge email within 7 days with:

1. **Git repository link**: https://github.com/hadyGhazi
2. **Live URL** on Vercel
3. A **test clinician login** for us
4. Your README covering everything

After submitting, we'll schedule a call: you demo the app, then we discuss your decisions. Every candidate who completes the challenge receives **written feedback** on their submission regardless of outcome.

Questions about the brief? Email us,.

Good luck, we hope you enjoy building this.
