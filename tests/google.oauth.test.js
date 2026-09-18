import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/auth/google/callback';
process.env.GOOGLE_ISSUER = 'https://accounts.google.com';

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
    email: '',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await startGoogleOAuth('SEEKER');

  expect(result.redirectUrl).toContain('https://accounts.google.com');
  expect(mockPrisma.pendingOAuthRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      provider: 'GOOGLE',
      intendedRole: 'SEEKER',
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
    email: '',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await startGoogleOAuth('EMPLOYER');

  expect(result.redirectUrl).toContain('https://accounts.google.com');
  expect(mockPrisma.pendingOAuthRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      intendedRole: 'EMPLOYER',
    }),
  }));
});

test('invalid Google role is rejected at start', async () => {
  await expect(startGoogleOAuth('INVALID' /* @ts-expect-error */)).rejects.toMatchObject({ status: 400 });
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
    status: 'PENDING',
    email: '',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await expect(handleGoogleCallback({ code: 'auth-code-123', state: 'state-123', nonce: 'nonce-bad' })).rejects.toMatchObject({
    status: 400,
  });
});

test('handleGoogleCallback rejects unverified Google email', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
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
  mockPrisma.pendingOAuthRegistration.update.mockResolvedValue({ id: 'pending-1' });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

  const result = await handleGoogleCallback({
    code: 'auth-code-123',
    state: 'state-123',
    nonce: 'nonce-123',
  });

  expect(result.email).toBe('alice@example.com');
  expect(result.role).toBe('SEEKER');
  expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      email: 'alice@example.com',
      role: 'SEEKER',
      isVerified: false,
      isActive: false,
    }),
  }));
  expect(mockRegisterEmailVerificationOnUser).toHaveBeenCalledWith(expect.objectContaining({
    id: 'user-1',
    email: 'alice@example.com',
  }));
});

test('existing same-email password accounts are not auto-linked during Google callback', async () => {
  mockPrisma.pendingOAuthRegistration.findFirst.mockResolvedValue({
    id: 'pending-1',
    nonce: 'nonce-123',
    codeVerifier: 'code-verifier-123',
    intendedRole: 'SEEKER',
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
