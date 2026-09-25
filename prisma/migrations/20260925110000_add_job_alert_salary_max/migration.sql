ALTER TABLE "JobAlert" ADD COLUMN "salaryMax" DECIMAL(12,2);

UPDATE "SubscriptionPlan"
SET "featureConfig" = COALESCE("featureConfig", '{}'::jsonb) || '{"savedJobsLimit":20,"jobAlertsLimit":1,"applicationLimit":20,"profileStrengthLevel":"BASIC"}'::jsonb
WHERE "key" = 'BASIC';

UPDATE "SubscriptionPlan"
SET "featureConfig" = COALESCE("featureConfig", '{}'::jsonb) || '{"savedJobsLimit":100,"jobAlertsLimit":5,"applicationLimit":100,"profileStrengthLevel":"BASIC"}'::jsonb
WHERE "key" = 'PROFESSIONAL';

UPDATE "SubscriptionPlan"
SET "featureConfig" = COALESCE("featureConfig", '{}'::jsonb) || '{"savedJobsLimit":null,"jobAlertsLimit":null,"applicationLimit":null,"profileStrengthLevel":"ADVANCED"}'::jsonb
WHERE "key" = 'PREMIUM';