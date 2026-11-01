ALTER TABLE "PendingOAuthRegistration"
  ADD COLUMN IF NOT EXISTS "acceptedTermsVersion" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "acceptedPrivacyVersion" VARCHAR(64);
