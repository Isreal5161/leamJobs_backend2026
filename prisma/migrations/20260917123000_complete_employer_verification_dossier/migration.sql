-- Add public employer dossier fields.
ALTER TABLE "EmployerProfile"
    ADD COLUMN "address" TEXT,
    ADD COLUMN "state" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "linkedinUrl" TEXT,
    ADD COLUMN "twitterUrl" TEXT,
    ADD COLUMN "facebookUrl" TEXT;

-- Keep private registration data on the verification record.
ALTER TABLE "EmployerVerification"
    ALTER COLUMN "submittedAt" DROP NOT NULL,
    ALTER COLUMN "submittedAt" DROP DEFAULT,
    ADD COLUMN "registrationNumber" TEXT,
    ADD COLUMN "registrationType" TEXT;

ALTER TABLE "EmployerVerificationDocument"
    ADD COLUMN "fileSize" INTEGER;

ALTER TYPE "EmployerVerificationDocumentKind"
    ADD VALUE IF NOT EXISTS 'IDENTITY_SUPPORTING';
