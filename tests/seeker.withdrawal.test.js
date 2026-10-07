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
  platformFeeConfiguration: { findUnique: jest.fn() },
  payoutAccount: { findFirst: jest.fn() },
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
let configurationUpdatedAt = new Date('2026-10-01T00:00:00.000Z');
let configuredWithdrawalPercentage = '0.00';

const token = (role = 'SEEKER', sub = seekerId) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const payoutAccount = {
  id: payoutAccountId,
  provider: 'FLUTTERWAVE',
  payoutMethod: 'BANK_ACCOUNT',
  country: 'Nigeria',
  currency: 'NGN',
  bankCode: '044',
  accountName: 'Jane Doe',
  accountNumberLast4: '4280',
  verifiedAt: createdAt,
  updatedAt: createdAt,
  isDefault: true,
};

const getQuoteReference = async (amount, { accountId = payoutAccountId, subject = seekerId, currency = 'NGN' } = {}) => {
  const params = new URLSearchParams({ amount, currency, payoutAccountId: accountId });
  const response = await request(app)
    .get(`/api/seeker/payments/withdrawal-quote?${params}`)
    .set('Authorization', `Bearer ${token('SEEKER', subject)}`);
  expect(response.status).toBe(200);
  return response.body.data.withdrawalQuote.quoteReference;
};

const withdrawal = {
  id: withdrawalId,
  seekerId,
  payoutAccountId,
  amount: new Prisma.Decimal('30000.00'),
  withdrawalFeePercentage: new Prisma.Decimal('0.00'),
  withdrawalFeeAmount: new Prisma.Decimal('0.00'),
  payoutAmount: new Prisma.Decimal('30000.00'),
  currency: 'NGN',
  status: 'PENDING',
  requestedAt: createdAt,
  createdAt,
  payoutAccount,
};

const createTransaction = ({ wallet = {}, payoutAccount: transactionPayoutAccount = payoutAccount, existing = null, createWithdrawal = withdrawal, failLedger = false, withdrawalPercentage = configuredWithdrawalPercentage, configUpdatedAt = configurationUpdatedAt } = {}) => {
  const rawQuery = jest.fn((query) => Promise.resolve(query.join(' ').includes('PlatformFeeConfiguration') ? [{ key: 'default' }] : [{
    id: walletId,
    currency: wallet.currency ?? 'NGN',
    availableBalance: new Prisma.Decimal(wallet.availableBalance ?? '100000.00'),
    pendingWithdrawalBalance: new Prisma.Decimal(wallet.pendingWithdrawalBalance ?? '0.00'),
    version: wallet.version ?? 0,
  }]));
  const tx = {
    $queryRaw: rawQuery,
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(createWithdrawal),
    },
    platformFeeConfiguration: {
      findUnique: jest.fn().mockResolvedValue({
        withdrawalPercentage: new Prisma.Decimal(withdrawalPercentage),
        isActive: true,
        updatedAt: configUpdatedAt,
      }),
    },
    payoutAccount: { findFirst: jest.fn().mockResolvedValue(transactionPayoutAccount) },
    wallet: { update: jest.fn().mockImplementation(({ data }) => ({ availableBalance: data.availableBalance })) },
    financialLedgerEntry: {
      create: failLedger ? jest.fn().mockRejectedValue(new Error('ledger failed')) : jest.fn().mockResolvedValue({}),
    },
  };
  return { tx, rawQuery };
};

beforeEach(() => {
  jest.clearAllMocks();
  configuredWithdrawalPercentage = '0.00';
  configurationUpdatedAt = new Date('2026-10-01T00:00:00.000Z');
  mockPrisma.withdrawal.findUnique.mockResolvedValue(null);
  mockPrisma.platformFeeConfiguration.findUnique.mockImplementation(async () => ({
    withdrawalPercentage: new Prisma.Decimal(configuredWithdrawalPercentage),
    isActive: true,
    updatedAt: configurationUpdatedAt,
  }));
  mockPrisma.payoutAccount.findFirst.mockImplementation(async ({ where }) => (
    where.id === payoutAccountId ? payoutAccount : null
  ));
});

