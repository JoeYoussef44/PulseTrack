import "server-only";

import { prisma } from "@/lib/db";
import { queueUploadForSync } from "@/lib/fhir/sync-hooks";
import { LabSource } from "@/lib/generated/prisma/enums";
import { toIsoDate, parseIsoDate } from "@/lib/validation/patient";

import { classifyRows, resultKey, type ImportReport } from "./classify";
import { parseLabCsv } from "./parse";
import { findByCsvCode } from "./test-catalog";

/**
 * The import's only stateful layer: read what exists, hand it to the pure
 * classifier, write what the classifier accepted.
 *
 * All the decisions live in `classify.ts`. This module deliberately contains no
 * validation rules at all — its job is to make the two database round-trips
 * bounded (one for patients, one for existing results, regardless of file
 * size) and to commit the outcome.
 */

export type ImportOutcome =
  | {
      ok: true;
      uploadId: string;
      filename: string;
      report: ImportReport;
      note?: string;
      /** Results now queued for the national platform. 0 when FHIR is unset. */
      queuedForFhir?: number;
    }
  | { ok: false; error: string };

export interface ImportInput {
  filename: string;
  text: string;
  clinicianId: string;
  /** Injected for testability; the route passes the real clock. */
  now?: Date;
}

/** Today at UTC midnight — the boundary a `collected_date` is compared against. */
function utcToday(now: Date): Date {
  return parseIsoDate(toIsoDate(now));
}

export async function importLabCsv({
  filename,
  text,
  clinicianId,
  now = new Date(),
}: ImportInput): Promise<ImportOutcome> {
  const parsed = parseLabCsv(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { rows } = parsed;

  /* ------------------------------------------------- referenced patients -- */

  // One query for every MRN in the file, however many rows reference it.
  // Resolving per row would be an N+1 that turns a 5 000-row file into 5 000
  // round trips and a function timeout.
  const mrns = [
    ...new Set(
      rows
        .map((r) => (r.cells.mrn ?? "").trim().toUpperCase())
        .filter((m) => m !== ""),
    ),
  ];

  const patients = mrns.length
    ? await prisma.patient.findMany({
        where: { mrn: { in: mrns } },
        select: { id: true, mrn: true },
      })
    : [];

  const patientsByMrn = new Map(patients.map((p) => [p.mrn.toUpperCase(), { id: p.id }]));

  /* --------------------------------------------------- existing results -- */

  /**
   * Also one query. The filter is narrowed by the three axes the duplicate key
   * is built from, so we fetch the results this file could possibly collide
   * with rather than the patients' entire lab history.
   */
  const candidateDates = [
    ...new Set(
      rows
        .map((r) => (r.cells.collected_date ?? "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ];

  const candidateCodes = [
    ...new Set(
      rows
        .map((r) => findByCsvCode((r.cells.test_code ?? "").trim())?.code)
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    ),
  ];

  const patientIds = [...patientsByMrn.values()].map((p) => p.id);

  const existing =
    patientIds.length && candidateDates.length && candidateCodes.length
      ? await prisma.labResult.findMany({
          where: {
            patientId: { in: patientIds },
            collectedDate: { in: candidateDates.map(parseIsoDate) },
            testCode: { in: candidateCodes },
          },
          select: {
            patientId: true,
            collectedDate: true,
            testCode: true,
            value: true,
          },
        })
      : [];

  const existingByKey = new Map(
    existing.map((r) => [
      resultKey(r.patientId, toIsoDate(r.collectedDate), r.testCode),
      { value: r.value.toString() },
    ]),
  );

  /* ---------------------------------------------------------- classify -- */

  const report = classifyRows(rows, {
    patientsByMrn,
    existingByKey,
    today: utcToday(now),
  });

  /* ------------------------------------------------------------- commit -- */

  const { uploadId, inserted } = await prisma.$transaction(
    async (tx) => {
      // The upload row is written even when nothing imported. An upload that
      // rejected every row is still an event the clinic should be able to see.
      const upload = await tx.labUpload.create({
        data: {
          filename,
          uploadedByClinicianId: clinicianId,
          uploadedAt: now,
          totalRows: report.totalRows,
        },
        select: { id: true },
      });

      const result = report.pending.length
        ? await tx.labResult.createMany({
            /**
             * `skipDuplicates` is the last line of defence, not the first.
             * The classifier has already excluded everything it knows to be a
             * duplicate; this covers the genuine race where two uploads of the
             * same file commit at the same instant. The unique constraint is
             * what makes the guarantee hold — this flag just stops the race
             * from becoming a 500.
             */
            data: report.pending.map((p) => ({
              patientId: p.patientId,
              labUploadId: upload.id,
              collectedDate: p.collectedDate,
              testCode: p.testCode,
              testName: p.testName,
              value: p.value,
              unit: p.unit,
              refLow: p.refLow,
              refHigh: p.refHigh,
              source: LabSource.CSV,
            })),
            skipDuplicates: true,
          })
        : { count: 0 };

      // Counts are written from what the database actually accepted, not from
      // what we hoped it would, so the summary can never overstate the import.
      const lost = report.pending.length - result.count;

      await tx.labUpload.update({
        where: { id: upload.id },
        data: {
          acceptedCount: result.count,
          rejectedCount: report.rejectedCount,
          skippedDuplicateCount: report.skippedDuplicateCount + lost,
        },
      });

      return { uploadId: upload.id, inserted: result.count };
    },
    { timeout: 20_000 },
  );

  // Tier 2: the imported rows are queued for the national platform rather than
  // pushed here. One request per row against a 120/min limit would exceed a
  // 60-second function long before it finished, and would do so while the
  // clinician is waiting for the validation report. The push runs afterwards
  // as a bounded batch the UI can show progress for.
  const queuedForFhir = await queueUploadForSync(uploadId);

  const lost = report.pending.length - inserted;

  // Ids and counts only — never a name, an MRN or a value. See CLAUDE.md.
  console.info(
    `[labs] import upload=${uploadId} rows=${report.totalRows} accepted=${inserted} rejected=${report.rejectedCount} skipped=${report.skippedDuplicateCount + lost}`,
  );

  return {
    ok: true,
    uploadId,
    filename,
    queuedForFhir,
    report: {
      ...report,
      acceptedCount: inserted,
      skippedDuplicateCount: report.skippedDuplicateCount + lost,
    },
    note:
      lost > 0
        ? `${lost} ${lost === 1 ? "row was" : "rows were"} imported by another upload while this one was running, and ${lost === 1 ? "is" : "are"} counted as already imported.`
        : undefined,
  };
}

/**
 * Recent imports, for the upload page and the clinic dashboard.
 *
 * `since` is the clinic view's date-range filter. Absent means all time, which
 * is what the lab import page wants.
 */
export async function recentUploads(limit = 10, since: Date | null = null) {
  return prisma.labUpload.findMany({
    where: since ? { uploadedAt: { gte: since } } : undefined,
    orderBy: { uploadedAt: "desc" },
    take: limit,
    select: {
      id: true,
      filename: true,
      uploadedAt: true,
      totalRows: true,
      acceptedCount: true,
      rejectedCount: true,
      skippedDuplicateCount: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
}
