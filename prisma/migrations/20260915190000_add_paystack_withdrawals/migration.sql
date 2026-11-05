-- Paystack is the provider for outbound Nigerian withdrawals.
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE inside Prisma's
-- transactional migration execution, so rebuild the enum instead.

CREATE TYPE "PaymentProvider_new" AS ENUM ('FLUTTERWAVE', 'OTHER', 'PAYSTACK');

ALTER TABLE "Payment" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

ALTER TABLE "Payout" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

ALTER TABLE "PayoutAccount" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

ALTER TABLE "ProviderWebhookEvent" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

ALTER TABLE "Refund" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

ALTER TABLE "Withdrawal" ALTER COLUMN "provider"
  TYPE "PaymentProvider_new"
  USING "provider"::text::"PaymentProvider_new";

DROP TYPE "PaymentProvider";

ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";

-- Existing Nigerian payout accounts were previously marked FLUTTERWAVE
-- but were never executable. Move their declared outbound provider to Paystack.
UPDATE "PayoutAccount"
SET "provider" = 'PAYSTACK'::"PaymentProvider"
WHERE "provider" = 'FLUTTERWAVE'::"PaymentProvider";
