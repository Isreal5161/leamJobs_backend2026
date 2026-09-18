import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { createMarketingUnsubscribeToken, EMAIL_TYPES, queueEmail } from './email.service.js';
import { renderEmailTemplate } from './email.templates.js';

const defaults = {
  WELCOME_SEEKER: { name: 'Welcome - Seeker', subject: 'Welcome to LeamJobs', heading: 'Your next opportunity starts here', body: 'Your LeamJobs account is ready. Complete your profile to discover roles that fit your skills.', ctaLabel: 'Complete your profile', ctaUrl: '/seeker/profile' },
  WELCOME_EMPLOYER: { name: 'Welcome - Employer', subject: 'Welcome to LeamJobs for employers', heading: 'Build your next great team', body: 'Your employer account is ready. Create your company profile and publish your first role.', ctaLabel: 'Open hiring workspace', ctaUrl: '/employer/jobs' },
};
const campaignSegments = ['ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS'];

const templateSelect = { id: true, key: true, name: true, kind: true, subject: true, heading: true, body: true, ctaLabel: true, ctaUrl: true, isActive: true, updatedAt: true };
const campaignSelect = { id: true, eventKey: true, subject: true, heading: true, body: true, ctaLabel: true, ctaUrl: true, segment: true, status: true, recipientCount: true, createdById: true, sentAt: true, createdAt: true, updatedAt: true };
const deliveryReportSelect = { id: true, recipientEmail: true, status: true, attempts: true, createdAt: true, sentAt: true, lastError: true };
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

const recipientQuery = (segment) => {
  if (segment === 'PUBLIC_JOB_SUBSCRIBERS') return { type: 'public' };
  const role = segment === 'SEEKERS' ? 'SEEKER' : segment === 'EMPLOYERS' ? 'EMPLOYER' : undefined;
  return { type: 'users', where: { isActive: true, marketingEmailsEnabled: true, ...(role ? { role } : {}) } };
};

export const getEligibleCampaignRecipients = async (segment, client = prisma) => {
  const query = recipientQuery(segment);
  if (query.type === 'public') return client.publicJobSubscriber.findMany({ where: { isSubscribed: true }, select: { id: true, email: true, unsubscribeHash: true } });
  return client.user.findMany({ where: query.where, select: { id: true, email: true } });
};

export const createPromotionalCampaign = async (adminId, input) => {
  const fields = normalizeFields(input);
  assertFields(fields);
  if (!['ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS'].includes(input.segment)) throw Object.assign(new Error('Invalid recipient segment'), { status: 400 });
  const campaign = await prisma.emailCampaign.create({ data: { ...fields, segment: input.segment, eventKey: `campaign:${crypto.randomUUID()}`, createdById: adminId }, select: campaignSelect });
  return campaign;
};

export const updatePromotionalCampaign = async (campaignId, input) => {
  const current = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!current) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (current.status !== 'DRAFT') throw Object.assign(new Error('This campaign is no longer editable'), { status: 409 });
  const merged = { ...current, ...normalizeFields(input) };
  const fields = { subject: merged.subject, heading: merged.heading, body: merged.body, ctaLabel: merged.ctaLabel, ctaUrl: merged.ctaUrl };
  assertFields(fields);
  const segment = input.segment ?? current.segment;
  if (!campaignSegments.includes(segment)) throw Object.assign(new Error('Invalid recipient segment'), { status: 400 });
  return prisma.emailCampaign.update({ where: { id: campaignId }, data: { ...fields, segment }, select: campaignSelect });
};

export const previewPromotionalCampaign = async (campaignId) => {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const recipients = await getEligibleCampaignRecipients(campaign.segment);
  const unsubscribeUrl = publicUrl('/unsubscribe-marketing?token=example');
  return { campaign, recipientCount: recipients.length, ...renderEmailTemplate(EMAIL_TYPES.PROMOTIONAL_CAMPAIGN, { title: campaign.subject, heading: campaign.heading, message: campaign.body, link: campaign.ctaUrl ? publicUrl(campaign.ctaUrl) : null, linkLabel: campaign.ctaLabel, isMarketing: true, unsubscribeUrl }) };
};

