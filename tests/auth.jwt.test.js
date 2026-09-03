import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

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

  test('accepts a valid token and constructs req.user from its claims', () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ sub: 'user-123', role: 'SEEKER' });
    expect(req.user.email).toBeUndefined();
  });

  test('rejects an expired token', () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { expiresIn: -1 });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an invalid token', () => {
    const req = createRequest('invalid-token');
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong issuer', () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { issuer: 'wrong-issuer' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong audience', () => {
    const token = signToken({ sub: 'user-123', role: 'SEEKER' }, { audience: 'wrong-audience' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token using the wrong algorithm', () => {
    const token = jwt.sign(
      { sub: 'user-123', role: 'SEEKER' },
      process.env.JWT_SECRET,
      { algorithm: 'HS512', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE },
    );
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a token without a subject', () => {
    const token = signToken({ role: 'SEEKER' });
    const req = createRequest(token);
    const res = createResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
