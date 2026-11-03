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
  env: { FRONTEND_URL: 'https://frontend.example', NODE_ENV: 'test' },
}));
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: {} }));

const {
  googleStartController,
  googleCallbackController,
  googleCompleteController,
  register,
} = await import('../src/controllers/auth.controller.js');
const { validateGoogleComplete } = await import('../src/validators/auth.validation.js');

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
    query: { code: 'authorization-code', state: 'oauth-state' },
    headers: { cookie: 'state_cookie=random-browser-secret' },
  };
  const res = createResponse();

  await googleCallbackController(req, res, jest.fn());

  expect(handleGoogleCallback).toHaveBeenCalledWith(expect.objectContaining({
    state: 'oauth-state',
    browserBinding: 'random-browser-secret',
  }));
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

test('Google completion request no longer accepts a continuation token in the request body', () => {
  const req = { body: { pendingId: 'pending-1', email: 'user@example.com' } };
  const res = createResponse();
  const next = jest.fn();

  validateGoogleComplete(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.body).toEqual({ pendingId: 'pending-1', email: 'user@example.com' });
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
    query: { code: 'authorization-code', state: 'oauth-state' },
    headers: { cookie: 'state_cookie=random-browser-secret' },
  }, callbackResponse, jest.fn());

  expect(callbackResponse.cookie).toHaveBeenCalledWith('completion_cookie', 'production-continuation-token', expect.objectContaining({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  }));
});
