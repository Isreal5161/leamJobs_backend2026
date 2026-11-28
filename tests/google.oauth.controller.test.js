import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://frontend.example';

const startGoogleOAuth = jest.fn();
const handleGoogleCallback = jest.fn();
const completeGoogleRegistration = jest.fn();
const getGoogleRegistrationStatus = jest.fn();
const verifyEmailWithCode = jest.fn();
const registerUser = jest.fn();
const googleStateCookieName = jest.fn(() => 'state_cookie');
const googleContinuationCookieName = jest.fn(() => 'completion_cookie');
class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists');
  }
}

jest.unstable_mockModule('../src/services/auth.service.js', () => ({
  getCurrentUser: jest.fn(),
  getLegalAcceptanceStatus: jest.fn(),
  loginUser: jest.fn(),
  recordAccountLegalAcceptance: jest.fn(),
  registerUser,
  DuplicateEmailError,
}));
jest.unstable_mockModule('../src/services/passwordReset.service.js', () => ({
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
}));
jest.unstable_mockModule('../src/services/emailVerification.service.js', () => ({
  resendEmailVerification: jest.fn(),
  verifyEmailWithCode,
}));
jest.unstable_mockModule('../src/services/googleOAuth.service.js', () => ({
  completeGoogleRegistration,
  getGoogleRegistrationStatus,
  googleContinuationCookieName,
  googleStateCookieName,
  handleGoogleCallback,
  startGoogleOAuth,
}));
jest.unstable_mockModule('../src/utils/userResponse.js', () => ({ toUserResponse: jest.fn((user) => user) }));
jest.unstable_mockModule('../src/config/env.js', () => ({
  env: {
    FRONTEND_URL: 'https://frontend.example',
    GOOGLE_REDIRECT_URI: 'https://api.leamjobs.com/api/auth/google/callback',
    NODE_ENV: 'test',
  },
}));
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: {} }));

const {
  googleStartController,
  googleCallbackController,
  googleCompleteController,
  googleRegistrationStatusController,
  googleVerifyEmailController,
  register,
} = await import('../src/controllers/auth.controller.js');
const { validateGoogleComplete, validateGoogleStatus } = await import('../src/validators/auth.validation.js');
const { buildGoogleCallbackUrl } = await import('../src/utils/googleOAuthCallbackUrl.js');

