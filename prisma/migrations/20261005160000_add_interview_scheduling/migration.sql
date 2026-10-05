CREATE TYPE "InterviewMethod" AS ENUM ('LEAMJOBS', 'WHATSAPP', 'VIDEO', 'PHONE', 'IN_PERSON', 'OTHER');
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE "InterviewHistoryEvent" AS ENUM ('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELLED');

CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "method" "InterviewMethod" NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "message" VARCHAR(2000),
    "meetingUrl" VARCHAR(2048),
    "phoneNumber" VARCHAR(40),
    "location" VARCHAR(300),
    "previousApplicationStatus" "ApplicationStatus" NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewHistory" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "actorId" TEXT,
    "event" "InterviewHistoryEvent" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Interview_employerId_status_scheduledAt_idx" ON "Interview"("employerId", "status", "scheduledAt");
CREATE INDEX "Interview_seekerId_status_scheduledAt_idx" ON "Interview"("seekerId", "status", "scheduledAt");
CREATE INDEX "Interview_applicationId_status_idx" ON "Interview"("applicationId", "status");
CREATE INDEX "Interview_jobId_scheduledAt_idx" ON "Interview"("jobId", "scheduledAt");
CREATE UNIQUE INDEX "Interview_one_active_per_application_idx" ON "Interview"("applicationId") WHERE "status" = 'SCHEDULED';
CREATE INDEX "InterviewHistory_interviewId_createdAt_idx" ON "InterviewHistory"("interviewId", "createdAt");

ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewHistory" ADD CONSTRAINT "InterviewHistory_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewHistory" ADD CONSTRAINT "InterviewHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
