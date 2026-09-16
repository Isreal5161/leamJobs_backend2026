import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'communications-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  emailTemplate: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  emailCampaign: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  user: { findMany: jest.fn() },
  publicJobSubscriber: { findMany: jest.fn() },
  emailDelivery: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
const { env } = await import('../src/config/env.js');
const { publicUrl, getOrCreateSystemTemplate, queueWelcomeEmail, getEligibleCampaignRecipients, sendPromotionalCampaign, listCampaignRecords, getCampaignReport, getCampaignDeliveries } = await import('../src/services/adminCommunications.service.js');

afterEach(() => jest.clearAllMocks());

test('preserves absolute CTA URLs and prefixes relative paths', () => {
  expect(publicUrl('https://leamjobs.com')).toBe('https://leamjobs.com');
  expect(publicUrl('http://example.com')).toBe('http://example.com');
  expect(publicUrl('/jobs/example')).toBe('https://leamjobs.com/jobs/example');
});

test('fails clearly when FRONTEND_URL is missing for a relative URL', () => {
  const configuredFrontendUrl = env.FRONTEND_URL;
  env.FRONTEND_URL = '';
  try {
    expect(() => publicUrl('/unsubscribe-marketing?token=test')).toThrow('FRONTEND_URL must be configured');
    expect(() => publicUrl('/unsubscribe-marketing?token=test')).not.toThrow('localhost:5173');
  } finally {
    env.FRONTEND_URL = configuredFrontendUrl;
  }
});

test('creates and uses the role-specific seeker welcome template with deterministic identity', async () => {
  const template = { id: 'template-1', key: 'WELCOME_SEEKER', name: 'Welcome - Seeker', kind: 'WELCOME_SEEKER', subject: 'Welcome', heading: 'Start here', body: 'Hello', ctaLabel: 'Profile', ctaUrl: '/seeker/profile', isActive: true, updatedAt: new Date() };
  mockPrisma.emailTemplate.findUnique.mockResolvedValue(template);
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1', status: 'PENDING', attempts: 0, recipientUserId: 'user-1', emailType: 'WELCOME_SEEKER', eventKey: 'welcome:WELCOME_SEEKER:user-1' });
  await queueWelcomeEmail({ id: 'user-1', email: 'seeker@example.com', role: 'SEEKER' });
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientUserId: 'user-1', emailType: 'WELCOME_SEEKER', eventKey: 'welcome:WELCOME_SEEKER:user-1', subject: 'Welcome' }) }));
});

test('campaign recipient counts only include consented registered users or active public subscribers', async () => {
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  await expect(getEligibleCampaignRecipients('SEEKERS')).resolves.toEqual([{ id: 'user-1', email: 'a@example.com' }]);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, marketingEmailsEnabled: true, role: 'SEEKER' } }));
  mockPrisma.publicJobSubscriber.findMany.mockResolvedValue([{ id: 'public-1', email: 'p@example.com', unsubscribeHash: 'hash' }]);
  await expect(getEligibleCampaignRecipients('PUBLIC_JOB_SUBSCRIBERS')).resolves.toHaveLength(1);
  expect(mockPrisma.publicJobSubscriber.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isSubscribed: true } }));
});

test('campaign send claims a draft once and queues through EmailDelivery', async () => {
  const campaign = { id: 'campaign-1', eventKey: 'campaign:1', subject: 'Update', heading: 'News', body: 'Hello', ctaLabel: null, ctaUrl: null, segment: 'SEEKERS', status: 'DRAFT' };
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1' });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  await expect(sendPromotionalCampaign('campaign-1')).resolves.toMatchObject({ status: 'SENT' });
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientUserId: 'user-1', eventKey: 'campaign:1:user-1', emailType: 'PROMOTIONAL_CAMPAIGN' }) }));
  expect(mockPrisma.emailCampaign.updateMany).toHaveBeenCalledWith({ where: { id: 'campaign-1', status: 'DRAFT' }, data: { status: 'SENDING', recipientCount: 1 } });
});

const campaignRecord = (overrides = {}) => ({
  id: 'campaign-1',
  eventKey: 'campaign:event-1',
  subject: 'Campaign',
  heading: 'Heading',
  body: 'Body',
  ctaLabel: 'Open',
  ctaUrl: '/jobs',
  segment: 'SEEKERS',
  status: 'SENT',
  recipientCount: 3,
  createdById: 'admin-1',
  sentAt: new Date('2026-09-16T10:00:00.000Z'),
  createdAt: new Date('2026-09-16T09:00:00.000Z'),
  updatedAt: new Date('2026-09-16T10:00:00.000Z'),
  ...overrides,
});

test('lists campaign records newest first with real delivery counts', async () => {
  const newest = campaignRecord({ id: 'campaign-new', eventKey: 'campaign:new', recipientCount: 2 });
  const older = campaignRecord({ id: 'campaign-old', eventKey: 'campaign:old' });
  mockPrisma.emailCampaign.count.mockResolvedValue(2);
  mockPrisma.emailCampaign.findMany.mockResolvedValue([newest, older]);
  mockPrisma.emailDelivery.findMany
    .mockResolvedValueOnce([{ status: 'SENT' }, { status: 'FAILED' }])
    .mockResolvedValueOnce([{ status: 'SENT' }]);
  const result = await listCampaignRecords({ page: 1, limit: 20 });
  expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, pages: 1 });
  expect(result.records[0].campaign.id).toBe('campaign-new');
  expect(result.records[0].delivery).toMatchObject({ recipientCount: 2, total: 2, sent: 1, failed: 1, reportingStatus: 'PARTIALLY_FAILED' });
  expect(mockPrisma.emailCampaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }));
});

test.each([
  [['SENT', 'SENT'], 'SENT'],
  [['SENT', 'FAILED'], 'PARTIALLY_FAILED'],
  [['FAILED', 'FAILED'], 'FAILED'],
  [['PENDING', 'PROCESSING'], 'IN_PROGRESS'],
])('derives %s delivery reporting state as %s', async (statuses, expected) => {
  const campaign = campaignRecord({ recipientCount: statuses.length });
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailDelivery.findMany.mockResolvedValue(statuses.map((status) => ({ status })));
  const result = await getCampaignReport(campaign.id);
  expect(result.delivery.reportingStatus).toBe(expected);
});

test('returns only deliveries belonging to the campaign event-key prefix', async () => {
  const campaign = campaignRecord();
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailDelivery.findMany.mockResolvedValue([{ id: 'delivery-1', recipientEmail: 'a@example.com', status: 'FAILED' }]);
  const result = await getCampaignDeliveries(campaign.id);
  expect(result.deliveries).toHaveLength(1);
  expect(mockPrisma.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailType: 'PROMOTIONAL_CAMPAIGN', eventKey: { startsWith: 'campaign:event-1:' } } }));
});
