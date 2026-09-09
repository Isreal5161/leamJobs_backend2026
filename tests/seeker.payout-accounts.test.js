import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.PAYOUT_ENCRYPTION_KEY = 'test-payout-encryption-key';

const mockPrisma = {
  payoutAccount: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');
const { encryptPayoutIdentifier } = await import('../src/utils/payoutEncryption.js');

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

const buildTransaction = (overrides = {}) => ({
  payoutAccount: {
    findMany: jest.fn().mockResolvedValue(overrides.existingAccounts ?? []),
    findFirst: jest.fn().mockResolvedValue(overrides.existingAccount ?? null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockImplementation(({ data }) => ({ id: defaultAccountId, ...data })),
    update: jest.fn().mockImplementation(({ data }) => ({ id: overrides.existingAccount?.id ?? defaultAccountId, ...(overrides.existingAccount ?? {}), ...data })),
  },
});

describe('POST /api/seeker/payout-accounts', () => {
  test('requires authentication', async () => {
    const response = await request(app).post('/api/seeker/payout-accounts').send({});

    expect(response.status).toBe(401);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test.each(['EMPLOYER', 'ADMIN'])('requires SEEKER role for %s', async (role) => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token(role)}`)
      .send({});

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('creates a Nigeria bank account, ignores client currency, and masks the account number', async () => {
    const tx = buildTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789', currency: 'USD' });

    expect(response.status).toBe(201);
    expect(response.body.data.payoutAccount).toMatchObject({
      country: 'Nigeria',
      currency: 'NGN',
      payoutMethod: 'BANK_ACCOUNT',
      provider: 'FLUTTERWAVE',
      maskedAccountNumber: '****6789',
      isDefault: true,
      verified: false,
      status: 'PENDING_VERIFICATION',
    });
    expect(JSON.stringify(response.body)).not.toContain('0123456789');
    expect(JSON.stringify(response.body)).not.toContain('encryptedAccountNumber');
    expect(tx.payoutAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: seekerId, currency: 'NGN', verifiedAt: null, isDefault: true }),
    }));
  });

  test('creates an international account without assuming Nigeria bank fields', async () => {
    const tx = buildTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'United States', accountHolderName: 'Jane Doe', payoutIdentifier: 'US64SVBKUS6S3300958879', currency: 'usd' });

    expect(response.status).toBe(201);
    expect(response.body.data.payoutAccount).toMatchObject({
      country: 'United States',
      currency: 'USD',
      payoutMethod: 'OTHER',
      provider: 'OTHER',
      verified: false,
      status: 'PENDING_VERIFICATION',
    });
  });

  test('rejects an unsupported country', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Wonderland', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a Nigeria submission missing bank account fields', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'bankName' }),
      expect.objectContaining({ field: 'accountNumber' }),
    ]));
  });

  test('ignores/rejects a client-supplied ownership field', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userId: otherSeekerId, country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a duplicate account for the same seeker', async () => {
    const tx = buildTransaction({
      existingAccounts: [{
        id: secondAccountId,
        country: 'Nigeria',
        payoutMethod: 'BANK_ACCOUNT',
        encryptedAccountNumber: encryptPayoutIdentifier('0123456789'),
      }],
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(409);
    expect(tx.payoutAccount.create).not.toHaveBeenCalled();
  });

  test('maps a database unique-constraint conflict to a clean 409 response', async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2002' }));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(409);
    expect(response.body.message).not.toMatch(/P2002|prisma/i);
  });
});

describe('PATCH /api/seeker/payout-accounts/:id', () => {
  test('requires authentication', async () => {
    const response = await request(app).patch(`/api/seeker/payout-accounts/${defaultAccountId}`).send({ isDefault: true });

    expect(response.status).toBe(401);
  });

  test('returns 404 when the account does not belong to the authenticated seeker', async () => {
    const tx = buildTransaction({ existingAccount: null });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ isDefault: true });

    expect(response.status).toBe(404);
    expect(tx.payoutAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: defaultAccountId, userId: seekerId, disabledAt: null },
    }));
  });

  test('can toggle isDefault without resubmitting account details', async () => {
    const tx = buildTransaction({ existingAccount: { id: defaultAccountId, isDefault: false } });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ isDefault: true });

    expect(response.status).toBe(200);
    expect(tx.payoutAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: defaultAccountId },
      data: { isDefault: true },
    }));
  });

  test('updating account details clears prior verification', async () => {
    const tx = buildTransaction({ existingAccount: { id: defaultAccountId, isDefault: true, country: 'Nigeria' } });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'Access Bank', accountNumber: '9876543210' });

    expect(response.status).toBe(200);
    expect(tx.payoutAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verifiedAt: null }),
    }));
  });
});
