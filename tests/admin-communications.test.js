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
  emailDelivery: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
const { env } = await import('../src/config/env.js');
const { publicUrl, getOrCreateSystemTemplate, queueWelcomeEmail, getEligibleCampaignRecipients, sendCommunicationCampaign, listCampaignRecords, getCampaignReport, getCampaignDeliveries } = await import('../src/services/adminCommunications.service.js');

afterEach(() => {
  jest.clearAllMocks();
  mockPrisma.emailDelivery.groupBy.mockResolvedValue([]);
});

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

test('essential announcement recipients do not require marketing consent', async () => {
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  await expect(getEligibleCampaignRecipients('ESSENTIAL_ANNOUNCEMENT', 'SEEKERS')).resolves.toEqual([{ id: 'user-1', email: 'a@example.com' }]);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { isActive: true, anonymizedAt: null, role: 'SEEKER', email: { not: '' } },
  }));
  expect(mockPrisma.user.findMany.mock.calls[0][0].where).not.toHaveProperty('marketingEmailsEnabled');
});

test.each([
  ['ALL_REGISTERED_USERS', { in: ['SEEKER', 'EMPLOYER'] }],
  ['SEEKERS', 'SEEKER'],
  ['EMPLOYERS', 'EMPLOYER'],
])('essential segment %s excludes administrators and inactive/anonymized accounts in its query', async (segment, role) => {
  mockPrisma.user.findMany.mockResolvedValue([]);
  await getEligibleCampaignRecipients('ESSENTIAL_ANNOUNCEMENT', segment);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { isActive: true, anonymizedAt: null, role, email: { not: '' } },
  }));
});

test.each([
  ['ALL_MARKETING_USERS', { in: ['SEEKER', 'EMPLOYER'] }],
  ['SEEKERS', 'SEEKER'],
  ['EMPLOYERS', 'EMPLOYER'],
])('promotional segment %s requires explicit consent and excludes administrators', async (segment, role) => {
  mockPrisma.user.findMany.mockResolvedValue([
    { id: 'user-1', email: 'a@example.com' },
    { id: 'user-2', email: ' A@example.com ' },
    { id: 'user-3', email: 'invalid' },
  ]);
  const recipients = await getEligibleCampaignRecipients('PROMOTIONAL_MARKETING', segment);
  expect(recipients).toEqual([{ id: 'user-1', email: 'a@example.com' }]);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { isActive: true, anonymizedAt: null, role, email: { not: '' }, marketingEmailsEnabled: true },
  }));
});

test('public promotional recipients remain subscribed-only and invalid or duplicate emails are excluded', async () => {
  mockPrisma.publicJobSubscriber.findMany.mockResolvedValue([
    { id: 'public-1', email: 'p@example.com', unsubscribeHash: 'hash-1' },
    { id: 'public-2', email: ' P@example.com ', unsubscribeHash: 'hash-2' },
    { id: 'public-3', email: 'invalid', unsubscribeHash: 'hash-3' },
  ]);
  await expect(getEligibleCampaignRecipients('PROMOTIONAL_MARKETING', 'PUBLIC_JOB_SUBSCRIBERS')).resolves.toEqual([
    { id: 'public-1', email: 'p@example.com', unsubscribeHash: 'hash-1' },
  ]);
  expect(mockPrisma.publicJobSubscriber.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isSubscribed: true, email: { not: '' } } }));
});

test('public newsletter subscribers are counted, previewed, and queued only once with their own unsubscribe link', async () => {
  const campaign = {
    id: 'campaign-public', eventKey: 'campaign:public', subject: 'New jobs', heading: 'New jobs',
    body: 'See the latest job opportunities.', ctaLabel: null, ctaUrl: null,
    segment: 'PUBLIC_JOB_SUBSCRIBERS', purpose: 'PROMOTIONAL_MARKETING',
    operationalContentConfirmed: false, status: 'DRAFT',
  };
  mockPrisma.publicJobSubscriber.findMany.mockResolvedValue([
    { id: 'subscriber-1', email: ' Public@Example.com ', unsubscribeHash: 'unsubscribe-hash' },
    { id: 'subscriber-2', email: 'public@example.com', unsubscribeHash: 'duplicate-hash' },
    { id: 'subscriber-3', email: 'invalid', unsubscribeHash: 'invalid-hash' },
  ]);
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-public' });
  const {
    getEligibleCampaignRecipients,
    previewPromotionalCampaign,
  } = await import('../src/services/adminCommunications.service.js');

  const recipients = await getEligibleCampaignRecipients('PROMOTIONAL_MARKETING', 'PUBLIC_JOB_SUBSCRIBERS');
  expect(recipients).toEqual([
    { id: 'subscriber-1', email: 'public@example.com', unsubscribeHash: 'unsubscribe-hash' },
  ]);
  expect((await previewPromotionalCampaign(campaign.id)).recipientCount).toBe(recipients.length);
  await sendCommunicationCampaign(campaign.id);

  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledTimes(1);
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      publicSubscriberId: 'subscriber-1',
      recipientEmail: 'public@example.com',
      communicationPurpose: 'PROMOTIONAL_MARKETING',
      html: expect.stringContaining('/unsubscribe-job-updates?token='),
    }),
  }));
  expect(mockPrisma.emailDelivery.create.mock.calls[0][0].data.recipientUserId).toBeNull();
});

