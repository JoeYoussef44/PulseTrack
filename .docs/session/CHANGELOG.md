# Changelog

What happened, session by session. Newest first.

Not a git log — `git log` records *what* changed. This records *why*, what was
learned, and what was left undone, so a new session does not have to
reconstruct it from diffs.

---

## Session 10 — 2026-08-26 (Wed) — the clinic analytics reviewed, and a change that moves nothing today

One PR (#45), **open on `dev` and not merged**. Tests 363 → 396. A review of the
clinic lab analytics built in session 9 rather than a rebuild: the histograms,
the trend, the reference context, the unit protection and the styling all
survive.

### The requested change, and the honest measurement of it

The clinic monthly figure was the mean of every result collected that month. A
patient measured three times therefore carried three times the weight of one
measured once, so the line tracked the appointment book as much as the
population. It now summarises each patient within the month first and averages
those — `patientMonthlyMeans`, then `monthlyClinicMeans`, two exported functions
so the intermediate step can be tested on its own.

**Then it was measured against the real register, and it moves nothing.** Only
2 of 66 patient-months carry more than one reading, and in both of those the two
patients have *equal* counts — which makes the raw mean and the patient-weighted
mean mathematically identical. Every delta across three tests and thirteen
months is rounding: the largest is 0.4 mg/dL, and it is the display precision,
not the method.

That is worth writing down rather than quietly claiming an improvement. The
method is right and the seed simply does not exercise it; it would the first
time one patient is seen twice in a month and another once. **A correctness fix
that changes no output today is still a correctness fix, and saying so is more
credible than a number that overstates it.**

### Three defects the review found that the request did not name

- **A float boundary bug in the histogram.** `(5.5 - 4.0) / 0.5` is
  `2.9999999999999996`, so `Math.floor` filed an HbA1c of exactly 5.5 into the
  **5.0–5.5** bucket — one bucket below the one its own label names. Any bin
  index computed as *divide then floor* has this, and it is invisible: the bar
  is one bucket to the left and nothing about the chart looks wrong.
- **`medianLatest` was never rounded** and could reach the page as
  `5.1499999999999995`. Rounded now to one decimal more than a mean, so a
  genuine midpoint of 110 and 111 stays 110.5 rather than becoming 111 — a
  reading nobody took.
- **A test whose every result is in a non-canonical unit rendered nothing**,
  exactly like a test nobody has ordered. With all three in that position the
  page said "No lab results yet", which was false. `usableCount` had been
  computed in `service.ts` since session 9 and never passed to the component.

### A bucket is not normal because most of it is

The histogram had one boolean, `aboveRange`. Two consequences, both of which
tell a clinician something untrue:

- **Hypoglycaemia was painted identically to a normal reading.** Below-range and
  in-range were the same colour, because the only question asked was whether the
  bucket was above the ceiling.
- **A bucket straddling a limit was painted as though all of it were fine.**
  Glucose's ceiling is 99 and the bucket was 80–100.

Buckets are now anchored at the **reference floor** rather than at multiples of
the width from zero. That makes the floor an edge for every test and the ceiling
one wherever it divides — systolic pressure's 90 and 120 both land on edges at a
width of 5, so it has no straddling bucket at all. Where one is unavoidable the
bar takes a neutral tone and the tooltip names the limit it spans.

The general form, and it is session 9's unit finding again in new clothes: **a
visual encoding is a claim about every value it covers.** A fill colour asserts
something about the whole bucket, and the assertion is false whenever the bucket
crosses the boundary the colour is about.

### Two ways a probe lied, fifth session running

Both reported a working feature as broken — again the dangerous direction.

- **A single `mouse.move` does not open a Recharts tooltip.** The line tooltip
  read empty and the feature looked dead. Recharts listens for `mousemove`, and
  one jump from the origin does not reliably produce one over the plot area.
  Two moves do. The histogram tooltip on the same page worked the whole time,
  which is what said the probe was wrong rather than the code.
- **`g.recharts-cartesian-axis text` matched nothing** while
  `.recharts-cartesian-axis-tick-value` matched 82 elements on the same page.
  Every axis read as having no ticks. Separating x from y by comparing rendered
  `y` positions is the version that does not depend on a class name the library
  is free to change.

### What was reviewed and deliberately left alone

Worth recording, because "we checked and it was already right" is invisible in a
diff and someone will otherwise check it again:

- **Unit handling** — nothing converts, nothing alters a stored row. Only the
  wording changed, so it reads as a decision rather than an error.
- **Reference ranges** — already deterministic: the catalog for clinic figures,
  reported-with-consensus for patient charts. Written down as D-25.
- **Sorting** — already on timestamps, never on formatted labels. Now tested.
- **Sparse months** — already gaps rather than zeroes. Now tested, and the
  tooltip's patient count makes a thin month legible rather than hidden.
- **Dates** — already UTC-safe end to end. Now has a regression test at both
  ends of a month.
- **Aggregation location** — already server-side, pure, `cache`d, one query.
- **A monthly median line** — considered and declined. The mean is the requested
  trend and a second series costs more clarity than it adds.

---

## Session 9 — 2026-08-26 (Wed) — one question, and the three things it turned out to be

Three merged PRs (#41, #42, #43). Tests 299 → 363. It started with Joe asking
why some patients have assessments they never submitted or were never sent.

Everything landed on `dev`. **Production was deliberately not touched** — asked
whether to promote, Joe said he would do it himself, so `dev` ends the session
11 commits ahead of `main`.

### The answer, and why it was worth chasing

Three places in the codebase can write an assessment, grep-verified: the seed,
the clinician's **Send assessment**, and the patient's submission. The third
**never creates a row** — it only updates one a clinician already made. So a
patient who never replied *should* have a row, and that matches the brief's own
`sent -> completed | expired` lifecycle. The question had a reassuring answer.

Two things underneath it did not.

**The seed writes eight finished assessments directly**, back-dated to before
their own patient record existed — Jane Doe's first is "sent" 2026-05-02 on a
record created 2026-08-24. Deliberate demo data, and nothing on screen said so.

**A row said "Awaiting reply" for invitations that never left the building.**
`sendAssessment` creates the row, *then* attempts delivery, and deliberately
keeps the row when delivery fails — the link is valid and the clinician can hand
it over. Right. What was missing is that nothing recorded the difference, and on
this deployment the failing case is the common one: Resend's free tier refuses
every fabricated recipient. So the table asserted a send that had not happened,
and the clinician's next action differs between the two states.

`emailDeliveredAt` fixes it, and `wasEmailed` draws the distinction the console
adapter blurs: it reports `delivered: true` so the flow works with no mail
configuration at all, having contacted nobody. Right answer to its own question,
wrong thing to write into a column a clinician reads as "the patient has this".

### An assessment is a page now

A score and a band is the right summary and a poor answer to what a nurse asks
before a consultation: *what did they actually say?* 14 can be one bad item and
seven good ones, or eight mediocre ones, and the conversation differs.

The review page recomputes the total from the answers on file and **renders a
disagreement with the stored total rather than picking one**. The two are
written in a single transaction today, so this can only fire after a backfill or
a version change — which is exactly when nobody would notice, because the
failure is silent: the header says 11 and the eight rows below it add to 14.

### The seed was falsifying a chart nobody had drawn yet

It filled greedily — 3 in q1, 3 in q2, until the total ran out — so every
patient scoring 17 got `[3,3,3,3,3,2,0,0]`. Invisible while the only thing read
is the total. The moment the dashboard grew a per-question breakdown it became a
staircase produced by a `for` loop, and a clinician reading it would conclude the
practice was failing at medication adherence and flawless at foot checks.

**The general form is worth keeping: data that is only ever aggregated one way
can be wrong in every other way without anyone finding out.** The fix
apportions by largest remainder over stable per-item weights, and the seed now
rewrites answers rather than `skipDuplicates` — which was idempotent in the weak
sense and meant a demo database could never be corrected while a fresh clone got
the new behaviour.

### The dashboard, and the unit that would have poisoned it

Four panels: a distribution histogram and a monthly-mean trend per test, monthly
collection volume, and a worst-first DSMA-8 item breakdown.

The finding worth carrying beyond this project came from looking at the data
before charting it. One stored row is `5.4 mmol/L` against a mg/dL test. The
importer stores it exactly as reported and flags it rather than converting —
deliberate, and right, because relabelling it invents a glucose reading wrong by
a factor of eighteen. **Correct on import and a trap on aggregation**: averaging
it in with 68 mg/dL readings is adding millimoles to milligrams, and the clinic
mean moves by an amount nobody can see. Every figure now filters to the canonical
unit and the page says how many rows that dropped.

Same shape as the truncation finding in session 8: a decision that is right at
one layer becomes a defect at the next, and neither layer is wrong on its own.

### Four defects the browser found and the suite could not

- **`sr-only` escapes a horizontally scrolling container.** It is
  `position: absolute`, so with no positioned ancestor its containing block is
  the initial containing block — not the `overflow-x-auto` div it sits inside.
  One screen-reader label dragged the whole page 260px sideways at 375px. The
  signature is `html.scrollWidth` large while `body.scrollWidth` matches the
  viewport, and no ancestor looks guilty.
- **A `<tr>` does not reliably establish a containing block**, so the standard
  "clickable row" trick — `relative` on the row, stretched `::after` on the
  anchor — silently does not work. Every computed style reads correct.
- **The reference band was invisible on two of three trend charts** because
  every monthly mean sits above the ceiling, putting the band outside the
  plotted domain. The chart was not wrong, it was *silent*, and a downward line
  read as a clinic in range when nothing in it is.
- **10 mmHg put the entire register's blood pressure in three bars.** A bucket
  width can be clinically sensible and still useless.

### Two more ways a probe lied

Fourth session running. Both reported a working feature as broken, which is the
dangerous direction — the reflex is to go and fix code that was never broken.
One clicked `y = 1095` in a 900px window. The other, after that was fixed, took
its `x` from a row's `getBoundingClientRect().right` — a table inside a scroller
has a rect at its full min-width, which overlaps the card in the next grid
column, so the click landed on a different card entirely.

And a third, in the opposite direction: **a full-page screenshot renders every
Recharts surface blank.** It looks exactly like four broken charts. Measuring the
marks showed 34 bar rectangles and 39 line dots with real geometry the whole
time. The artifact was the capture.

### A real identity was back on a public server

`MRN-9999` — real name, real inbox, real mobile, real date of birth — created on
the live site during session 8's testing and **pushed to the shared FHIR server
as resource 831**. Found by accident while querying assessments for something
else.

Cleaned in the only order that works: rename locally first, because the platform
copy can only be corrected through `pushPatient`, which needs the local row; then
PUT; then verify the current version by reading it back; only then delete. Same
permanent caveat as session 6 — DELETE is disabled, so version 1 stays in
`_history`.

**A2 was closed in session 6 and reopened by ordinary manual testing eleven days
later.** Nothing in the app prevents it and, for this project, nothing needs to
except a habit. The register should be checked once more before submitting.

---

## Session 8 — 2026-08-26 (Wed, submission day) — Tier 3, and three things only a live probe could find

Four merged PRs (#35–#38). **Tier 3 is built, measured and live**, so all three
tiers are now complete. Tests 268 → 299. The session 7 record, which had been
committed but never pushed, finally reached the repo.

Joe asked first whether Tier 3 was feasible at all and what it would cost. The
estimate was 5–7 hours; it took closer to two, because the analysis had already
settled the design in §18 and almost all the plumbing — the series functions,
the reference ranges, the band logic, the error-state primitives, an
external-API client to copy — already existed. **The estimate was wrong in the
direction of assuming work that was already done.**

### Not ChatGPT, and why

Joe has a $20 ChatGPT subscription and asked whether it was usable. It is not,
for two independent reasons: a Plus subscription does not include API access at
all, and the brief says in as many words *"any model with a genuinely free API
key… No paid keys."* Either one is disqualifying on its own. Gemini was chosen
from the two the brief names.

### The design: the model narrates, it does not analyse

The obvious build hands the model the patient's rows and asks what it sees. That
asks a language model to do arithmetic and to judge clinical significance, and
it does both fluently whether or not it does them correctly — a fabricated
HbA1c delta reads exactly like a real one.

So the split runs the other way: **every number is computed in TypeScript, and
the model only narrates them.** Two things follow, and they are the whole
argument. A number in the prose that is not in the fact object is *mechanically
detectable*, so grounding becomes a check rather than a promise. And the same
object is rendered beside the prose, so a clinician reads the summary against
its source rather than instead of it.

It is also less code than the fluent version, not more.

**The ungrounded path was proved rather than asserted.** The system prompt was
temporarily amended to tell the model to state that the patient "walked 4821
steps yesterday". It complied; the verifier caught `4821`; the prose was
discarded and the panel rendered the withheld state with the real figures
intact. The injection was reverted and `prompt.ts` is byte-identical to its own
commit.

### Three findings that only a live probe could produce

Every one was invisible to tests, types and the build, and every one would have
shipped looking fine. Full detail in `state.md` §6f.

- **A model can be listed and still refuse to serve.** `gemini-2.5-flash`
  appears in `GET /v1beta/models` and answers `404 "no longer available to new
  users"` on every generate call.
- **Gemini 3.x charges thinking tokens against `max_tokens`, and thinking
  expands to fill the budget.** At the 400-token cap the branch shipped with:
  396 tokens of reasoning, 13 of output. Raising the cap did not help — thinking
  took the new budget too. Latency hit 27s against a 20s client timeout. The
  model was then chosen by measuring five candidates against this exact prompt;
  `gemini-3.1-flash-lite` does it in **1.5s with zero thinking tokens**, against
  16.7s and 1076 for `gemini-3.6-flash`. There is nothing here for a reasoning
  model to reason about.
- **Truncation defeats a grounding check, and this is the one worth keeping.**
  At the 400 cap the provider returned `"HBA1C (Hemoglobin A1c): 3"` with
  `finish_reason: "length"`. `verify.ts` passed it — *correctly*, because `3`
  genuinely is one of that patient's figures. **Truncation is not fabrication**,
  so a checker aimed at fabrication is blind to it, and a clinician would have
  been shown half a sentence as a finished summary.

That last one is §6e's lesson again in new clothes: a guard catches the failure
it was designed for and is blind to the one beside it. Having built a number
checker, the question to ask was "what wrong output contains only right
numbers" — and the answer was sitting in `finish_reason` the whole time.

### A fourth, found by writing the test before trusting the code

The verifier's number scanner skipped any figure ending a sentence —
`...rose to 7.1.` — because its lookahead excluded a trailing full stop. A
fabrication in the most common position in the output would never have been
checked, and **every summary would have been reported as grounded**. There is a
regression test for it. Two sibling false-positive shapes were fixed the same
way: instrument names containing digits (`HbA1c`, `DSMA-8`) and dates.

### A configuration failure that hid itself

Joe pasted the model id into `AI_PROVIDER`. The lookup missed, `readAiConfig()`
returned null, and the panel reported "not configured on this deployment" —
true, unhelpful, and indistinguishable from having set nothing at all.
`aiConfigProblem()` now names the offending variable. **A wrong value and an
absent value are different problems and should not produce the same message.**

Also worth recording: the key was doubted and should not have been. Current
Google AI Studio keys are ~53 characters starting `AQ.A`, not the older 39-char
`AIza` shape. A probe settled it in one call; the doubt was unfounded.

### The stale server, a third time

A rebuild was started to test the ungrounded path, and the previous `npm start`
still held port 3000, serving the **previous build**. Probing then would have
reported a grounded summary from a binary that did not contain the change under
test — a green pass from the wrong code. It was caught only because the start
command's log was read rather than assumed, and it said `EADDRINUSE`.

Three sessions, three occurrences. **Kill by port and assert it is free before
every server start.**

### Git topology

Tier 3 was merged to `main` in #37 **directly from the feature branch**,
bypassing `dev`, which left `dev` 16 commits behind and silently without Tier 3
— including the Preview environment and any branch cut from it. `dev` was a
clean ancestor and fast-forwarded. The documented flow is feature → `dev` →
`main`, and a direct merge to `main` breaks it without warning.

### Left undone

- **Tier 3 on production is unconfirmed** (A7). Summarise was verified on the
  *preview*; production reads a separate set of Vercel variables.
- **The fresh-clone dry run**, still never done — and now more load-bearing,
  since the README gained a Tier 3 section and four environment variables today.
- **A3, the demo figures.** Recommendation recorded: accept and document.
- **The user guide does not mention the Tier 3 panel.**
- **The submission email.**
- **The cold start** — last, alone, after the final deploy.

---

## Session 7 — 2026-08-26 (Wed, submission day) — a first impression, a walkthrough, and a sweep

Four merged PRs (#31, #32, #33, #34). The sign-in page and the browser tab —
the first two things anyone sees — stopped being the defaults. The app got a
document that explains how to *use* it. The repo lost its scaffold leftovers.
Tests unchanged at 268; nothing here touches product logic.

**`main` is three commits behind `dev`** at the end of this session: #34 was
merged to `dev` only, because that is what was asked for. Documentation and a
dead-asset removal, no schema change, so promoting is a merge whenever it is
wanted.

### The login page and the mark (#32, promoted in #33)

Joe asked for a sign-in page that fills the space, with the product beside the
form, a logo, and a favicon. Two things turned out to be true before any of it
was built:

- The shell rendered **1104px of centred box on an empty field** — the same
  diagnosis as #29, one page later.
- **`app/favicon.ico` was still the `create-next-app` file**, untouched since
  the initial commit. The live site had been showing the Next.js logo in the
  browser tab for the whole project.

Built: a pulse-trace mark, short on vertices because a favicon is read at 16px;
a split page with the product on `--color-deep` — the rail's own surface — on
the left and the form on the right; the panel dropped below `lg` with the mark
moving above the card, the way the rail becomes a bar; and one `<Wordmark/>`
now serving the rail, the mobile bar and the login page instead of four
hand-typed copies of two strings.

**The geometry is defined once**, in `lib/brand/mark.ts`. The React component
and the generated `app/icon.svg` both import it. Drawing the same shape twice
in a `.tsx` and an `.svg` is exactly how the FHIR loading skeleton drifted from
its own page in #27 — the fix there was to stop writing the heading out twice,
and a logo is the same class of thing. `app/favicon.ico` is rasterised from
that SVG at 16/32/48 by the scratchpad's headless Chrome, which stays out of
`package.json` (D-QA-1), so it is committed as a binary and the script's header
says how to regenerate it.

Measured on a production build, then again on production itself: zero
horizontal overflow at 1920, 1440, 1280, 768 and 375; both icon files served
and **decoding** — 200 `image/svg+xml` and 200 `image/x-icon`, 48×48 — with the
live `favicon.ico` byte-identical to the committed blob; sign-in still working
end to end.

One correction worth keeping: the first cut pinned the panel's text to the left
edge of a 960px column at 1920, which left a dead middle. The screenshot said
so; the overflow measurement did not. Content moved into one centred column.

### A red probe that lied (#32)

The sign-in probe reported a **failure that was not real**. It read
`page.url()` after `waitForNavigation`, but the server action redirects
client-side, so it checked before the redirect landed. The credentials had been
correct all along.

Every previous instance of this in the changelog is a *green* probe passing
without reaching the code under test. This is the mirror image, and it is worth
naming because the reflex — "the app is broken" — points at the wrong thing.
**A probe's verdict is a claim about the probe until the mechanism is
understood.** Fixed by waiting on the pathname actually changing.

### The user guide (#34)

`.docs/06-using-pulsetrack.html` and a 16-page PDF: what every screen does,
what happens when you click, and the rules the app will not break, for both
tiers. It exists because the three documents already in `.docs` explain the
product, the QA plan and the integration, and **none of them answers "what
happens when I press this button"** — which is the question that was actually
asked, about *Download template* and *Import* specifically.

Written from the code rather than from memory. The CSV rejection rules, the
token lifecycle, the band thresholds, the batch sizes and the page counts were
each read out of the implementation before being written down, so the guide
cannot quietly describe an app we do not have.

**Four defects came out of rendering it**, every one invisible in the markup:

- **Text bled out of nine boxes** across all three diagrams. The first checker
  compared text against *text* — which is session 5's lesson in mirror image,
  since that time the checker tested text-against-box and missed a
  text-against-text collision. Adding the missing direction found two more in
  the FHIR diagram **after the set already looked clean**.
- A dashed rule ran 100 units past its viewBox.
- Six cards in a four-column grid left two empty cells showing the grid gap
  colour as a bare grey block — the dead-half-row defect from §1d of
  `state.md`, in a new place.
- **The PDF rendered dark-theme text onto the print stylesheet's white page.**
  `emulateMediaFeatures` does not survive `emulateMediaType("print")`. The
  renderer now sets the `data-theme="light"` opt-out the stylesheet already
  defines. Checked against the other three PDFs afterwards by inflating their
  streams and reading the fill operators: all four share `#0F1A17`, so this was
  new and not a pre-existing defect in the earlier documents.

The general shape, again: **a check that passes tells you only about the thing
it checks.** Three sessions running, the defects have been found by looking at
the rendered artefact and by adding the check that the last one's absence
implied.

### Why the HTML documents "could not be opened"

Joe reported being unable to open the `.docs` HTML files and asked whether they
could be deleted. They are the sources the PDFs are rendered from, so the
answer mattered.

It was not the files. This machine's association is `.html → htmlfile →
"C:\Program Files\Internet Explorer\iexplore.exe"`, and Internet Explorer does
not run on Windows 11 — so a double-click hands the file to a browser that is
not there and nothing happens. The per-user default is Edge; anything going
through the classic association misses it.

The pass did turn up a real defect in the files: **three of the four never
declared `<meta charset="utf-8">`** despite being full of em dashes, curly
quotes and arrows. Chrome sniffs it correctly; a browser opening a `file://`
URL under a Windows locale is entitled to fall back to windows-1252 and render
every dash as `â€"`. One line each — and deliberately **not** a doctype, which
would switch these documents from quirks mode to standards mode and can move a
layout their PDFs were already rendered from. Re-measured after: height
unchanged at 14826px.

### The sweep (#34)

Removed the five `create-next-app` SVGs in `public/` — `file`, `globe`, `next`,
`vercel`, `window` — referenced by nothing.

Nothing else is dead, and that was checked rather than assumed: every module
under `lib/` and `components/` is imported, `lib/assessments/dsma8.json` is
**byte-identical to the official attachment**, and the served CSV template is
byte-identical to the supplied one. Both of those are worth re-running rather
than trusting this note — a drift in either is a defect that no test would
catch.

### The demo database has drifted further, and it was found by accident

A screenshot taken while verifying the navigation rail showed the dashboard
reading **201 lab results and two uploads**, with `lab-results-ugly.csv` in
recent imports. `state.md` §4 records 190 and one.

So the ugly-CSV rows are back in the shared demo database — imported during
some verification run and not restored, which is D-QA-2 not being honoured. It
is cosmetic rather than incorrect, and it is folded into A3, but it is now
**10 patients / 16 assessments / 201 labs / 2 uploads** and a decision is still
owed before submitting.

Worth noting how it surfaced: nobody was looking for it. It was legible in the
corner of a screenshot taken for something else entirely.

### Git and environment notes

- **Excel holding a file blocks `git checkout` and `git pull`**, with
  `unable to unlink … Invalid argument` and `Device or resource busy`. The
  working tree sat on a 22-commit-stale `main` for part of the session because
  `.docs/lab-results-ugly.csv` was open. Nothing was wrong with git. Close the
  file, then pull.
- PR #33 was created and merged within ninety seconds of the `dev` merge, from
  the same account this session pushes as. Recorded because it was not obvious
  at the time whether it was a person or an automation.

### Left undone

- **The fresh-clone dry run**, still never done.
- **The cold start**, still never observed end to end — and a correction to the
  session 6 plan for it: the clock **cannot** run in parallel with any work,
  because a deploy runs `prisma migrate deploy`, which connects to Neon and
  wakes the compute. It has to be the last thing done after the final deploy.
- **A3, the demo figures** — now 10/16/201/2 against a documented 190/1.
- **Promoting #34 to `main`.**
- The submission email.

---

## Session 6 — 2026-08-25 (Tue, later) — the last real-data problem, the states nobody had seen, and a frame

Three merged PRs of substance (#27, #29, plus the #25/#26/#28 backlog cleared),
264 → 268 tests. **A2 is cleared**, the empty and loading states have finally
been *looked at*, and the app has a clinical frame instead of a centred column.

### The two real identities (A2)

`MRN-444` and `MRN-3410` carried Joe's real name, inbox, mobile and date of
birth. Both are now fabricated — Nour Chalhoub and Elias Mansour — with their
assessment history intact.

**Probed before changing anything**, which changed what the fix had to cover.
Both records were `OWNED`/`SYNCED`, so the real **name and date of birth were
sitting on a shared, publicly readable server**. D-FHIR-11 held: no `telecom`
was ever pushed, so the email and phone had never left the machine. Both
resources were re-pushed through `pushPatient`'s PUT path.

One thing could not be undone and is recorded rather than glossed:
`GET /Patient/819/_history/1` still returns `200` with the original name. That
server disables DELETE, so the superseded version stays in its history. The
*current* version — what any read, search or import returns — is clean, and
that was verified against production by grepping the rendered patients page for
six strings, not by assuming.

Joe closed A1, the Resend key rotation, as no longer an issue. Recorded in §3
rather than deleted, because "we decided not to" and "we forgot" look identical
six months later.

### The empty and loading states, at last

Session 5 corrected the claim that they had not been built. This session closed
what that correction left open: **they had never been seen.**

Method: a scratch Neon database created with `CREATE DATABASE`, migrated, seeded
with the clinician *only*, then a **production build** served against it.
Skeletons held still with CDP throttling at 40 kbit/s and 400 ms latency.

**Nine empty states, all reading as intentional** — each with a heading, an
explanation of what will appear there, and where relevant the action that fills
it. Plus the state nobody had thought about, one patient with no activity:
`1 · 0 assessed · 1 not yet`, completion `—`, all bands zero.

And one real defect, which is what the exercise was for. The FHIR route's
`loading.tsx` drew **four figures in four columns**; its page has drawn **six in
three** since the pull side landed in #20. The grid reflowed the moment content
arrived — while the file's own comment said:

> The skeleton mirrors the real layout ... so the page does not jump when the
> content arrives.

Measured before and after at 1280px: `cells 4→6, columns 4→3, rows 1→2` became
`6→6, 3→3, 2→2`, with the grid settling 7px instead of reflowing. Fixed in #27,
with the heading moved into one file imported by both page and loading state —
writing the title out twice is what let them diverge, so the fix must not repeat
it.

### The frame (#29)

Joe asked for a prettier UI that fills the space. The complaint was measurable,
so it got measured first: the shell was `max-w-6xl` centred and rendered
**1104px of content on every monitor** — 86% of 1280px, 77% of 1440, **57% of
1920 with 408px of dead margin a side**.

The useful part of the diagnosis was that "too narrow" was wrong. It was **one
column**: widening alone would only have given the risk bars 1600px of empty
track instead of 780px. A plan went out before any code — the measurements, what
Epic's Storyboard, the NHS service manual and Carbon actually do, what stays,
and a phasing with an explicit recommendation against the deadline.

Built: a fixed 232px rail on a new `--color-deep`; a fluid work area to 1600px;
a `PageHeader` primitive; a sticky patient identity banner with the four charts
in one grid and the record tables abreast; four equal dashboard tiles beside the
distribution and imports; **latest band** and **last result** in the register.

| | Before | After |
|---|---|---|
| Content at 1920 | 1104px (57%) | fluid to 1600px |
| Patient page, 3 series | 1631px | **1366px**, four charts at once |
| Overflow at 375px | 0 | **0**, five pages |

Merged into `dev` as #29 and promoted by Joe as #30 while this entry was being
written — so it is **live**, and re-verified there: five pages at 1920 and
375px, zero horizontal overflow, no console or network errors.

The palette was deliberately not re-chosen. It is derived from
`questionnaire-dsma8.json`, the reasoning is in `globals.css`, and trading a
documented decision for a taste decision the day before submission is a
downgrade. Four tokens added, none replaced.

### Three defects the dev server hid

All three survived every development screenshot and appeared the moment the app
was built and served for real. This is now **D-QA-3**.

- **283px of horizontal overflow at 375px.** A CSS grid track sized `auto` takes
  its minimum from the item's *min-content*, so a card holding a 520px table
  dragged the column past the viewport. A column flexbox does not do this, which
  is exactly why wrapping cards in a grid regressed a layout that had been clean
  since #13. Tailwind's numbered `grid-cols-*` are `minmax(0, 1fr)` and cannot.
- **Sign out was nearly invisible in the rail.** `text-deep-ink` was passed
  alongside the ghost variant's `text-ink-2`, and Tailwind resolves conflicting
  utilities by their order **in the generated stylesheet**, not in `class`. A
  coin toss, and it lost. In development the Next dev-tools badge sits in the
  bottom-left corner, precisely on top of that button, so every screenshot
  showed it covered rather than broken.
- **The empty dashboard left a dead half-row.** With no patients the
  distribution renders nothing, and a fixed two-column grid stranded the imports
  card beside blank space — "looks broken rather than intentional", which is the
  brief's own phrase for the thing this must not be.

### The probe that measured the wrong database

Worth recording because it is §6b of `state.md` recurring in a new place, and
because it was nearly believed.

The first empty-database run reported clean, intentional empty states. It was
reporting on the **real** database: the previous server still held port 3000,
`next start` had died with `EADDRINUSE`, and the probe cheerfully talked to the
server that was already there. The output looked exactly like a pass.

It was caught by reading the **server log** rather than the probe output — and
then noticing the dashboard "empty state" was showing 10 patients. `TaskStop`
had killed the shell, not the node process; only an explicit port check does
that. A green probe that never reached the thing under test proves nothing, and
this is the third session in which that sentence has had to be written.

### One thing this session could not check itself

**Preview deployments are behind Vercel deployment protection.** A preview URL
answers `200` and then redirects to a Vercel SSO login, so it cannot be driven
by `curl` or a headless browser — only by a browser signed in to the account.
Verification therefore ran against a local production build and, after the
promotion, against production itself. Worth knowing before planning any check
around a preview URL: **it is a human step.**

### Left undone

- **The fresh-clone dry run**, still never done.
- **The cold start**, still never observed end to end.
- **A3, the demo figures** — 10/16/190 against a documented 3/8/10. Cosmetic.
- Phases D and E of the interface plan (density/tables, chart reference bands).
  F is cut.

---

## Session 5 — 2026-08-25 (Tue) — deployed, and the checks only a live URL can settle

**B2 is cleared. Tier 1 and Tier 2 are complete, deployed and verified against
the live URL.** Five merged PRs (#21–#25). The app is at
https://pulse-track-joe.vercel.app.

Four pieces of work: the Tier 2 explainer, the deployment pipeline, the live
verification pass, and the ugly CSV. Each is below, with what it got wrong first.

### The Tier 2 explainer (PR #21)

`.docs/04-tier2-fhir-integration.html` and a 15-page PDF, in the same design
system as `02-project-overview.html` and the Tier 1 checklist, so the three read
as one set rather than three separate documents. It leads with the ownership
finding — quoting the probe output showing five other candidates holding
`MRN-1001` — then the pagination traps, the idempotency guarantees with their
measurements, the transient-versus-terminal failure policy with the timings that
prove which is which, and the performance findings. It closes with what the
integration deliberately does not do, each limit with its cost stated.

**Writing it out found four wrong numbers**, which is the argument for writing
these documents at all:

- *"a seed import is ~15 requests per patient"* appeared in four places. It is
  **three** per patient — one search plus two pages — and 15 for all five.
- *"36 observations across three pages"* — it is **two** pages, 20 + 16.
- A claim that a single-match MRN collision *"was true earlier in the week"* was
  speculation written as fact. Removed.
- The masthead said the API guide gets **four** things wrong. Three are the
  guide's; the fourth finding is ours. Corrected, and that section relabelled.

**Four layout defects came from measuring the rendered page**, none of them
visible in the markup: a label overflowing its box by 22 units, two labels
overlapping, an eyebrow rendering on top of the box beneath it, and a three-card
grid wrapping to two columns at A4 and leaving the parent's rule colour showing
through the unfilled cell as a bare grey block.

The overlap is the instructive one. My first checker tested text-against-box and
reported clean; the collision was text-against-*text*, which it could not see.
**A check that passes tells you only about the thing it checks.** The screenshot
found it, and only then was a second checker written for the class.

One defect matters only for a PDF: the transcript blocks use `overflow-x: auto`,
which scrolls on screen. **A printed page has no scrollbar**, so those lines were
being silently cut off. Reflowed to fit the printable column, with print CSS
wrapping as a backstop.

### Deployment and CI/CD (PRs #22–#24)

Joe cleared the Vercel account and asked, reasonably: *isn't connecting the repo
enough?* Largely yes — the git integration gives push-to-deploy, a production
branch, and a preview URL per branch with no configuration at all. Two things it
does not give:

- **It never runs the test suite.** Vercel runs `next build`. All 264 tests can
  fail and it deploys happily. That gap is the only reason GitHub Actions was
  added — and there was no `.github` directory at all before this.
- **It does not run migrations.** `next build` alone would leave the first future
  migration unapplied: a deploy that succeeds and an app that 500s on a missing
  column.

`main` → Production, `dev` → Preview, work flows **feature → dev → main**, and
`CLAUDE.md` was updated to match.

**CI failed on its own first pull request**, which is the best possible
advertisement for it:

```
app/layout.tsx(28,50): error TS2304: Cannot find name 'LayoutProps'
```

Next 16 generates its route and layout helper types into `.next/types` during
`next dev` and `next build`. Anyone who has run the dev server has them on disk;
a fresh checkout does not. `tsc --noEmit` had been passing locally for weeks and
would have failed for any evaluator who cloned the repo and typechecked it.
Nothing was wrong with the code — **the check had simply never run anywhere
clean, because until this PR there was nowhere clean to run it.**

Fixed with `next typegen`, wired into a new `npm run typecheck` that CI calls
rather than into the workflow alone: a separate CI incantation is precisely how
local and CI drift apart. Reproduced before fixing — deleting `.next/types`
reproduced the exact error locally.

### Where I over-delivered, and Joe said so

Asked for *"a simple commit like a commented line"* to test the pipeline, I built
a deployment badge and browser-tested it at two viewports. Joe pointed out the
delay, fairly. The work is sound and genuinely useful — the two URLs are
otherwise indistinguishable — but it was not what was asked for, and "simple" was
explicit in the request. Recorded because the pattern is worth watching:
**scope discipline is part of doing the task, not separate from it.**

### The live verification pass

Run against the deployed URL rather than inferred from local behaviour:

| Check | Result |
|---|---|
| **FHIR import from the deployed URL** | 5/5, slowest **3418ms** of a 60000ms ceiling — closes Tier 2's DoD |
| Idempotency in production | `unchanged=36` per patient; the re-run wrote nothing |
| Secrets in the client bundle | 11 chunks, 595KB: **zero** hits for four different secrets |
| Auth boundary | `/dashboard` signed out → 307 to `/login` |
| Charts on a patient page | 3 charts, 36 points, chronological |
| 375px and 1280px | zero overflow, no console or network errors |

My probe lied once, in the familiar way:
`document.querySelector('a[href^="/patients/"]')` matched **`/patients/new`** —
the Add-patient link, which comes first in the DOM — and it reported a patient
page with zero charts. Same shape as session 3's Sign-out button: a selector
loose enough to match something adjacent and plausible.

**Two things remain unproven on the live URL** and are recorded as such: the Neon
cold start (every measurement was taken against a warm database) and a real
assessment email (untested deliberately, because two patient records carry real
inboxes).

### The ugly CSV (PR #25)

The brief promises to test with *"a deliberately messy file."* It did not exist,
and was the highest-value untested item on the checklist.

29 rows, each targeting one named rule: 11 import, 14 are rejected for fourteen
distinct reasons, 4 land in the third state. Hostile before parsing begins — a
UTF-8 BOM, CRLF endings, blank lines mid-file, a trailing newline, one ragged
short row and one ragged long row. Written as **bytes** rather than text, because
the BOM and the CRLFs would not survive an editor.

Verifying it row by row against `classifyRows` found the failure mode the first
draft missed: **a row already on file with a *changed* value** — decision
D-CSV-2's entire point, and the file did not exercise it. Added as line 32.

**Then Joe asked whether I had actually imported it. I had not.** I had tested
the classifier, which is a different claim — and exactly the conflation that let
the duplicate-MRN crash survive session 3. Imported through the live UI: 29 rows
read, **11 / 14 / 4**, matching the classifier prediction exactly, in 1.6s, with
the file's own line numbers correctly skipping the blank lines.

The 11 rows and their upload record were then deleted (D-QA-2) — after first
confirming **none had been pushed to the national platform**, where a write
cannot be undone. Had any been pushed, deleting locally would have orphaned a
remote record permanently, so the cleanup aborts rather than guesses.

### A correction carried for two sessions

`state.md` said the empty and loading states had not been built. **That was
wrong.** `EmptyState` is used in seven places, and loading states use React
Suspense with skeleton fallbacks in four, plus a route-level `loading.tsx`. The
real gap is narrower and still open: **none of them has ever been seen**, because
the database has always had data. The code existing and its presentation being
correct are two separate claims, and only the first was ever checked — the same
lesson as session 3, in a new place.

### Left undone

- **Two patient records carry real personal inboxes** (`MRN-444`, `MRN-3410`).
  The brief says fabricated data only, and an evaluator clicking *Send
  assessment* emails a real person. The one item that would actively count
  against the submission.
- **The Resend key is still unrotated.**
- **The empty and loading states have still never been looked at.**
- **The fresh-clone dry run** has still never been done.
- **The cold start** has still never been observed succeeding end to end.

---

## Session 4 — 2026-08-24 (Mon) — Tier 2, both directions, against the real server

**Tier 2 is complete.** Two merged PRs (#19 push, #20 pull), test suite 188 →
264. Patients and locally-imported labs push to the national platform; the
platform's five seeded patients and their 180 observations pull back into the
same tables and appear on the same charts. What remains for the whole submission
is the Vercel deployment, which is still B2 and still only Joe's to clear.

The session opened with a decision that turned out to matter more than the code:
**probe before writing.** Every write to that server is permanent — DELETE is
disabled — so the two questions session 3 left open were settled with `curl`
first, and one of the answers changed the design.

### The API guide's own example is unsafe, and the server says so

The guide's conditional create is:

```
If-None-Exist: identifier=https://challenge.capadev.dev/mrn|MRN-1001
```

`MRN-1001` is the MRN printed in the supplied CSV template. One read-only query
before any code was written:

```
GET /Patient?identifier=…|MRN-1001
→ total = 5
  id=189 cand-jihane-l   id=265 cand-maryamhmayed-l   id=278 cand-marwa-l
  id=340 cand-adham-l    id=360 cand-khalils-l
```

Five other candidates already hold it. The guide's header matches all five and
the server returns `412`. The worse case is the one that nearly happened to
everybody who follows the guide literally: had it matched **one**, we would have
stored a stranger's resource id, and every later `PUT` would have earned a
permanent `403` that looks exactly like a bug in our own code.

The analysis had predicted this in §12.2 and proposed `_tag` scoping. What it
could not say was whether HAPI honours `_tag` inside `If-None-Exist`. The
five-way collision turned that into a clean experiment rather than a hopeful
one: an unscoped search matches five, so if `_tag` were ignored the POST would
return `412`.

```
POST /Patient  (tag-scoped)  → 201 Created  Location: …/Patient/816/_history/1
POST /Patient  (identical)   → 200 OK       Location: …/Patient/816/_history/1
```

`201` proves it. Both open questions closed in about four minutes, and the
result is the strongest walkthrough talking point in the project — a documented
integration guide being wrong about its own server, caught by reading rather
than assuming.

Two smaller things fell out of the same two responses, both of which would have
been quiet bugs:

- The `Location` header **also** carries the internal `hapi:8080` host, so it
  must be parsed and never fetched — the same root cause as the pagination
  links.
- The id is the segment **before** `_history`, not the last segment. Taking the
  last one stores the version number as the resource id, and every later write
  goes to a resource that does not exist.

### Push (PR #19)

The layering is the part worth keeping: `systems.ts` and `mappers.ts` are pure
and testable, `client.ts` and `config.ts` are `server-only` and are the only
places the API key exists, and `sync-hooks.ts` is the single seam patient CRUD
and the CSV importer call. Neither of those two imports the FHIR client, handles
a FHIR error, or can be broken by one.

That split was not cosmetic. `config.ts` originally held the coding-system
constants as well, and because it is `server-only`, every mapper test would have
failed on import. Splitting the constants into `systems.ts` is what made the
mapping layer — the part most worth testing — testable at all.

**Two sync strategies, deliberately different.** A patient syncs inline, bounded
at 6 seconds, because "create a patient and it appears on the platform" is what
the brief asks for. Lab results are queued, because an import is thousands of
rows at one request each against a documented 120/min: pushing them inside the
upload request would blow a 60-second Vercel function long before it hit the
rate limit, and would do so while the clinician is waiting for the validation
report.

Failure handling was verified by breaking it on purpose:

```
wrong API key → 401 : "…Check FHIR_API_KEY."          1218ms  (one attempt)
unreachable host    : "Could not reach the platform"   4302ms  (three, with backoff)
recovery            : {"ok":true,"fhirId":"818"}    →  SYNCED
```

The timings are the evidence, not the messages: 1.2s is one attempt, 4.3s is
three with backoff. A 403 or a 401 is a fact about the world, and retrying it
spends the rate limit re-learning it.

### Pull (PR #20)

Five patients, 36 observations each, **2 pages each** — the number that proves
`_count=20` was the right call. At the guide's `_count=50` all 36 return in one
page, no `next` link is emitted, and the pagination code never executes. It
would have been an integration that looks paginated and has never paginated
once.

The interesting design problem was collisions. `fhirObservationId` is unique and
so is `(patientId, collectedDate, testCode)`, and they disagree whenever a CSV
row already describes the measurement the platform is now reporting. Letting the
second constraint throw would fail an entire import over one row that is not
even wrong.

`reconcile.ts` decides, and is **pure** — which is the whole point, because it
means every branch is tested in milliseconds instead of by uploading a CSV and
then importing against a server whose writes cannot be undone. The rule that
matters: where a measurement is already held locally, the link is attached and
the **stored value is never touched**. Silently editing a clinician's record
because a remote resource happens to share a date is how a clinical system stops
being trustworthy. It is also just D-CSV-2 applied in the other direction.

### Idempotent is not the same as cheap

The most useful finding of the session, and it came from timing runs that had
already passed.

Both directions were idempotent from the first attempt — identical resource
counts across a re-push, zero new rows across a re-import. Both were also
quietly heading for a function timeout:

| | First run | Re-run | After |
|---|---|---|---|
| Push, 14 records | 12.8s | — | 3.2s |
| Import, per patient | 2.4s | 10s | 2.1s |

The push was sequential, so the throttle's concurrency cap of 4 was decorative —
nothing ever ran concurrently. The re-import was writing 180 unchanged rows back
one at a time, inside a transaction whose timeout is 20 seconds.

Neither would have failed a test. Both would have failed on Vercel with real
data volume, in front of an evaluator, as a timeout with no explanation.

**And fixing the first introduced a real race.** An Observation whose patient is
not yet linked pushes that patient itself, so two results for one unlinked
patient issue two conditional creates whose searches both complete before either
insert lands — a duplicate `Patient` on a server where DELETE is disabled. The
batch now links every referenced patient before sending any observation, which
removes the race by construction rather than by hoping to lose it. Re-verified
after the change: still 4 Patients and 10 Observations under our tag.

### What the browser pass added this time

Session 3 established that headless Chrome verification works; this session it
was routine rather than a discovery, and it still earned its keep:

- The push card rendered an **empty padded strip** under its header when nothing
  was queued — invisible in the markup, obvious in the screenshot.
- The pulled data was confirmed *on the charts*, not inferred from row counts:
  MRN-2001's page draws three trend charts of twelve monthly points each, with
  the "National platform record" badge and `Linked · 1`.
- Both loops were driven through the real buttons — five `200`s from
  `/api/fhir/import`, one from `/api/fhir/sync` — at 1280px and 375px, with no
  overflow at either width and the API key absent from the page HTML.

One probe lied again, and in a new way: the first push-button test reported
"no API calls" because it closed **12.7 seconds** into a request that took 12.8.
The server log settled it in one line. A probe that stops before the thing it is
measuring proves nothing — the same lesson as session 3's two, wearing a
different hat.

### Documentation

The README gained a full FHIR section: the integration diagram the brief asks
for as requirement 4, the idempotency table, the pagination traps, the
transient-versus-terminal failure table, and four new decisions (D-16..D-19)
each with its cost stated. All four Mermaid diagrams were parsed with mermaid's
own parser rather than eyeballed — a broken diagram is the first thing an
evaluator would see.

### Left undone

**B2 (Vercel) is now the only thing standing between this and submission.** It
blocks the last Tier 1 item *and* Tier 2's Definition of Done, which requires
the import to complete from the deployed URL without a function timeout. The
local per-patient measurements (2.1–2.4s) suggest it will be comfortable, but
that is a prediction and not a measurement, and this project's own history says
which of those to trust.

Also still open, both unchanged from session 3: rotate the Resend key, and
settle the demo data — including the patient row carrying a real personal email
address.

---

## Session 3 — 2026-08-24 (Mon) — README, browser QA, and three defects found by using it

**Tier 1 is complete except the live deployment.** Six merged PRs (#12–#17).
Definition of Done 26 → 27 of 28. The single outstanding item is the Vercel URL,
which only Joe can unblock.

The session had two halves. The first shipped the README and the first browser
pass. The second began when Joe used the app and immediately found three things
none of our checks had caught — including one the acceptance checklist had
already marked as verified.

### Phase 10 — the README (PR #12)

It was still the create-next-app default, and it is one of the brief's six
graded areas — the brief says outright *"We read this carefully."*

Three Mermaid diagrams, because GitHub renders them and they carry what prose
doesn't: an **architecture diagram** showing the three authorization layers and
the pure-function/service split, an **ERD** annotating every column that encodes
a decision, and a **sequence diagram** for the assessment token flow, since "the
raw token is never persisted" is easier to see than to read.

The **Decisions and tradeoffs** section leads with the calls a reviewer is most
likely to challenge, each with its cost stated rather than hidden: units stored
as reported rather than relabelled, a changed value skipped rather than
overwritten, hard delete over soft delete, and why the risk bands are faceted
rather than stacked.

Claims were verified rather than copied from this changelog: `.docs/` is tracked
so the quick-start upload step works from a fresh clone; the mg/dL example
matches `lib/labs/test-catalog.ts`; and the in-app template download was
`cmp`-checked byte-identical to the supplied attachment.

### The browser pass — a previously "impossible" check that took ten minutes

Sessions 1 and 2 both recorded that the charts **"cannot be verified
headlessly"**. That was wrong, and it had blocked two graded items for two
sessions.

The reasoning had been: `renderToStaticMarkup` returns a 127-byte wrapper with
no `<svg>`, and jsdom has no layout. Both true. The error was
**over-generalising from those two tools to all headless verification** —
headless Chrome has real layout and renders Recharts exactly as a user sees it.
Chrome was installed on this machine the whole time.

`puppeteer-core` was installed **in the scratchpad, not the project**: it is how
we check the work, not part of the product, and a submission should not ship a
browser driver in its `package.json`.

### Three defects, found in three different ways

Worth separating, because each needed a different kind of looking:

| Found by | Defect |
|---|---|
| Measuring `scrollWidth - clientWidth` | `/labs/upload` scrolled sideways at 375px |
| Walking every element's `getBoundingClientRect().right` | Named the culprit — a `-mx-5` div sitting at `right=378` in a 375px viewport — instead of guessing |
| **Looking at the screenshot** | The truncated `not survey…` label, which passed the overflow check entirely |

The first is the interesting one. The `-mx-5 overflow-x-auto sm:mx-0`
edge-to-edge table pattern is correct **only when the parent supplies matching
padding to cancel**. `Card` is `rounded-lg border bg-surface` — no padding at
all — so the negative margin had nothing to cancel and hung the table 20px
outside the card on each side, breaking the card border and pushing the page
wider than the viewport. The identical pattern in `upload-form.tsx` is correct,
because its parent there really is a `px-5` wrapper. Both sites looked the same;
only one was wrong. A comment at the fixed site now records the distinction.

The second defect is a reminder that `truncate` in a fixed-width grid column
**hides text at every width, not just mobile** — `not survey…` had been rendering
at 1280px for two sessions.

### What the charts actually look like

Seen for the first time, not inferred from aria-labels. Jane Doe's page draws
three trend charts with correctly plotted, chronologically ordered points:
glucose 112 → 104, HbA1c 7.1 → 6.9, and DSMA-8 descending 17 → 11 → 6, matching
the three completed assessments in the table below it. The fourth chart is
correctly absent — she has no systolic readings.

The dashboard's numbers were read off the rendered page rather than the query:
88% labelled "7 of 8 completed, all time", bands summing to 3, and **High risk
at 0** despite Jane having a High-risk assessment in her history — the visible
proof that the distribution counts each patient once by their *latest*
assessment rather than counting assessments.

The public questionnaire was opened in a fresh cookie-less browser context, which
is both how a patient arrives and a check that the page is authorised by its
token alone. At 375px: 8 fieldsets, 32 radios — 8 questions × 4 options, matching
the official JSON — with full-width tap targets and no overflow. It is the best
page in the app on a phone, which is the right outcome given patients answer it
there.

### A side effect that had to be cleaned up

Getting a live token meant sending a real assessment through the UI, which added
a 9th row and moved completion from 88% to 78%. That figure appears in
`state.md`, the README and several PR bodies, so a stray test row would have
quietly falsified all of them. The row was deleted and the state re-checked
against the database: `patients=3 assessments=8 completed=7 expired=1 labs=10
rate=88%`. Recorded as **D-QA-2** so the next session restores the database too.

### What the first half got wrong

One thing, and it is the same shape as session 2's four: **a plausible
conclusion that nobody tested.** "Charts cannot be verified headlessly" was
recorded as a finding in two consecutive session files, propagated into
`state.md`'s gotcha table as settled fact, and used to justify leaving two graded
items unverified. It took ten minutes to disprove.

The lesson is narrower than "test everything": a *negative* claim — that
something cannot be done — is the kind most worth re-checking, because unlike a
positive claim it never fails loudly. It just quietly shrinks the work.
`state.md` §6a now carries the correction and the working recipe.

At this point Tier 1 looked finished apart from the deployment. Then Joe opened
the app.

---

## Session 3, second half — what using the app turned up

### The acceptance checklist (PR #15)

Before starting Tier 2, Joe asked what Tier 1 is actually supposed to present
and what still needed testing. That produced
`.docs/03-tier1-acceptance-checklist.html` and a rendered PDF: **112 numbered
checks**, each traced back to the brief, the official attachments or the
Definition of Done, so the band boundaries are the real 0–6/7–12/13–18/19–24
rather than a remembered approximation.

Writing it out was worth more than the document. Two things fell out of it:

- **The states the brief explicitly grades are the least-tested part of the
  app.** Empty-database, loading and error states had never been exercised, and
  *"a dashboard with no data should look intentional, not broken"* is a direct
  quote from the brief.
- **The first-draft summary tiles were wrong** — 41/33/18 by estimate against
  29/52/24 when counted from the document itself. Small, but the whole point of
  a status column is that it is not a guess.

### Three defects Joe found by using the app

All three had passed everything we had. Worth recording individually, because
each failed in a different way.

**1. A duplicate MRN crashed the page (PR #16).**

Creating a patient with an existing MRN rendered the Next.js error overlay with
a raw `PrismaClientKnownRequestError`. In production that is a 500 — the site
appearing to fall over on an ordinary data-entry mistake.

**The checklist had this marked VERIFIED, and it was not.** Session 1 verified
that the *database constraint* rejects duplicates and that was written down as
though the *user-facing behaviour* had also been checked. They are two different
checks. "The constraint holds" and "the user sees something sensible" have to be
tested separately, and conflating them is how a crash survives into a document
that claims coverage.

The handler existed and looked correct. The cause was that **Prisma 7 with a
driver adapter does not populate `meta.target`** — the field list moves to
`meta.driverAdapterError.cause.constraint.fields`. `instanceof` and `error.code`
were both still right, which is exactly why the code read as working. Probing the
live database showed the real payload and settled it in one run.

**2. A rejected submission cleared all six fields.** Found while verifying the
first fix. React resets an uncontrolled form once its action resolves, and the
reset lands on `defaultValue`, so a clinician retyped everything to correct one
field. Failure states now echo the submission back. The `<select>` needed a key
as well — React applies `defaultValue` to a select only on mount, so Sex alone
still reset after the five text inputs were fixed.

**3. There were no error boundaries at all.** No `error.tsx`, `global-error.tsx`,
`not-found.tsx` or `loading.tsx` anywhere in the app. That is the real reason a
single failure read as "the website goes down". Four were added, deliberately
layered rather than global: the dashboard boundary sits *inside* the layout so a
failure keeps the nav, and the public one is worded for a patient, who cannot
debug and must not be told their answers were saved when they may not have been.
The 404 says nothing about *why* a record is missing, so it cannot be used to
enumerate ids.

Next.js 16 names the recovery prop `retry`, not `reset` — checked against the
bundled docs rather than assumed, exactly as `CLAUDE.md` instructs.

### My own probes lied twice before the app did

Both worth remembering, because both produced confident, wrong conclusions:

- `page.click('button[type="submit"]')` matched the **header's Sign out button**,
  which comes first in the DOM. The test logged itself out and reported that
  submitting the form redirected to `/login`.
- `page.type` into an `<input type="date">` follows the browser's **locale mask**,
  so `"1990-01-01"` became an invalid date and Zod rejected it before Prisma was
  ever reached — the duplicate path never ran at all.

A green-looking probe that never reaches the code under test proves nothing. Both
recipes are now in `state.md` §6a.

### An hour lost to a stale server, and the email that was never broken

Joe configured Resend and reported the app still saying "No email provider is
configured". The configuration was correct the whole time.

A background `npm start` left over from verification held port 3000. It had
booted **twelve minutes before `.env` was saved**, so the browser was talking to
a process with the old environment. Next then put Joe's own `npm run dev` on
**3001**. Two servers, two environments, and the one being viewed was the stale
one.

The diagnosis took one command — comparing the process start time against the
file mtime. The lesson is procedural rather than technical: **check the port and
the process start time before debugging anything else**, and do not leave
background servers running at the end of a task. That was my mistake and it cost
Joe real time. `state.md` §6b records the symptoms that should trigger the
suspicion immediately, including 500s on `/_next/static/chunks/*.js`, which mean
a server is serving a chunk manifest a rebuild has already replaced.

Once restarted, Resend worked and told us its own constraint: it delivers only to
the account owner's address until a domain is verified. Fabricated recipients like
`jane.doe@example.test` can never receive mail regardless, so **every evaluator
will land on the copy-link path**. That is by design, and the brief allows it.

### The database failure that was not a database failure (PR #17)

Joe's log then showed `Can't reach database server` on login. The database was
healthy — a direct connection seconds later succeeded, and its timing was the
whole diagnosis:

```
CONNECTED in 3118 ms
```

**Neon's free tier scales compute to zero after a few minutes idle.** The next
connection cold-starts it. `PrismaPg` was being constructed with only a
connection string and no pool options, so the first request after idle failed
with `P1001` and the retry succeeded — which makes it look intermittent rather
than like a cold start.

This one matters well beyond a local annoyance, and it is the reason it was worth
fixing immediately rather than noting: it is precisely what an evaluator meets.
They open the link days after we send it, and **the very first request they ever
make** lands on a suspended compute. A login that errors on first attempt reads
as a broken deployment, and they have no reason to guess they should retry.
`connectionTimeoutMillis` is now 15s against a measured ~3s wake, and `max` is
capped at 5 — which also closes risk R5, previously mitigated only by using the
pooled URL.

Stated honestly: the timeout is now longer than the measured wake. A cold start
has **not** been observed to succeed end to end, because that needs the compute
to actually idle down first. Re-check it on Vercel.

### What the second half got wrong

The same shape as everything else in this project: **a check that was recorded as
done without being done.** Session 1 verified a database constraint; the
checklist reported it as a verified user-facing behaviour; the behaviour was a
crash. Nothing lied — a true fact was written down at the wrong altitude.

The generalisation worth keeping: **a guarantee and its presentation are two
separate checks.** The constraint holding, the API returning the right status,
and the user seeing something sensible are three claims, and verifying the first
says nothing about the third.

### Left undone

**B2 (Vercel) is still the only incomplete Tier 1 item**, and only Joe can clear
it. Two new items need a decision before submitting, both recorded in `state.md`
§3 and §4:

- **The Resend API key was pasted into a chat transcript** and should be rotated.
  It never reached git history or the client bundle — verified — but treat it as
  exposed.
- **The demo database has drifted** to 4 patients and 13 assessments (69%),
  against the 3/8/88% quoted in the README and several PR bodies. One patient row
  currently carries a **real personal email address**, added so Resend would
  deliver. Either restore the documented state or re-document it, but they must
  not disagree.

22 of the checklist's 112 checks remain untested. The two that matter most are
cloning into a clean directory and following the README literally, and building
the one deliberately ugly CSV the brief promises to test with.

---

## Session 2 — 2026-08-24 (Mon) — repo published, Tier 1 finished

**Phases 4 and 5 complete; Tier 1 is feature-complete.** Ten merged PRs, test
suite 85 → 188. What remains is the README and the deployment.

The session had three parts: publishing the repo as a feature-branch history,
building the CSV importer, and building the dashboards. Each is below.

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

### What this session got wrong, and how it was caught

Worth recording as a pattern, because all four were the same shape — something
that looked right and was not, caught only by running it:

| Caught by | What it was |
|---|---|
| A test written before the UI | Header inferred from row one's keys, so a short first data row rejected the whole file |
| `curl` on the endpoint | `/api/labs/upload` returned 307 to `/login`, so an expired session rendered an empty report instead of an error |
| Running the colour validator | Moderate↔high risk bands at ΔE 0.4 under deuteranopia — the same colour |
| Re-reading the brief against the work | The clinic view's required "recent uploads with at least one filter" was missing entirely |

None would have been found by reasoning about the code. Three of the four
produced a *plausible* wrong answer rather than an error, which is the class of
defect this project is actually being judged on.

### Left undone

**Tier 1 is feature-complete.** What remains is the README — one of the six
graded areas, still the create-next-app default — and the deployment.
**B2 (Vercel) is still the only open blocker**, and the README does not depend
on it.

Two things were built but **never seen by anyone**: the plotted charts (Recharts
draws client-side, and no browser tooling was available) and the app at 375px.
Both are graded. Recorded in `state.md` §1a.

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
