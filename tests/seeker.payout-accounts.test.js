import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  payoutAccount: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const defaultAccountId = '33333333-3333-4333-8333-333333333333';
const secondAccountId = '44444444-4444-4444-8444-444444444444';
const createdAt = new Date('2026-09-05T12:00:00.000Z');

const token = (role = 'SEEKER', subject = seekerId) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const account = (overrides = {}) => ({
  id: secondAccountId,
  provider: 'OTHER',
  bankCode: '044',
  accountName: 'Jane Doe',
  accountNumberLast4: '1234',
  isDefault: false,
  verifiedAt: createdAt,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.payoutAccount.findMany.mockResolvedValue([]);
});

describe('GET /api/seeker/payout-accounts', () => {
  test('requires authentication', async () => {
    const response = await request(app).get('/api/seeker/payout-accounts');

    expect(response.status).toBe(401);
    expect(mockPrisma.payoutAccount.findMany).not.toHaveBeenCalled();
  });

  test.each(['EMPLOYER', 'ADMIN'])('requires SEEKER role for %s', async (role) => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token(role)}`);

    expect(response.status).toBe(403);
    expect(mockPrisma.payoutAccount.findMany).not.toHaveBeenCalled();
  });

  test('returns only eligible accounts owned by the authenticated seeker', async () => {
    mockPrisma.payoutAccount.findMany.mockResolvedValue([
      account({ id: defaultAccountId, isDefault: true, accountNumberLast4: '4280' }),
      account({ id: secondAccountId, isDefault: false, accountNumberLast4: '1234' }),
    ]);

    const response = await request(app)
      .get(`/api/seeker/payout-accounts?userId=${otherSeekerId}&seekerId=${otherSeekerId}`)
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        payoutAccounts: [
          expect.objectContaining({ id: defaultAccountId, accountNumberLast4: '4280', isDefault: true }),
          expect.objectContaining({ id: secondAccountId, accountNumberLast4: '1234', isDefault: false }),
        ],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('encryptedAccountNumber');
    expect(JSON.stringify(response.body)).not.toContain('encrypted');
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith({
      where: { userId: seekerId, disabledAt: null, verifiedAt: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: expect.objectContaining({ accountNumberLast4: true }),
    });
  });

  test('returns empty collection when no eligible accounts exist', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { payoutAccounts: [] } });
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: seekerId, disabledAt: null, verifiedAt: { not: null } },
    }));
  });

  test('does not return disabled or unverified accounts', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.payoutAccounts).toEqual([]);
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ disabledAt: null, verifiedAt: { not: null } }),
    }));
  });
});
