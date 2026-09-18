CREATE TABLE "EmailVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationCode_userId_key"
    ON "EmailVerificationCode"("userId");

CREATE INDEX "EmailVerificationCode_userId_expiresAt_idx"
    ON "EmailVerificationCode"("userId", "expiresAt");

CREATE INDEX "EmailVerificationCode_userId_usedAt_expiresAt_idx"
    ON "EmailVerificationCode"("userId", "usedAt", "expiresAt");

ALTER TABLE "EmailVerificationCode"
    ADD CONSTRAINT "EmailVerificationCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
