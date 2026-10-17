CREATE TYPE "ContractActivityType" AS ENUM (
  'PROGRESS_UPDATE',
  'SUBMISSION',
  'REVISION_REQUEST',
  'FEEDBACK',
  'APPROVAL'
);

CREATE TYPE "ContractProgressStatus" AS ENUM (
  'IN_PROGRESS',
  'BLOCKED',
  'WAITING',
  'SUBMITTED_FOR_REVIEW',
  'REVISION_IN_PROGRESS'
);

CREATE TABLE "ContractActivity" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL,
  "type" "ContractActivityType" NOT NULL,
  "progressStatus" "ContractProgressStatus",
  "description" TEXT NOT NULL,
  "links" JSONB,
  "submissionVersion" INTEGER,
  "parentActivityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractWorkAttachment" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractWorkAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractActivity_contractId_submissionVersion_key"
  ON "ContractActivity"("contractId", "submissionVersion");
CREATE INDEX "ContractActivity_contractId_createdAt_id_idx"
  ON "ContractActivity"("contractId", "createdAt", "id");
CREATE INDEX "ContractActivity_parentActivityId_type_idx"
  ON "ContractActivity"("parentActivityId", "type");
CREATE UNIQUE INDEX "ContractWorkAttachment_objectKey_key"
  ON "ContractWorkAttachment"("objectKey");
CREATE INDEX "ContractWorkAttachment_activityId_idx"
  ON "ContractWorkAttachment"("activityId");

ALTER TABLE "ContractActivity"
  ADD CONSTRAINT "ContractActivity_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractActivity"
  ADD CONSTRAINT "ContractActivity_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContractActivity"
  ADD CONSTRAINT "ContractActivity_parentActivityId_fkey"
  FOREIGN KEY ("parentActivityId") REFERENCES "ContractActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContractWorkAttachment"
  ADD CONSTRAINT "ContractWorkAttachment_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "ContractActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
