-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'ACTIVATED', 'RENEWED', 'CANCELLED', 'EXPIRED', 'PAYMENT_FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "benefits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "planId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("planId", "entitlementId")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" "SubscriptionEventType" NOT NULL,
    "providerReference" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_key_key" ON "SubscriptionPlan"("key");
CREATE INDEX "SubscriptionPlan_isActive_isPublic_displayOrder_idx" ON "SubscriptionPlan"("isActive", "isPublic", "displayOrder");
CREATE UNIQUE INDEX "Entitlement_key_key" ON "Entitlement"("key");
CREATE INDEX "PlanEntitlement_entitlementId_idx" ON "PlanEntitlement"("entitlementId");
CREATE INDEX "SubscriptionEvent_subscriptionId_occurredAt_idx" ON "SubscriptionEvent"("subscriptionId", "occurredAt");
CREATE INDEX "SubscriptionEvent_eventType_occurredAt_idx" ON "SubscriptionEvent"("eventType", "occurredAt");

-- Seed stable plans required to preserve legacy subscription rows during the conversion.
INSERT INTO "SubscriptionPlan" ("id", "key", "displayName", "description", "billingInterval", "isActive", "isPublic", "displayOrder", "updatedAt")
VALUES
  ('10000000-0000-4000-8000-000000000001', 'PROFESSIONAL', 'Professional', 'Career visibility tools for active job seekers.', 'MONTHLY', true, true, 0, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000002', 'PREMIUM', 'Premium', 'The strongest career visibility and future advanced capabilities.', 'MONTHLY', true, true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Convert the legacy enum-backed plan values without changing subscription history.
ALTER TABLE "Subscription" ADD COLUMN "planId" TEXT;
UPDATE "Subscription"
SET "planId" = CASE "plan"::text
  WHEN 'BASIC' THEN '10000000-0000-4000-8000-000000000001'
  WHEN 'PREMIUM' THEN '10000000-0000-4000-8000-000000000002'
END;
ALTER TABLE "Subscription" ALTER COLUMN "planId" SET NOT NULL;
ALTER TABLE "Subscription" DROP COLUMN "plan";
DROP TYPE "SubscriptionPlan";

-- Add historical subscription terms and lifecycle fields.
ALTER TABLE "Subscription"
  ADD COLUMN "priceSnapshot" DECIMAL(12,2),
  ADD COLUMN "currencySnapshot" VARCHAR(3),
  ADD COLUMN "billingIntervalSnapshot" "BillingInterval",
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "nextRenewalAt" TIMESTAMP(3),
  ADD COLUMN "providerCustomerReference" TEXT;

-- Prevent multiple pending or active subscriptions for one user.
CREATE UNIQUE INDEX "Subscription_one_current_per_user_idx"
  ON "Subscription"("userId")
  WHERE "status" IN ('PENDING', 'ACTIVE');

-- AddForeignKey
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanEntitlement"
  ADD CONSTRAINT "PlanEntitlement_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanEntitlement"
  ADD CONSTRAINT "PlanEntitlement_entitlementId_fkey"
  FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEvent"
  ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