test('incompatible communication purposes and segments are rejected', async () => {
  await expect(getEligibleCampaignRecipients('ESSENTIAL_ANNOUNCEMENT', 'PUBLIC_JOB_SUBSCRIBERS')).rejects.toMatchObject({ status: 400 });
  await expect(getEligibleCampaignRecipients('PROMOTIONAL_MARKETING', 'ALL_REGISTERED_USERS')).rejects.toMatchObject({ status: 400 });
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('campaign creation requires purpose and explicit essential-content confirmation', async () => {
  const { createPromotionalCampaign } = await import('../src/services/adminCommunications.service.js');
  await expect(createPromotionalCampaign('admin-1', {
    subject: 'Maintenance', heading: 'Maintenance', body: 'Scheduled service window.',
    purpose: 'ESSENTIAL_ANNOUNCEMENT', segment: 'ALL_REGISTERED_USERS', operationalContentConfirmed: false,
  })).rejects.toMatchObject({ status: 400 });
  mockPrisma.emailCampaign.create.mockResolvedValue({ id: 'campaign-essential', purpose: 'ESSENTIAL_ANNOUNCEMENT' });
  await createPromotionalCampaign('admin-1', {
    subject: 'Maintenance', heading: 'Maintenance', body: 'Scheduled service window.',
    purpose: 'ESSENTIAL_ANNOUNCEMENT', segment: 'ALL_REGISTERED_USERS', operationalContentConfirmed: true,
  });
  expect(mockPrisma.emailCampaign.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ purpose: 'ESSENTIAL_ANNOUNCEMENT', operationalContentConfirmed: true }),
  }));
});

test('campaign draft purpose cannot be changed after creation', async () => {
  const { updatePromotionalCampaign } = await import('../src/services/adminCommunications.service.js');
  mockPrisma.emailCampaign.findUnique.mockResolvedValue({
    id: 'campaign-1', purpose: 'PROMOTIONAL_MARKETING', segment: 'SEEKERS', status: 'DRAFT',
    subject: 'News', heading: 'News', body: 'Message', operationalContentConfirmed: false,
  });
  await expect(updatePromotionalCampaign('campaign-1', { purpose: 'ESSENTIAL_ANNOUNCEMENT' })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.emailCampaign.update).not.toHaveBeenCalled();
});

test('essential announcement content changes require a fresh operational confirmation', async () => {
  const { updatePromotionalCampaign } = await import('../src/services/adminCommunications.service.js');
  mockPrisma.emailCampaign.findUnique.mockResolvedValue({
    id: 'campaign-essential', purpose: 'ESSENTIAL_ANNOUNCEMENT', segment: 'SEEKERS', status: 'DRAFT',
    subject: 'Maintenance', heading: 'Maintenance', body: 'Scheduled service window.',
    operationalContentConfirmed: true,
  });
  await expect(updatePromotionalCampaign('campaign-essential', { body: 'Maintenance and new paid features.' }))
    .rejects.toMatchObject({ status: 400 });
  expect(mockPrisma.emailCampaign.update).not.toHaveBeenCalled();
});

test('opted-out user is still selected for an essential announcement send', async () => {
  const campaign = {
    id: 'campaign-1', eventKey: 'campaign:essential', subject: 'Maintenance', heading: 'Maintenance', body: 'Scheduled service window.',
    ctaLabel: null, ctaUrl: null, segment: 'SEEKERS', purpose: 'ESSENTIAL_ANNOUNCEMENT',
    operationalContentConfirmed: true, status: 'DRAFT',
  };
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1' });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  await sendCommunicationCampaign(campaign.id);
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      recipientUserId: 'user-1',
      emailType: 'ESSENTIAL_ANNOUNCEMENT',
      communicationPurpose: 'ESSENTIAL_ANNOUNCEMENT',
    }),
  }));
  expect(mockPrisma.emailDelivery.create.mock.calls[0][0].data.html).not.toContain('Unsubscribe from marketing emails');
});

