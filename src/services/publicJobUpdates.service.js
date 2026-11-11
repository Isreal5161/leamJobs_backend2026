import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';
import { hashJobUpdatesToken, legacyJobUpdatesTokenHash } from '../utils/jobUpdatesTokens.js';

const CONFIRMATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const encodedId = (id) => Buffer.from(id).toString('base64url');
const tokenFor = (subscriberId, token) => `${encodedId(subscriberId)}.${token}`;
const hasUnexpiredPendingConfirmation = (subscriber) => {
  if (!subscriber || subscriber.isSubscribed || subscriber.unsubscribedAt || !subscriber.updatedAt) return false;
  const age = Date.now() - new Date(subscriber.updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= CONFIRMATION_EXPIRY_MS;
};
const safeEqual = (expected, received) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const subscriptionResponse = { message: 'If confirmation is needed, check the inbox for a message from LeamJobs.' };

export class InvalidJobUpdateUnsubscribeError extends Error {
  constructor() { super('This unsubscribe link is invalid or has expired'); this.status = 400; }
}

export class InvalidJobUpdateConfirmationError extends Error {
  constructor() { super('This confirmation link is invalid or has expired'); this.status = 400; }
}

export const subscribeToJobUpdates = async (email) => {
  const normalized = normalizeEmail(email);
  const existing = await prisma.publicJobSubscriber.findUnique({ where: { email: normalized } });
  if (existing?.isSubscribed) return subscriptionResponse;
  if (hasUnexpiredPendingConfirmation(existing)) return subscriptionResponse;

  const confirmationToken = crypto.randomBytes(32).toString('hex');
  const confirmationHash = hashJobUpdatesToken(confirmationToken);
  let subscriber;

  if (existing) {
    const updated = await prisma.publicJobSubscriber.updateMany({
      where: { id: existing.id, isSubscribed: false, updatedAt: existing.updatedAt },
      data: { unsubscribeHash: confirmationHash, unsubscribedAt: null },
    });
    if (updated.count === 0) return subscriptionResponse;
    subscriber = await prisma.publicJobSubscriber.findUnique({ where: { email: normalized } });
  } else {
    try {
      subscriber = await prisma.publicJobSubscriber.create({
        data: { email: normalized, unsubscribeHash: confirmationHash, isSubscribed: false },
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const current = await prisma.publicJobSubscriber.findUnique({ where: { email: normalized } });
      if (!current || hasUnexpiredPendingConfirmation(current) || current.isSubscribed) return subscriptionResponse;
      const updated = await prisma.publicJobSubscriber.updateMany({
        where: { email: normalized, isSubscribed: false, updatedAt: current.updatedAt },
        data: { unsubscribeHash: confirmationHash, unsubscribedAt: null },
      });
      if (updated.count === 0) return subscriptionResponse;
      subscriber = await prisma.publicJobSubscriber.findUnique({ where: { email: normalized } });
    }
  }

  if (!subscriber || subscriber.isSubscribed) return subscriptionResponse;

  const confirmationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/unsubscribe-job-updates?action=confirm&token=${encodeURIComponent(tokenFor(subscriber.id, confirmationToken))}`;
  void queueEmail({
    publicSubscriberId: subscriber.id,
    emailType: EMAIL_TYPES.JOB_UPDATES_SUBSCRIBED,
    eventKey: `public-job-updates:confirm:${subscriber.id}:${confirmationHash}`,
    recipientEmail: subscriber.email,
    context: {
      title: 'Confirm your LeamJobs job updates',
      message: 'Please confirm that you want to receive optional job update emails from LeamJobs. This link expires in 24 hours.',
      link: confirmationUrl,
      linkLabel: 'Confirm subscription',
      isMarketing: false,
    },
  }).catch((error) => console.error('Job updates confirmation email queue failed:', { message: error.message }));
  return subscriptionResponse;
};

export const confirmJobUpdatesSubscription = async (token) => {
  const [encodedSubscriberId, rawToken, ...extra] = String(token ?? '').split('.');
  let id = '';
  try {
    id = encodedSubscriberId ? Buffer.from(encodedSubscriberId, 'base64url').toString('utf8') : '';
  } catch {
    throw new InvalidJobUpdateConfirmationError();
  }
  if (!id || !rawToken || extra.length > 0) throw new InvalidJobUpdateConfirmationError();

  const subscriber = await prisma.publicJobSubscriber.findUnique({ where: { id } });
  const tokenHash = hashJobUpdatesToken(rawToken);
  const createdAt = subscriber?.updatedAt ? new Date(subscriber.updatedAt).getTime() : Number.NaN;
  if (
    !subscriber
    || subscriber.isSubscribed
    || !safeEqual(subscriber.unsubscribeHash, tokenHash)
    || !Number.isFinite(createdAt)
    || Date.now() - createdAt > CONFIRMATION_EXPIRY_MS
    || Date.now() < createdAt
  ) {
    throw new InvalidJobUpdateConfirmationError();
  }

  const unsubscribeToken = crypto.randomBytes(32).toString('hex');
  const updated = await prisma.publicJobSubscriber.updateMany({
    where: { id, isSubscribed: false, unsubscribeHash: tokenHash },
    data: {
      isSubscribed: true,
      subscribedAt: new Date(),
      unsubscribedAt: null,
      unsubscribeHash: hashJobUpdatesToken(unsubscribeToken),
    },
  });
  if (updated.count !== 1) throw new InvalidJobUpdateConfirmationError();

  return { message: 'Your email address is confirmed for LeamJobs job updates.' };
};

export const unsubscribeFromJobUpdates = async (token) => {
  const [encodedSubscriberId, receivedToken, ...extra] = String(token ?? '').split('.');
  let id = '';
  try {
    id = encodedSubscriberId ? Buffer.from(encodedSubscriberId, 'base64url').toString('utf8') : '';
  } catch {
    throw new InvalidJobUpdateUnsubscribeError();
  }
  const subscriber = id && extra.length === 0
    ? await prisma.publicJobSubscriber.findUnique({ where: { id } })
    : null;
  if (!subscriber || !receivedToken) throw new InvalidJobUpdateUnsubscribeError();

  // Links generated by the former email-derived scheme are invalidated; those tokens were predictable.
  const isPredictableLegacyToken = safeEqual(subscriber.unsubscribeHash, legacyJobUpdatesTokenHash(subscriber.email));
  if (isPredictableLegacyToken) throw new InvalidJobUpdateUnsubscribeError();

  const matchesHashedToken = safeEqual(subscriber.unsubscribeHash, hashJobUpdatesToken(receivedToken));
  const matchesRandomStoredToken = safeEqual(subscriber.unsubscribeHash, receivedToken);
  if (!matchesHashedToken && !matchesRandomStoredToken) throw new InvalidJobUpdateUnsubscribeError();

  if (!subscriber.isSubscribed) return { message: 'Job update emails have been turned off.' };

  const updated = await prisma.publicJobSubscriber.updateMany({
    where: { id, unsubscribeHash: subscriber.unsubscribeHash, isSubscribed: true },
    data: { isSubscribed: false, unsubscribedAt: new Date() },
  });
  if (updated.count !== 1) return { message: 'Job update emails have been turned off.' };
  return { message: 'Job update emails have been turned off.' };
};
