import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/auth/google/callback';
process.env.GOOGLE_ISSUER = 'https://accounts.google.com';
process.env.TERMS_DOCUMENT_VERSION = '1.0';
process.env.PRIVACY_DOCUMENT_VERSION = '1.0';

const legalVersions = {
  termsAccepted: true,
  privacyAccepted: true,
  acceptedTermsVersion: '1.0',
  acceptedPrivacyVersion: '1.0',
};

const mockPrisma = {
  pendingOAuthRegistration: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  oauthAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  employerProfile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  wallet: {
    upsert: jest.fn(),
  },
  userLegalAcceptance: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  $transaction: jest.fn(),
};

const mockClient = {
  authorizationUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=google-client-id'),
  callback: jest.fn(async () => ({
    claims: () => ({
      sub: 'google-subject-123',
      email: 'alice@example.com',
      email_verified: true,
      given_name: 'Alice',
      family_name: 'Example',
      picture: 'https://example.com/avatar.png',
      iss: 'https://accounts.google.com',
      aud: 'google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  })),
};

const mockRegisterEmailVerificationOnUser = jest.fn().mockResolvedValue({ success: true });

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/emailVerification.service.js', () => ({
  registerEmailVerificationOnUser: mockRegisterEmailVerificationOnUser,
}));
jest.unstable_mockModule('openid-client', () => ({
  discovery: jest.fn().mockResolvedValue({
    Client: jest.fn().mockImplementation(() => mockClient),
  }),
}));

const { startGoogleOAuth, handleGoogleCallback, completeGoogleRegistration } = await import('../src/services/googleOAuth.service.js');

const createContinuationToken = ({ pendingId, userId, email, role }) => jwt.sign(
  {
    sub: 'google-subject-123',
    pendingId,
    userId,
    email,
    role,
    provider: 'GOOGLE',
  },
  process.env.JWT_SECRET,
  {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '15m',
  },
);

afterEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
});

test('seeker starts Google signup and binds the intended role to the pending OAuth transaction', async () => {
  mockPrisma.pendingOAuthRegistration.create.mockResolvedValue({
    id: 'pending-seeker',
    nonce: 'nonce-seeker',
    codeVerifier: 'code-verifier-seeker',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    email: '',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await startGoogleOAuth('SEEKER', legalVersions);

  expect(result.redirectUrl).toContain('https://accounts.google.com');
  expect(mockPrisma.pendingOAuthRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      provider: 'GOOGLE',
      intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
      status: 'PENDING',
    }),
  }));
});

test('employer starts Google signup and binds the intended role to the pending OAuth transaction', async () => {
  mockPrisma.pendingOAuthRegistration.create.mockResolvedValue({
    id: 'pending-employer',
    nonce: 'nonce-employer',
    codeVerifier: 'code-verifier-employer',
    intendedRole: 'EMPLOYER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    email: '',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await startGoogleOAuth('EMPLOYER', legalVersions);

  expect(result.redirectUrl).toContain('https://accounts.google.com');
  expect(mockPrisma.pendingOAuthRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      intendedRole: 'EMPLOYER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    }),
  }));
});

test('Google sign-in can start without legal acceptance fields for existing accounts', async () => {
  mockPrisma.pendingOAuthRegistration.create.mockResolvedValue({
    id: 'pending-signin-seeker',
    nonce: 'nonce-signin-seeker',
    codeVerifier: 'code-verifier-signin-seeker',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: null,
    acceptedPrivacyVersion: null,
    email: '',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await startGoogleOAuth('SEEKER');

  expect(result.redirectUrl).toContain('https://accounts.google.com');
  expect(mockPrisma.pendingOAuthRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      intendedRole: 'SEEKER',
      acceptedTermsVersion: null,
      acceptedPrivacyVersion: null,
    }),
  }));
});

test('invalid Google role is rejected at start', async () => {
  await expect(startGoogleOAuth('INVALID' /* @ts-expect-error */, legalVersions)).rejects.toMatchObject({ status: 400 });
});

