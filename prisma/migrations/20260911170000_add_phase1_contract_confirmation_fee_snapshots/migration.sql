-- Additive Phase 1 contract confirmation and fee snapshot fields.
ALTER TABLE "FreelanceContract"
  ADD COLUMN "platformFeePercentage" DECIMAL(5,2),
  ADD COLUMN "platformFeeAmount" DECIMAL(12,2),
  ADD COLUMN "seekerNetAmount" DECIMAL(12,2),
  ADD COLUMN "seekerConfirmedAt" TIMESTAMP(3);

CREATE TABLE "PlatformFeeConfiguration" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL DEFAULT 'default',
  "percentage" DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformFeeConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformFeeConfiguration_key_key"
  ON "PlatformFeeConfiguration"("key");

INSERT INTO "PlatformFeeConfiguration" ("id", "key", "percentage", "isActive", "updatedAt")
VALUES ('77777777-7777-4777-8777-777777777777', 'default', 5.00, true, CURRENT_TIMESTAMP);
