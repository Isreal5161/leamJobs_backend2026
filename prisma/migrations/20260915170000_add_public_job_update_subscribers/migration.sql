ALTER TABLE "EmailDelivery" ALTER COLUMN "recipientUserId" DROP NOT NULL;
ALTER TABLE "EmailDelivery" ADD COLUMN "publicSubscriberId" TEXT;

CREATE TABLE "PublicJobSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unsubscribeHash" TEXT NOT NULL,
    "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicJobSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicJobSubscriber_email_key" ON "PublicJobSubscriber"("email");
CREATE UNIQUE INDEX "PublicJobSubscriber_unsubscribeHash_key" ON "PublicJobSubscriber"("unsubscribeHash");
CREATE UNIQUE INDEX "EmailDelivery_publicSubscriberId_emailType_eventKey_key" ON "EmailDelivery"("publicSubscriberId", "emailType", "eventKey");

ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_publicSubscriberId_fkey"
  FOREIGN KEY ("publicSubscriberId") REFERENCES "PublicJobSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;