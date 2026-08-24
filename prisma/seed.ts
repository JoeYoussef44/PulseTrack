import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";
import { AssessmentStatus, Sex } from "../lib/generated/prisma/enums";
import { QUESTION_IDS } from "../lib/assessments/definition";
import { bandForScore } from "../lib/assessments/scoring";
import { hashToken } from "../lib/assessments/token";

/**
 * Idempotent seed. Safe to run repeatedly — every write is an upsert keyed on
 * a unique column, so a second run reports the same result as the first.
 *
 * All data here is fabricated, as the brief requires.
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL / DATABASE_URL not set — check your .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Parse YYYY-MM-DD as a plain calendar date, with no timezone shift. */
function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function seedClinician() {
  const email = (process.env.SEED_CLINICIAN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_CLINICIAN_PASSWORD ?? "";

  if (!email || !password) {
    throw new Error(
      "SEED_CLINICIAN_EMAIL and SEED_CLINICIAN_PASSWORD must be set in .env",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const clinician = await prisma.clinician.upsert({
    where: { email },
    update: { passwordHash, name: "Dr. Nadia Rahme" },
    create: { email, passwordHash, name: "Dr. Nadia Rahme" },
  });

  console.log(`  clinician  ${clinician.email}`);
  return clinician;
}

/**
 * MRN-1001..1003 exist because the supplied `lab-results-sample-clean.csv`
 * references exactly these three. Without them, an evaluator's very first
 * upload rejects all ten rows as "unknown MRN" and the importer looks broken.
 */
const DEMO_PATIENTS = [
  {
    mrn: "MRN-1001",
    fullName: "Jane Doe",
    dateOfBirth: "1980-05-12",
    sex: Sex.FEMALE,
    email: "jane.doe@example.test",
    phone: "+961 3 111 001",
  },
  {
    mrn: "MRN-1002",
    fullName: "Samir Aoun",
    dateOfBirth: "1968-09-30",
    sex: Sex.MALE,
    email: "samir.aoun@example.test",
    phone: "+961 3 111 002",
  },
  {
    mrn: "MRN-1003",
    fullName: "Rana Bitar",
    dateOfBirth: "1992-02-17",
    sex: Sex.FEMALE,
    email: "rana.bitar@example.test",
    phone: "+961 3 111 003",
  },
] as const;

async function seedPatients() {
  for (const p of DEMO_PATIENTS) {
    const patient = await prisma.patient.upsert({
      where: { mrn: p.mrn },
      // Do not clobber demographics an evaluator may have edited by hand.
      update: {},
      create: {
        mrn: p.mrn,
        fullName: p.fullName,
        dateOfBirth: isoDate(p.dateOfBirth),
        sex: p.sex,
        email: p.email,
        phone: p.phone,
      },
    });

    console.log(`  patient    ${patient.mrn}  ${patient.fullName}`);
  }
}

/**
 * A short assessment history, so the clinic dashboard and the score chart have
 * something to show on a fresh install rather than four empty states.
 *
 * Two properties are deliberate:
 *
 * **Every seeded assessment is already finished** — completed or expired. The
 * token hash is derived from a fixed label so re-running the seed updates the
 * same row rather than creating a second one, and a deterministic token would
 * normally be a bad idea. It is safe here only because neither a completed nor
 * an expired assessment will open: the gate refuses both before it looks at
 * anything else. No seeded row ever carries a working link.
 *
 * **The dates and scores describe a trajectory**, not noise. Jane improves,
 * Samir holds steady, Rana deteriorates — so the trend lines have a shape worth
 * reading, and the risk bands populate with more than one value.
 */
const DEMO_ASSESSMENTS: Array<{
  mrn: string;
  label: string;
  completedOn: string | null;
  totalScore: number | null;
}> = [
  // Jane Doe — improving.
  { mrn: "MRN-1001", label: "a1", completedOn: "2026-05-04", totalScore: 17 },
  { mrn: "MRN-1001", label: "a2", completedOn: "2026-06-05", totalScore: 11 },
  { mrn: "MRN-1001", label: "a3", completedOn: "2026-07-10", totalScore: 6 },

  // Samir Aoun — steady, and one invitation he never answered.
  { mrn: "MRN-1002", label: "b1", completedOn: "2026-05-18", totalScore: 9 },
  { mrn: "MRN-1002", label: "b2", completedOn: "2026-06-21", totalScore: 8 },
  { mrn: "MRN-1002", label: "b3", completedOn: null, totalScore: null },

  // Rana Bitar — deteriorating.
  { mrn: "MRN-1003", label: "c1", completedOn: "2026-05-22", totalScore: 13 },
  { mrn: "MRN-1003", label: "c2", completedOn: "2026-06-24", totalScore: 20 },
];

/** Answers that genuinely sum to `total`, so the stored score is not a fiction. */
function answersTotalling(total: number): number[] {
  const answers: number[] = [];
  let remaining = total;

  for (let i = 0; i < QUESTION_IDS.length; i += 1) {
    const value = Math.min(3, Math.max(0, remaining));
    answers.push(value);
    remaining -= value;
  }

  return answers;
}

async function seedAssessments() {
  for (const a of DEMO_ASSESSMENTS) {
    const patient = await prisma.patient.findUnique({
      where: { mrn: a.mrn },
      select: { id: true },
    });
    if (!patient) continue;

    // Stable across runs, so the seed stays idempotent.
    const tokenHash = hashToken(`pulsetrack-seed:${a.mrn}:${a.label}`);

    const completed = a.completedOn !== null && a.totalScore !== null;
    const sentAt = isoDate(
      completed ? shiftDays(a.completedOn!, -2) : "2026-06-30",
    );
    const expiresAt = new Date(sentAt.getTime() + 7 * 86_400_000);

    const data = completed
      ? {
          status: AssessmentStatus.COMPLETED,
          sentAt,
          expiresAt,
          completedAt: isoDate(a.completedOn!),
          totalScore: a.totalScore!,
          riskBand: bandForScore(a.totalScore!).label,
        }
      : {
          // Sent, never answered, and now past its 7 days — which is what
          // keeps the clinic's completion rate honestly below 100%.
          status: AssessmentStatus.EXPIRED,
          sentAt,
          expiresAt,
          completedAt: null,
          totalScore: null,
          riskBand: null,
        };

    const assessment = await prisma.assessment.upsert({
      where: { tokenHash },
      update: data,
      create: { patientId: patient.id, tokenHash, ...data },
      select: { id: true },
    });

    if (completed) {
      const scores = answersTotalling(a.totalScore!);

      // The unique (assessmentId, questionId) index makes this idempotent.
      await prisma.assessmentAnswer.createMany({
        data: QUESTION_IDS.map((questionId, i) => ({
          assessmentId: assessment.id,
          questionId,
          score: scores[i],
        })),
        skipDuplicates: true,
      });
    }

    console.log(
      `  assessment ${a.mrn}  ${completed ? `score ${a.totalScore}` : "expired, unanswered"}`,
    );
  }
}

/** `2026-05-04` shifted by n days, still as a plain calendar date. */
function shiftDays(iso: string, days: number): string {
  const shifted = new Date(isoDate(iso).getTime() + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

async function main() {
  console.log("Seeding PulseTrack (fabricated data only)");
  await seedClinician();
  await seedPatients();
  await seedAssessments();

  const counts = {
    clinicians: await prisma.clinician.count(),
    patients: await prisma.patient.count(),
    assessments: await prisma.assessment.count(),
  };
  console.log(
    `Done. ${counts.clinicians} clinician(s), ${counts.patients} patient(s), ${counts.assessments} assessment(s).`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
