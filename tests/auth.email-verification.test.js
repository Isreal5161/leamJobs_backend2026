import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import bcrypt from 'bcrypt';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.FRONTEND_URL = 'https://leamjobs.com';
process.env.EMAIL_VERIFICATION_EXPIRE_MINUTES = '15';
process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS = '5';
process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = '60';

const mockPrisma = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  emailVerificationCode: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockQueueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
const mockQueueWelcomeEmail = jest.fn().mockResolvedValue({ id: 'welcome-1' });
const hashCode = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/adminCommunications.service.js', () => ({
  queueWelcomeEmail: mockQueueWelcomeEmail,
}));
jest.unstable_mockModule('../src/services/email.service.js', () => ({
  EMAIL_TYPES: { EMAIL_VERIFICATION_CODE: 'EMAIL_VERIFICATION_CODE' },
  queueEmail: mockQueueEmail,
  createMarketingUnsubscribeToken: (userId) => `token:${userId}`,
  createUnsubscribeToken: (userId) => `unsubscribe:${userId}`,
  verifyUnsubscribeToken: () => true,
}));

const { registerUser, loginUser } = await import('../src/services/auth.service.js');
const { createEmailVerificationChallenge, verifyEmailWithCode, resendEmailVerification } = await import('../src/services/emailVerification.service.js');

afterEach(() => { jest.clearAllMocks(); });

test('registration creates a pending unverified user and queues an email verification challenge', async () => {
  const createdUser = {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    passwordHash: bcrypt.hashSync('ValidPassword1!', 12),
    phone: '+2348000000000',
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  };

  mockPrisma.user.create.mockResolvedValue(createdUser);
  mockPrisma.user.findUnique.mockResolvedValue(createdUser);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    emailVerificationCode: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'verification-1', userId: 'user-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }));

  const created = await registerUser({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    password: 'ValidPassword1!',
    phone: '+2348000000000',
    role: 'SEEKER',
  });

  expect(created.isActive).toBe(false);
  expect(created.isVerified).toBe(false);
  expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
    emailType: 'EMAIL_VERIFICATION_CODE',
    recipientEmail: 'ada@example.com',
  }));
});

test('newly registered users cannot log in before verification', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-2',
    email: 'pending@example.com',
    passwordHash: bcrypt.hashSync('ValidPassword1!', 12),
    role: 'EMPLOYER',
    isActive: false,
    isVerified: false,
  });
  mockPrisma.emailVerificationCode.findUnique.mockResolvedValue({ id: 'verification-pending', userId: 'user-2' });

  await expect(loginUser({ email: 'pending@example.com', password: 'ValidPassword1!' })).rejects.toMatchObject({
    status: 403,
    name: 'InactiveAccountError',
  });
});

test('legacy active users without a verification record can still log in', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'legacy-user',
    email: 'legacy@example.com',
    passwordHash: bcrypt.hashSync('ValidPassword1!', 12),
    role: 'SEEKER',
    isActive: true,
    isVerified: false,
  });
  mockPrisma.emailVerificationCode.findUnique.mockResolvedValue(null);
  mockPrisma.user.update.mockResolvedValue({
    id: 'legacy-user',
    email: 'legacy@example.com',
    role: 'SEEKER',
    isActive: true,
    lastLogin: new Date('2026-09-10T00:00:00.000Z'),
  });

  const result = await loginUser({ email: 'legacy@example.com', password: 'ValidPassword1!' });

  expect(result.user.id).toBe('legacy-user');
  expect(result.token).toBeTruthy();
});

test('a correct verification code verifies the user and activates the account', async () => {
  const code = '123456';
  const codeHash = hashCode(code);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-3',
    email: 'verify@example.com',
    firstName: 'Jane',
    lastName: 'User',
    role: 'SEEKER',
    isVerified: false,
    isActive: false,
  });
  mockPrisma.emailVerificationCode.findUnique.mockResolvedValue({
    id: 'verification-2',
    userId: 'user-3',
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    attempts: 0,
    maxAttempts: 5,
  });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    emailVerificationCode: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'verification-2',
        userId: 'user-3',
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        attempts: 0,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'verification-2', usedAt: new Date() }),
    },
    user: {
      update: jest.fn().mockResolvedValue({
        id: 'user-3',
        email: 'verify@example.com',
        firstName: 'Jane',
        lastName: 'User',
        role: 'SEEKER',
        isActive: true,
        isVerified: true,
      }),
    },
  }));

  const value = await verifyEmailWithCode({ email: 'verify@example.com', code });

  expect(value.success).toBe(true);
  expect(mockPrisma.user.update).not.toHaveBeenCalled();
});

