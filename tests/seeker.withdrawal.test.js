import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  $transaction: jest.fn(),
  withdrawal: { findUnique: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const walletId = '33333333-3333-4333-8333-333333333333';
const payoutAccountId = '44444444-4444-4444-8444-444444444444';
const otherPayoutAccountId = '55555555-5555-4555-8555-555555555555';
const withdrawalId = '66666666-6666-4666-8666-666666666666';
const createdAt = new Date('2026-09-05T12:00:00.000Z');

const token = (role = 'SEEKER', sub = seekerId) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const payoutAccount = {
  id: payoutAccountId,
  provider: 'OTHER',
  bankCode: '044',
  accountName: 'Jane Doe',
  accountNumberLast4: '4280',
  verifiedAt: createdAt,
  isDefault: true,
};

const withdrawal = {
  id: withdrawalId,
  seekerId,
  payoutAccountId,
  amount: new Prisma.Decimal('30000.00'),
  currency: 'NGN',
  status: 'PENDING',
  requestedAt: createdAt,
  createdAt,
  payoutAccount,
};

const createTransaction = ({ wallet = {}, existing = null, createWithdrawal = withdrawal, failLedger = false } = {}) => {
  const rawQuery = jest.fn().mockResolvedValue([{
    id: walletId,
    currency: 'NGN',
    availableBalance: new Prisma.Decimal(wallet.availableBalance ?? '100000.00'),
    pendingWithdrawalBalance: new Prisma.Decimal(wallet.pendingWithdrawalBalance ?? '0.00'),
    version: wallet.version ?? 0,
  }]);
  const tx = {
    $queryRaw: rawQuery,
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(createWithdrawal),
    },
    payoutAccount: { findFirst: jest.fn().mockResolvedValue(payoutAccount) },
    wallet: { update: jest.fn().mockImplementation(({ data }) => ({ availableBalance: data.availableBalance })) },
    financialLedgerEntry: {
      create: failLedger ? jest.fn().mockRejectedValue(new Error('ledger failed')) : jest.fn().mockResolvedValue({}),
    },
  };
  return { tx, rawQuery };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.withdrawal.findUnique.mockResolvedValue(null);
});