test('promotional campaign uses shared opt-in recipient selection and preserves unsubscribe', async () => {
  const campaign = {
    id: 'campaign-1', eventKey: 'campaign:promo', subject: 'News', heading: 'News', body: 'Message',
    ctaLabel: null, ctaUrl: null, segment: 'EMPLOYERS', purpose: 'PROMOTIONAL_MARKETING',
    operationalContentConfirmed: false, status: 'DRAFT',
  };
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1' });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  await sendCommunicationCampaign(campaign.id);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ role: 'EMPLOYER', marketingEmailsEnabled: true }),
  }));
  expect(mockPrisma.emailDelivery.create.mock.calls[0][0].data).toMatchObject({
    emailType: 'PROMOTIONAL_CAMPAIGN',
    communicationPurpose: 'PROMOTIONAL_MARKETING',
  });
  expect(mockPrisma.emailDelivery.create.mock.calls[0][0].data.html).toContain('Unsubscribe from marketing emails');
});

test('campaign count and send share purpose-aware recipient selection', async () => {
  const campaign = {
    id: 'campaign-1', eventKey: 'campaign:essential-count', subject: 'Update', heading: 'Update', body: 'Message',
    ctaLabel: null, ctaUrl: null, segment: 'ALL_REGISTERED_USERS', purpose: 'ESSENTIAL_ANNOUNCEMENT',
    operationalContentConfirmed: true, status: 'DRAFT',
  };
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }, { id: 'user-2', email: 'b@example.com' }]);
  const { getEligibleCampaignRecipients, previewPromotionalCampaign } = await import('../src/services/adminCommunications.service.js');
  const count = (await getEligibleCampaignRecipients(campaign.purpose, campaign.segment)).length;
  expect((await previewPromotionalCampaign(campaign.id)).recipientCount).toBe(count);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1' });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  await sendCommunicationCampaign(campaign.id);
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledTimes(count);
});

test('campaign send claims a draft once and queues through EmailDelivery', async () => {
  const campaign = { id: 'campaign-1', eventKey: 'campaign:1', subject: 'Update', heading: 'News', body: 'Hello', ctaLabel: null, ctaUrl: null, segment: 'SEEKERS', purpose: 'PROMOTIONAL_MARKETING', operationalContentConfirmed: false, status: 'DRAFT' };
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@example.com' }]);
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1' });
  mockPrisma.emailCampaign.update.mockResolvedValue({ ...campaign, status: 'SENT' });
  await expect(sendCommunicationCampaign('campaign-1')).resolves.toMatchObject({ status: 'SENT' });
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientUserId: 'user-1', eventKey: 'campaign:1:user-1', emailType: 'PROMOTIONAL_CAMPAIGN' }) }));
  expect(mockPrisma.emailCampaign.updateMany).toHaveBeenCalledWith({ where: { id: 'campaign-1', status: 'DRAFT' }, data: { status: 'SENDING', recipientCount: 1 } });
  expect(mockPrisma.emailCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'campaign-1' },
    data: expect.objectContaining({ recipientCount: 1 }),
  }));
});

test('campaign send queues bounded pages and deduplicates normalized emails across pages', async () => {
  const campaign = {
    id: 'campaign-batched',
    eventKey: 'campaign:batched',
    subject: 'Update',
    heading: 'News',
    body: 'Hello',
    ctaLabel: null,
    ctaUrl: null,
    segment: 'SEEKERS',
    purpose: 'PROMOTIONAL_MARKETING',
    operationalContentConfirmed: false,
    status: 'DRAFT',
  };
  const firstBatch = Array.from({ length: 100 }, (_, index) => ({
    id: `user-${String(index).padStart(3, '0')}`,
    email: `user-${index}@example.com`,
  }));
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockImplementation(async ({ where }) => (
    where.id
      ? [
        { id: 'user-100', email: ' USER-0@EXAMPLE.COM ' },
        { id: 'user-101', email: 'last@example.com' },
      ]
      : firstBatch
  ));
  mockPrisma.emailCampaign.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-batched' });
  mockPrisma.emailCampaign.update.mockImplementation(async ({ data }) => ({
    ...campaign,
    ...data,
    recipientCount: data.recipientCount ?? 101,
  }));

  await expect(sendCommunicationCampaign(campaign.id)).resolves.toMatchObject({
    status: 'SENT',
    recipientCount: 101,
  });

  expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2);
  expect(mockPrisma.user.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 100 }));
  expect(mockPrisma.user.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
    take: 100,
    where: expect.objectContaining({ id: { gt: 'user-099' } }),
  }));
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledTimes(101);
  expect(mockPrisma.emailDelivery.create.mock.calls.at(-1)[0].data.recipientEmail).toBe('last@example.com');
  expect(mockPrisma.emailCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { recipientCount: 101 },
  }));
});

