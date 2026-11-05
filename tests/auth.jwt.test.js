import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  authSession: {
    findFirst: jest.fn().mockResolvedValue({
      userId: 'user-123',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { isActive: true, role: 'SEEKER' },
    }),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const createResponse = () => {
  const response = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
};

const createRequest = (token) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

const signToken = (payload, options = {}) =>
  jwt.sign({ sid: 'session-123', ...payload }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
    ...options,
  });

describe('authenticate', () => {
  let authenticate;

  beforeAll(async () => {
    ({ authenticate } = await import('../src/middleware/auth.middleware.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('accepts a valid token and constructs req.user from its claims', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ sub: 'user-123', role: 'SEEKER' });
    expect(req.user.email).toBeUndefined();
    expect(mockPrisma.authSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-123', userId: 'user-123' },
      select: expect.objectContaining({ userId: true, expiresAt: true, revokedAt: true }),
    }));
  });

  test('rejects an expired token', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { expiresIn: -1 });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an invalid token', async () => {
    const req = createRequest('invalid-token');
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong issuer', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { issuer: 'wrong-issuer' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong audience', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { audience: 'wrong-audience' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token using the wrong algorithm', async () => {
    const token = jwt.sign(
      { sub: 'user-123', role: 'SEEKER' },
      process.env.JWT_SECRET,
      { algorithm: 'HS512', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE },
    );
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token without a subject', async () => {
    const token = signToken({ role: 'SEEKER' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token without a session ID', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER', sid: undefined });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockPrisma.authSession.findFirst).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects revoked or expired sessions', async () => {
    for (const session of [
      { userId: 'user-123', expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date(), user: { isActive: true, role: 'SEEKER' } },
      { userId: 'user-123', expiresAt: new Date(Date.now() - 1), revokedAt: null, user: { isActive: true, role: 'SEEKER' } },
    ]) {
      mockPrisma.authSession.findFirst.mockResolvedValueOnce(session);
      const req = createRequest(signToken({ sub: 'user-123', role: 'SEEKER' }));
      const res = createResponse();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('rejects a session belonging to a different user', async () => {
    mockPrisma.authSession.findFirst.mockResolvedValueOnce({
      userId: 'another-user',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { isActive: true, role: 'SEEKER' },
    });
    const req = createRequest(signToken({ sub: 'user-123', role: 'SEEKER' }));
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('retains account-active and role-mismatch protections', async () => {
    for (const user of [{ isActive: false, role: 'SEEKER' }, { isActive: true, role: 'EMPLOYER' }]) {
      mockPrisma.authSession.findFirst.mockResolvedValueOnce({
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user,
      });
      const req = createRequest(signToken({ sub: 'user-123', role: 'SEEKER' }));
      const res = createResponse();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('rejects a suspended staff account even if its user row remains active', async () => {
    mockPrisma.authSession.findFirst.mockResolvedValueOnce({
      userId: 'staff-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        isActive: true,
        role: 'ADMIN',
        adminAccount: { tier: 'STAFF_ADMIN', suspendedAt: new Date() },
      },
    });
    const req = createRequest(signToken({ sub: 'staff-1', role: 'ADMIN' }));
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('fails closed when the session lookup fails', async () => {
    const lookupError = new Error('database unavailable');
    mockPrisma.authSession.findFirst.mockRejectedValueOnce(lookupError);
    const req = createRequest(signToken({ sub: 'user-123', role: 'SEEKER' }));
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(lookupError);
  });
});
