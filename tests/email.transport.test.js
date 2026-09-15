import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'transport-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_HOST = 'mail.privateemail.com';
process.env.EMAIL_PORT = '465';
process.env.EMAIL_SECURE = 'true';
process.env.EMAIL_USER = 'mailbox@example.com';
process.env.EMAIL_PASSWORD = 'test-only-not-a-real-password';
process.env.EMAIL_FROM = 'noreply@example.com';

const mockPrisma = { emailDelivery: { update: jest.fn() } };
const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('nodemailer', () => ({ default: { createTransport } }));

const { isEmailEnabled, sendEmailDelivery } = await import('../src/services/email.service.js');

afterEach(() => jest.clearAllMocks());

test('uses Namecheap-compatible SMTP configuration and marks successful delivery', async () => {
  sendMail.mockResolvedValue({ messageId: 'message-1' });
  mockPrisma.emailDelivery.update.mockResolvedValue({ id: 'delivery-1', status: 'SENT' });
  expect(isEmailEnabled()).toBe(true);
  await expect(sendEmailDelivery({ id: 'delivery-1', attempts: 0, recipientEmail: 'user@example.com', subject: 'Hello', html: '<p>Hello</p>', text: 'Hello', emailType: 'NEW_MESSAGE' }, mockPrisma)).resolves.toMatchObject({ status: 'SENT' });
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail.privateemail.com', port: 465, secure: true }));
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com', subject: 'Hello' }));
});

test('records a safe failed delivery without exposing SMTP credentials', async () => {
  sendMail.mockRejectedValue(new Error('SMTP temporary failure')); 
  mockPrisma.emailDelivery.update.mockResolvedValue({ id: 'delivery-1', status: 'FAILED' });
  await expect(sendEmailDelivery({ id: 'delivery-1', attempts: 1, recipientEmail: 'user@example.com', subject: 'Hello', html: '<p>Hello</p>', text: 'Hello', emailType: 'NEW_MESSAGE' }, mockPrisma)).resolves.toMatchObject({ status: 'FAILED' });
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', lastError: 'SMTP temporary failure' }) }));
  expect(JSON.stringify(mockPrisma.emailDelivery.update.mock.calls)).not.toContain('test-only-not-a-real-password');
});
