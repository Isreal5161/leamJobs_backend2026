import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'welcome-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const user = { id: 'user-1', firstName: 'Ava', lastName: 'Stone', email: 'ava@example.com', role: 'EMPLOYER' };
const mockPrisma = {
  user: {
    create: jest.fn().mockResolvedValue(user),
    findUnique: jest.fn().mockResolvedValue(user),
  },
  $transaction: jest.fn(async (callback) => callback({
    emailVerificationCode: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'verification-1', userId: user.id }),
    },
  })),
};
const queueWelcomeEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
const mockQueueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/adminCommunications.service.js', () => ({ queueWelcomeEmail }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({
  EMAIL_TYPES: { EMAIL_VERIFICATION_CODE: 'EMAIL_VERIFICATION_CODE' },
  queueEmail: mockQueueEmail,
  createMarketingUnsubscribeToken: (userId) => `token:${userId}`,
  createUnsubscribeToken: (userId) => `unsubscribe:${userId}`,
  verifyUnsubscribeToken: () => true,
}));
jest.unstable_mockModule('bcrypt', () => ({ default: { hash: jest.fn().mockResolvedValue('hashed-password') } }));
const { registerUser } = await import('../src/services/auth.service.js');

test('successful employer registration queues the employer welcome after account creation', async () => {
  await expect(registerUser({ firstName: 'Ava', lastName: 'Stone', email: 'Ava@Example.com', password: 'ValidPassword1!', role: 'EMPLOYER' })).resolves.toEqual(user);
  expect(mockPrisma.user.create).toHaveBeenCalled();
  await new Promise((resolve) => setImmediate(resolve));
  expect(queueWelcomeEmail).toHaveBeenCalledWith(user);
});
