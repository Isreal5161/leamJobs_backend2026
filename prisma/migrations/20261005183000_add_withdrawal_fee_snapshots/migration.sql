-- Recreate the enum instead of adding values in place. Some PostgreSQL
-- deployments reject ALTER TYPE ... ADD VALUE when Prisma executes the
-- migration as a multi-command statement.
ALTER TYPE "LedgerEntryType" RENAME TO "LedgerEntryType_old";

CREATE TYPE "LedgerEntryType" AS ENUM (
    'EMPLOYER_PAYMENT',
    'ESCROW_FUNDED',
    'PLATFORM_FEE',
    'FUNDS_RELEASED',
    'WALLET_CREDIT',
    'WITHDRAWAL_RESERVED',
    'WITHDRAWAL_SUCCESSFUL',
    'WITHDRAWAL_FEE',
    'WITHDRAWAL_FEE_REVERSAL',
    'WITHDRAWAL_FAILED_REVERSAL',
    'REFUND',
    'ADMIN_ADJUSTMENT'
);

ALTER TABLE "FinancialLedgerEntry"
ALTER COLUMN "entryType" TYPE "LedgerEntryType"
USING ("entryType"::text::"LedgerEntryType");

DROP TYPE "LedgerEntryType_old";

ALTER TABLE "PlatformFeeConfiguration"
ADD COLUMN "withdrawalPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "Withdrawal"
ADD COLUMN "withdrawalFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "withdrawalFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "payoutAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "Withdrawal"
SET "payoutAmount" = "amount";
