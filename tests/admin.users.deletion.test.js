import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const adminId = '99999999-9999-4999-8999-999999999999';
const otherAdminId = '88888888-8888-4888-8888-888888888888';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';
const state = new Map();
const mockPrisma = { user: { findUnique: jest.fn() }, $transaction: jest.fn() };
const tx = {
  user: { findUnique: jest.fn(), updateMany: jest.fn() },
  seekerProfile: { updateMany: jest.fn() },
  employerProfile: { updateMany: jest.fn() },
  jobAlert: { updateMany: jest.fn() },
  job: { updateMany: jest.fn() },
  emailVerificationCode: { deleteMany: jest.fn() },
  oAuthAccount: { deleteMany: jest.fn() },
  passwordResetToken: { deleteMany: jest.fn() },
  pendingOAuthRegistration: { deleteMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const record = (id, role) => ({
  id,
  email: `${role.toLowerCase()}@example.com`,
  role,
  isActive: true,
  anonymizedAt: null,
});

const resetState = () => {
  state.clear();
  state.set(adminId, record(adminId, 'ADMIN'));
  state.set(otherAdminId, record(otherAdminId, 'ADMIN'));
  state.set(seekerId, record(seekerId, 'SEEKER'));
  state.set(employerId, record(employerId, 'EMPLOYER'));
  jest.clearAllMocks();

  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
    const user = state.get(where.id);
    return user ? { isActive: user.isActive, role: user.role } : null;
  });

  tx.user.findUnique.mockImplementation(async ({ where }) => state.get(where.id) ?? null);
  tx.user.updateMany.mockImplementation(async ({ where, data }) => {
    const user = state.get(where.id);
    if (!user || user.anonymizedAt) return { count: 0 };
    state.set(where.id, { ...user, ...data });
    return { count: 1 };
  });
  tx.seekerProfile.updateMany.mockResolvedValue({ count: 1 });
  tx.employerProfile.updateMany.mockResolvedValue({ count: 1 });
  tx.jobAlert.updateMany.mockResolvedValue({ count: 0 });
  tx.job.updateMany.mockResolvedValue({ count: 0 });
  for (const model of [tx.emailVerificationCode, tx.oAuthAccount, tx.passwordResetToken, tx.pendingOAuthRegistration]) {
    model.deleteMany.mockResolvedValue({ count: 1 });
  }

  mockPrisma.$transaction.mockImplementation(async (callback) => {
    const before = new Map(state);
    try {
      return await callback(tx);
    } catch (error) {
      state.clear();
      for (const [id, user] of before) state.set(id, user);
      throw error;
    }
  });
};

beforeEach(resetState);

test.each([
  ['SEEKER', seekerId],
  ['EMPLOYER', employerId],
])('anonymizes and deactivates a %s while preserving business history', async (role, userId) => {
  const response = await request(app)
    .delete(`/api/admin/users/${userId}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data).toEqual(expect.objectContaining({
    userId,
    role,
    anonymized: true,
    isActive: false,
    retainedHistory: expect.arrayContaining(['contracts', 'payments', 'financial ledger entries', 'audit records']),
  }));
  expect(state.get(userId)).toEqual(expect.objectContaining({
    email: `deleted-${userId}@account.invalid`,
    firstName: 'Deleted',
    lastName: 'Account',
    phone: null,
    isActive: false,
    isVerified: false,
    marketingEmailsEnabled: false,
  }));
  expect(tx[role === 'SEEKER' ? 'seekerProfile' : 'employerProfile'].updateMany).toHaveBeenCalled();
  if (role === 'SEEKER') {
    expect(tx.jobAlert.updateMany).toHaveBeenCalledWith({
      where: { seekerId: userId, isActive: true },
      data: { isActive: false },
    });
  } else {
    expect(tx.job.updateMany).toHaveBeenCalledWith({
      where: { employerId: userId, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'CLOSED', closedAt: expect.any(Date) },
    });
  }
  expect(tx.emailVerificationCode.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  expect(tx.oAuthAccount.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  expect(response.body.data).not.toHaveProperty('email');
});

test('rejects self-anonymization and protects admin accounts', async () => {
  const selfResponse = await request(app)
    .delete(`/api/admin/users/${adminId}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(selfResponse.status).toBe(403);
  expect(selfResponse.body.error.code).toBe('SELF_ANONYMIZATION_FORBIDDEN');

  const protectedResponse = await request(app)
    .delete(`/api/admin/users/${otherAdminId}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(protectedResponse.status).toBe(403);
  expect(protectedResponse.body.error.code).toBe('ADMIN_ACCOUNT_PROTECTED');
  expect(state.get(otherAdminId).isActive).toBe(true);
});

test('rejects repeat anonymization with a stable conflict response', async () => {
  const auth = { Authorization: `Bearer ${token('ADMIN', adminId)}` };
  expect((await request(app).delete(`/api/admin/users/${seekerId}`).set(auth)).status).toBe(200);
  const repeated = await request(app).delete(`/api/admin/users/${seekerId}`).set(auth);
  expect(repeated.status).toBe(409);
  expect(repeated.body.error.code).toBe('ACCOUNT_ALREADY_ANONYMIZED');
});

test('the existing JWT is rejected after account deactivation', async () => {
  await request(app)
    .delete(`/api/admin/users/${seekerId}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  const response = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);
  expect(response.status).toBe(401);
  expect(response.body.message).toBe('Invalid authentication token');
});

test('rolls back anonymization when dependent data cleanup fails', async () => {
  tx.seekerProfile.updateMany.mockRejectedValueOnce(new Error('profile cleanup failed'));
  const response = await request(app)
    .delete(`/api/admin/users/${seekerId}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(500);
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  expect(state.get(seekerId)).toEqual(expect.objectContaining({ isActive: true, anonymizedAt: null }));
});
