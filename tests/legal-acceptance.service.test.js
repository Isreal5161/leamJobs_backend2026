import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.TERMS_DOCUMENT_VERSION = '1.0';
process.env.PRIVACY_DOCUMENT_VERSION = '1.0';

const mockPrisma = {
  userLegalAcceptance: {
    findUnique: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
  },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/adminCommunications.service.js', () => ({
  queueWelcomeEmail: jest.fn(),
}));
jest.unstable_mockModule('../src/services/emailVerification.service.js', () => ({
  registerEmailVerificationOnUser: jest.fn(),
}));
jest.unstable_mockModule('../src/services/wallet.service.js', () => ({
  initializeSeekerWallet: jest.fn(),
}));

const { getLegalAcceptanceStatus, recordAccountLegalAcceptance } = await import('../src/services/auth.service.js');

afterEach(() => {
  jest.clearAllMocks();
  mockPrisma.userLegalAcceptance.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
});

test('existing users are reported as not having accepted current documents until they do', async () => {
  await expect(getLegalAcceptanceStatus('existing-user')).resolves.toEqual({
    terms: { version: '1.0', acceptedAt: null },
    privacy: { version: '1.0', acceptedAt: null },
  });
  expect(mockPrisma.userLegalAcceptance.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId_documentType_version: { userId: 'existing-user', documentType: 'TERMS', version: '1.0' } },
  }));
  expect(mockPrisma.userLegalAcceptance.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId_documentType_version: { userId: 'existing-user', documentType: 'PRIVACY', version: '1.0' } },
  }));
});

test('account settings acceptance records the current versions and is duplicate-safe', async () => {
  const acceptedAt = new Date('2026-10-31T12:00:00.000Z');
  mockPrisma.userLegalAcceptance.findUnique
    .mockResolvedValueOnce({ acceptedAt })
    .mockResolvedValueOnce({ acceptedAt });

  await expect(recordAccountLegalAcceptance('user-1', {
    termsAccepted: true,
    privacyAccepted: true,
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
  })).resolves.toEqual({
    terms: { version: '1.0', acceptedAt },
    privacy: { version: '1.0', acceptedAt },
  });

  expect(mockPrisma.userLegalAcceptance.createMany).toHaveBeenCalledWith({
    data: [
      { userId: 'user-1', documentType: 'TERMS', version: '1.0', registrationMethod: 'ACCOUNT' },
      { userId: 'user-1', documentType: 'PRIVACY', version: '1.0', registrationMethod: 'ACCOUNT' },
    ],
    skipDuplicates: true,
  });
});
