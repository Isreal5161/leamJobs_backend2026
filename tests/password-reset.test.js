import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'reset-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  passwordResetToken: { create: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn(),
};
const mockQueueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({ EMAIL_TYPES: { PASSWORD_RESET: 'PASSWORD_RESET', PASSWORD_CHANGED: 'PASSWORD_CHANGED' }, queueEmail: mockQueueEmail }));

const { requestPasswordReset, resetPassword, InvalidPasswordResetTokenError } = await import('../src/services/passwordReset.service.js');

afterEach(() => jest.clearAllMocks());

test('password reset request is generic for unknown accounts', async () => {
  mockPrisma.user.findUnique.mockResolvedValue(null);
  await expect(requestPasswordReset('missing@example.com')).resolves.toEqual({ message: expect.stringContaining('If an account exists') });
  expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
});

test('password reset queues a secure frontend link without exposing the raw token', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', firstName: 'Ada', isActive: true });
  mockPrisma.passwordResetToken.create.mockResolvedValue({ id: 'reset-1' });
  await requestPasswordReset('user@example.com');
  expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', tokenHash: expect.any(String), expiresAt: expect.any(Date) }) }));
  await new Promise((resolve) => setImmediate(resolve));
  expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ emailType: 'PASSWORD_RESET', eventKey: 'password-reset:reset-1', recipientEmail: 'user@example.com', context: expect.objectContaining({ link: expect.stringContaining('https://leamjobs.com/reset-password?token=') }) }));
  expect(mockQueueEmail.mock.calls[0][0].context.link).not.toContain('user-1');
});

test('expired or used reset tokens are rejected', async () => {
  mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
  await expect(resetPassword({ token: 'invalid-token', password: 'ValidPassword1!' })).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
});

test('reset password claims token once and queues security confirmation', async () => {
  mockPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60000) });
  const transaction = {
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { update: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', firstName: 'Ada' }) },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));
  await expect(resetPassword({ token: 'valid-looking-token', password: 'ValidPassword1!' })).resolves.toEqual({ message: expect.stringContaining('reset successfully') });
  expect(transaction.passwordResetToken.updateMany).toHaveBeenCalled();
  await new Promise((resolve) => setImmediate(resolve));
  expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ emailType: 'PASSWORD_CHANGED', eventKey: 'password-changed:reset-1' }));
});