const createResponse = () => {
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    set: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  for (const method of ['redirect', 'set', 'status', 'json']) res[method].mockReturnValue(res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('Google OAuth start sets a short-lived HttpOnly browser-binding cookie', async () => {
  startGoogleOAuth.mockResolvedValue({
    redirectUrl: 'https://accounts.google.com/authorize',
    stateCookieName: 'state_cookie',
    stateCookieValue: 'random-browser-secret',
  });
  const req = { query: { role: 'SEEKER' } };
  const res = createResponse();

  await googleStartController(req, res, jest.fn());

  expect(res.cookie).toHaveBeenCalledWith('state_cookie', 'random-browser-secret', expect.objectContaining({
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth/google/callback',
    maxAge: 15 * 60 * 1000,
  }));
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://accounts.google.com/authorize');
});

test('Google callback uses the browser binding and keeps the continuation token out of the redirect URL', async () => {
  handleGoogleCallback.mockResolvedValue({
    pendingId: 'pending-1',
    email: 'user@example.com',
    role: 'SEEKER',
    continuationToken: 'secret-continuation-token',
  });
  const req = {
    originalUrl: '/api/auth/google/callback?code=authorization-code&state=oauth-state&scope=openid',
    headers: {
      cookie: 'state_cookie=random-browser-secret',
      host: 'attacker.example',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'http',
    },
  };
  const res = createResponse();

  await googleCallbackController(req, res, jest.fn());

  const callbackArguments = handleGoogleCallback.mock.calls[0][0];
  expect(callbackArguments).toEqual(expect.objectContaining({
    browserBinding: 'random-browser-secret',
  }));
  expect(callbackArguments.callbackUrl).toBeInstanceOf(URL);
  expect(callbackArguments.callbackUrl.origin).toBe('https://api.leamjobs.com');
  expect(callbackArguments.callbackUrl.pathname).toBe('/api/auth/google/callback');
  expect(callbackArguments.callbackUrl.searchParams.get('code')).toBe('authorization-code');
  expect(callbackArguments.callbackUrl.searchParams.get('state')).toBe('oauth-state');
  expect(callbackArguments.callbackUrl.searchParams.get('scope')).toBe('openid');
  expect(res.clearCookie).toHaveBeenCalledWith('state_cookie', expect.objectContaining({
    path: '/api/auth/google/callback',
  }));
  expect(res.cookie).toHaveBeenCalledWith('completion_cookie', 'secret-continuation-token', expect.objectContaining({
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth/google/complete',
    maxAge: 15 * 60 * 1000,
  }));
  const redirectUrl = new URL(res.redirect.mock.calls[0][1]);
  expect(redirectUrl.searchParams.get('pendingId')).toBe('pending-1');
  expect(redirectUrl.searchParams.has('continuationToken')).toBe(false);
  expect(redirectUrl.toString()).not.toContain('secret-continuation-token');
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
});

test('Google callback rejects duplicate query parameters instead of choosing one', async () => {
  const req = {
    originalUrl: '/api/auth/google/callback?state=first&state=second&code=authorization-code',
    headers: { cookie: 'state_cookie=random-browser-secret' },
  };
  const res = createResponse();
  const next = jest.fn();

  await googleCallbackController(req, res, next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  expect(handleGoogleCallback).not.toHaveBeenCalled();
});

test('Google callback redirects email conflicts to the existing role sign-in page', async () => {
  const conflict = Object.assign(new Error('This email is already associated with a LeamJobs account.'), {
    status: 409,
    oauthErrorCode: 'EMAIL_ALREADY_REGISTERED',
    existingRole: 'SEEKER',
  });
  handleGoogleCallback.mockRejectedValueOnce(conflict);
  const req = {
    originalUrl: '/api/auth/google/callback?code=authorization-code&state=oauth-state',
    headers: { cookie: 'state_cookie=random-browser-secret' },
  };
  const res = createResponse();
  const next = jest.fn();

  await googleCallbackController(req, res, next);

  expect(res.clearCookie).toHaveBeenCalledWith('state_cookie', expect.objectContaining({
    path: '/api/auth/google/callback',
  }));
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
  expect(res.redirect).toHaveBeenCalledTimes(1);
  const redirectUrl = new URL(res.redirect.mock.calls[0][1]);
  expect(redirectUrl.origin).toBe('https://frontend.example');
  expect(redirectUrl.pathname).toBe('/login');
  expect([...redirectUrl.searchParams.entries()]).toEqual([
    ['oauth_error', 'account_exists'],
    ['existing_role', 'SEEKER'],
  ]);
  expect(next).not.toHaveBeenCalled();
});

test.each([
  ['SEEKER', '/login'],
  ['EMPLOYER', '/employers/login'],
])('Google callback sends a verified %s role conflict to the matching sign-in page', async (existingRole, expectedPath) => {
  handleGoogleCallback.mockRejectedValueOnce(Object.assign(new Error('Role mismatch'), {
    status: 409,
    oauthErrorCode: 'ROLE_MISMATCH',
    existingRole,
  }));
  const res = createResponse();

  await googleCallbackController({
    originalUrl: '/api/auth/google/callback?code=authorization-code&state=oauth-state',
    headers: { cookie: 'state_cookie=random-browser-secret' },
  }, res, jest.fn());

  const redirectUrl = new URL(res.redirect.mock.calls[0][1]);
  expect(redirectUrl.pathname).toBe(expectedPath);
  expect(redirectUrl.searchParams.get('oauth_error')).toBe('role_mismatch');
  expect(redirectUrl.searchParams.get('existing_role')).toBe(existingRole);
});

test('unverified Google email conflicts redirect to the neutral chooser without account details', async () => {
  handleGoogleCallback.mockRejectedValueOnce(Object.assign(new Error('Unverified Google email'), {
    status: 401,
    oauthErrorCode: 'GOOGLE_EMAIL_UNVERIFIED',
    existingRole: 'EMPLOYER',
  }));
  const res = createResponse();

  await googleCallbackController({
    originalUrl: '/api/auth/google/callback?code=authorization-code&state=oauth-state',
    headers: { cookie: 'state_cookie=random-browser-secret' },
  }, res, jest.fn());

  const redirectUrl = new URL(res.redirect.mock.calls[0][1]);
  expect(redirectUrl.pathname).toBe('/choose-sign-in');
  expect([...redirectUrl.searchParams.entries()]).toEqual([
    ['oauth_error', 'google_email_unverified'],
  ]);
});

test('callback URL builder rejects malformed parameters and preserves provider error parameters', () => {
  expect(() => buildGoogleCallbackUrl(
    '/api/auth/google/callback?state=%',
    'https://api.leamjobs.com/api/auth/google/callback',
  )).toThrow();
  expect(() => buildGoogleCallbackUrl(
    '//attacker.example/api/auth/google/callback?state=oauth-state',
    'https://api.leamjobs.com/api/auth/google/callback',
  )).toThrow();
  expect(() => buildGoogleCallbackUrl(
    '/api/auth/google/callback?state=%C3%28',
    'https://api.leamjobs.com/api/auth/google/callback',
  )).toThrow();

  const callbackUrl = buildGoogleCallbackUrl(
    '/api/auth/google/callback?error=access_denied&error_description=Cancelled&state=oauth-state',
    'https://api.leamjobs.com/api/auth/google/callback',
  );
  expect(callbackUrl.origin).toBe('https://api.leamjobs.com');
  expect(callbackUrl.searchParams.get('error')).toBe('access_denied');
  expect(callbackUrl.searchParams.get('error_description')).toBe('Cancelled');
  expect(callbackUrl.searchParams.get('state')).toBe('oauth-state');
});

test('Google completion reads the continuation from HttpOnly cookie and clears it after success', async () => {
  completeGoogleRegistration.mockResolvedValue({
    token: 'access-token',
    user: { id: 'user-1' },
  });
  const req = {
    body: { pendingId: 'pending-1', email: 'user@example.com' },
    headers: { cookie: 'completion_cookie=secret-continuation-token' },
  };
  const res = createResponse();

  await googleCompleteController(req, res, jest.fn());

  expect(completeGoogleRegistration).toHaveBeenCalledWith({
    pendingId: 'pending-1',
    email: 'user@example.com',
    continuationToken: 'secret-continuation-token',
  });
  expect(res.clearCookie).toHaveBeenCalledWith('completion_cookie', expect.objectContaining({
    path: '/api/auth/google/complete',
  }));
  expect(res.status).toHaveBeenCalledWith(200);
});

test('Google registration status uses only the continuation cookie and disables caching', async () => {
  getGoogleRegistrationStatus.mockResolvedValue({
    email: 'employer@example.com',
    role: 'EMPLOYER',
    requiresEmailVerification: false,
    requiresEmployerProfile: true,
  });
  const req = {
    query: { pendingId: 'pending-1' },
    headers: { cookie: 'completion_cookie=secret-continuation-token' },
  };
  const validationResponse = createResponse();
  let nextCalled = false;
  validateGoogleStatus(req, validationResponse, () => { nextCalled = true; });
  expect(nextCalled).toBe(true);

  const res = createResponse();
  await googleRegistrationStatusController(req, res, jest.fn());

  expect(getGoogleRegistrationStatus).toHaveBeenCalledWith({
    pendingId: 'pending-1',
    continuationToken: 'secret-continuation-token',
  });
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ role: 'EMPLOYER' }),
  }));
});