test('campaign send retries a transient draft-recovery failure after queueing fails', async () => {
  const campaign = {
    id: 'campaign-recovery',
    eventKey: 'campaign:recovery',
    subject: 'Update',
    heading: 'News',
    body: 'Hello',
    ctaLabel: null,
    ctaUrl: null,
    segment: 'SEEKERS',
    purpose: 'PROMOTIONAL_MARKETING',
    operationalContentConfirmed: false,
    status: 'DRAFT',
  };
  const queueError = new Error('delivery queue unavailable');
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-recovery', email: 'user@example.com' }]);
  mockPrisma.emailCampaign.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockRejectedValueOnce(new Error('temporary campaign update failure'))
    .mockResolvedValueOnce({ count: 1 });
  mockPrisma.emailDelivery.create.mockRejectedValue(queueError);

  await expect(sendCommunicationCampaign(campaign.id)).rejects.toBe(queueError);

  expect(mockPrisma.emailCampaign.updateMany).toHaveBeenCalledTimes(3);
  expect(mockPrisma.emailCampaign.updateMany).toHaveBeenLastCalledWith({
    where: { id: campaign.id, status: 'SENDING' },
    data: { status: 'DRAFT' },
  });
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
  purpose: 'PROMOTIONAL_MARKETING',
  operationalContentConfirmed: false,
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
  mockPrisma.emailDelivery.groupBy.mockResolvedValue([
    { eventKey: 'campaign:new:user-1', status: 'SENT', _count: { _all: 1 } },
    { eventKey: 'campaign:new:user-2', status: 'FAILED', _count: { _all: 1 } },
    { eventKey: 'campaign:old:user-3', status: 'SENT', _count: { _all: 1 } },
  ]);
  const result = await listCampaignRecords({ page: 1, limit: 20 });
  expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, pages: 1 });
  expect(result.records[0].campaign.id).toBe('campaign-new');
  expect(result.records[0].delivery).toMatchObject({ recipientCount: 2, total: 2, sent: 1, failed: 1, reportingStatus: 'PARTIALLY_FAILED' });
  expect(mockPrisma.emailCampaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }));
  expect(mockPrisma.emailDelivery.groupBy).toHaveBeenCalledTimes(1);
  expect(mockPrisma.emailDelivery.findMany).not.toHaveBeenCalled();
});

test.each([
  [['SENT', 'SENT'], 'SENT'],
  [['SENT', 'FAILED'], 'PARTIALLY_FAILED'],
  [['FAILED', 'FAILED'], 'FAILED'],
  [['PENDING', 'PROCESSING'], 'IN_PROGRESS'],
])('derives %s delivery reporting state as %s', async (statuses, expected) => {
  const campaign = campaignRecord({ recipientCount: statuses.length });
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailDelivery.groupBy.mockResolvedValue(statuses.map((status) => ({ status, _count: { _all: 1 } })));
  const result = await getCampaignReport(campaign.id);
  expect(result.delivery.reportingStatus).toBe(expected);
});

test('returns only deliveries belonging to the campaign event-key prefix', async () => {
  const campaign = campaignRecord();
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailDelivery.findMany.mockResolvedValue([{ id: 'delivery-1', recipientEmail: 'a@example.com', status: 'FAILED' }]);
  mockPrisma.emailDelivery.count.mockResolvedValue(3);
  const result = await getCampaignDeliveries(campaign.id);
  expect(result.deliveries).toHaveLength(1);
  expect(result.pagination).toEqual({ page: 1, limit: 50, total: 3, totalPages: 1, hasNextPage: false, hasPreviousPage: false });
  expect(mockPrisma.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { emailType: { in: ['PROMOTIONAL_CAMPAIGN', 'ESSENTIAL_ANNOUNCEMENT'] }, eventKey: { startsWith: 'campaign:event-1:' } },
  }));
});

test('bounds campaign delivery listings at the database query', async () => {
  const campaign = campaignRecord();
  mockPrisma.emailCampaign.findUnique.mockResolvedValue(campaign);
  mockPrisma.emailDelivery.findMany.mockResolvedValue([]);
  mockPrisma.emailDelivery.count.mockResolvedValue(101);

  const result = await getCampaignDeliveries(campaign.id, { page: 3, limit: 50 });

  expect(result.deliveries).toEqual([]);
  expect(result.pagination).toMatchObject({ page: 3, limit: 50, total: 101, totalPages: 3, hasNextPage: false, hasPreviousPage: true });
  expect(mockPrisma.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
});