test('Google cancellation returns a safe restart message', async () => {
  await expect(handleGoogleCallback({
    error: 'access_denied',
    errorDescription: 'The user cancelled the Google sign-in request.',
  })).rejects.toMatchObject({
    status: 400,
    publicMessage: 'Google authentication failed. Please try again.',
  });

  expect(mockPrisma.pendingOAuthRegistration.findFirst).not.toHaveBeenCalled();
});

test('handleGoogleCallback rejects invalid state', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue(null);

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'bad-state', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 400,
  });
});

test('handleGoogleCallback rejects invalid nonce', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-valid',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-bad' })).rejects.toMatchObject({
    status: 400,
  });
});

test('new Google registrations cannot proceed without current legal versions saved at OAuth start', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-without-acceptance',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: null,
    acceptedPrivacyVersion: null,
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);

  await expect(handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  })).rejects.toMatchObject({
    status: 400,
    publicMessage: 'Please review and accept the current Terms and Conditions and acknowledge the Privacy Policy.',
  });

  expect(mockPrisma.user.create).not.toHaveBeenCalled();
  expect(mockPrisma.userLegalAcceptance.createMany).not.toHaveBeenCalled();
});

test('new Google registrations cannot proceed when the saved legal versions are outdated', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-outdated-acceptance',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '0.9',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);

  await expect(handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  })).rejects.toMatchObject({
    status: 400,
    publicMessage: 'Please review and accept the current Terms and Conditions and acknowledge the Privacy Policy.',
  });

  expect(mockPrisma.user.create).not.toHaveBeenCalled();
  expect(mockPrisma.userLegalAcceptance.createMany).not.toHaveBeenCalled();
});

test('handleGoogleCallback rejects unverified Google email', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockClient.callback.mockImplementationOnce(async () => ({
    claims: () => ({
      sub: 'google-subject-123',
      email: 'alice@example.com',
      email_verified: false,
      iss: 'https://accounts.google.com',
      aud: 'google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  }));

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 400,
  });
});

test('handleGoogleCallback creates a user and keeps the email-verification workflow authoritative', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Example',
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  });
  mockPrisma.wallet.upsert.mockResolvedValue({ id: 'wallet-1', userId: 'user-1' });
  mockPrisma.pendingOAuthRegistration.update.mockResolvedValue({ id: 'pending-1' });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

  const result = await handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  });

  expect(result.email).toBe('alice@example.com');
  expect(result.role).toBe('SEEKER');
  expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      email: 'alice@example.com',
      role: 'SEEKER',
      isVerified: false,
      isActive: false,
    }),
  }));
  expect(mockPrisma.wallet.upsert).toHaveBeenCalledWith({
    where: { userId_currency: { userId: 'user-1', currency: 'NGN' } },
    create: { userId: 'user-1', currency: 'NGN' },
    update: {},
  });
  expect(mockPrisma.userLegalAcceptance.createMany).toHaveBeenCalledWith({
    data: [
      { userId: 'user-1', documentType: 'TERMS', version: '1.0', registrationMethod: 'GOOGLE' },
      { userId: 'user-1', documentType: 'PRIVACY', version: '1.0', registrationMethod: 'GOOGLE' },
    ],
    skipDuplicates: true,
  });
  expect(mockRegisterEmailVerificationOnUser).toHaveBeenCalledWith(expect.objectContaining({
    id: 'user-1',
    email: 'alice@example.com',
  }));
});

test('Google employer registration does not initialize a wallet', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-employer',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'EMPLOYER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({
    id: 'employer-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Example',
    role: 'EMPLOYER',
    isActive: false,
    isVerified: false,
  });
  mockPrisma.oauthAccount.create.mockResolvedValue({ id: 'oauth-employer-1' });
  mockPrisma.pendingOAuthRegistration.update.mockResolvedValue({ id: 'pending-employer' });

  const result = await handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  });

  expect(result.role).toBe('EMPLOYER');
  expect(mockPrisma.wallet.upsert).not.toHaveBeenCalled();
});

