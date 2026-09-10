-- Additive Employer Jobs fields. Existing jobs default to monthly employment.
CREATE TYPE "EngagementType" AS ENUM ('MONTHLY', 'CONTRACT', 'FREELANCE');
CREATE TYPE "WorkArrangement" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE');

ALTER TABLE "Job"
  ADD COLUMN "engagementType" "EngagementType" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "department" TEXT,
  ADD COLUMN "workArrangement" "WorkArrangement";

UPDATE "Job"
SET "engagementType" = 'FREELANCE'
WHERE "jobType" = 'FREELANCE_PROJECT';

CREATE TABLE "ContractCompensation" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
  "duration" TEXT,

  CONSTRAINT "ContractCompensation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractCompensation_jobId_key" ON "ContractCompensation"("jobId");

ALTER TABLE "ContractCompensation"
  ADD CONSTRAINT "ContractCompensation_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;