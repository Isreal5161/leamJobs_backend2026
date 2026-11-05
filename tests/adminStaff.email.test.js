import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_HOST = 'smtp.example.test';
process.env.EMAIL_USER = 'mailer@example.test';
process.env.EMAIL_PASSWORD = 'test-only-password';
process.env.EMAIL_FROM = 'noreply@example.test';
process.env.FRONTEND_URL = 'https://leamjobs.example';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
const mockEmailDeliveryCreate = jest.fn();

jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));
jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: { emailDelivery: { create: mockEmailDeliveryCreate } },
}));

const { sendAdminInvitationEmail, StaffInvitationEmailDeliveryError } = await import('../src/services/email.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: 'message-1' });
});

test('sends an invitation email directly without persisting its token-bearing body', async () => {
  const rawToken = 'sensitive-token-value';
  await sendAdminInvitationEmail({
    recipientEmail: 'Staff@Example.com',
    invitationId: 'invitation-1',
    link: `https://leamjobs.example/admin/accept-invitation#token=${rawToken}`,
  });

  expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'staff@example.com',
    html: expect.stringContaining(rawToken),
    text: expect.stringContaining(rawToken),
    headers: { 'X-LeamJobs-Email-Type': 'ADMIN_STAFF_INVITATION' },
  }));
  expect(mockEmailDeliveryCreate).not.toHaveBeenCalled();
});

test('surfaces a generic delivery error without exposing transport error details', async () => {
  mockSendMail.mockRejectedValue(new Error('smtp response included sensitive internals'));

  await expect(sendAdminInvitationEmail({
    recipientEmail: 'staff@example.com',
    invitationId: 'invitation-2',
    link: 'https://leamjobs.example/admin/accept-invitation#token=sensitive-token-value',
  })).rejects.toMatchObject({
    name: 'StaffInvitationEmailDeliveryError',
    message: expect.not.stringContaining('sensitive internals'),
  });
});
