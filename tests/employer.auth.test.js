import { jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');
const { loginUser } = await import('../src/services/auth.service.js');

const createToken = (role = 'SEEKER', subject = 'user-123') =>
  jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  });

describe('Employer authentication and authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('valid SEEKER login returns role SEEKER', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'seeker-123',
      email: 'seeker@example.com',
      passwordHash: bcrypt.hashSync('Password1!', 12),
      role: 'SEEKER',
      isActive: true,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'seeker-123',
      email: 'seeker@example.com',
      role: 'SEEKER',
      isActive: true,
      lastLogin: new Date('2026-09-10T00:00:00.000Z'),
    });

    const result = await loginUser({ email: 'seeker@example.com', password: 'Password1!' });

    expect(result.user.role).toBe('SEEKER');
    expect(result.token).toBeTruthy();
  });

  test('valid EMPLOYER login returns role EMPLOYER', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'employer-123',
      email: 'employer@example.com',
      passwordHash: bcrypt.hashSync('Password1!', 12),
      role: 'EMPLOYER',
      isActive: true,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'employer-123',
      email: 'employer@example.com',
      role: 'EMPLOYER',
      isActive: true,
      lastLogin: new Date('2026-09-10T00:00:00.000Z'),
    });

    const result = await loginUser({ email: 'employer@example.com', password: 'Password1!' });

    expect(result.user.role).toBe('EMPLOYER');
    expect(result.token).toBeTruthy();
  });

  test('invalid credentials fail', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(loginUser({ email: 'missing@example.com', password: 'Password1!' })).rejects.toMatchObject({
      status: 401,
      name: 'AuthenticationError',
    });
  });

  test('SEEKER token is rejected from the Employer endpoint', async () => {
    const response = await request(app)
      .get('/api/employer/me')
      .set('Authorization', `Bearer ${createToken('SEEKER', 'seeker-123')}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('EMPLOYER token is allowed on the Employer endpoint', async () => {
    const response = await request(app)
      .get('/api/employer/me')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'employer-123')}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: 'employer-123',
        role: 'EMPLOYER',
      },
    });
  });

  test('client-supplied userId cannot override the authenticated identity', async () => {
    const response = await request(app)
      .get('/api/employer/me?userId=other-user-456')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'employer-123')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe('employer-123');
    expect(response.body.data.id).not.toBe('other-user-456');
  });

  test('client-supplied role cannot elevate a SEEKER to Employer access', async () => {
    const response = await request(app)
      .get('/api/employer/me?role=EMPLOYER')
      .set('Authorization', `Bearer ${createToken('SEEKER', 'seeker-123')}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('unauthenticated requests are rejected on the Employer endpoint', async () => {
    const response = await request(app).get('/api/employer/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Invalid authentication token' });
  });

  test('ADMIN token is rejected from the Employer endpoint', async () => {
    const response = await request(app)
      .get('/api/employer/me')
      .set('Authorization', `Bearer ${createToken('ADMIN', 'admin-123')}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('EMPLOYER token is rejected from the Seeker endpoint', async () => {
    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'employer-123')}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('public registration rejects ADMIN as a role', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@example.com',
        password: 'Password1!',
        phone: '+2348000000000',
        role: 'ADMIN',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      message: 'Validation failed',
    }));
  });

  test('expired or modified JWTs are rejected', async () => {
    const expiredToken = jwt.sign({ sub: 'user-123', role: 'EMPLOYER' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: -1,
    });

    const expiredResponse = await request(app)
      .get('/api/employer/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(expiredResponse.status).toBe(401);

    const modifiedToken = `${createToken('EMPLOYER', 'employer-123')}.tampered`;
    const modifiedResponse = await request(app)
      .get('/api/employer/me')
      .set('Authorization', `Bearer ${modifiedToken}`);

    expect(modifiedResponse.status).toBe(401);
  });
});
