import { prisma } from '../config/database.js';
import { createMarketingUnsubscribeToken, EMAIL_TYPES, queueEmail } from './email.service.js';

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification not found');
    this.name = 'NotificationNotFoundError';
    this.status = 404;
  }
}

const notificationSelect = {
  id: true,
  recipientUserId: true,
  actorUserId: true,
  type: true,
  category: true,
  eventKey: true,
  title: true,
  message: true,
  link: true,
  metadata: true,
  isRead: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
  actor: { select: { id: true, firstName: true, lastName: true } },
};

const mapNotification = (notification) => ({
  id: notification.id,
  recipientUserId: notification.recipientUserId,
  actorUserId: notification.actorUserId,
  actor: notification.actor ? {
    id: notification.actor.id,
    firstName: notification.actor.firstName,
    lastName: notification.actor.lastName,
  } : null,
  type: notification.type,
  category: notification.category,
  eventKey: notification.eventKey,
  title: notification.title,
  message: notification.message,
  link: notification.link ?? null,
  metadata: notification.metadata ?? null,
  isRead: Boolean(notification.isRead),
  readAt: notification.readAt,
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
});

const normalizeNotificationInput = ({ recipientUserId, actorUserId, type, category, eventKey, title, message, link, metadata }) => ({
  recipientUserId,
  actorUserId: actorUserId ?? null,
  type: type ?? 'INFO',
  category: category ?? 'GENERAL',
  eventKey: String(eventKey ?? '').trim(),
  title: String(title ?? '').trim(),
  message: String(message ?? '').trim(),
  link: link ? String(link).trim() : null,
  metadata: metadata ?? null,
});

const emailTypeForNotification = (notification) => {
  const { eventKey, link } = notification;
  if (eventKey.startsWith('job:submitted:')) return EMAIL_TYPES.ADMIN_JOB_REVIEW_REQUIRED;
  if (eventKey.startsWith('job:approved:')) return link?.startsWith('/seeker/') ? EMAIL_TYPES.NEW_JOB_MATCH : EMAIL_TYPES.JOB_APPROVED;
  if (eventKey.startsWith('job:rejected:')) return EMAIL_TYPES.JOB_REJECTED;
  if (eventKey.startsWith('application:submitted:')) return EMAIL_TYPES.APPLICATION_SUBMITTED;
  if (eventKey.startsWith('application:status:') || eventKey.startsWith('application:accepted:') || eventKey.startsWith('application:selected:')) return EMAIL_TYPES.APPLICATION_STATUS_CHANGED;
  if (eventKey.startsWith('invitation:pending:')) return EMAIL_TYPES.JOB_INVITATION_RECEIVED;
  if (eventKey.startsWith('invitation:accepted:')) return EMAIL_TYPES.JOB_INVITATION_ACCEPTED;
  if (eventKey.startsWith('invitation:declined:')) return EMAIL_TYPES.JOB_INVITATION_DECLINED;
  if (eventKey.startsWith('message:new:')) return EMAIL_TYPES.NEW_MESSAGE;
  if (eventKey.startsWith('subscription:activated:')) return EMAIL_TYPES.SUBSCRIPTION_ACTIVATED;
  if (eventKey.startsWith('subscription:expiry-reminder:')) return EMAIL_TYPES.SUBSCRIPTION_EXPIRING;
  if (eventKey.startsWith('subscription:expired:')) return EMAIL_TYPES.SUBSCRIPTION_EXPIRED;
  if (eventKey.startsWith('subscription:payment-failed:')) return EMAIL_TYPES.SUBSCRIPTION_PAYMENT_FAILED;
  if (eventKey.startsWith('contract:active:')) return EMAIL_TYPES.CONTRACT_ACTIVE;
  if (eventKey.startsWith('contract:completion-submitted:')) return EMAIL_TYPES.CONTRACT_COMPLETION_SUBMITTED;
  if (eventKey.startsWith('escrow:release-eligible:')) return EMAIL_TYPES.CONTRACT_RELEASE_ELIGIBLE;
  if (eventKey.startsWith('contract:payment-failed:')) return EMAIL_TYPES.CONTRACT_FUNDING_FAILED;
  if (eventKey.startsWith('escrow:released:')) return EMAIL_TYPES.ESCROW_RELEASED;
  return null;
};

