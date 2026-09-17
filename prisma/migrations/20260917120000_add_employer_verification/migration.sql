-- CreateEnum
CREATE TYPE "EmployerVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EmployerVerificationDocumentKind" AS ENUM ('CAC', 'TRADE_LICENSE', 'TAX_CERTIFICATE', 'UTILITY_BILL', 'OTHER');

-- CreateTable
CREATE TABLE "EmployerVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "EmployerVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerVerificationDocument" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "kind" "EmployerVerificationDocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerVerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployerVerification_userId_key"
    ON "EmployerVerification"("userId");

-- CreateIndex
CREATE INDEX "EmployerVerification_status_submittedAt_idx"
    ON "EmployerVerification"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "EmployerVerification_reviewedById_reviewedAt_idx"
    ON "EmployerVerification"("reviewedById", "reviewedAt");

-- CreateIndex
CREATE INDEX "EmployerVerificationDocument_verificationId_uploadedAt_idx"
    ON "EmployerVerificationDocument"("verificationId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "EmployerVerification"
    ADD CONSTRAINT "EmployerVerification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerVerification"
    ADD CONSTRAINT "EmployerVerification_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerVerificationDocument"
    ADD CONSTRAINT "EmployerVerificationDocument_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "EmployerVerification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