test('withdrawal quote is seeker-bound and cannot be used by another seeker', async () => {
    const quoteReference = await getQuoteReference('100000.00', { subject: otherSeekerId });
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
      .set('Idempotency-Key', 'other-seekers-quote')
      .send({ quoteReference });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WITHDRAWAL_QUOTE_INVALID');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

test('rejects stale withdrawal quote after fee change and creates only from a fresh quote', async () => {
    configuredWithdrawalPercentage = '5.00';
    const originalQuoteResponse = await request(app)
      .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100000.00', currency: 'NGN', payoutAccountId })}`)
      .set('Authorization', `Bearer ${token()}`);
    const originalQuote = originalQuoteResponse.body.data.withdrawalQuote;
    expect(originalQuote).toMatchObject({
      withdrawalFeePercentage: '5.00',
      withdrawalFeeAmount: '5000.00',
      payoutAmount: '95000.00',
    });

    configuredWithdrawalPercentage = '10.00';
    configurationUpdatedAt = new Date('2026-10-01T00:01:00.000Z');
    const staleTx = createTransaction({ withdrawalPercentage: '10.00' }).tx;
    mockPrisma.$transaction.mockImplementation((callback) => callback(staleTx));
    const staleResponse = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'stale-withdrawal-quote')
      .send({ quoteReference: originalQuote.quoteReference });

    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body.error.code).toBe('WITHDRAWAL_QUOTE_STALE');
    expect(staleTx.wallet.update).not.toHaveBeenCalled();
    expect(staleTx.withdrawal.create).not.toHaveBeenCalled();
    expect(staleTx.financialLedgerEntry.create).not.toHaveBeenCalled();

    const freshQuoteResponse = await request(app)
      .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100000.00', currency: 'NGN', payoutAccountId })}`)
      .set('Authorization', `Bearer ${token()}`);
    const freshQuote = freshQuoteResponse.body.data.withdrawalQuote;
    expect(freshQuote).toMatchObject({
      withdrawalFeePercentage: '10.00',
      withdrawalFeeAmount: '10000.00',
      payoutAmount: '90000.00',
    });

    const savedWithdrawal = {
      ...withdrawal,
      amount: new Prisma.Decimal('100000.00'),
      withdrawalFeePercentage: new Prisma.Decimal('10.00'),
      withdrawalFeeAmount: new Prisma.Decimal('10000.00'),
      payoutAmount: new Prisma.Decimal('90000.00'),
    };
    const freshTx = createTransaction({ withdrawalPercentage: '10.00', createWithdrawal: savedWithdrawal }).tx;
    mockPrisma.$transaction.mockImplementation((callback) => callback(freshTx));
    const confirmedResponse = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'fresh-withdrawal-quote')
      .send({ quoteReference: freshQuote.quoteReference });

    expect(confirmedResponse.status).toBe(201);
    expect(confirmedResponse.body.data.withdrawal).toMatchObject({
      amount: '100000.00',
      withdrawalFeePercentage: '10.00',
      withdrawalFeeAmount: '10000.00',
      payoutAmount: '90000.00',
    });
    expect(freshTx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        availableBalance: new Prisma.Decimal('0.00'),
        pendingWithdrawalBalance: new Prisma.Decimal('100000.00'),
      }),
    }));
    expect(freshTx.withdrawal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        withdrawalFeePercentage: new Prisma.Decimal('10.00'),
        withdrawalFeeAmount: new Prisma.Decimal('10000.00'),
        payoutAmount: new Prisma.Decimal('90000.00'),
      }),
    }));
  });
