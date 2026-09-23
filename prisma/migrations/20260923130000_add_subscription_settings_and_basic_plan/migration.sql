CREATE TABLE "SubscriptionSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "trialEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trialDurationDays" INTEGER NOT NULL DEFAULT 7,
    "trialPlanKey" TEXT NOT NULL DEFAULT 'PREMIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "aiUnlimited" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "SubscriptionPlan" ("id", "key", "displayName", "description", "billingInterval", "isActive", "isPublic", "displayOrder", "benefits", "aiAllowance", "featureConfig", "updatedAt")
VALUES (
  '10000000-0000-4000-8000-000000000003',
  'BASIC',
  'Basic',
  'Free access with limited AI usage and core job features.',
  'MONTHLY',
  true,
  true,
  0,
  '["Browse jobs", "Search jobs", "Basic filters", "Limited AI credits"]'::jsonb,
  5,
  '{"free": true}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;