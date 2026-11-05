import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-invitation-validation-secret';
process.env.JWT_ISSUER = 'admin-invitation-validation-issuer';
process.env.JWT_AUDIENCE = 'admin-invitation-validation-audience';

const { validateAdminInvitationAcceptance } = await import('../src/validators/auth.validation.js');
const authRouter = (await import('../src/routes/auth.routes.js')).default;
const { authRateLimiters } = await import('../src/middleware/authRateLimit.middleware.js');

const invoke = (body) => {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  validateAdminInvitationAcceptance(req, res, next);
  return { req, res, next };
};

test('acceptance validation permits only token, names, and a valid password', () => {
  const result = invoke({
    token: 'A'.repeat(43),
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  });

  expect(result.next).toHaveBeenCalledTimes(1);
  expect(result.req.body).toEqual({
    token: 'A'.repeat(43),
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  });
});

test.each([
  ['role', { role: 'ADMIN' }],
  ['tier', { tier: 'SUPER_ADMIN' }],
  ['permissions', { permissionKeys: ['users.view'] }],
  ['email', { email: 'attacker@example.com' }],
])('rejects client-supplied %s during acceptance', (_field, extra) => {
  const result = invoke({
    token: 'A'.repeat(43),
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
    ...extra,
  });

  expect(result.next).not.toHaveBeenCalled();
  expect(result.res.status).toHaveBeenCalledWith(400);
});

test('public acceptance route is rate limited and does not require an authenticated session', () => {
  const layer = authRouter.stack.find((item) => item.route?.path === '/admin-invitations/accept');
  expect(layer).toBeDefined();
  const handlers = layer.route.stack.map(({ handle }) => handle);

  expect(handlers.slice(0, authRateLimiters.adminInvitationAccept.length))
    .toEqual(authRateLimiters.adminInvitationAccept);
  expect(handlers).toContain(validateAdminInvitationAcceptance);
  expect(handlers.some((handle) => handle.name === 'authenticate')).toBe(false);
});