describe('POST /api/seeker/payments/withdrawals', () => {
  test('reserves wallet funds, creates pending withdrawal, and writes reservation ledger', async () => {
    const { tx, rawQuery } = createTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'withdrawal-1')
      .send({ amount: '30000.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(201);
    expect(response.body.data.withdrawal).toMatchObject({ id: withdrawalId, amount: '30000.00', currency: 'NGN', status: 'PENDING' });
    expect(response.body.data.withdrawal.payoutAccount).not.toHaveProperty('encryptedAccountNumber');
    expect(rawQuery.mock.calls[0][0].values).toBeDefined();
    expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: walletId },
      data: expect.objectContaining({
        availableBalance: new Prisma.Decimal('70000.00'),
        pendingWithdrawalBalance: new Prisma.Decimal('30000.00'),
        version: { increment: 1 },
      }),
    }));
    expect(tx.withdrawal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ walletId, seekerId, payoutAccountId, amount: new Prisma.Decimal('30000.00'), status: 'PENDING', idempotencyKey: 'withdrawal-1' }),
    }));
    expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entryType: 'WITHDRAWAL_RESERVED', walletId, withdrawalId, amount: new Prisma.Decimal('30000.00'), currency: 'NGN', balanceAfter: new Prisma.Decimal('70000.00'), idempotencyKey: 'withdrawal-1:reservation' }),
    }));
  });

  test('uses a wallet row lock before making the balance decision', async () => {
    const { tx, rawQuery } = createTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'lock-check')
      .send({ amount: '1.00', currency: 'NGN', payoutAccountId });

    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(rawQuery.mock.calls[0][0].join(' ')).toContain('FOR UPDATE');
  });

  test.each([
    [{ amount: '0.00', currency: 'NGN', payoutAccountId }],
    [{ amount: '-1.00', currency: 'NGN', payoutAccountId }],
    [{ amount: '1.001', currency: 'NGN', payoutAccountId }],
    [{ amount: '1.00', currency: 'USD', payoutAccountId }],
  ])('rejects invalid withdrawal input: %j', async (payload) => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'invalid-input')
      .send(payload);

    expect([400, 422]).toContain(response.status);
    if (payload.currency === 'USD') {
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    } else {
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    }
  });

  test('rejects missing idempotency key and client ownership fields', async () => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId, seekerId: otherSeekerId, walletId });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects insufficient balance without changing the wallet', async () => {
    const { tx } = createTransaction({ wallet: { availableBalance: '100000.00' } });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'too-large')
      .send({ amount: '100001.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(422);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
    expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
  });

  test('rejects safely when the authenticated seeker has no wallet', async () => {
    const { tx } = createTransaction();
    tx.$queryRaw.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'missing-wallet')
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Wallet not found');
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });

  test('allows withdrawing the exact available balance', async () => {
    const { tx } = createTransaction({ wallet: { availableBalance: '100000.00' }, createWithdrawal: { ...withdrawal, amount: new Prisma.Decimal('100000.00') } });
    tx.$queryRaw.mockResolvedValue([{
      id: walletId,
      currency: 'NGN',
      availableBalance: new Prisma.Decimal('100000.00'),
      pendingWithdrawalBalance: new Prisma.Decimal('0.00'),
      version: 0,
    }]);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'exact-balance')
      .send({ amount: '100000.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(201);
    expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ availableBalance: new Prisma.Decimal('0.00'), pendingWithdrawalBalance: new Prisma.Decimal('100000.00') }),
    }));
  });

  test('rejects a payout account that is not owned by the seeker', async () => {
    const { tx } = createTransaction();
    tx.payoutAccount.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'wrong-account')
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId: otherPayoutAccountId });

    expect(response.status).toBe(404);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test.each([
    ['disabled', { disabledAt: createdAt, verifiedAt: createdAt }],
    ['unverified', { disabledAt: null, verifiedAt: null }],
  ])('rejects a %s payout account', async (_label, accountState) => {
    const { tx } = createTransaction();
    tx.payoutAccount.findFirst.mockResolvedValue(null);
    tx.payoutAccount.findFirst.mockImplementation(({ where }) => {
      expect(where).toEqual(expect.objectContaining({ userId: seekerId, disabledAt: null, verifiedAt: { not: null } }));
      return Promise.resolve(null);
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', `account-${_label}`)
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(404);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test('returns the existing withdrawal for an identical idempotent retry', async () => {
    const existing = { ...withdrawal, payoutAccountId, amount: new Prisma.Decimal('30000.00'), currency: 'NGN' };
    const { tx } = createTransaction({ existing });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'same-request')
      .send({ amount: '30000.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(201);
    expect(response.body.data.withdrawal.id).toBe(withdrawalId);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });

  test('rejects an idempotency key reused with different details', async () => {
    const existing = { ...withdrawal, payoutAccountId, amount: new Prisma.Decimal('30000.00'), currency: 'NGN' };
    const { tx } = createTransaction({ existing });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'same-request')
      .send({ amount: '40000.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(409);
  });

  test('rolls back when ledger creation fails', async () => {
    const { tx } = createTransaction({ failLedger: true });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'ledger-failure')
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(500);
    expect(tx.wallet.update).toHaveBeenCalled();
    expect(tx.withdrawal.create).toHaveBeenCalled();
    expect(tx.financialLedgerEntry.create).toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test.each(['EMPLOYER', 'ADMIN'])('rejects %s role', async (role) => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token(role)}`)
      .set('Idempotency-Key', 'role-check')
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Idempotency-Key', 'auth-check')
      .send({ amount: '10.00', currency: 'NGN', payoutAccountId });

    expect(response.status).toBe(401);
  });
});
