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

-- Recreate the enum instead of altering its values in place. Some PostgreSQL
-- deployments reject that operation when Prisma executes the migration
-- transaction as a multi-command statement.
ALTER TYPE "EmployerVerificationDocumentKind" RENAME TO "EmployerVerificationDocumentKind_old";

CREATE TYPE "EmployerVerificationDocumentKind" AS ENUM (
    'CAC',
    'TRADE_LICENSE',
    'TAX_CERTIFICATE',
    'UTILITY_BILL',
    'IDENTITY_SUPPORTING',
    'OTHER'
);

ALTER TABLE "EmployerVerificationDocument"
    ALTER COLUMN "kind" TYPE "EmployerVerificationDocumentKind"
    USING ("kind"::text::"EmployerVerificationDocumentKind");

DROP TYPE "EmployerVerificationDocumentKind_old";
