import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { createMarketingUnsubscribeToken, EMAIL_TYPES, isValidEmail, normalizeEmail, queueEmail } from './email.service.js';
import { renderEmailTemplate } from './email.templates.js';

const defaults = {
  WELCOME_SEEKER: { name: 'Welcome - Seeker', subject: 'Welcome to LeamJobs', heading: 'Your next opportunity starts here', body: 'Your LeamJobs account is ready. Complete your profile to discover roles that fit your skills.', ctaLabel: 'Complete your profile', ctaUrl: '/seeker/profile' },
  WELCOME_EMPLOYER: { name: 'Welcome - Employer', subject: 'Welcome to LeamJobs for employers', heading: 'Build your next great team', body: 'Your employer account is ready. Create your company profile and publish your first role.', ctaLabel: 'Open hiring workspace', ctaUrl: '/employer/jobs' },
};
const campaignPurposes = ['ESSENTIAL_ANNOUNCEMENT', 'PROMOTIONAL_MARKETING'];
const registeredRoles = ['SEEKER', 'EMPLOYER'];

const templateSelect = { id: true, key: true, name: true, kind: true, subject: true, heading: true, body: true, ctaLabel: true, ctaUrl: true, isActive: true, updatedAt: true };
const campaignSelect = { id: true, eventKey: true, subject: true, heading: true, body: true, ctaLabel: true, ctaUrl: true, segment: true, purpose: true, operationalContentConfirmed: true, status: true, recipientCount: true, createdById: true, sentAt: true, createdAt: true, updatedAt: true };
const deliveryReportSelect = { id: true, recipientEmail: true, status: true, attempts: true, createdAt: true, sentAt: true, lastError: true, suppressionReason: true };
const CAMPAIGN_RECIPIENT_BATCH_SIZE = 100;
const CAMPAIGN_RECOVERY_ATTEMPTS = 3;
const normalizeFields = (input) => ({
  subject: String(input.subject ?? '').trim(),
  heading: String(input.heading ?? '').trim(),
  body: String(input.body ?? '').trim(),
  ctaLabel: input.ctaLabel ? String(input.ctaLabel).trim() : null,
  ctaUrl: input.ctaUrl ? String(input.ctaUrl).trim() : null,
});
const assertFields = (fields) => {
  if (!fields.subject || !fields.heading || !fields.body) throw Object.assign(new Error('Subject, heading, and body are required'), { status: 400 });
  if (fields.ctaLabel && !fields.ctaUrl) throw Object.assign(new Error('CTA URL is required when CTA text is provided'), { status: 400 });
  if (fields.ctaUrl && !/^\/(?!\/)/.test(fields.ctaUrl) && !/^https:\/\//.test(fields.ctaUrl)) throw Object.assign(new Error('CTA URL must be a trusted path or HTTPS URL'), { status: 400 });
};
export const publicUrl = (path) => {
  if (!path) return path;
  const value = String(path).trim();
  if (/^https?:\/\//i.test(value)) return value;
  const baseUrl = env.FRONTEND_URL || env.FRONTEND_URL_PROD || '';
  if (!baseUrl) throw Object.assign(new Error('FRONTEND_URL must be configured to build relative URLs'), { status: 500 });
  return `${baseUrl.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
};

export const getOrCreateSystemTemplate = async (key, client = prisma) => {
  const existing = await client.emailTemplate.findUnique({ where: { key }, select: templateSelect });
  if (existing) return existing;
  const fallback = defaults[key];
  if (!fallback) throw Object.assign(new Error('Unknown email template'), { status: 404 });
  try {
    return await client.emailTemplate.create({ data: { key, kind: key, ...fallback }, select: templateSelect });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return client.emailTemplate.findUnique({ where: { key }, select: templateSelect });
  }
};

export const listSystemTemplates = async () => Promise.all(Object.keys(defaults).map((key) => getOrCreateSystemTemplate(key)));

export const updateSystemTemplate = async (key, adminId, input) => {
  const fields = normalizeFields(input);
  assertFields(fields);
  await getOrCreateSystemTemplate(key);
  return prisma.emailTemplate.update({ where: { key }, data: { ...fields, isActive: input.isActive ?? true, updatedById: adminId }, select: templateSelect });
};

export const previewSystemTemplate = async (key, input = {}) => {
  const template = await getOrCreateSystemTemplate(key);
  const fields = { ...template, ...normalizeFields(input) };
  assertFields(fields);
  return renderEmailTemplate(key, { title: fields.subject, heading: fields.heading, message: fields.body, link: fields.ctaUrl ? publicUrl(fields.ctaUrl) : null, linkLabel: fields.ctaLabel });
};

export const queueWelcomeEmail = async (user) => {
  const key = user.role === 'EMPLOYER' ? 'WELCOME_EMPLOYER' : 'WELCOME_SEEKER';
  const template = await getOrCreateSystemTemplate(key);
  if (!template.isActive) return null;
  return queueEmail({
    recipientUserId: user.id,
    emailType: EMAIL_TYPES[key],
    eventKey: `welcome:${key}:${user.id}`,
    recipientEmail: user.email,
    context: { title: template.subject, heading: template.heading, message: template.body, link: template.ctaUrl ? publicUrl(template.ctaUrl) : null, linkLabel: template.ctaLabel },
  });
};

const assertPurposeSegment = (purpose, segment) => {
  const compatible = purpose === 'ESSENTIAL_ANNOUNCEMENT'
    ? ['ALL_REGISTERED_USERS', 'SEEKERS', 'EMPLOYERS']
    : purpose === 'PROMOTIONAL_MARKETING'
      ? ['ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS']
      : [];
  if (!campaignPurposes.includes(purpose) || !compatible.includes(segment)) {
    throw Object.assign(new Error('Recipient segment is not valid for this communication purpose'), { status: 400 });
  }
};

const uniqueValidRecipients = (recipients, seen = new Set()) => {
  return recipients.filter((recipient) => {
    const email = normalizeEmail(recipient.email);
    if (!isValidEmail(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  }).map((recipient) => ({ ...recipient, email: normalizeEmail(recipient.email) }));
};

export async function* getEligibleCampaignRecipientBatches(purpose, segment, client = prisma) {
  assertPurposeSegment(purpose, segment);
  const seen = new Set();
  const isPublicSubscriberSegment = segment === 'PUBLIC_JOB_SUBSCRIBERS';
  const role = segment === 'SEEKERS' ? 'SEEKER' : segment === 'EMPLOYERS' ? 'EMPLOYER' : undefined;
  const where = isPublicSubscriberSegment
    ? { isSubscribed: true, email: { not: '' } }
    : {
      isActive: true,
      anonymizedAt: null,
      role: role ?? { in: registeredRoles },
      email: { not: '' },
      ...(purpose === 'PROMOTIONAL_MARKETING' ? { marketingEmailsEnabled: true } : {}),
    };
  const select = isPublicSubscriberSegment
    ? { id: true, email: true, unsubscribeHash: true }
    : { id: true, email: true };
  const source = isPublicSubscriberSegment ? client.publicJobSubscriber : client.user;
  let afterId;

  while (true) {
    const recipients = await source.findMany({
      where: { ...where, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: 'asc' },
      take: CAMPAIGN_RECIPIENT_BATCH_SIZE,
      select,
    });
    if (recipients.length === 0) return;

    const uniqueRecipients = uniqueValidRecipients(recipients, seen);
    if (uniqueRecipients.length > 0) yield uniqueRecipients;
    if (recipients.length < CAMPAIGN_RECIPIENT_BATCH_SIZE) return;
    afterId = recipients[recipients.length - 1].id;
  }
}

export const getEligibleCampaignRecipients = async (purpose, segment, client = prisma) => {
  const recipients = [];
  for await (const batch of getEligibleCampaignRecipientBatches(purpose, segment, client)) {
    recipients.push(...batch);
  }
  return recipients;
};

export const countEligibleCampaignRecipients = async (purpose, segment, client = prisma) => {
  let count = 0;
  for await (const batch of getEligibleCampaignRecipientBatches(purpose, segment, client)) {
    count += batch.length;
  }
  return count;
};

const restoreCampaignDraftAfterFailure = async (campaignId) => {
  let lastError;
  for (let attempt = 1; attempt <= CAMPAIGN_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      const restored = await prisma.emailCampaign.updateMany({
        where: { id: campaignId, status: 'SENDING' },
        data: { status: 'DRAFT' },
      });
      if (restored.count === 1) return;
      throw new Error('Campaign was no longer in SENDING state during failure recovery');
    } catch (error) {
      lastError = error;
      if (attempt < CAMPAIGN_RECOVERY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  }

  throw lastError;
};

export const createPromotionalCampaign = async (adminId, input) => {
  const fields = normalizeFields(input);
  assertFields(fields);
  assertPurposeSegment(input.purpose, input.segment);
  const operationalContentConfirmed = input.operationalContentConfirmed === true;
  if (input.purpose === 'ESSENTIAL_ANNOUNCEMENT' && !operationalContentConfirmed) {
    throw Object.assign(new Error('Confirm that this announcement contains only essential operational information'), { status: 400 });
  }
  if (input.purpose === 'PROMOTIONAL_MARKETING' && operationalContentConfirmed) {
    throw Object.assign(new Error('Operational-content confirmation is only valid for essential announcements'), { status: 400 });
  }
  const campaign = await prisma.emailCampaign.create({
    data: {
      ...fields,
      segment: input.segment,
      purpose: input.purpose,
      operationalContentConfirmed,
      eventKey: `campaign:${crypto.randomUUID()}`,
      createdById: adminId,
    },
    select: campaignSelect,
  });
  return campaign;
};

export const updatePromotionalCampaign = async (campaignId, input) => {
  const current = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!current) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (current.status !== 'DRAFT') throw Object.assign(new Error('This campaign is no longer editable'), { status: 409 });
  const fields = normalizeFields({ ...current, ...input });
  assertFields(fields);
  const segment = input.segment ?? current.segment;
  const purpose = current.purpose ?? 'PROMOTIONAL_MARKETING';
  if (input.purpose !== undefined && input.purpose !== purpose) {
    throw Object.assign(new Error('Communication purpose cannot be changed after a draft is created'), { status: 409 });
  }
  assertPurposeSegment(purpose, segment);
  const operationalContentConfirmed = input.operationalContentConfirmed ?? current.operationalContentConfirmed ?? false;
  const operationalContentChanged = ['subject', 'heading', 'body', 'ctaLabel', 'ctaUrl'].some((field) => (
    input[field] !== undefined
    && String(input[field] ?? '').trim() !== String(current[field] ?? '').trim()
  ));
  if (purpose === 'ESSENTIAL_ANNOUNCEMENT'
    && (operationalContentConfirmed !== true || (operationalContentChanged && input.operationalContentConfirmed !== true))) {
    throw Object.assign(new Error('Confirm that this announcement contains only essential operational information'), { status: 400 });
  }
  if (purpose === 'PROMOTIONAL_MARKETING' && operationalContentConfirmed) {
    throw Object.assign(new Error('Operational-content confirmation is only valid for essential announcements'), { status: 400 });
  }
  return prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { ...fields, segment, operationalContentConfirmed },
    select: campaignSelect,
  });
};

export const previewPromotionalCampaign = async (campaignId) => {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const purpose = campaign.purpose ?? 'PROMOTIONAL_MARKETING';
  assertPurposeSegment(purpose, campaign.segment);
  if (purpose === 'ESSENTIAL_ANNOUNCEMENT' && campaign.operationalContentConfirmed !== true) {
    throw Object.assign(new Error('Essential announcement confirmation is required'), { status: 409 });
  }
  const recipientCount = await countEligibleCampaignRecipients(purpose, campaign.segment);
  const isMarketing = purpose === 'PROMOTIONAL_MARKETING';
  const unsubscribeUrl = isMarketing ? publicUrl('/unsubscribe-marketing?token=example') : null;
  const emailType = isMarketing ? EMAIL_TYPES.PROMOTIONAL_CAMPAIGN : EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT;
  return { campaign, recipientCount, ...renderEmailTemplate(emailType, { title: campaign.subject, heading: campaign.heading, message: campaign.body, link: campaign.ctaUrl ? publicUrl(campaign.ctaUrl) : null, linkLabel: campaign.ctaLabel, isMarketing, unsubscribeUrl }) };
};

export const sendCommunicationCampaign = async (campaignId) => {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (campaign.status !== 'DRAFT') throw Object.assign(new Error('This campaign has already been sent or is being processed'), { status: 409 });
  const purpose = campaign.purpose ?? 'PROMOTIONAL_MARKETING';
  assertPurposeSegment(purpose, campaign.segment);
  if (purpose === 'ESSENTIAL_ANNOUNCEMENT' && campaign.operationalContentConfirmed !== true) {
    throw Object.assign(new Error('Essential announcement confirmation is required'), { status: 409 });
  }
  const recipientBatches = getEligibleCampaignRecipientBatches(purpose, campaign.segment);
  const firstBatch = await recipientBatches.next();
  if (firstBatch.done) throw Object.assign(new Error('This campaign has no eligible recipients'), { status: 409 });
  const claimed = await prisma.emailCampaign.updateMany({ where: { id: campaign.id, status: 'DRAFT' }, data: { status: 'SENDING', recipientCount: firstBatch.value.length } });
  if (claimed.count !== 1) throw Object.assign(new Error('This campaign has already been sent or is being processed'), { status: 409 });
  const isMarketing = purpose === 'PROMOTIONAL_MARKETING';
  const emailType = isMarketing ? EMAIL_TYPES.PROMOTIONAL_CAMPAIGN : EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT;
  const unsubscribeUrl = (userId) => publicUrl(`/unsubscribe-marketing?token=${encodeURIComponent(createMarketingUnsubscribeToken(userId))}`);
  try {
    let recipients = firstBatch.value;
    let queuedCount = 0;
    while (true) {
      const queued = await Promise.allSettled(recipients.map((recipient) => queueEmail({
        ...(campaign.segment !== 'PUBLIC_JOB_SUBSCRIBERS' ? { recipientUserId: recipient.id } : {}),
        ...(campaign.segment === 'PUBLIC_JOB_SUBSCRIBERS' ? { publicSubscriberId: recipient.id } : {}),
        emailType,
        communicationPurpose: purpose,
        eventKey: `${campaign.eventKey}:${recipient.id}`,
        recipientEmail: recipient.email,
        context: {
          title: campaign.subject,
          heading: campaign.heading,
          message: campaign.body,
          link: campaign.ctaUrl ? publicUrl(campaign.ctaUrl) : null,
          linkLabel: campaign.ctaLabel,
          isMarketing,
          ...(isMarketing ? {
            unsubscribeUrl: campaign.segment === 'PUBLIC_JOB_SUBSCRIBERS'
              ? publicUrl(`/unsubscribe-job-updates?token=${encodeURIComponent(`${Buffer.from(recipient.id).toString('base64url')}.${recipient.unsubscribeHash}`)}`)
              : unsubscribeUrl(recipient.id),
          } : {}),
        },
      })));
      const failedQueue = queued.find((result) => result.status === 'rejected');
      if (failedQueue) throw failedQueue.reason;
      queuedCount += recipients.length;
      await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { recipientCount: queuedCount } });
      const nextBatch = await recipientBatches.next();
      if (nextBatch.done) break;
      recipients = nextBatch.value;
    }
    return prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: { status: 'SENT', sentAt: new Date() },
      select: campaignSelect,
    });
  } catch (error) {
    try {
      await restoreCampaignDraftAfterFailure(campaign.id);
    } catch (recoveryError) {
      console.error('Campaign failed and draft recovery did not complete:', {
        campaignId: campaign.id,
        errorName: typeof recoveryError?.name === 'string' ? recoveryError.name : 'Error',
        ...(typeof recoveryError?.code === 'string' ? { errorCode: recoveryError.code } : {}),
      });
      throw new AggregateError(
        [error, recoveryError],
        'Campaign failed and could not be returned to draft.',
        { cause: error },
      );
    }
    throw error;
  }
};

const campaignDeliveryWhere = (eventKey) => ({
  emailType: { in: [EMAIL_TYPES.PROMOTIONAL_CAMPAIGN, EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT] },
  eventKey: { startsWith: `${eventKey}:` },
});

const deriveReportingStatus = (campaign, counts) => {
  if (campaign.status === 'DRAFT') return 'DRAFT';
  if (counts.pending > 0 || counts.processing > 0) return 'IN_PROGRESS';
  const expected = campaign.recipientCount ?? counts.total;
  if (counts.total < expected) return 'IN_PROGRESS';
  if (counts.failed > 0 && counts.sent > 0) return 'PARTIALLY_FAILED';
  if (counts.failed > 0 && counts.sent === 0) return 'FAILED';
  if (counts.suppressed > 0 && counts.sent === 0) return 'SUPPRESSED';
  if (counts.suppressed > 0) return 'PARTIALLY_FAILED';
  if (counts.sent > 0 && counts.sent === expected) return 'SENT';
  return 'IN_PROGRESS';
};

const countsFromGroupedDeliveries = (deliveries) => {
  const counts = deliveries.reduce((summary, delivery) => {
    const count = delivery._count._all;
    summary.total += count;
    summary[delivery.status.toLowerCase()] += count;
    return summary;
  }, { total: 0, sent: 0, pending: 0, processing: 0, failed: 0, suppressed: 0 });
  return counts;
};

const countCampaignDeliveries = async (campaign) => {
  const deliveries = await prisma.emailDelivery.groupBy({
    by: ['status'],
    where: campaignDeliveryWhere(campaign.eventKey),
    _count: { _all: true },
  });
  const counts = countsFromGroupedDeliveries(deliveries);
  return { ...counts, recipientCount: campaign.recipientCount ?? counts.total, reportingStatus: deriveReportingStatus(campaign, counts) };
};

export const listCampaignRecords = async ({ page = 1, limit = 20 } = {}) => {
  const [total, campaigns] = await Promise.all([
    prisma.emailCampaign.count(),
    prisma.emailCampaign.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: campaignSelect }),
  ]);
  const deliveries = campaigns.length === 0 ? [] : await prisma.emailDelivery.groupBy({
    by: ['eventKey', 'status'],
    where: {
      emailType: { in: [EMAIL_TYPES.PROMOTIONAL_CAMPAIGN, EMAIL_TYPES.ESSENTIAL_ANNOUNCEMENT] },
      OR: campaigns.map((campaign) => ({ eventKey: { startsWith: `${campaign.eventKey}:` } })),
    },
    _count: { _all: true },
  });
  const records = campaigns.map((campaign) => {
    const campaignDeliveries = deliveries.filter((delivery) => delivery.eventKey.startsWith(`${campaign.eventKey}:`));
    const counts = countsFromGroupedDeliveries(campaignDeliveries);
    return { campaign, delivery: { ...counts, recipientCount: campaign.recipientCount ?? counts.total, reportingStatus: deriveReportingStatus(campaign, counts) } };
  });
  return { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const findCampaign = async (campaignId) => {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  return campaign;
};

export const getCampaignReport = async (campaignId) => {
  const campaign = await findCampaign(campaignId);
  return { campaign, delivery: await countCampaignDeliveries(campaign) };
};

export const getCampaignDeliveries = async (campaignId, { page = 1, limit = 50 } = {}) => {
  const campaign = await findCampaign(campaignId);
  const where = campaignDeliveryWhere(campaign.eventKey);
  const [deliveries, total] = await Promise.all([
    prisma.emailDelivery.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, select: deliveryReportSelect }),
    prisma.emailDelivery.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { campaignId: campaign.id, deliveries, pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 } };
};