test('Google seeker wallet initialization failure aborts the registration transaction', async () => {
  const transactionState = { users: [], oauthAccounts: [] };
  const transaction = {
    ...mockPrisma,
    user: {
      ...mockPrisma.user,
      create: jest.fn(async ({ data }) => {
        const user = { id: 'google-rollback-seeker', ...data };
        transactionState.users.push(user);
        return user;
      }),
    },
    wallet: {
      upsert: jest.fn().mockRejectedValue(new Error('wallet initialization failed')),
    },
    oauthAccount: {
      ...mockPrisma.oauthAccount,
      create: jest.fn(async (args) => {
        transactionState.oauthAccounts.push(args);
        return { id: 'oauth-rollback' };
      }),
    },
  };
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-rollback',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    try {
      return await callback(transaction);
    } catch (error) {
      transactionState.users.length = 0;
      transactionState.oauthAccounts.length = 0;
      throw error;
    }
  });

  await expect(handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  })).rejects.toThrow('wallet initialization failed');

  expect(transactionState).toEqual({ users: [], oauthAccounts: [] });
  expect(mockRegisterEmailVerificationOnUser).not.toHaveBeenCalled();
});

test('existing linked Google user is not silently given new acceptance records', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-existing', nonce: 'nonce-123', codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER', acceptedTermsVersion: null, acceptedPrivacyVersion: null,
    status: 'PENDING', email: '', expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue({
    id: 'oauth-existing', provider: 'GOOGLE', providerSubject: 'google-subject-123',
    email: 'alice@example.com', userId: 'existing-user',
    user: { id: 'existing-user', email: 'alice@example.com', role: 'SEEKER', isActive: true, isVerified: true },
  });
  mockPrisma.pendingOAuthRegistration.update.mockResolvedValue({ id: 'pending-existing' });

  const result = await handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' });

  expect(result.userId).toBe('existing-user');
  expect(mockPrisma.userLegalAcceptance.createMany).not.toHaveBeenCalled();
  expect(mockPrisma.user.create).not.toHaveBeenCalled();
});

test('existing same-email password accounts are not auto-linked during Google callback', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'alice@example.com', role: 'SEEKER' });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 409,
  });
});

test('existing Google identity with mismatched stored email is rejected without reassigning the OAuth account', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue({
    id: 'oauth-1',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    email: 'alice+other@example.com',
    userId: 'existing-user',
    user: {
      id: 'existing-user',
      email: 'alice@example.com',
      role: 'SEEKER',
      isActive: true,
      isVerified: true,
    },
  });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 409,
  });
});

test('existing Google identity with a missing linked user is rejected safely', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue({
    id: 'oauth-1',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    email: 'alice@example.com',
    userId: 'missing-user',
    user: null,
  });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 409,
  });
});

test('same-email password account with opposite requested role is rejected without auto-linking', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'EMPLOYER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.oauthAccount.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'alice@example.com', role: 'SEEKER' });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-123' })).rejects.toMatchObject({
    status: 409,
  });
});

test('completeGoogleRegistration requires email verification before JWT issuance', async () => {
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue({
    id: 'pending-1',
    intendedRole: 'SEEKER',
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    email: 'alice@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'user-1',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    email: 'alice@example.com',
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  });

  await expect(completeGoogleRegistration({
    pendingId: 'pending-1',
    continuationToken: 'invalid-token',
    email: 'alice@example.com',
  })).rejects.toMatchObject({ status: 400 });
});

test('completeGoogleRegistration rejects an expired pending registration', async () => {
  const pending = {
    id: 'pending-expired',
    intendedRole: 'SEEKER',
    email: 'alice@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'user-expired',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() - 1_000),
    consumedAt: null,
  };
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue(pending);

  await expect(completeGoogleRegistration({
    pendingId: pending.id,
    continuationToken: createContinuationToken({
      pendingId: pending.id,
      userId: pending.userId,
      email: pending.email,
      role: 'SEEKER',
    }),
    email: pending.email,
  })).rejects.toMatchObject({ status: 400 });

  expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
});

test('completeGoogleRegistration rejects an unverified user even with a valid continuation token', async () => {
  const pending = {
    id: 'pending-unverified',
    intendedRole: 'SEEKER',
    email: 'alice@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'user-unverified',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue(pending);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: pending.userId,
    email: pending.email,
    role: 'SEEKER',
    isActive: false,
    isVerified: false,
  });

  await expect(completeGoogleRegistration({
    pendingId: pending.id,
    continuationToken: createContinuationToken({
      pendingId: pending.id,
      userId: pending.userId,
      email: pending.email,
      role: 'SEEKER',
    }),
    email: pending.email,
  })).rejects.toMatchObject({ status: 403 });

  expect(mockPrisma.pendingOAuthRegistration.updateMany).not.toHaveBeenCalled();
});