export const sendPromotionalCampaign = async (campaignId) => {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (campaign.status !== 'DRAFT') throw Object.assign(new Error('This campaign has already been sent or is being processed'), { status: 409 });
  const recipients = await getEligibleCampaignRecipients(campaign.segment);
  if (!recipients.length) throw Object.assign(new Error('This campaign has no eligible recipients'), { status: 409 });
  const claimed = await prisma.emailCampaign.updateMany({ where: { id: campaign.id, status: 'DRAFT' }, data: { status: 'SENDING', recipientCount: recipients.length } });
  if (claimed.count !== 1) throw Object.assign(new Error('This campaign has already been sent or is being processed'), { status: 409 });
  const unsubscribeUrl = (userId) => publicUrl(`/unsubscribe-marketing?token=${encodeURIComponent(createMarketingUnsubscribeToken(userId))}`);
  try {
    await Promise.all(recipients.map((recipient) => queueEmail({
    ...(campaign.segment !== 'PUBLIC_JOB_SUBSCRIBERS' ? { recipientUserId: recipient.id } : {}),
    ...(campaign.segment === 'PUBLIC_JOB_SUBSCRIBERS' ? { publicSubscriberId: recipient.id } : {}),
    emailType: EMAIL_TYPES.PROMOTIONAL_CAMPAIGN,
    eventKey: `${campaign.eventKey}:${recipient.id}`,
    recipientEmail: recipient.email,
    context: { title: campaign.subject, heading: campaign.heading, message: campaign.body, link: campaign.ctaUrl ? publicUrl(campaign.ctaUrl) : null, linkLabel: campaign.ctaLabel, isMarketing: true, unsubscribeUrl: campaign.segment === 'PUBLIC_JOB_SUBSCRIBERS' ? publicUrl(`/unsubscribe-job-updates?token=${encodeURIComponent(`${Buffer.from(recipient.id).toString('base64url')}.${recipient.unsubscribeHash}`)}`) : unsubscribeUrl(recipient.id) },
    })));
    return prisma.emailCampaign.update({ where: { id: campaign.id }, data: { status: 'SENT', sentAt: new Date() }, select: campaignSelect });
  } catch (error) {
    await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { status: 'DRAFT' } }).catch(() => undefined);
    throw error;
  }
};

const campaignDeliveryWhere = (eventKey) => ({
  emailType: EMAIL_TYPES.PROMOTIONAL_CAMPAIGN,
  eventKey: { startsWith: `${eventKey}:` },
});

const deriveReportingStatus = (campaign, counts) => {
  if (campaign.status === 'DRAFT') return 'DRAFT';
  if (counts.pending > 0 || counts.processing > 0) return 'IN_PROGRESS';
  const expected = campaign.recipientCount ?? counts.total;
  if (counts.total < expected) return 'IN_PROGRESS';
  if (counts.failed > 0 && counts.sent > 0) return 'PARTIALLY_FAILED';
  if (counts.failed > 0 && counts.sent === 0) return 'FAILED';
  if (counts.sent > 0 && counts.sent === expected) return 'SENT';
  return 'IN_PROGRESS';
};

const countCampaignDeliveries = async (campaign) => {
  const deliveries = await prisma.emailDelivery.findMany({ where: campaignDeliveryWhere(campaign.eventKey), select: { status: true } });
  const counts = deliveries.reduce((summary, delivery) => {
    summary.total += 1;
    summary[delivery.status.toLowerCase()] += 1;
    return summary;
  }, { total: 0, sent: 0, pending: 0, processing: 0, failed: 0 });
  return { ...counts, recipientCount: campaign.recipientCount ?? counts.total, reportingStatus: deriveReportingStatus(campaign, counts) };
};

const campaignRecord = async (campaign) => ({ campaign, delivery: await countCampaignDeliveries(campaign) });

export const listCampaignRecords = async ({ page = 1, limit = 20 } = {}) => {
  const [total, campaigns] = await Promise.all([
    prisma.emailCampaign.count(),
    prisma.emailCampaign.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: campaignSelect }),
  ]);
  const records = await Promise.all(campaigns.map(campaignRecord));
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

export const getCampaignDeliveries = async (campaignId) => {
  const campaign = await findCampaign(campaignId);
  const deliveries = await prisma.emailDelivery.findMany({ where: campaignDeliveryWhere(campaign.eventKey), orderBy: { createdAt: 'desc' }, select: deliveryReportSelect });
  return { campaignId: campaign.id, deliveries };
};
