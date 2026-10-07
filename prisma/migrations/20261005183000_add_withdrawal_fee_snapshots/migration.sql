ALTER TYPE "LedgerEntryType" ADD VALUE 'WITHDRAWAL_FEE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'WITHDRAWAL_FEE_REVERSAL';

ALTER TABLE "PlatformFeeConfiguration"
ADD COLUMN "withdrawalPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "Withdrawal"
ADD COLUMN "withdrawalFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "withdrawalFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "payoutAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "Withdrawal"
SET "payoutAmount" = "amount";
