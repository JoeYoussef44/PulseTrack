-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('SENT', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TestCode" AS ENUM ('GLU_F', 'HBA1C', 'SBP');

-- CreateEnum
CREATE TYPE "LabSource" AS ENUM ('CSV', 'FHIR', 'MANUAL');

-- CreateEnum
CREATE TYPE "FhirOwnership" AS ENUM ('NONE', 'OWNED', 'EXTERNAL_SEED');

-- CreateEnum
CREATE TYPE "FhirSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'FORBIDDEN');

-- CreateTable
CREATE TABLE "clinicians" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "sex" "Sex" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "fhirPatientId" TEXT,
    "fhirOwnership" "FhirOwnership" NOT NULL DEFAULT 'NONE',
    "fhirSyncStatus" "FhirSyncStatus",
    "fhirLastSyncedAt" TIMESTAMP(3),
    "fhirLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL DEFAULT 'dsma-8',
    "questionnaireVersion" TEXT NOT NULL DEFAULT '1.0',
    "tokenHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'SENT',
    "completedAt" TIMESTAMP(3),
    "totalScore" INTEGER,
    "riskBand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answers" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedByClinicianId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedDuplicateCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lab_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "labUploadId" TEXT,
    "collectedDate" DATE NOT NULL,
    "testCode" "TestCode" NOT NULL,
    "testName" TEXT NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "refLow" DECIMAL(10,3),
    "refHigh" DECIMAL(10,3),
    "source" "LabSource" NOT NULL,
    "fhirObservationId" TEXT,
    "fhirSyncStatus" "FhirSyncStatus",
    "fhirLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinicians_email_key" ON "clinicians"("email");

-- CreateIndex
CREATE UNIQUE INDEX "patients_mrn_key" ON "patients"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "patients_fhirPatientId_key" ON "patients"("fhirPatientId");

-- CreateIndex
CREATE INDEX "patients_fullName_idx" ON "patients"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_tokenHash_key" ON "assessments"("tokenHash");

-- CreateIndex
CREATE INDEX "assessments_patientId_sentAt_idx" ON "assessments"("patientId", "sentAt");

-- CreateIndex
CREATE INDEX "assessments_status_expiresAt_idx" ON "assessments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answers_assessmentId_questionId_key" ON "assessment_answers"("assessmentId", "questionId");

-- CreateIndex
CREATE INDEX "lab_uploads_uploadedAt_idx" ON "lab_uploads"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_fhirObservationId_key" ON "lab_results"("fhirObservationId");

-- CreateIndex
CREATE INDEX "lab_results_patientId_testCode_collectedDate_idx" ON "lab_results"("patientId", "testCode", "collectedDate");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_patientId_collectedDate_testCode_key" ON "lab_results"("patientId", "collectedDate", "testCode");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_uploads" ADD CONSTRAINT "lab_uploads_uploadedByClinicianId_fkey" FOREIGN KEY ("uploadedByClinicianId") REFERENCES "clinicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_labUploadId_fkey" FOREIGN KEY ("labUploadId") REFERENCES "lab_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
