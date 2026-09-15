import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const unsubscribeHash = (email) => crypto.createHash('sha256').update(`job-updates:${email}`).digest('hex');
const tokenFor = (subscriber) => `${Buffer.from(subscriber.id).toString('base64url')}.${subscriber.unsubscribeHash}`;
const safeEqual = (expected, received) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export class InvalidJobUpdateUnsubscribeError extends Error {
  constructor() { super('This unsubscribe link is invalid or has expired'); this.status = 400; }
}

export const subscribeToJobUpdates = async (email) => {
  const normalized = normalizeEmail(email);
  const existing = await prisma.publicJobSubscriber.findUnique({ where: { email: normalized } });
  const subscriber = existing
    ? await prisma.publicJobSubscriber.update({ where: { id: existing.id }, data: { isSubscribed: true, unsubscribedAt: null } })
    : await prisma.publicJobSubscriber.create({ data: { email: normalized, unsubscribeHash: unsubscribeHash(normalized) } });
  const unsubscribeUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/unsubscribe-job-updates?token=${encodeURIComponent(tokenFor(subscriber))}`;
  void queueEmail({
    publicSubscriberId: subscriber.id,
    emailType: EMAIL_TYPES.JOB_UPDATES_SUBSCRIBED,
    eventKey: `public-job-updates:subscribed:${subscriber.id}`,
    recipientEmail: subscriber.email,
    context: { title: 'You are subscribed to LeamJobs job updates', message: 'We will keep your inbox informed about relevant LeamJobs updates. You can unsubscribe at any time.', unsubscribeUrl, isMarketing: true },
  }).catch((error) => console.error('Job updates email queue failed:', { message: error.message }));
  return { message: existing?.isSubscribed ? 'This email is already subscribed to job updates.' : 'You are subscribed to LeamJobs job updates.' };
};

export const unsubscribeFromJobUpdates = async (token) => {
  const [encodedId, hash] = String(token ?? '').split('.');
  const id = encodedId ? Buffer.from(encodedId, 'base64url').toString('utf8') : '';
  const subscriber = id ? await prisma.publicJobSubscriber.findUnique({ where: { id } }) : null;
  if (!subscriber || !hash || !safeEqual(hash, subscriber.unsubscribeHash)) throw new InvalidJobUpdateUnsubscribeError();
  await prisma.publicJobSubscriber.update({ where: { id }, data: { isSubscribed: false, unsubscribedAt: new Date() } });
  return { message: 'Job update emails have been turned off.' };
};