# FHIR API Guide (Tier 2)

You are integrating with a **HAPI FHIR server, FHIR version R4**, playing the role of the national health data platform your clinic reports to.

We've issued you a **personal API key** and a **candidate id** (e.g. `cand-yourname-x`) in your challenge email, you'll use both below. There's nothing to register or generate on your side.

- **Base URL:** `https://fhir-challenge.vihagent.net/fhir`
- **Auth:** send your personal key on every request: `X-API-Key: <your-key>`
- **Format:** JSON. Send `Content-Type: application/fhir+json` and `Accept: application/fhir+json`
- **Rate limit:** 120 requests/minute, handle `429` responses gracefully (that's part of the exercise)

New to FHIR? We assume yes. Start with the R4 spec pages for [Patient](https://hl7.org/fhir/R4/patient.html), [Observation](https://hl7.org/fhir/R4/observation.html), and [Search](https://hl7.org/fhir/R4/search.html). You only need those three pages plus this guide.

## How the shared server works

1. **Identify patients by MRN** using this identifier system:
   `https://challenge.capadev.dev/mrn`
2. **Ownership is automatic.** Every resource you create is tagged with your candidate id by the server (system `https://challenge.capadev.dev/tags`), you don't need to add the tag yourself, and you can't set anyone else's. Reads are open, but **you can only modify resources you created**; seed data and other candidates' resources are read-only for you.
3. When searching for your own data on the shared server, filter by your tag: `?_tag=https://challenge.capadev.dev/tags|<your-candidate-id>`
4. **Enforced write rules** (requests violating these return a `403`/`405` `OperationOutcome` explaining why):
   - `DELETE` is disabled, if you create something by mistake, just leave it
   - Conditional updates (`PUT`/`PATCH` with search parameters) are disabled, use `POST` with `If-None-Exist` for idempotent creates, or `PUT` the specific id you own
   - Update-as-create (`PUT` to a nonexistent id) is disabled, create with `POST` and let the server assign ids
   - Transaction/batch Bundles may only contain `GET` and `POST` entries
   - Non-`GET` FHIR `$operations` are disabled; JSON only (no XML)

## Seeded historical data (for you to pull)

Five patients with 12 months of lab history exist on the server. Find them by MRN: **MRN-2001, MRN-2002, MRN-2003, MRN-2004, MRN-2005**. Each has monthly `Observation` resources for Hemoglobin A1c (LOINC `4548-4`), Fasting Glucose (LOINC `1558-6`), and Systolic Blood Pressure (LOINC `8480-6`). Import these patients and their observations into your app so they appear in your dashboards.

## Examples

Find a seeded patient by MRN:

```bash
curl -s "https://fhir-challenge.vihagent.net/fhir/Patient?identifier=https://challenge.capadev.dev/mrn%7CMRN-2001" \
  -H "X-API-Key: $KEY" -H "Accept: application/fhir+json"
```

Note: the | separating system from value must be URL-encoded as %7C in a raw URL (HTTP clients like fetch/axios do this automatically; only hand-written curl needs it explicit).


Fetch all observations for that patient (paginated — follow the bundle's `next` link):

```bash
curl -s "https://fhir-challenge.vihagent.net/fhir/Observation?subject=Patient/<id>&_sort=date&_count=50" \
  -H "X-API-Key: $KEY" -H "Accept: application/fhir+json"
```

Create one of *your* patients (conditional create, the `If-None-Exist` header prevents duplicates if you sync twice; this is the idiomatic FHIR way to make pushes idempotent):

```bash
curl -s -X POST "https://fhir-challenge.vihagent.net/fhir/Patient" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/fhir+json" \
  -H 'If-None-Exist: identifier=https://challenge.capadev.dev/mrn|MRN-1001' \
  -d '{
    "resourceType": "Patient",
    "identifier": [{ "system": "https://challenge.capadev.dev/mrn", "value": "MRN-1001" }],
    "name": [{ "family": "Doe", "given": ["Jane"] }],
    "gender": "female",
    "birthDate": "1980-05-12"
  }'
```

Push a lab result as an Observation:

```bash
curl -s -X POST "https://fhir-challenge.vihagent.net/fhir/Observation" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Observation",
    "status": "final",
    "code": { "coding": [{ "system": "http://loinc.org", "code": "1558-6", "display": "Fasting Glucose" }] },
    "subject": { "reference": "Patient/<id>" },
    "effectiveDateTime": "2026-06-01",
    "valueQuantity": { "value": 105, "unit": "mg/dL", "system": "http://unitsofmeasure.org", "code": "mg/dL" }
  }'
```

Suggested test-code → LOINC mapping for your pushed labs: `GLU-F → 1558-6`, `HBA1C → 4548-4`, `SBP → 8480-6`.

Errors come back as FHIR `OperationOutcome` resources, read the `diagnostics` field.

If the server seems down or you believe something is broken on our side, email us, infrastructure issues are our problem, not yours, and reporting them clearly is a good look.
