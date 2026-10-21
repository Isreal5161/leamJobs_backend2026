import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn().mockResolvedValue({ isActive: true, role: 'SEEKER' }) },
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
  jwt.sign(payload, process.env.JWT_SECRET, {
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

  test('accepts a valid token and constructs req.user from its claims', async () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ sub: 'user-123', role: 'SEEKER' });
    expect(req.user.email).toBeUndefined();
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
});
