import { jest } from '@jest/globals';
import { requireRole } from '../src/middleware/authorization.middleware.js';

const createResponse = () => {
  const response = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
};

describe('requireRole', () => {
  test('returns 401 for an unauthenticated request', () => {
    const req = {};
    const res = createResponse();
    const next = jest.fn();

    requireRole('ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an authenticated ADMIN', () => {
    const req = { user: { role: 'ADMIN' } };
    const res = createResponse();
    const next = jest.fn();

    requireRole('ADMIN')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('allows an authenticated EMPLOYER', () => {
    const req = { user: { role: 'EMPLOYER' } };
    const res = createResponse();
    const next = jest.fn();

    requireRole('EMPLOYER')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 403 for a disallowed SEEKER', () => {
    const req = { user: { role: 'SEEKER' } };
    const res = createResponse();
    const next = jest.fn();

    requireRole('ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows any of multiple permitted roles', () => {
    const req = { user: { role: 'EMPLOYER' } };
    const res = createResponse();
    const next = jest.fn();

    requireRole('ADMIN', 'EMPLOYER')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 403 when the authenticated user has no role', () => {
    const req = { user: {} };
    const res = createResponse();
    const next = jest.fn();

    requireRole('ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });
});
