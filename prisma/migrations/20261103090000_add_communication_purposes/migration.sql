CREATE TYPE "CommunicationPurpose" AS ENUM (
  'ESSENTIAL_ANNOUNCEMENT',
  'PROMOTIONAL_MARKETING'
);

ALTER TABLE "EmailCampaign"
  ADD COLUMN "purpose" "CommunicationPurpose" NOT NULL DEFAULT 'PROMOTIONAL_MARKETING',
  ADD COLUMN "operationalContentConfirmed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EmailDelivery"
  ADD COLUMN "communicationPurpose" "CommunicationPurpose",
  ADD COLUMN "suppressionReason" TEXT;
