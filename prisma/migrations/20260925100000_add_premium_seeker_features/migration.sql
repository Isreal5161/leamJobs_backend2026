CREATE TABLE "SavedJob" (
    "id" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobAlert" (
    "id" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT,
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "location" TEXT,
    "jobType" "JobType",
    "workArrangement" "WorkArrangement",
    "salaryMin" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedJob_seekerId_jobId_key" ON "SavedJob"("seekerId", "jobId");
CREATE INDEX "SavedJob_seekerId_createdAt_idx" ON "SavedJob"("seekerId", "createdAt");
CREATE INDEX "SavedJob_jobId_createdAt_idx" ON "SavedJob"("jobId", "createdAt");
CREATE INDEX "JobAlert_seekerId_isActive_createdAt_idx" ON "JobAlert"("seekerId", "isActive", "createdAt");
CREATE INDEX "SupportRequest_seekerId_status_createdAt_idx" ON "SupportRequest"("seekerId", "status", "createdAt");
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");

ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobAlert" ADD CONSTRAINT "JobAlert_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;