test('resend enforces the cooldown before sending a new code', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-4',
    email: 'resend@example.com',
    firstName: 'Re',
    lastName: 'Send',
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    emailVerificationCode: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'verification-3',
        userId: 'user-4',
        lastSentAt: new Date(Date.now() - 30 * 1000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'verification-4', userId: 'user-4' }),
    },
  }));

  const result = await resendEmailVerification({ email: 'resend@example.com' });

  expect(result.message).toContain('Please wait');
  expect(mockQueueEmail).not.toHaveBeenCalled();
});

// This test is intentionally aligned to the backend-only requirement: no plaintext code should be exposed.
test('verification challenge creation never returns a plaintext code in the payload', async () => {
  const user = {
    id: 'user-5',
    email: 'safe@example.com',
    firstName: 'Safe',
    lastName: 'User',
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  };
  mockPrisma.user.findUnique.mockResolvedValue(user);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    emailVerificationCode: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'verification-5', userId: 'user-5' }),
    },
  }));

  const result = await createEmailVerificationChallenge('user-5', 'safe@example.com');
  expect(result.code).toBeUndefined();
  expect(result.message).toContain('sent');
});

test('two concurrent verification attempts only consume one challenge', async () => {
  const code = '123456';
  const user = {
    id: 'user-concurrent',
    email: 'concurrent@example.com',
    firstName: 'Con',
    lastName: 'Current',
    role: 'SEEKER',
    isVerified: false,
    isActive: false,
  };
  mockPrisma.user.findUnique.mockResolvedValue(user);
  mockPrisma.emailVerificationCode.findUnique.mockResolvedValue({
    id: 'verification-concurrent',
    userId: 'user-concurrent',
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    attempts: 0,
    maxAttempts: 5,
  });

  let updateCalls = 0;
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    emailVerificationCode: {
      updateMany: jest.fn().mockImplementation(async () => {
        updateCalls += 1;
        return { count: updateCalls === 1 ? 1 : 0 };
      }),
    },
    user: {
      update: jest.fn().mockResolvedValue({
        id: 'user-concurrent',
        email: 'concurrent@example.com',
        firstName: 'Con',
        lastName: 'Current',
        role: 'SEEKER',
        isVerified: true,
        isActive: true,
      }),
    },
  }));

  const results = await Promise.allSettled([
    verifyEmailWithCode({ email: 'concurrent@example.com', code }),
    verifyEmailWithCode({ email: 'concurrent@example.com', code }),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled' && result.value.success).length;
  const rejected = results.filter((result) => result.status === 'rejected').length;
  expect(fulfilled).toBe(1);
  expect(rejected + fulfilled).toBe(2);
  expect(updateCalls).toBeGreaterThanOrEqual(2);
});

test('two concurrent resend requests only allow one update and the other is rejected by cooldown', async () => {
  const user = {
    id: 'user-resend',
    email: 'resend-concurrent@example.com',
    firstName: 'Res',
    lastName: 'Send',
    role: 'SEEKER',
    isVerified: false,
    isActive: false,
  };
  mockPrisma.user.findUnique.mockResolvedValue(user);

  const state = {
    lastSentAt: new Date(Date.now() - 120 * 1000),
    lock: false,
  };

  mockPrisma.$transaction.mockImplementation(async (callback) => {
    const tx = {
      emailVerificationCode: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'verification-resend',
          userId: 'user-resend',
          lastSentAt: state.lastSentAt,
        })),
        updateMany: jest.fn().mockImplementation(async () => {
          const cooldownThreshold = new Date(Date.now() - 60 * 1000);
          if (state.lock || (state.lastSentAt && new Date(state.lastSentAt).getTime() > cooldownThreshold.getTime())) {
            return { count: 0 };
          }

          state.lock = true;
          try {
            state.lastSentAt = new Date();
            return { count: 1 };
          } finally {
            state.lock = false;
          }
        }),
        create: jest.fn().mockImplementation(async () => {
          const error = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }),
      },
    };
    return callback(tx);
  });

  const results = await Promise.all([
    createEmailVerificationChallenge('user-resend', 'resend-concurrent@example.com'),
    createEmailVerificationChallenge('user-resend', 'resend-concurrent@example.com'),
  ]);

  expect(results.filter((result) => result.success)).toHaveLength(1);
  expect(results.some((result) => result.message.includes('Please wait'))).toBe(true);
  expect(new Date(state.lastSentAt).getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
});
