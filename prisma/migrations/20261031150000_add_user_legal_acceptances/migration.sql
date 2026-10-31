CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY');
CREATE TYPE "LegalRegistrationMethod" AS ENUM ('PASSWORD', 'GOOGLE', 'ACCOUNT');

CREATE TABLE "UserLegalAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "documentType" "LegalDocumentType" NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registrationMethod" "LegalRegistrationMethod" NOT NULL,
  CONSTRAINT "UserLegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserLegalAcceptance_userId_documentType_version_key"
  ON "UserLegalAcceptance"("userId", "documentType", "version");
CREATE INDEX "UserLegalAcceptance_userId_documentType_acceptedAt_idx"
  ON "UserLegalAcceptance"("userId", "documentType", "acceptedAt");

ALTER TABLE "UserLegalAcceptance"
  ADD CONSTRAINT "UserLegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
