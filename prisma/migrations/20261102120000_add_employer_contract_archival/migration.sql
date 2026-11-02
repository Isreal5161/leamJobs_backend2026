ALTER TABLE "Contract"
ADD COLUMN "employerArchivedAt" TIMESTAMP(3);

CREATE INDEX "Contract_employerId_employerArchivedAt_createdAt_idx"
ON "Contract"("employerId", "employerArchivedAt", "createdAt");
