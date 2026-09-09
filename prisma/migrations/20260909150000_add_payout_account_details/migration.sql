-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK_ACCOUNT', 'OTHER');

-- AlterTable: add country/currency/payoutMethod/bankName, relax bankCode (not every payout method has one)
ALTER TABLE "PayoutAccount"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "currency" VARCHAR(3),
  ADD COLUMN "payoutMethod" "PayoutMethod",
  ADD COLUMN "bankName" TEXT,
  ALTER COLUMN "bankCode" DROP NOT NULL;

-- Backfill existing rows (schema predates country/currency awareness; existing accounts were Nigeria bank accounts)
UPDATE "PayoutAccount"
SET "country" = 'Nigeria', "currency" = 'NGN', "payoutMethod" = 'BANK_ACCOUNT'
WHERE "country" IS NULL;

-- Enforce NOT NULL now that existing rows are backfilled
ALTER TABLE "PayoutAccount"
  ALTER COLUMN "country" SET NOT NULL,
  ALTER COLUMN "currency" SET NOT NULL,
  ALTER COLUMN "payoutMethod" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PayoutAccount_userId_disabledAt_idx" ON "PayoutAccount"("userId", "disabledAt");

-- Enforce a single default payout account per user at the database level (partial unique index;
-- not expressible in the Prisma schema DSL, so it is not mirrored as `@@unique` in schema.prisma).
CREATE UNIQUE INDEX "PayoutAccount_userId_isDefault_unique"
  ON "PayoutAccount" ("userId")
  WHERE "isDefault" = true;
