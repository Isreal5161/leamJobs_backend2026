CREATE TYPE "TrialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ENDED', 'CANCELLED');

ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "featureConfig" JSONB,
  ADD COLUMN "aiAllowance" INTEGER;

ALTER TABLE "Entitlement"
  ADD COLUMN "usageLimit" INTEGER;

CREATE TABLE "UserSubscriptionTrial" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedPlanKey" TEXT NOT NULL,
  "status" "TrialStatus" NOT NULL DEFAULT 'ACTIVE',
  "durationDays" INTEGER NOT NULL DEFAULT 7,
  "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "source" TEXT,
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSubscriptionTrial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSubscriptionTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiUsageRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "planKey" TEXT NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UserSubscriptionTrial_userId_status_endAt_idx"
  ON "UserSubscriptionTrial" ("userId", "status", "endAt");

CREATE INDEX "UserSubscriptionTrial_status_endAt_idx"
  ON "UserSubscriptionTrial" ("status", "endAt");

CREATE INDEX "AiUsageRecord_userId_planKey_periodStart_idx"
  ON "AiUsageRecord" ("userId", "planKey", "periodStart");

CREATE INDEX "AiUsageRecord_userId_featureKey_createdAt_idx"
  ON "AiUsageRecord" ("userId", "featureKey", "createdAt");
