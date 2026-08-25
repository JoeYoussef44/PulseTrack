# The ugly CSV — what every row is for

The brief says the CSV importer will be tested with *"a deliberately messy
file."* `lab-results-ugly.csv` is that file, built so each row exercises one
named rule rather than being generically bad. This document is what it should
produce, so the import report can be compared against an expectation instead of
just being read.

Import it at **`/labs/upload`**, signed in.

## Expected totals

```
29 rows read   ·   11 imported   ·   14 rejected   ·   4 already imported
```

Measured against `classifyRows` on 2026-08-25. If these three numbers come back
different, something has regressed.

## The file is hostile before parsing even starts

Four properties that break naive CSV readers, none of which should be visible in
the result:

| Property | Why it is there |
|---|---|
| **UTF-8 BOM** | What Excel writes by default. An unhandled BOM corrupts the first header cell, so `mrn` stops matching and the whole file is rejected as "not a lab results CSV". |
| **CRLF line endings** | Also Excel. |
| **Blank lines mid-file and a trailing newline** | These must not become rows, and must not shift the reported line numbers. |
| **Ragged rows** | One row short of its trailing cells, one with two extra. Neither may reject the file. |

**The line numbers in the report are the file's own**, counting the header as
line 1 and counting blank lines. That is the number a clinician sees in Excel
when they open the file to fix it, so it is the only number worth showing.

## Rows that import, some with warnings

| Line | What it tests | Outcome |
|---|---|---|
| 2, 3 | Ordinary valid rows | Imported |
| 4 | Whitespace padding around every cell | Imported, trimmed |
| 5 | Lower-case test code `hba1c` | Imported — lookup is case-insensitive |
| 6 | Unit `MG/DL` differing only in case | Imported silently — a case difference is not worth a warning |
| 7 | Unit genuinely wrong: `mmol/L` for a mg/dL test | Imported **and flagged**, value stored exactly as reported |
| 8 | `test_name` disagrees with the code | Imported under the catalog name, warned |
| 9 | `ref_low`/`ref_high` are the words `low`/`high` | Imported, warned, catalog range used |
| 28 | Ragged short row — trailing cells absent | Imported |
| 29 | Ragged long row — two extra cells | Imported, extras ignored |
| 30 | Quoted field containing a comma | Imported, warned on the name |

Row 7 is the one worth looking at. **The value is stored as reported and
flagged, never converted or relabelled.** Silently "fixing" a unit mismatch
means inventing a clinical value, and 5.4 mmol/L quietly relabelled as mg/dL is
a glucose reading wrong by a factor of eighteen.

## Rows that are rejected, one rule each

| Line | Rule |
|---|---|
| 11 | Unknown MRN — no such patient |
| 12 | MRN missing |
| 13 | Date not `YYYY-MM-DD` (`02/07/2026`) |
| 14 | Well-formed but not a real date (`2026-02-30`) |
| 15 | Date in the future |
| 16 | Date missing |
| 17 | Unknown test code (`CHOL`) |
| 18 | Test code missing |
| 19 | Value not numeric (`ninety-nine`) |
| 21 | Scientific notation (`1e3`) — ambiguous in a lab CSV, refused deliberately |
| 22 | Negative value |
| 23 | Implausibly large value |
| 24 | Value missing |
| 25 | Every required field blank — reports **all four** reasons, not just the first |

Line 25 is the one that matters for the report's quality: a row with four things
wrong should say all four, so one upload-fix cycle corrects the row rather than
four.

## Rows that are neither accepted nor rejected

This is the third state, and the reason the report has three columns rather than
two. **A row already on file is not an error** — nothing is wrong with it.

| Line | Case | Message |
|---|---|---|
| 26 | Duplicate of line 2 *within this file*, same value | "Duplicate of line 2 in this file… Only the first was imported." |
| 27 | Duplicate of line 3 within this file, **different value** | Same — first wins, second reported |
| 31 | Already on file from the clean sample, same value | "Already imported." |
| 32 | Already on file, **different value** | "Already imported with a different value (7.1). The stored result was left unchanged — delete it first if you need to replace it." |

Line 32 is decision **D-CSV-2** in action. A changed value is *reported*, never
silently written over the result already in the record. Overwriting a stored
clinical value because a spreadsheet said something different is how a record
stops being trustworthy — and the message names the old value so the clinician
can see exactly what the disagreement is.

## Re-import it

Running the same file a second time should import **nothing** and move all 11
previously-accepted rows into "already imported". That is the guarantee that
matters most: **a re-upload can never create duplicates.**

## Note on demo data

A successful import adds 11 lab results to whatever database you point it at.
On the live deployment that changes the figures on the clinic dashboard. If you
want the demo data left exactly as it was, test this against a local database,
or delete the resulting upload afterwards.
