import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'reset-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  passwordResetToken: { create: jest.fn(), findFirst: jest.fn() },
  authSession: { updateMany: jest.fn() },
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
  expect(mockPrisma.passwordResetToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ usedAt: null, expiresAt: { gt: expect.any(Date) } }),
  }));
});

test('reset password claims token once and queues security confirmation', async () => {
  mockPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60000) });
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    user: { update: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', firstName: 'Ada' }) },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));
  await expect(resetPassword({ token: 'valid-looking-token', password: 'ValidPassword1!' })).resolves.toEqual({ message: expect.stringContaining('reset successfully') });
  expect(transaction.$queryRaw).toHaveBeenCalled();
  expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledTimes(2);
  expect(transaction.passwordResetToken.updateMany).toHaveBeenNthCalledWith(2, {
    where: { userId: 'user-1', usedAt: null },
    data: { usedAt: expect.any(Date) },
  });
  expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
    where: { userId: 'user-1', revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ emailType: 'PASSWORD_CHANGED', eventKey: 'password-changed:reset-1' }));
});

test('reset token invalidation is limited to the token owner', async () => {
  mockPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60000) });
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    user: { update: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', firstName: 'Ada' }) },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

  await resetPassword({ token: 'user-one-token', password: 'ValidPassword1!' });

  expect(transaction.passwordResetToken.updateMany.mock.calls[1][0].where.userId).toBe('user-1');
  expect(transaction.authSession.updateMany.mock.calls[0][0].where.userId).toBe('user-1');
});

test('concurrent reset attempts with sibling tokens allow only one password change', async () => {
  const now = new Date(Date.now() + 60_000);
  const resetTokens = [
    { id: 'reset-1', userId: 'user-1', usedAt: null, expiresAt: now },
    { id: 'reset-2', userId: 'user-1', usedAt: null, expiresAt: now },
  ];
  mockPrisma.passwordResetToken.findFirst
    .mockResolvedValueOnce({ id: 'reset-1', userId: 'user-1', expiresAt: now })
    .mockResolvedValueOnce({ id: 'reset-2', userId: 'user-1', expiresAt: now });

  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    passwordResetToken: {
      updateMany: jest.fn(async ({ where, data }) => {
        const matches = resetTokens.filter((item) => (where.userId === undefined || item.userId === where.userId)
          && (where.id === undefined || item.id === where.id)
          && item.usedAt === null
          && item.expiresAt > new Date());
        matches.forEach((item) => { item.usedAt = data.usedAt; });
        return { count: matches.length };
      }),
    },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    user: { update: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', firstName: 'Ada' }) },
  };
  let transactionQueue = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const result = transactionQueue.then(() => callback(transaction));
    transactionQueue = result.catch(() => undefined);
    return result;
  });

  const results = await Promise.allSettled([
    resetPassword({ token: 'first-token', password: 'ValidPassword1!' }),
    resetPassword({ token: 'second-token', password: 'ValidPassword2!' }),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  expect(transaction.user.update).toHaveBeenCalledTimes(1);
});

test('transaction failure rolls back token, session, and password mutations', async () => {
  mockPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60000) });
  const state = {
    tokenUsedAt: null,
    siblingUsedAt: null,
    sessionRevokedAt: null,
    passwordHash: 'old-password-hash',
  };
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    passwordResetToken: {
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.id) {
          state.tokenUsedAt = data.usedAt;
          return { count: 1 };
        }
        state.siblingUsedAt = data.usedAt;
        return { count: 1 };
      }),
    },
    authSession: {
      updateMany: jest.fn(async ({ data }) => {
        state.sessionRevokedAt = data.revokedAt;
        return { count: 1 };
      }),
    },
    user: {
      update: jest.fn(async ({ data }) => {
        state.passwordHash = data.passwordHash;
        throw new Error('transaction failed');
      }),
    },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    const snapshot = { ...state };
    try {
      return await callback(transaction);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  });

  await expect(resetPassword({ token: 'valid-token', password: 'ValidPassword1!' })).rejects.toThrow('transaction failed');
  expect(state).toEqual({
    tokenUsedAt: null,
    siblingUsedAt: null,
    sessionRevokedAt: null,
    passwordHash: 'old-password-hash',
  });
});
