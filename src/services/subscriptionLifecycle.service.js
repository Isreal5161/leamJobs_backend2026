import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { recordSubscriptionEvent } from './subscriptionFoundation.service.js';
import { createNotification } from './notification.service.js';

const DEFAULT_BATCH_SIZE = 100;
const EXPIRY_REMINDER_DAYS = 3;

export const isSubscriptionCurrentlyActive = (subscription, now = new Date()) => (
  subscription?.status === 'ACTIVE'
    && subscription.startDate
    && subscription.startDate <= now
    && subscription.endDate
    && subscription.endDate > now
);

export const isStaleActiveSubscription = (subscription, now = new Date()) => (
  subscription?.status === 'ACTIVE'
    && subscription.endDate
    && subscription.endDate <= now
);

export const getEffectiveSubscriptionStatus = (subscription, now = new Date()) => (
  isStaleActiveSubscription(subscription, now) ? 'EXPIRED' : subscription?.status
);

export const getEffectiveActiveWhere = (now = new Date()) => ({
  status: 'ACTIVE',
  startDate: { not: null, lte: now },
  endDate: { not: null, gt: now },
});

export const getEffectiveExpiredWhere = (now = new Date()) => ({
  OR: [
    { status: 'EXPIRED' },
    { status: 'ACTIVE', endDate: { not: null, lte: now } },
  ],
});

export const addBillingInterval = (startDate, billingInterval) => {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid subscription start date');
  }

  if (billingInterval !== 'MONTHLY') {
    throw new Error(`Unsupported subscription billing interval: ${billingInterval}`);
  }

  const end = new Date(start);
  const originalDay = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDayOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDayOfMonth));
  return end;
};

const normalizeBatchSize = (value) => {
  const batchSize = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(batchSize, 1000);
};

const expireBatchInTransaction = async (transaction, { userId, batchSize }) => {
  const userFilter = userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty;
  const expired = await transaction.$queryRaw(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "Subscription"
      WHERE "status" = 'ACTIVE'::"SubscriptionStatus"
        AND "endDate" IS NOT NULL
        AND "endDate" <= CURRENT_TIMESTAMP
        ${userFilter}
      ORDER BY "endDate" ASC, "id" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ), transitioned AS (
      UPDATE "Subscription" AS subscription
      SET "status" = 'EXPIRED'::"SubscriptionStatus",
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
      WHERE subscription."id" = candidates."id"
        AND subscription."status" = 'ACTIVE'::"SubscriptionStatus"
      RETURNING subscription."id", subscription."userId"
    )
    SELECT "id", "userId"
    FROM transitioned
  `);

  for (const subscription of expired) {
    await recordSubscriptionEvent({
      subscriptionId: subscription.id,
      eventType: 'EXPIRED',
      metadata: {
        userId: subscription.userId,
        reason: 'END_DATE_REACHED',
      },
    }, transaction);
    await createNotification({
      recipientUserId: subscription.userId,
      type: 'INFO',
      category: 'SUBSCRIPTION',
      eventKey: `subscription:expired:${subscription.id}`,
      title: 'Subscription expired',
      message: 'Your subscription has expired. Renew to continue using subscriber benefits.',
      link: '/seeker/payments',
    }, transaction).catch(() => undefined);
  }

  return expired;
};

export const expireSubscriptionBatch = async ({ userId, batchSize = DEFAULT_BATCH_SIZE, client = prisma } = {}) => {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  return client.$transaction((transaction) => expireBatchInTransaction(transaction, {
    userId,
    batchSize: normalizedBatchSize,
  }));
};

export const reconcileExpiredSubscriptionsForUser = async (userId, client = prisma) => {
  if (!userId) {
    return [];
  }
  return expireSubscriptionBatch({ userId, batchSize: 100, client });
};

const notifySubscriptionExpiryReminderBatch = async ({ batchSize, afterId, client }) => {
  if (!client.subscription?.findMany) return [];

  const now = new Date();
  const reminderEnd = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const subscriptions = await client.subscription.findMany({
    where: {
      status: 'ACTIVE',
      endDate: { gt: now, lte: reminderEnd },
      ...(afterId ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: 'asc' },
    take: batchSize,
    select: { id: true, userId: true, endDate: true, plan: { select: { displayName: true } } },
  });

  await Promise.all(subscriptions.map((subscription) => createNotification({
    recipientUserId: subscription.userId,
    type: 'WARNING',
    category: 'SUBSCRIPTION',
    eventKey: `subscription:expiry-reminder:${subscription.id}:3d`,
    title: 'Subscription expires soon',
    message: `Your ${subscription.plan?.displayName ?? 'subscription'} expires in 3 days.`,
    link: '/seeker/payments',
    metadata: { endDate: subscription.endDate },
  }, client).catch(() => undefined)));

  return subscriptions;
};

export const notifySubscriptionExpiryReminders = async ({ batchSize = DEFAULT_BATCH_SIZE, client = prisma } = {}) => {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  let totalNotified = 0;
  let afterId;
  while (true) {
    const batch = await notifySubscriptionExpiryReminderBatch({ batchSize: normalizedBatchSize, afterId, client });
    totalNotified += batch.length;
    if (batch.length < normalizedBatchSize) return totalNotified;
    afterId = batch[batch.length - 1].id;
  }
};

export const expireSubscriptions = async ({ batchSize = DEFAULT_BATCH_SIZE, client = prisma } = {}) => {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  await notifySubscriptionExpiryReminders({ batchSize: normalizedBatchSize, client });
  let totalExpired = 0;

  while (true) {
    const expired = await expireSubscriptionBatch({ batchSize: normalizedBatchSize, client });
    totalExpired += expired.length;
    if (expired.length < normalizedBatchSize) {
      return totalExpired;
    }
  }
};
