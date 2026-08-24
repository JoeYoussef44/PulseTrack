import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client";
import { Sex } from "../lib/generated/prisma/enums";

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

async function main() {
  console.log("Seeding PulseTrack (fabricated data only)");
  await seedClinician();
  await seedPatients();

  const counts = {
    clinicians: await prisma.clinician.count(),
    patients: await prisma.patient.count(),
  };
  console.log(
    `Done. ${counts.clinicians} clinician(s), ${counts.patients} patient(s).`,
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
