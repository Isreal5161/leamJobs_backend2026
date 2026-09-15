-- Paystack is the provider for outbound Nigerian withdrawals.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYSTACK';

-- Existing Nigerian payout accounts were previously marked FLUTTERWAVE but were
-- never executable. Move their declared outbound provider to Paystack.
UPDATE "PayoutAccount"
SET "provider" = 'PAYSTACK'::"PaymentProvider"
WHERE "payoutMethod" = 'BANK_ACCOUNT'::"PayoutMethod";