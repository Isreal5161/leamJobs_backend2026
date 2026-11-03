DROP INDEX "Application_seekerId_jobId_key";

CREATE INDEX "Application_seekerId_jobId_idx" ON "Application"("seekerId", "jobId");
