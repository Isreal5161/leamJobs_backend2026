CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "pictureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthAccount_provider_providerSubject_key"
    ON "OAuthAccount"("provider", "providerSubject");

CREATE INDEX "OAuthAccount_userId_idx"
    ON "OAuthAccount"("userId");

CREATE INDEX "OAuthAccount_email_idx"
    ON "OAuthAccount"("email");

ALTER TABLE "OAuthAccount"
    ADD CONSTRAINT "OAuthAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PendingOAuthRegistration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT,
    "email" TEXT NOT NULL,
    "intendedRole" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "PendingOAuthRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingOAuthRegistration_stateHash_key"
    ON "PendingOAuthRegistration"("stateHash");

CREATE INDEX "PendingOAuthRegistration_provider_providerSubject_idx"
    ON "PendingOAuthRegistration"("provider", "providerSubject");

CREATE INDEX "PendingOAuthRegistration_email_idx"
    ON "PendingOAuthRegistration"("email");

CREATE INDEX "PendingOAuthRegistration_status_expiresAt_idx"
    ON "PendingOAuthRegistration"("status", "expiresAt");

CREATE INDEX "PendingOAuthRegistration_userId_idx"
    ON "PendingOAuthRegistration"("userId");

ALTER TABLE "PendingOAuthRegistration"
    ADD CONSTRAINT "PendingOAuthRegistration_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
