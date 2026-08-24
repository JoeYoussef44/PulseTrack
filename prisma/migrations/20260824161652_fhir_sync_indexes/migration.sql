-- CreateIndex
CREATE INDEX "lab_results_fhirSyncStatus_idx" ON "lab_results"("fhirSyncStatus");

-- CreateIndex
CREATE INDEX "patients_fhirSyncStatus_idx" ON "patients"("fhirSyncStatus");