test('Google code verification finalizes its pending OAuth registration in one session', async () => {
  const verifiedUser = {
    id: 'user-1',
    email: 'employer@example.com',
    role: 'EMPLOYER',
    isVerified: true,
    isActive: true,
  };
  getGoogleRegistrationStatus.mockResolvedValue({ email: verifiedUser.email });
  verifyEmailWithCode.mockResolvedValue({
    success: true,
    message: 'verified',
    token: null,
    user: verifiedUser,
  });
  completeGoogleRegistration.mockResolvedValue({
    token: 'final-session-token',
    user: verifiedUser,
  });
  const req = {
    body: { email: verifiedUser.email, code: '123456', pendingId: 'pending-1' },
    headers: { cookie: 'completion_cookie=secret-continuation-token' },
  };
  const res = createResponse();

  await googleVerifyEmailController(req, res, jest.fn());

  expect(verifyEmailWithCode).toHaveBeenCalledWith(
    { email: verifiedUser.email, code: '123456' },
    { createSession: false },
  );
  expect(completeGoogleRegistration).toHaveBeenCalledWith({
    pendingId: 'pending-1',
    continuationToken: 'secret-continuation-token',
    email: verifiedUser.email,
  });
  expect(res.clearCookie).toHaveBeenCalledWith('completion_cookie', expect.objectContaining({
    path: '/api/auth/google/complete',
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    token: 'final-session-token',
    user: verifiedUser,
  }));
});

