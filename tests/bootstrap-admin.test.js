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
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  disconnectDatabase: jest.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ success: true, database: 'connected' }),
}));

const { bootstrapAdmin, parseBootstrapConfig } = await import('../src/scripts/bootstrap-admin.js');
const { default: app } = await import('../src/app.js');
const { loginUser } = await import('../src/services/auth.service.js');

const createToken = (role = 'SEEKER', subject = 'user-123') =>
  jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  });

describe('Admin bootstrap script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('missing ADMIN_EMAIL fails safely', () => {
    expect(() => parseBootstrapConfig({ ADMIN_PASSWORD: 'Password1!' })).toThrow('Missing required environment variable(s): ADMIN_EMAIL.');
  });

  test('missing ADMIN_PASSWORD fails safely', () => {
    expect(() => parseBootstrapConfig({ ADMIN_EMAIL: 'admin@example.com' })).toThrow('Missing required environment variable(s): ADMIN_PASSWORD.');
  });

  test('invalid email fails', () => {
    expect(() => parseBootstrapConfig({ ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: 'Password1!' })).toThrow('ADMIN_EMAIL must be a valid email address.');
  });

  test('new user is created with role ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      isActive: true,
      isVerified: true,
    });

    const result = await bootstrapAdmin({
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'Password1!',
      ADMIN_FIRST_NAME: 'Ada',
      ADMIN_LAST_NAME: 'Lovelace',
    });

    expect(result.action).toBe('created');
    expect(result.role).toBe('ADMIN');
    expect(result.passwordHashStored).toBe(true);
    expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'admin@example.com',
        role: 'ADMIN',
        isActive: true,
        isVerified: true,
      }),
    }));
  });

  test('password is stored as a bcrypt hash and plaintext is never stored', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'admin-2',
      email: data.email,
      role: data.role,
      passwordHash: data.passwordHash,
      isActive: data.isActive,
      isVerified: data.isVerified,
    }));

    await bootstrapAdmin({
      ADMIN_EMAIL: 'admin2@example.com',
      ADMIN_PASSWORD: 'Password1!',
    });

    const createData = mockPrisma.user.create.mock.calls[0][0].data;
    expect(createData.passwordHash).not.toBe('Password1!');
    expect(createData.passwordHash).not.toBeUndefined();
    expect(await bcrypt.compare('Password1!', createData.passwordHash)).toBe(true);
  });

  test('SEEKER cannot be converted to ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'seeker-1',
      email: 'seeker@example.com',
      role: 'SEEKER',
    });

    await expect(bootstrapAdmin({
      ADMIN_EMAIL: 'seeker@example.com',
      ADMIN_PASSWORD: 'Password1!',
    })).rejects.toThrow('Refusing to change existing SEEKER account to ADMIN.');
  });

  test('EMPLOYER cannot be converted to ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'employer-1',
      email: 'employer@example.com',
      role: 'EMPLOYER',
    });

    await expect(bootstrapAdmin({
      ADMIN_EMAIL: 'employer@example.com',
      ADMIN_PASSWORD: 'Password1!',
    })).rejects.toThrow('Refusing to change existing EMPLOYER account to ADMIN.');
  });

  test('existing ADMIN is handled safely without overriding unrelated values unless reset is requested', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-3',
      email: 'admin3@example.com',
      role: 'ADMIN',
      isActive: true,
      isVerified: true,
    });

    const result = await bootstrapAdmin({
      ADMIN_EMAIL: 'admin3@example.com',
      ADMIN_PASSWORD: 'Password1!',
    });

    expect(result.action).toBe('existing-admin');
    expect(result.passwordHashStored).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('ADMIN_RESET_PASSWORD=true updates the existing ADMIN password hash explicitly', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-4',
      email: 'admin4@example.com',
      role: 'ADMIN',
      isActive: true,
      isVerified: true,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'admin-4',
      email: 'admin4@example.com',
      role: 'ADMIN',
    });

    const result = await bootstrapAdmin({
      ADMIN_EMAIL: 'admin4@example.com',
      ADMIN_PASSWORD: 'Password2!',
      ADMIN_RESET_PASSWORD: 'true',
    });

    expect(result.action).toBe('updated-admin-password');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        passwordHash: expect.any(String),
      }),
    }));
  });

  test('public registration still cannot create ADMIN', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin-reg@example.com',
        password: 'Password1!',
        phone: '+2348000000000',
        role: 'ADMIN',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('created ADMIN can log in through the shared auth endpoint and receives ADMIN role in JWT', async () => {
    mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.email === 'admin-login@example.com') {
        return {
          id: 'admin-login-1',
          email: 'admin-login@example.com',
          passwordHash: await bcrypt.hash('Password1!', 12),
          role: 'ADMIN',
          isActive: true,
        };
      }
      return null;
    });

    mockPrisma.user.update.mockResolvedValue({
      id: 'admin-login-1',
      email: 'admin-login@example.com',
      role: 'ADMIN',
      isActive: true,
      lastLogin: new Date('2026-09-10T00:00:00.000Z'),
    });

    const result = await loginUser({
      email: 'admin-login@example.com',
      password: 'Password1!',
    });

    expect(result.user.role).toBe('ADMIN');
    expect(result.token).toBeTruthy();

    const tokenPayload = jwt.decode(result.token);
    expect(tokenPayload).toMatchObject({ role: 'ADMIN', sub: 'admin-login-1' });
  });

});
