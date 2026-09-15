-- CreateEnum
CREATE TYPE "JobInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "JobInvitation" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "JobInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "conversationId" TEXT,
    "applicationId" TEXT,

    CONSTRAINT "JobInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobInvitation_conversationId_key" ON "JobInvitation"("conversationId");
CREATE UNIQUE INDEX "JobInvitation_applicationId_key" ON "JobInvitation"("applicationId");
CREATE UNIQUE INDEX "JobInvitation_employerId_seekerId_jobId_status_key" ON "JobInvitation"("employerId", "seekerId", "jobId", "status");
CREATE INDEX "JobInvitation_seekerId_status_createdAt_idx" ON "JobInvitation"("seekerId", "status", "createdAt");
CREATE INDEX "JobInvitation_employerId_status_createdAt_idx" ON "JobInvitation"("employerId", "status", "createdAt");
CREATE INDEX "JobInvitation_jobId_status_idx" ON "JobInvitation"("jobId", "status");

-- AddForeignKey
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