test('Google completion request only accepts its pending registration and email', () => {
  const req = { body: { pendingId: 'pending-1', email: 'user@example.com' } };
  const res = createResponse();
  const next = jest.fn();

  validateGoogleComplete(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.body).toEqual({ pendingId: 'pending-1', email: 'user@example.com' });

  const profileDataReq = {
    body: {
      pendingId: 'pending-1',
      email: 'user@example.com',
      companyName: 'Untrusted Company',
      phone: '+234 800 000 0000',
    },
  };
  const profileDataRes = createResponse();
  const nextWithProfileData = jest.fn();

  validateGoogleComplete(profileDataReq, profileDataRes, nextWithProfileData);

  expect(profileDataRes.status).toHaveBeenCalledWith(400);
  expect(nextWithProfileData).not.toHaveBeenCalled();
});

test('new and duplicate registrations receive the same neutral response', async () => {
  const neutralBody = {
    success: true,
    message: 'If registration can be completed for this email, we will send the next steps.',
  };
  const createRegistrationResponse = () => {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  const timeoutDelays = [];
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const timeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay) => {
    timeoutDelays.push(delay);
    callback();
    return 0;
  });

  let successfulResponse;
  let duplicateResponse;
  const next = jest.fn();
  try {
    registerUser.mockResolvedValue({ id: 'user-1', email: 'new@example.com', role: 'SEEKER' });
    successfulResponse = createRegistrationResponse();
    await register({ body: {} }, successfulResponse, jest.fn());

    registerUser.mockRejectedValue(new DuplicateEmailError());
    duplicateResponse = createRegistrationResponse();
    await register({ body: {} }, duplicateResponse, next);
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }

  expect(successfulResponse.status).toHaveBeenCalledWith(202);
  expect(duplicateResponse.status).toHaveBeenCalledWith(202);
  expect(successfulResponse.json).toHaveBeenCalledWith(neutralBody);
  expect(duplicateResponse.json).toHaveBeenCalledWith(neutralBody);
  expect(successfulResponse.json.mock.calls[0][0]).toEqual(duplicateResponse.json.mock.calls[0][0]);
  expect(next).not.toHaveBeenCalled();
  expect(timeoutDelays).toHaveLength(2);
  expect(timeoutDelays.every((delay) => delay >= 500 && delay <= 600)).toBe(true);
});

test('OAuth credentials use Secure cookies in production', async () => {
  const productionEnv = (await import('../src/config/env.js')).env;
  productionEnv.NODE_ENV = 'production';
  startGoogleOAuth.mockResolvedValue({
    redirectUrl: 'https://accounts.google.com/authorize',
    stateCookieName: 'state_cookie',
    stateCookieValue: 'random-browser-secret',
  });
  const req = { query: { role: 'SEEKER' } };
  const res = createResponse();

  await googleStartController(req, res, jest.fn());

  expect(res.cookie).toHaveBeenCalledWith('state_cookie', 'random-browser-secret', expect.objectContaining({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  }));

  handleGoogleCallback.mockResolvedValue({
    pendingId: 'pending-production',
    email: 'user@example.com',
    role: 'SEEKER',
    continuationToken: 'production-continuation-token',
  });
  const callbackResponse = createResponse();
  await googleCallbackController({
    originalUrl: '/api/auth/google/callback?code=authorization-code&state=oauth-state',
    headers: { cookie: 'state_cookie=random-browser-secret' },
  }, callbackResponse, jest.fn());

  expect(callbackResponse.cookie).toHaveBeenCalledWith('completion_cookie', 'production-continuation-token', expect.objectContaining({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  }));
});
