import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://frontend.example';

const startGoogleOAuth = jest.fn();
const handleGoogleCallback = jest.fn();
const completeGoogleRegistration = jest.fn();
const registerUser = jest.fn();
const googleStateCookieName = jest.fn(() => 'state_cookie');
const googleContinuationCookieName = jest.fn(() => 'completion_cookie');
class DuplicateEmailError extends Error {}

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
  verifyEmailWithCode: jest.fn(),
}));
jest.unstable_mockModule('../src/services/googleOAuth.service.js', () => ({
  completeGoogleRegistration,
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
  register,
} = await import('../src/controllers/auth.controller.js');
const { validateGoogleComplete } = await import('../src/validators/auth.validation.js');
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

test('Google callback redirects email conflicts to signup with a safe error identifier', async () => {
  const conflict = Object.assign(new Error('This email is already associated with a LeamJobs account.'), {
    status: 409,
    oauthErrorCode: 'EMAIL_ALREADY_REGISTERED',
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
  expect(redirectUrl.pathname).toBe('/register');
  expect([...redirectUrl.searchParams.entries()]).toEqual([['oauth_error', 'email_already_registered']]);
  expect(next).not.toHaveBeenCalled();
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

test('new and duplicate registrations receive the same enumeration-safe response', async () => {
  const expectedBody = {
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

  registerUser.mockResolvedValue({ id: 'user-1' });
  const successfulResponse = createRegistrationResponse();
  await register({ body: {} }, successfulResponse, jest.fn());

  registerUser.mockRejectedValue(new DuplicateEmailError());
  const duplicateResponse = createRegistrationResponse();
  await register({ body: {} }, duplicateResponse, jest.fn());

  expect(successfulResponse.status).toHaveBeenCalledWith(202);
  expect(duplicateResponse.status).toHaveBeenCalledWith(202);
  expect(successfulResponse.json).toHaveBeenCalledWith(expectedBody);
  expect(duplicateResponse.json).toHaveBeenCalledWith(expectedBody);
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
