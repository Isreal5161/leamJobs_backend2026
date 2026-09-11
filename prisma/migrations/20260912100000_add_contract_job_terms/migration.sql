-- Additive Contract Job terms and payment-pending application state.
CREATE TYPE "ContractStartMode" AS ENUM ('IMMEDIATE', 'SCHEDULED');
ALTER TYPE "ContractType" ADD VALUE 'CONTRACT_PROJECT';
ALTER TYPE "ApplicationStatus" ADD VALUE 'PAYMENT_PENDING';

ALTER TABLE "ContractCompensation"
  ADD COLUMN "startMode" "ContractStartMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "scheduledStartDate" TIMESTAMP(3),
  ADD COLUMN "expectedCompletionDate" TIMESTAMP(3);

ALTER TABLE "FreelanceContract"
  ADD COLUMN "duration" TEXT,
  ADD COLUMN "startMode" "ContractStartMode";
