import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { renderEmailTemplate } from './email.templates.js';

export const EMAIL_TYPES = Object.freeze({
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  EMAIL_VERIFICATION_CODE: 'EMAIL_VERIFICATION_CODE',
  ADMIN_STAFF_INVITATION: 'ADMIN_STAFF_INVITATION',
  JOB_APPROVED: 'JOB_APPROVED',
  JOB_REJECTED: 'JOB_REJECTED',
  EMPLOYER_VERIFICATION_APPROVED: 'EMPLOYER_VERIFICATION_APPROVED',
  EMPLOYER_VERIFICATION_DECLINED: 'EMPLOYER_VERIFICATION_DECLINED',
  NEW_JOB_MATCH: 'NEW_JOB_MATCH',
  ADMIN_JOB_REVIEW_REQUIRED: 'ADMIN_JOB_REVIEW_REQUIRED',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_STATUS_CHANGED: 'APPLICATION_STATUS_CHANGED',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  INTERVIEW_RESCHEDULED: 'INTERVIEW_RESCHEDULED',
  INTERVIEW_UPDATED: 'INTERVIEW_UPDATED',
  INTERVIEW_CANCELLED: 'INTERVIEW_CANCELLED',
  JOB_INVITATION_RECEIVED: 'JOB_INVITATION_RECEIVED',
  JOB_INVITATION_ACCEPTED: 'JOB_INVITATION_ACCEPTED',
  JOB_INVITATION_DECLINED: 'JOB_INVITATION_DECLINED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_EXPIRING: 'SUBSCRIPTION_EXPIRING',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_PAYMENT_FAILED: 'SUBSCRIPTION_PAYMENT_FAILED',
  CONTRACT_ACTIVE: 'CONTRACT_ACTIVE',
  CONTRACT_COMPLETION_SUBMITTED: 'CONTRACT_COMPLETION_SUBMITTED',
  CONTRACT_RELEASE_ELIGIBLE: 'CONTRACT_RELEASE_ELIGIBLE',
  CONTRACT_FUNDING_FAILED: 'CONTRACT_FUNDING_FAILED',
  ESCROW_RELEASED: 'ESCROW_RELEASED',
  JOB_UPDATES_SUBSCRIBED: 'JOB_UPDATES_SUBSCRIBED',
  JOB_ALERT_MATCH: 'JOB_ALERT_MATCH',
  WELCOME_SEEKER: 'WELCOME_SEEKER',
  WELCOME_EMPLOYER: 'WELCOME_EMPLOYER',
  PROMOTIONAL_CAMPAIGN: 'PROMOTIONAL_CAMPAIGN',
  ESSENTIAL_ANNOUNCEMENT: 'ESSENTIAL_ANNOUNCEMENT',
});

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const safeHeader = (value) => String(value ?? '').replace(/[\r\n]/g, ' ').trim();
const retryDelay = (attempts) => Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.max(0, attempts - 1)));
const MAX_EMAIL_ATTEMPTS = 8;

let transport;
const getTransport = () => {
  if (!env.EMAIL_ENABLED || !env.EMAIL_HOST || !env.EMAIL_USER || !env.EMAIL_PASSWORD) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD },
    });
  }
  return transport;
};

const deliveryData = ({ recipientUserId, notificationId, emailType, communicationPurpose, eventKey, recipientEmail, subject, html, text }) => ({
  recipientUserId,
  notificationId: notificationId ?? null,
  emailType,
  communicationPurpose: communicationPurpose ?? null,
  eventKey,
  recipientEmail,
  subject,
  html,
  text,
});

export const isEmailEnabled = () => Boolean(getTransport());

export class StaffInvitationEmailDeliveryError extends Error {
  constructor() {
    super('Staff invitation was created, but its email could not be delivered. Resend the invitation to try again.');
    this.name = 'StaffInvitationEmailDeliveryError';
    this.status = 503;
    this.publicMessage = this.message;
  }
}

