ALTER TABLE "ProviderWebhookEvent"
  ADD COLUMN "contractId" TEXT,
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "transactionId" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "lastError" TEXT;

CREATE INDEX "ProviderWebhookEvent_provider_processedAt_nextAttemptAt_att_idx"
  ON "ProviderWebhookEvent"("provider", "processedAt", "nextAttemptAt", "attempts");
