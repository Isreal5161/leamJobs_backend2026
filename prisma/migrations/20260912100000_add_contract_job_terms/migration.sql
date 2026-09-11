-- Additive Contract Job terms and payment-pending application state.
CREATE TYPE "ContractStartMode" AS ENUM ('IMMEDIATE', 'SCHEDULED');

CREATE TYPE "_ApplicationStatus_new" AS ENUM (
  'APPLIED',
  'REVIEWING',
  'SHORTLISTED',
  'INTERVIEW',
  'REJECTED',
  'ACCEPTED',
  'PAYMENT_PENDING',
  'WITHDRAWN'
);

ALTER TABLE "Application"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Application"
  ALTER COLUMN "status"
  TYPE "_ApplicationStatus_new"
  USING ("status"::text::"_ApplicationStatus_new");

DROP TYPE "ApplicationStatus";
ALTER TYPE "_ApplicationStatus_new" RENAME TO "ApplicationStatus";

ALTER TABLE "Application"
  ALTER COLUMN "status" SET DEFAULT 'APPLIED';

CREATE TYPE "_ContractType_new" AS ENUM (
  'NORMAL_EMPLOYMENT',
  'CONTRACT_PROJECT',
  'FREELANCE_PROJECT'
);

ALTER TABLE "Contract"
  ALTER COLUMN "type"
  TYPE "_ContractType_new"
  USING ("type"::text::"_ContractType_new");

DROP TYPE "ContractType";
ALTER TYPE "_ContractType_new" RENAME TO "ContractType";

ALTER TABLE "ContractCompensation"
  ADD COLUMN "startMode" "ContractStartMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "scheduledStartDate" TIMESTAMP(3),
  ADD COLUMN "expectedCompletionDate" TIMESTAMP(3);

ALTER TABLE "FreelanceContract"
  ADD COLUMN "duration" TEXT,
  ADD COLUMN "startMode" "ContractStartMode";