test('seeker withdrawal quote uses the active backend percentage and Decimal amounts', async () => {
  configuredWithdrawalPercentage = '5.00';
  const response = await request(app)
    .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100000.00', currency: 'NGN', payoutAccountId })}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(response.body.data.withdrawalQuote).toEqual({
    amount: '100000.00',
    withdrawalFeePercentage: '5.00',
    withdrawalFeeAmount: '5000.00',
    payoutAmount: '95000.00',
    currency: 'NGN',
    quoteReference: expect.any(String),
    expiresAt: expect.any(String),
  });
});

test('rejects a stored US/USD account when requesting a new withdrawal quote', async () => {
  mockPrisma.payoutAccount.findFirst.mockResolvedValue({
    ...payoutAccount,
    country: 'United States',
    currency: 'USD',
    verifiedAt: null,
    encryptedPayoutMetadata: 'encrypted-us-meta',
  });
  const response = await request(app)
    .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100.00', currency: 'USD', payoutAccountId })}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(404);
  expect(mockPrisma.payoutAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ country: 'Nigeria', currency: 'NGN' }),
  }));
});

test('rejects a client-supplied USD quote request for a Nigerian NGN account', async () => {
  const response = await request(app)
    .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100.00', currency: 'USD', payoutAccountId })}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(422);
});
describe('POST /api/seeker/payments/withdrawals', () => {
  test('reserves wallet funds, creates pending withdrawal, and writes reservation ledger', async () => {
    const { tx, rawQuery } = createTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const quoteReference = await getQuoteReference('30000.00');

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'withdrawal-1')
      .send({ quoteReference });

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

  test('rejects a previously signed USD quote without reserving an NGN wallet', async () => {
    const quoteReference = jwt.sign({
      purpose: 'seeker-withdrawal',
      sub: seekerId,
      amount: '100.00',
      currency: 'USD',
      payoutAccountId,
      payoutAccountVersion: createdAt.toISOString(),
      withdrawalFeePercentage: '0.00',
      withdrawalFeeAmount: '0.00',
      payoutAmount: '100.00',
      configurationVersion: configurationUpdatedAt.toISOString(),
    }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER,
      audience: 'leamjobs-withdrawal-quote',
      expiresIn: '5m',
    });
    const { tx } = createTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'old-usd-quote')
      .send({ quoteReference });

    expect(response.status).toBe(422);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
    expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
  });

  test('rejects a previously signed USD quote for legacy USD account data', async () => {
    configuredWithdrawalPercentage = '5.00';
    const usAccount = {
      ...payoutAccount,
      country: 'United States',
      currency: 'USD',
      verifiedAt: null,
      encryptedPayoutMetadata: 'encrypted-us-meta',
    };
    const quoteReference = jwt.sign({
      purpose: 'seeker-withdrawal',
      sub: seekerId,
      amount: '100.00',
      currency: 'USD',
      payoutAccountId,
      payoutAccountVersion: createdAt.toISOString(),
      withdrawalFeePercentage: '5.00',
      withdrawalFeeAmount: '5.00',
      payoutAmount: '95.00',
      configurationVersion: configurationUpdatedAt.toISOString(),
    }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER,
      audience: 'leamjobs-withdrawal-quote',
      expiresIn: '5m',
    });
    const { tx } = createTransaction({
      wallet: { currency: 'USD', availableBalance: '100.00' },
      payoutAccount: usAccount,
      withdrawalPercentage: '5.00',
    });
    mockPrisma.payoutAccount.findFirst.mockResolvedValue(usAccount);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'old-usd-account-quote')
      .send({ quoteReference });

    expect(response.status).toBe(404);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
    expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
  });
  test('uses a wallet row lock before making the balance decision', async () => {
    const { tx, rawQuery } = createTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'lock-check')
      .send({ quoteReference: await getQuoteReference('1.00') });

    expect(rawQuery).toHaveBeenCalledTimes(2);
    expect(rawQuery.mock.calls[0][0].join(' ')).toContain('FOR UPDATE');
    expect(rawQuery.mock.calls[1][0].join(' ')).toContain('FOR SHARE');
  });

  test('rejects a withdrawal quote after the payout account details have changed', async () => {
    const quoteReference = await getQuoteReference('10000.00');
    const { tx } = createTransaction();
    tx.payoutAccount.findFirst.mockResolvedValue({
      ...payoutAccount,
      updatedAt: new Date(createdAt.getTime() + 1000),
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
      .set('Idempotency-Key', 'changed-payout-account')
      .send({ quoteReference });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('WITHDRAWAL_QUOTE_STALE');
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
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
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects missing idempotency key and client ownership fields', async () => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        amount: '10.00',
        currency: 'NGN',
        payoutAccountId,
        seekerId: otherSeekerId,
        walletId,
        withdrawalFeePercentage: 1,
        withdrawalFeeAmount: '0.10',
        payoutAmount: '9.90',
      });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects client-supplied withdrawal fee and payout amounts even with a valid idempotency key', async () => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'client-fee-values')
      .send({
        amount: '100.00',
        currency: 'NGN',
        payoutAccountId,
        withdrawalFeePercentage: 1,
        withdrawalFeeAmount: '1.00',
        payoutAmount: '99.00',
      });

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
      .send({ quoteReference: await getQuoteReference('100001.00') });

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
      .send({ quoteReference: await getQuoteReference('10.00') });

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
      .send({ quoteReference: await getQuoteReference('100000.00') });

    expect(response.status).toBe(201);
    expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ availableBalance: new Prisma.Decimal('0.00'), pendingWithdrawalBalance: new Prisma.Decimal('100000.00') }),
    }));
  });

  test('serialized wallet locking prevents concurrent requests from overdrawing available funds', async () => {
    let availableBalance = new Prisma.Decimal('100000.00');
    let pendingWithdrawalBalance = new Prisma.Decimal('0.00');
    let transactionTail = Promise.resolve();
    mockPrisma.$transaction.mockImplementation((callback) => {
      const result = transactionTail.then(() => {
        const { tx } = createTransaction({
          wallet: {
            availableBalance: availableBalance.toFixed(2),
            pendingWithdrawalBalance: pendingWithdrawalBalance.toFixed(2),
          },
        });
        tx.wallet.update.mockImplementation(({ data }) => {
          availableBalance = data.availableBalance;
          pendingWithdrawalBalance = data.pendingWithdrawalBalance;
          return { availableBalance };
        });
        return callback(tx);
      });
      transactionTail = result.catch(() => undefined);
      return result;
    });

    const [firstQuote, secondQuote] = await Promise.all([getQuoteReference('60000.00'), getQuoteReference('60000.00')]);
    const results = await Promise.all([
      request(app)
        .post('/api/seeker/payments/withdrawals')
        .set('Authorization', `Bearer ${token()}`)
        .set('Idempotency-Key', 'concurrent-one')
        .send({ quoteReference: firstQuote }),
      request(app)
        .post('/api/seeker/payments/withdrawals')
        .set('Authorization', `Bearer ${token()}`)
        .set('Idempotency-Key', 'concurrent-two')
        .send({ quoteReference: secondQuote }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
    expect(availableBalance.toFixed(2)).toBe('40000.00');
    expect(pendingWithdrawalBalance.toFixed(2)).toBe('60000.00');
  });

  test('stores requested amount, calculated fee, and net payout while reserving the gross request', async () => {
    configuredWithdrawalPercentage = '5.00';
    const expectedWithdrawal = {
      ...withdrawal,
      amount: new Prisma.Decimal('100000.00'),
      withdrawalFeePercentage: new Prisma.Decimal('5.00'),
      withdrawalFeeAmount: new Prisma.Decimal('5000.00'),
      payoutAmount: new Prisma.Decimal('95000.00'),
    };
    const { tx } = createTransaction({
      wallet: { availableBalance: '100000.00' },
      createWithdrawal: expectedWithdrawal,
      withdrawalPercentage: '5.00',
    });
    tx.$queryRaw.mockResolvedValue([{
      id: walletId,
      currency: 'NGN',
      availableBalance: new Prisma.Decimal('100000.00'),
      pendingWithdrawalBalance: new Prisma.Decimal('0.00'),
      version: 0,
    }]);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const quoteReference = await getQuoteReference('100000.00');

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'fee-breakdown')
      .send({ quoteReference });

    expect(response.status).toBe(201);
    expect(response.body.data.withdrawal).toMatchObject({
      amount: '100000.00',
      withdrawalFeePercentage: '5.00',
      withdrawalFeeAmount: '5000.00',
      payoutAmount: '95000.00',
    });
    expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        availableBalance: new Prisma.Decimal('0.00'),
        pendingWithdrawalBalance: new Prisma.Decimal('100000.00'),
      }),
    }));
    expect(tx.withdrawal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: new Prisma.Decimal('100000.00'),
        withdrawalFeePercentage: new Prisma.Decimal('5.00'),
        withdrawalFeeAmount: new Prisma.Decimal('5000.00'),
        payoutAmount: new Prisma.Decimal('95000.00'),
      }),
    }));
  });

  test('rejects a zero-net withdrawal and never reserves funds', async () => {
    mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({
      withdrawalPercentage: new Prisma.Decimal('100.00'),
      isActive: true,
      updatedAt: configurationUpdatedAt,
    });
    const response = await request(app)
      .get(`/api/seeker/payments/withdrawal-quote?${new URLSearchParams({ amount: '100.00', currency: 'NGN', payoutAccountId })}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(422);
  });

  test('rejects a payout account that is not owned by the seeker', async () => {
    const quoteReference = await getQuoteReference('10.00');
    const { tx } = createTransaction();
    tx.payoutAccount.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'wrong-account')
      .send({ quoteReference });

    expect(response.status).toBe(404);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test.each([
    ['disabled', { disabledAt: createdAt, verifiedAt: createdAt }],
    ['unverified', { disabledAt: null, verifiedAt: null }],
  ])('rejects a %s payout account', async (_label, accountState) => {
    const quoteReference = await getQuoteReference('10.00');
    const { tx } = createTransaction();
    tx.payoutAccount.findFirst.mockResolvedValue(null);
    tx.payoutAccount.findFirst.mockImplementation(({ where }) => {
      expect(where).toEqual(expect.objectContaining({
        userId: seekerId,
        provider: 'FLUTTERWAVE',
        payoutMethod: 'BANK_ACCOUNT',
        country: 'Nigeria',
        currency: 'NGN',
        verifiedAt: { not: null },
        disabledAt: null,
      }));
      return Promise.resolve(null);
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', `account-${_label}`)
      .send({ quoteReference });

    expect(response.status).toBe(404);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test('returns the existing withdrawal for an identical idempotent retry', async () => {
    const existing = { ...withdrawal, payoutAccountId, amount: new Prisma.Decimal('30000.00'), currency: 'NGN' };
    const { tx } = createTransaction({ existing });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const quoteReference = await getQuoteReference('30000.00');

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'same-request')
      .send({ quoteReference });

    expect(response.status).toBe(201);
    expect(response.body.data.withdrawal.id).toBe(withdrawalId);
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });

  test('rejects an idempotency key reused with different details', async () => {
    const existing = { ...withdrawal, payoutAccountId, amount: new Prisma.Decimal('30000.00'), currency: 'NGN' };
    const { tx } = createTransaction({ existing });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const quoteReference = await getQuoteReference('40000.00');

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'same-request')
      .send({ quoteReference });

    expect(response.status).toBe(409);
  });

  test('rolls back when ledger creation fails', async () => {
    const { tx } = createTransaction({ failLedger: true });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
    const quoteReference = await getQuoteReference('10.00');

    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'ledger-failure')
      .send({ quoteReference });

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
      .send({ quoteReference: 'unavailable' });

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/seeker/payments/withdrawals')
      .set('Idempotency-Key', 'auth-check')
      .send({ quoteReference: 'unavailable' });

    expect(response.status).toBe(401);
  });
});
