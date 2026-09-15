import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'email-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.EMAIL_ENABLED = 'false';

const mockPrisma = {
  emailDelivery: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { isEmailEnabled, queueEmail, processPendingEmails, createUnsubscribeToken, verifyUnsubscribeToken } = await import('../src/services/email.service.js');

afterEach(() => jest.clearAllMocks());

test('email stays safely disabled without SMTP credentials', () => {
  expect(isEmailEnabled()).toBe(false);
});

test('queues an idempotent email delivery without storing credentials', async () => {
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1', status: 'PENDING', attempts: 0, recipientUserId: 'user-1', emailType: 'APPLICATION_SUBMITTED', eventKey: 'application:submitted:1' });
  await queueEmail({ recipientUserId: 'user-1', emailType: 'APPLICATION_SUBMITTED', eventKey: 'application:submitted:1', recipientEmail: 'employer@example.com', context: { title: 'New application', message: 'A seeker applied.' } });
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientEmail: 'employer@example.com', emailType: 'APPLICATION_SUBMITTED' }) }));
  const data = mockPrisma.emailDelivery.create.mock.calls[0][0].data;
  expect(data.html).toContain('LeamJobs');
  expect(data.text).toContain('A seeker applied.');
  expect(data).not.toHaveProperty('password');
});

test('renders campaign headings and emphasis as email HTML', async () => {
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-2', status: 'PENDING', attempts: 0, recipientUserId: 'user-2', emailType: 'PROMOTIONAL_CAMPAIGN', eventKey: 'campaign:1:user-2' });
  await queueEmail({ recipientUserId: 'user-2', emailType: 'PROMOTIONAL_CAMPAIGN', eventKey: 'campaign:1:user-2', recipientEmail: 'seeker@example.com', context: { title: 'Discover more', message: '## Discover more\n\n**Explore LeamJobs today.**' } });
  const html = mockPrisma.emailDelivery.create.mock.calls[0][0].data.html;
  expect(html).toContain('<h2');
  expect(html).toContain('Discover more</h2>');
  expect(html).toContain('<strong>Explore LeamJobs today.</strong>');
  expect(html).not.toContain('## Discover more');
  expect(html).not.toContain('**Explore LeamJobs today.**');
});

test('disabled processor does not attempt SMTP work', async () => {
  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
  expect(mockPrisma.emailDelivery.findMany).not.toHaveBeenCalled();
});

test('unsubscribe tokens are signed and reject tampering', () => {
  const token = createUnsubscribeToken({ userId: 'user-1' });
  expect(verifyUnsubscribeToken('user-1', token)).toBe(true);
  expect(verifyUnsubscribeToken('user-2', token)).toBe(false);
  expect(verifyUnsubscribeToken('user-1', `${token}bad`)).toBe(false);
});