export const sendAdminInvitationEmail = async ({ recipientEmail, link, invitationId }) => {
  const mailer = getTransport();
  if (!mailer) throw new StaffInvitationEmailDeliveryError();

  const template = renderEmailTemplate(EMAIL_TYPES.ADMIN_STAFF_INVITATION, {
    title: 'You are invited to LeamJobs Admin',
    heading: 'Staff administrator invitation',
    message: 'A LeamJobs Super Admin invited you to activate a staff administrator account. This link expires in 48 hours and can be used once.',
    link,
    linkLabel: 'Accept invitation',
  });

  try {
    await mailer.sendMail({
      from: env.EMAIL_FROM_NAME ? `"${safeHeader(env.EMAIL_FROM_NAME)}" <${env.EMAIL_FROM}>` : env.EMAIL_FROM,
      to: normalizeEmail(recipientEmail),
      replyTo: env.EMAIL_REPLY_TO || undefined,
      subject: safeHeader(template.subject),
      html: template.html,
      text: template.text,
      messageId: `<${crypto.createHash('sha256').update(`admin-invitation:${invitationId}`).digest('hex')}@leamjobs.com>`,
      headers: { 'X-LeamJobs-Email-Type': EMAIL_TYPES.ADMIN_STAFF_INVITATION },
    });
  } catch {
    throw new StaffInvitationEmailDeliveryError();
  }
};

export const queueEmail = async ({ recipientUserId = null, publicSubscriberId = null, notificationId, emailType, communicationPurpose, eventKey, recipientEmail, context, client = prisma }) => {
  const email = normalizeEmail(recipientEmail);
  if ((!recipientUserId && !publicSubscriberId) || (recipientUserId && publicSubscriberId) || !email || !isValidEmail(email)) throw new Error('A valid email recipient is required');
  const template = renderEmailTemplate(emailType, context);
  const data = { ...deliveryData({ recipientUserId, notificationId, emailType, communicationPurpose, eventKey, recipientEmail: email, ...template }), publicSubscriberId };

  try {
    return await client.emailDelivery.create({
      data,
      select: { id: true, status: true, attempts: true, recipientUserId: true, emailType: true, eventKey: true },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return client.emailDelivery.findUnique({
      where: recipientUserId
        ? { recipientUserId_emailType_eventKey: { recipientUserId, emailType, eventKey } }
        : { publicSubscriberId_emailType_eventKey: { publicSubscriberId, emailType, eventKey } },
      select: { id: true, status: true, attempts: true, recipientUserId: true, emailType: true, eventKey: true },
    });
  }
};

export const sendEmailDelivery = async (delivery, client = prisma) => {
  const mailer = getTransport();
  if (!mailer) return { skipped: true, reason: 'EMAIL_DISABLED' };

  const attempts = delivery.attempts + 1;
  await client.emailDelivery.update({ where: { id: delivery.id }, data: { status: 'PROCESSING', attempts } });
  try {
    await mailer.sendMail({
      from: env.EMAIL_FROM_NAME ? `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>` : env.EMAIL_FROM,
      to: delivery.recipientEmail,
      replyTo: env.EMAIL_REPLY_TO || undefined,
      subject: safeHeader(delivery.subject),
      html: delivery.html,
      text: delivery.text,
      messageId: `<${crypto.createHash('sha256').update(`${delivery.recipientUserId ?? delivery.publicSubscriberId}:${delivery.emailType}:${delivery.eventKey}`).digest('hex')}@leamjobs.com>`,
      headers: { 'X-LeamJobs-Email-Type': delivery.emailType },
    });
    return client.emailDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
  } catch (error) {
    console.error('Email delivery failed:', { emailType: delivery.emailType, deliveryId: delivery.id, message: error.message });
    return client.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', lastError: String(error.message).slice(0, 500), nextAttemptAt: new Date(Date.now() + retryDelay(attempts)) },
    });
  }
};

const suppressDelivery = (delivery, reason, client) => client.emailDelivery.update({
  where: { id: delivery.id },
  data: { status: 'SUPPRESSED', suppressionReason: reason, lastError: null },
});

