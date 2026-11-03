import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'session-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const sessions = new Map([
  ['session-device-a', {
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: { isActive: true, role: 'SEEKER' },
  }],
  ['session-device-b', {
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: { isActive: true, role: 'SEEKER' },
  }],
]);

const mockPrisma = {
  authSession: {
    findFirst: jest.fn(async ({ where }) => {
      const session = sessions.get(where.id);
      return session?.userId === where.userId ? session : null;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const session = sessions.get(where.id);
      if (!session || session.userId !== where.userId || session.revokedAt !== null) return { count: 0 };
      sessions.set(where.id, { ...session, revokedAt: data.revokedAt });
      return { count: 1 };
    }),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { authenticate } = await import('../src/middleware/auth.middleware.js');
const { logout } = await import('../src/controllers/auth.controller.js');

const createToken = (sid) => jwt.sign(
  { sub: 'user-1', role: 'SEEKER', sid },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' },
);
const createResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};
const authenticateRequest = async (token) => {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createResponse();
  const next = jest.fn();
  await authenticate(req, res, next);
  return { req, res, next };
};

test('logout revokes only the authenticated device session; the other device remains valid', async () => {
  const deviceAToken = createToken('session-device-a');
  const deviceBToken = createToken('session-device-b');
  const beforeLogout = await authenticateRequest(deviceAToken);
  expect(beforeLogout.next).toHaveBeenCalledTimes(1);

  const response = createResponse();
  const next = jest.fn();
  await logout(beforeLogout.req, response, next);

  expect(response.status).toHaveBeenCalledWith(200);
  expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
    where: { id: 'session-device-a', userId: 'user-1', revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });

  const revokedDevice = await authenticateRequest(deviceAToken);
  expect(revokedDevice.res.status).toHaveBeenCalledWith(401);
  expect(revokedDevice.next).not.toHaveBeenCalled();

  const activeDevice = await authenticateRequest(deviceBToken);
  expect(activeDevice.next).toHaveBeenCalledTimes(1);
});

test('repeating logout is safe and does not revoke a different session', async () => {
  const req = {
    user: { sid: 'session-device-a', sub: 'user-1' },
  };
  const response = createResponse();
  const next = jest.fn();

  await logout(req, response, next);

  expect(next).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(200);
  expect(sessions.get('session-device-b').revokedAt).toBeNull();
});
