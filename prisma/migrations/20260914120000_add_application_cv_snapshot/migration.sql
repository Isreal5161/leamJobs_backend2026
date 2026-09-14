-- CreateEnum
CREATE TYPE "CvSource" AS ENUM ('LEAMJOBS_TEMPLATE');

-- CreateTable
CREATE TABLE "ApplicationCvSnapshot" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "source" "CvSource" NOT NULL DEFAULT 'LEAMJOBS_TEMPLATE',
    "templateId" TEXT,
    "templateName" TEXT,
    "templateVersion" TEXT,
    "snapshotCapturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationCvSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationCvSnapshot_applicationId_key"
    ON "ApplicationCvSnapshot"("applicationId");

-- AddForeignKey
ALTER TABLE "ApplicationCvSnapshot"
    ADD CONSTRAINT "ApplicationCvSnapshot_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
