import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const staffId = '99999999-9999-4999-8999-999999999999';
const otherAdminId = '88888888-8888-4888-8888-888888888888';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';

const mockPrisma = {
  adminAccount: {
    findUnique: jest.fn(async ({ where }) => ({
      userId: where.userId,
      tier: 'STAFF_ADMIN',
      suspendedAt: null,
      user: { id: where.userId, role: 'ADMIN', isActive: true },
    })),
  },
  adminPermissionGrant: {
    findMany: jest.fn(),
  },
  authSession: {
    findFirst: jest.fn(async ({ where }) => ({
      userId: where.userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        isActive: true,
        role: where.id,
        adminAccount: { tier: 'STAFF_ADMIN', suspendedAt: null },
      },
    })),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const token = (role, subject) => jwt.sign(
  { sub: subject, role, sid: role },
  process.env.JWT_SECRET,
  {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  },
);

const authHeader = (role, subject) => `Bearer ${token(role, subject)}`;
const staffAccount = (userId, overrides = {}) => ({
  userId,
  tier: 'STAFF_ADMIN',
  suspendedAt: null,
  user: { id: userId, role: 'ADMIN', isActive: true },
  ...overrides,
});
const grant = (permissionKey, key = permissionKey, isEnabled = true) => ({
  permissionKey,
  permission: { key, isEnabled },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.adminAccount.findUnique.mockImplementation(async ({ where }) => staffAccount(where.userId));
  mockPrisma.adminPermissionGrant.findMany.mockResolvedValue([]);
  mockPrisma.authSession.findFirst.mockImplementation(async ({ where }) => ({
    userId: where.userId,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: {
      isActive: true,
      role: where.id,
      adminAccount: { tier: 'STAFF_ADMIN', suspendedAt: null },
    },
  }));
});

test('requires authentication and the ADMIN role', async () => {
  expect((await request(app).get('/api/admin/me/permissions')).status).toBe(401);

  for (const [role, subject] of [['SEEKER', seekerId], ['EMPLOYER', employerId]]) {
    const response = await request(app)
      .get('/api/admin/me/permissions')
      .set('Authorization', authHeader(role, subject));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  }

  expect(mockPrisma.adminPermissionGrant.findMany).not.toHaveBeenCalled();
});

test('returns only the authenticated staff member current enabled grants', async () => {
  mockPrisma.adminPermissionGrant.findMany.mockResolvedValue([
    grant('jobs.view'),
    grant('jobs.moderate'),
    grant('finance.payments.view', 'finance.payments.view', false),
    grant('unknown.permission', 'different.permission'),
    grant('orphan.permission', null),
  ]);

  const response = await request(app)
    .get(`/api/admin/me/permissions?userId=${otherAdminId}&accountId=${otherAdminId}`)
    .set('Authorization', authHeader('ADMIN', staffId))
    .set('x-user-id', otherAdminId);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    data: {
      tier: 'STAFF_ADMIN',
      isSuperAdmin: false,
      permissions: ['jobs.moderate', 'jobs.view'],
    },
  });
  expect(mockPrisma.adminPermissionGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { adminUserId: staffId },
  }));
  expect(mockPrisma.adminPermissionGrant.findMany).toHaveBeenCalledTimes(1);
});

test('reads only current grants, so revoked permissions are absent', async () => {
  mockPrisma.adminPermissionGrant.findMany
    .mockResolvedValueOnce([grant('jobs.view'), grant('jobs.moderate')])
    .mockResolvedValueOnce([grant('jobs.view')]);

  const first = await request(app)
    .get('/api/admin/me/permissions')
    .set('Authorization', authHeader('ADMIN', staffId));
  const afterRevocation = await request(app)
    .get('/api/admin/me/permissions')
    .set('Authorization', authHeader('ADMIN', staffId));

  expect(first.body.data.permissions).toEqual(['jobs.moderate', 'jobs.view']);
  expect(afterRevocation.body.data.permissions).toEqual(['jobs.view']);
  expect(mockPrisma.adminPermissionGrant.findMany).toHaveBeenCalledTimes(2);
});

test('does not resolve permissions for a missing or inconsistent admin account', async () => {
  mockPrisma.adminAccount.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(staffAccount(staffId, {
      user: { id: otherAdminId, role: 'ADMIN', isActive: true },
    }));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(app)
      .get('/api/admin/me/permissions')
      .set('Authorization', authHeader('ADMIN', staffId));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  }

  expect(mockPrisma.adminPermissionGrant.findMany).not.toHaveBeenCalled();
});

test('returns the explicit Super Admin tier without fabricating individual grants', async () => {
  mockPrisma.adminAccount.findUnique.mockResolvedValue(staffAccount(staffId, {
    tier: 'SUPER_ADMIN',
  }));
  mockPrisma.authSession.findFirst.mockResolvedValue({
    userId: staffId,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: {
      isActive: true,
      role: 'ADMIN',
      adminAccount: { tier: 'SUPER_ADMIN', suspendedAt: null },
    },
  });

  const response = await request(app)
    .get('/api/admin/me/permissions')
    .set('Authorization', authHeader('ADMIN', staffId));

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    data: {
      tier: 'SUPER_ADMIN',
      isSuperAdmin: true,
      permissions: [],
    },
  });
  expect(mockPrisma.adminPermissionGrant.findMany).not.toHaveBeenCalled();
});

test('a permission change is visible on the next request', async () => {
  mockPrisma.adminPermissionGrant.findMany
    .mockResolvedValueOnce([grant('jobs.view')])
    .mockResolvedValueOnce([grant('jobs.view'), grant('applications.view')]);

  const first = await request(app)
    .get('/api/admin/me/permissions')
    .set('Authorization', authHeader('ADMIN', staffId));
  const refreshed = await request(app)
    .get('/api/admin/me/permissions')
    .set('Authorization', authHeader('ADMIN', staffId));

  expect(first.body.data.permissions).toEqual(['jobs.view']);
  expect(refreshed.body.data.permissions).toEqual(['applications.view', 'jobs.view']);
  expect(mockPrisma.adminPermissionGrant.findMany).toHaveBeenCalledTimes(2);
});