const queueNotificationEmail = async (notification, recipientEmail) => {
  const emailType = emailTypeForNotification(notification);
  if (!emailType) return;
  const recipient = prisma.user?.findUnique
    ? await prisma.user.findUnique({ where: { id: notification.recipientUserId }, select: { email: true, marketingEmailsEnabled: true } })
    : recipientEmail ? { email: recipientEmail, marketingEmailsEnabled: true } : null;
  if (!recipient?.email) return;
  if (emailType === EMAIL_TYPES.NEW_JOB_MATCH && !recipient.marketingEmailsEnabled) return;
  await queueEmail({
    recipientUserId: notification.recipientUserId,
    notificationId: notification.id,
    emailType,
    eventKey: notification.eventKey,
    recipientEmail: recipient.email,
    context: {
      title: notification.title,
      message: notification.message,
      link: notification.link,
      ...(emailType === EMAIL_TYPES.NEW_JOB_MATCH ? { isMarketing: true, unsubscribeUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/unsubscribe-marketing?token=${encodeURIComponent(createMarketingUnsubscribeToken(notification.recipientUserId))}` } : {}),
    },
  });
};

export const createNotification = async (input, client = prisma) => {
  const { recipientEmail } = input;
  const payload = normalizeNotificationInput(input);

  if (!payload.recipientUserId || !payload.eventKey || !payload.title || !payload.message) {
    const error = new Error('recipientUserId, eventKey, title, and message are required');
    error.status = 400;
    throw error;
  }

  const existing = await client.notification.findFirst({
    where: { recipientUserId: payload.recipientUserId, eventKey: payload.eventKey },
    select: { id: true },
  });

  if (existing) {
    return client.notification.findUnique({
      where: { id: existing.id },
      select: notificationSelect,
    }).then((notification) => mapNotification(notification));
  }

  try {
    const created = await client.notification.create({
      data: payload,
      select: notificationSelect,
    });

    const mapped = mapNotification(created);
    setImmediate(() => {
      void queueNotificationEmail(mapped, recipientEmail).catch((error) => console.error('Email notification queue failed:', { message: error.message }));
    });
    return mapped;
  } catch (error) {
    if (error?.code !== 'P2002') throw error;

    const duplicate = await client.notification.findUnique({
      where: {
        recipientUserId_eventKey: {
          recipientUserId: payload.recipientUserId,
          eventKey: payload.eventKey,
        },
      },
      select: notificationSelect,
    });
    if (!duplicate) throw error;
    return mapNotification(duplicate);
  }
};

export const listNotificationsForUser = async (userId, { limit = 20, cursor } = {}, client = prisma) => {
  const query = {
    where: { recipientUserId: userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: notificationSelect,
  };

  const rows = await client.notification.findMany(query);
  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  const unreadCount = await client.notification.count({ where: { recipientUserId: userId, isRead: false } });

  return {
    notifications: page.map(mapNotification),
    unreadCount,
    nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
  };
};

export const getNotificationForUser = async (userId, notificationId, client = prisma) => {
  const row = await client.notification.findFirst({
    where: { id: notificationId, recipientUserId: userId },
    select: notificationSelect,
  });

  if (!row) throw new NotificationNotFoundError();
  return mapNotification(row);
};

export const markNotificationRead = async (userId, notificationId, client = prisma) => {
  const current = await client.notification.findFirst({
    where: { id: notificationId, recipientUserId: userId },
    select: { id: true, isRead: true },
  });

  if (!current) throw new NotificationNotFoundError();

  const updated = await client.notification.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
    select: notificationSelect,
  });

  return { notification: mapNotification(updated) };
};

export const markAllNotificationsRead = async (userId, client = prisma) => {
  const result = await client.notification.updateMany({
    where: { recipientUserId: userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return { count: result.count };
};