const recheckCampaignDelivery = async (delivery, client) => {
  const isEssential = delivery.emailType === EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT
    && delivery.communicationPurpose === 'ESSENTIAL_ANNOUNCEMENT';
  const isPromotional = delivery.emailType === EMAIL_TYPES.PROMOTIONAL_CAMPAIGN
    && [null, undefined, 'PROMOTIONAL_MARKETING'].includes(delivery.communicationPurpose);
  if (!isEssential && !isPromotional) {
    return 'Communication purpose does not match the queued message type';
  }

  if (delivery.publicSubscriberId) {
    if (!isPromotional) return 'Public subscribers are only eligible for promotional updates';
    const subscriber = await client.publicJobSubscriber.findUnique({
      where: { id: delivery.publicSubscriberId },
      select: { email: true, isSubscribed: true },
    });
    if (!subscriber?.isSubscribed) return 'Public subscriber is no longer subscribed';
    if (!isValidEmail(normalizeEmail(subscriber.email))) return 'Subscriber email address is no longer valid';
    if (normalizeEmail(subscriber.email) !== normalizeEmail(delivery.recipientEmail)) return 'Subscriber email address changed after queueing';
    return null;
  }

  if (!delivery.recipientUserId) return 'Registered recipient is unavailable';
  const user = await client.user.findUnique({
    where: { id: delivery.recipientUserId },
    select: { email: true, role: true, isActive: true, anonymizedAt: true, marketingEmailsEnabled: true },
  });
  if (!user || !user.isActive || user.anonymizedAt || !['SEEKER', 'EMPLOYER'].includes(user.role)) {
    return 'Recipient account is no longer eligible';
  }
  const currentEmail = normalizeEmail(user.email);
  if (!isValidEmail(currentEmail)) return 'Recipient email address is no longer valid';
  if (currentEmail !== normalizeEmail(delivery.recipientEmail)) return 'Recipient email address changed after queueing';
  if (isPromotional && !user.marketingEmailsEnabled) return 'Recipient opted out of marketing emails';
  return null;
};

export const processPendingEmails = async ({ batchSize = 50, client = prisma } = {}) => {
  if (!isEmailEnabled()) return 0;
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const deliveries = await client.emailDelivery.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_EMAIL_ATTEMPTS }, nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', updatedAt: { lt: staleProcessingBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(Number(batchSize) || 50, 1), 200),
    include: { publicSubscriber: { select: { isSubscribed: true } } },
  });
  let sent = 0;
  for (const delivery of deliveries) {
    const claimed = await client.emailDelivery.updateMany({
      where: { id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) continue;
    if (delivery.attempts >= MAX_EMAIL_ATTEMPTS) {
      await client.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: 'Maximum delivery attempts reached before the worker recovered.',
          nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      continue;
    }
    if ([EMAIL_TYPES.PROMOTIONAL_CAMPAIGN, EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT].includes(delivery.emailType)) {
      const suppressionReason = await recheckCampaignDelivery(delivery, client);
      if (suppressionReason) {
        await suppressDelivery(delivery, suppressionReason, client);
        continue;
      }
    } else if (delivery.publicSubscriberId && delivery.publicSubscriber && !delivery.publicSubscriber.isSubscribed) {
      await suppressDelivery(delivery, 'Public subscriber is no longer subscribed', client);
      continue;
    }
    const result = await sendEmailDelivery({ ...delivery, attempts: delivery.attempts }, client);
    if (result.status === 'SENT') sent += 1;
  }
  return sent;
};

export const createUnsubscribeToken = ({ userId, secret = env.JWT_SECRET }) => crypto.createHmac('sha256', secret).update(`marketing:${userId}`).digest('hex');
export const createMarketingUnsubscribeToken = (userId) => `${Buffer.from(userId).toString('base64url')}.${createUnsubscribeToken({ userId })}`;
export const verifyUnsubscribeToken = (userId, token) => {
  const expected = Buffer.from(createUnsubscribeToken({ userId }));
  const received = Buffer.from(String(token ?? ''));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};