test('completeGoogleRegistration issues a session once for a verified seeker', async () => {
  const pending = {
    id: 'pending-seeker-complete',
    intendedRole: 'SEEKER',
    email: 'alice@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'user-seeker-complete',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue(pending);
  mockPrisma.user.findUnique
    .mockResolvedValueOnce({
      id: pending.userId,
      email: pending.email,
      firstName: 'Alice',
      lastName: 'Example',
      role: 'SEEKER',
      isActive: true,
      isVerified: true,
      phone: null,
    })
    .mockResolvedValueOnce({
      id: pending.userId,
      email: pending.email,
      firstName: 'Alice',
      lastName: 'Example',
      phone: null,
      role: 'SEEKER',
      isActive: true,
      isVerified: true,
      createdAt: new Date(),
    });
  mockPrisma.pendingOAuthRegistration.updateMany.mockResolvedValue({ count: 1 });

  const result = await completeGoogleRegistration({
    pendingId: pending.id,
    continuationToken: createContinuationToken({
      pendingId: pending.id,
      userId: pending.userId,
      email: pending.email,
      role: 'SEEKER',
    }),
    email: pending.email,
  });

  expect(result.token).toBeTruthy();
  expect(result.user.id).toBe(pending.userId);
  expect(mockPrisma.pendingOAuthRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: pending.id, userId: pending.userId }),
    data: expect.objectContaining({ status: 'COMPLETED', userId: pending.userId }),
  }));
});

test('repeated Google completion cannot consume the same pending registration twice', async () => {
  const pending = {
    id: 'pending-replay',
    intendedRole: 'SEEKER',
    email: 'alice@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'user-replay',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue(pending);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: pending.userId,
    email: pending.email,
    role: 'SEEKER',
    isActive: true,
    isVerified: true,
  });
  mockPrisma.pendingOAuthRegistration.updateMany.mockResolvedValue({ count: 0 });

  await expect(completeGoogleRegistration({
    pendingId: pending.id,
    continuationToken: createContinuationToken({
      pendingId: pending.id,
      userId: pending.userId,
      email: pending.email,
      role: 'SEEKER',
    }),
    email: pending.email,
  })).rejects.toMatchObject({ status: 409 });
});

test('existing verified Google employer completes without changing its company profile', async () => {
  const pending = {
    id: 'pending-existing-employer',
    intendedRole: 'EMPLOYER',
    email: 'employer@example.com',
    provider: 'GOOGLE',
    providerSubject: 'google-subject-123',
    userId: 'existing-employer',
    status: 'VERIFICATION_PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  mockPrisma.pendingOAuthRegistration.findUnique.mockResolvedValue(pending);
  mockPrisma.user.findUnique
    .mockResolvedValueOnce({
      id: pending.userId,
      email: pending.email,
      firstName: 'Em',
      lastName: 'Ployer',
      role: 'EMPLOYER',
      isActive: true,
      isVerified: true,
      phone: '12345',
    })
    .mockResolvedValueOnce({
      id: pending.userId,
      email: pending.email,
      firstName: 'Em',
      lastName: 'Ployer',
      phone: '12345',
      role: 'EMPLOYER',
      isActive: true,
      isVerified: true,
      createdAt: new Date(),
    });
  mockPrisma.employerProfile.findUnique.mockResolvedValue({ id: 'existing-employer-profile' });
  mockPrisma.pendingOAuthRegistration.updateMany.mockResolvedValue({ count: 1 });

  const result = await completeGoogleRegistration({
    pendingId: pending.id,
    continuationToken: createContinuationToken({
      pendingId: pending.id,
      userId: pending.userId,
      email: pending.email,
      role: 'EMPLOYER',
    }),
    email: pending.email,
  });

  expect(result.user.id).toBe(pending.userId);
  expect(mockPrisma.user.update).not.toHaveBeenCalled();
  expect(mockPrisma.employerProfile.upsert).not.toHaveBeenCalled();
});
