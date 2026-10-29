BEGIN;

-- Preserve every existing wallet row and replace only the single-wallet constraint.
DROP INDEX "Wallet_userId_key";
CREATE UNIQUE INDEX "Wallet_userId_currency_key" ON "Wallet"("userId", "currency");

CREATE TYPE "ConversionOperationStatus" AS ENUM (
  'BLOCKED',
  'QUOTED',
  'SUBMITTED',
  'UNCERTAIN',
  'CONFIRMED',
  'FAILED',
  'RECONCILIATION_REQUIRED'
);

CREATE TABLE "ConversionOperation" (
  "id" TEXT NOT NULL,
  "seekerId" TEXT NOT NULL,
  "escrowId" TEXT NOT NULL,
  "sourcePaymentId" TEXT,
  "destinationWalletId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "sourceCurrency" VARCHAR(3) NOT NULL,
  "destinationCurrency" VARCHAR(3) NOT NULL,
  "sourceAmount" DECIMAL(20,8) NOT NULL,
  "convertedAmount" DECIMAL(20,8),
  "rate" DECIMAL(28,12),
  "rateDirection" TEXT,
  "rateSource" TEXT,
  "quoteReference" TEXT,
  "quoteCreatedAt" TIMESTAMP(3),
  "quoteExpiresAt" TIMESTAMP(3),
  "feeAmount" DECIMAL(20,8),
  "spreadAmount" DECIMAL(20,8),
  "roundingAmount" DECIMAL(20,8),
  "providerIdempotencyKey" TEXT,
  "providerTransactionId" TEXT,
  "status" "ConversionOperationStatus" NOT NULL DEFAULT 'BLOCKED',
  "statusReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversionOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversionOperationEvent" (
  "id" TEXT NOT NULL,
  "conversionOperationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" "ConversionOperationStatus",
  "toStatus" "ConversionOperationStatus" NOT NULL,
  "eventType" TEXT NOT NULL,
  "reason" TEXT,
  "providerReference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversionOperationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversionOperation_escrowId_key" ON "ConversionOperation"("escrowId");
CREATE UNIQUE INDEX "ConversionOperation_idempotencyKey_key" ON "ConversionOperation"("idempotencyKey");
CREATE INDEX "ConversionOperation_status_updatedAt_idx" ON "ConversionOperation"("status", "updatedAt");
CREATE INDEX "ConversionOperation_seekerId_createdAt_idx" ON "ConversionOperation"("seekerId", "createdAt");
CREATE INDEX "ConversionOperation_providerTransactionId_idx" ON "ConversionOperation"("providerTransactionId");
CREATE INDEX "ConversionOperationEvent_conversionOperationId_createdAt_idx" ON "ConversionOperationEvent"("conversionOperationId", "createdAt");
CREATE INDEX "ConversionOperationEvent_actorUserId_createdAt_idx" ON "ConversionOperationEvent"("actorUserId", "createdAt");

ALTER TABLE "ConversionOperation"
  ADD CONSTRAINT "ConversionOperation_seekerId_fkey"
  FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversionOperation"
  ADD CONSTRAINT "ConversionOperation_escrowId_fkey"
  FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversionOperation"
  ADD CONSTRAINT "ConversionOperation_sourcePaymentId_fkey"
  FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversionOperation"
  ADD CONSTRAINT "ConversionOperation_destinationWalletId_fkey"
  FOREIGN KEY ("destinationWalletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversionOperationEvent"
  ADD CONSTRAINT "ConversionOperationEvent_conversionOperationId_fkey"
  FOREIGN KEY ("conversionOperationId") REFERENCES "ConversionOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversionOperationEvent"
  ADD CONSTRAINT "ConversionOperationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialLedgerEntry" ADD COLUMN "conversionOperationId" TEXT;
CREATE UNIQUE INDEX "FinancialLedgerEntry_conversionOperationId_key" ON "FinancialLedgerEntry"("conversionOperationId");
ALTER TABLE "FinancialLedgerEntry"
  ADD CONSTRAINT "FinancialLedgerEntry_conversionOperationId_fkey"
  FOREIGN KEY ("conversionOperationId") REFERENCES "ConversionOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
