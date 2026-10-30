import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  wallet: { findUnique: jest.fn(), findMany: jest.fn() },
  escrow: { aggregate: jest.fn() },
  financialLedgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
  withdrawal: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const employerId = '77777777-7777-4777-8777-777777777777';
const adminId = '88888888-8888-4888-8888-888888888888';
const walletId = '33333333-3333-4333-8333-333333333333';
const ledgerId = '44444444-4444-4444-8444-444444444444';
const withdrawalId = '55555555-5555-4555-8555-555555555555';
const createdAt = new Date('2026-09-05T12:00:00.000Z');

const token = (role = 'SEEKER', sub = seekerId) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const money = (value) => ({ toString: () => value });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    isActive: true,
    role: where.id === seekerId || where.id === otherSeekerId ? 'SEEKER' : where.id === adminId ? 'ADMIN' : 'EMPLOYER',
  }));
  mockPrisma.wallet.findUnique.mockResolvedValue({ id: walletId, currency: 'NGN', availableBalance: money('1000.00'), pendingWithdrawalBalance: money('250.00') });
  mockPrisma.wallet.findMany.mockResolvedValue([{ id: walletId, currency: 'NGN', availableBalance: money('1000.00'), pendingWithdrawalBalance: money('250.00') }]);
  mockPrisma.escrow.aggregate.mockResolvedValue({ _sum: { seekerNetAmount: money('300000.00') } });
  mockPrisma.financialLedgerEntry.aggregate.mockResolvedValue({ _sum: { amount: money('1250.00') } });
  mockPrisma.financialLedgerEntry.findMany.mockResolvedValue([]);
  mockPrisma.withdrawal.findMany.mockResolvedValue([]);
});

describe('seeker read-only payment endpoints', () => {
  test('returns the authenticated seeker wallet summary from the wallet and ledger', async () => {
    const response = await request(app)
      .get('/api/seeker/payments/summary')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      currency: 'NGN',
      availableBalance: '1000.00',
      pendingWithdrawalBalance: '250.00',
      pendingEarnings: '300000.00',
      totalEarnings: '1250.00',
      totalWithdrawn: '1250.00',
      wallets: [{
        currency: 'NGN',
        availableBalance: '1000.00',
        pendingWithdrawalBalance: '250.00',
        pendingEarnings: '300000.00',
        totalEarnings: '1250.00',
        totalWithdrawn: '1250.00',
      }],
      conversionEnabled: false,
    });

    expect(mockPrisma.wallet.findMany).toHaveBeenCalledWith({
      where: { userId: seekerId },
      orderBy: { currency: 'asc' },
      select: expect.any(Object),
    });
    expect(mockPrisma.financialLedgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, currency: 'NGN', entryType: 'WALLET_CREDIT' } }));
    expect(mockPrisma.financialLedgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, currency: 'NGN', entryType: 'WITHDRAWAL_SUCCESSFUL' } }));
  });

  test('returns independent summaries for every existing wallet currency without combining balances', async () => {
    mockPrisma.wallet.findMany.mockResolvedValue([
      { id: walletId, currency: 'NGN', availableBalance: money('1000.00'), pendingWithdrawalBalance: money('25.00') },
      { id: 'usd-wallet', currency: 'USD', availableBalance: money('20.00'), pendingWithdrawalBalance: money('0.00') },
    ]);
    const response = await request(app)
      .get('/api/seeker/payments/summary')
      .set('Authorization', ['Bearer', token()].join(' '));

    expect(response.status).toBe(200);
    expect(response.body.data.wallets.map(({ currency, availableBalance }) => ({ currency, availableBalance }))).toEqual([
      { currency: 'NGN', availableBalance: '1000.00' },
      { currency: 'USD', availableBalance: '20.00' },
    ]);
    expect(response.body.data.availableBalance).toBe('1000.00');
    expect(response.body.data.currency).toBe('NGN');
  });

  test('returns zero summary and empty histories when the seeker has no wallet', async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);
    mockPrisma.wallet.findMany.mockResolvedValue([]);

    const summary = await request(app).get('/api/seeker/payments/summary').set('Authorization', `Bearer ${token()}`);
    const payments = await request(app).get('/api/seeker/payments').set('Authorization', `Bearer ${token()}`);

    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({
      currency: null,
      availableBalance: '0.00',
      pendingWithdrawalBalance: '0.00',
      pendingEarnings: '0.00',
      totalEarnings: '0.00',
      totalWithdrawn: '0.00',
      wallets: [],
      conversionEnabled: false,
    });
    expect(payments.body.data).toEqual({ items: [], nextCursor: null });
  });

  test('returns credited payment history from the authenticated wallet only', async () => {
    mockPrisma.financialLedgerEntry.findMany.mockResolvedValue([{
      id: ledgerId,
      amount: money('900.00'),
      currency: 'NGN',
      description: 'Released project earnings',
      createdAt,
      balanceAfter: money('1000.00'),
      contract: { job: { title: 'Frontend Developer', employer: { employerProfile: { companyName: 'Example Ltd' } } } },
      escrow: { platformFeeAmount: money('100.00') },
    }]);

    const response = await request(app)
      .get('/api/seeker/payments?limit=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({ id: ledgerId, jobTitle: 'Frontend Developer', employerName: 'Example Ltd', amount: '900.00', platformFee: '100.00', netAmount: '900.00', status: 'CREDITED' });
    expect(mockPrisma.financialLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, currency: 'NGN', entryType: 'WALLET_CREDIT' }, take: 2 }));
  });

  test('returns safe transaction and withdrawal fields without encrypted account data', async () => {
    mockPrisma.financialLedgerEntry.findMany.mockResolvedValue([{ id: ledgerId, entryType: 'WALLET_CREDIT', amount: money('900.00'), currency: 'NGN', description: 'Credit', createdAt, balanceAfter: money('900.00') }]);
    mockPrisma.withdrawal.findMany.mockResolvedValue([{ id: withdrawalId, amount: money('500.00'), currency: 'NGN', status: 'PENDING', requestedAt: createdAt, processingAt: null, completedAt: null, failedAt: null, failureReason: null, payoutAccount: { accountNumberLast4: '4280' } }]);

    const transactions = await request(app).get('/api/seeker/payments/transactions').set('Authorization', `Bearer ${token()}`);
    const withdrawals = await request(app).get('/api/seeker/payments/withdrawals').set('Authorization', `Bearer ${token()}`);

    expect(transactions.status).toBe(200);
    expect(withdrawals.status).toBe(200);
    expect(withdrawals.body.data.items[0].paymentMethod).toEqual({ type: 'bank', last4: '4280' });
    expect(JSON.stringify(withdrawals.body)).not.toContain('encryptedAccountNumber');
    expect(mockPrisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seekerId, currency: 'NGN' } }));
  });

  test('validates requested history currency and scopes reads to that wallet', async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: 'usd-wallet',
      currency: 'USD',
      availableBalance: money('20.00'),
      pendingWithdrawalBalance: money('0.00'),
    });
    const response = await request(app)
      .get('/api/seeker/payments/transactions?currency=USD')
      .set('Authorization', ['Bearer', token()].join(' '));

    expect(response.status).toBe(200);
    expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_currency: { userId: seekerId, currency: 'USD' } },
    }));
    expect(mockPrisma.financialLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId: 'usd-wallet', currency: 'USD' },
    }));

    const invalid = await request(app)
      .get('/api/seeker/payments/transactions?currency=EUR')
      .set('Authorization', ['Bearer', token()].join(' '));
    expect(invalid.status).toBe(400);
  });

  test.each([
    ['/api/seeker/payments', 'payments'],
    ['/api/seeker/payments/transactions', 'transactions'],
    ['/api/seeker/payments/withdrawals', 'withdrawals'],
  ])('accepts NGN currency and paginates %s within the authenticated seeker scope', async (endpoint, historyType) => {
    const response = await request(app)
      .get(`${endpoint}?limit=1&currency=NGN&cursor=${ledgerId}`)
      .set('Authorization', ['Bearer', token()].join(' '));

    expect(response.status).toBe(200);
    if (historyType === 'withdrawals') {
      expect(mockPrisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { seekerId, currency: 'NGN' },
        take: 2,
        cursor: { id: ledgerId },
        skip: 1,
      }));
      return;
    }

    expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_currency: { userId: seekerId, currency: 'NGN' } },
    }));
    expect(mockPrisma.financialLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ walletId, currency: 'NGN' }),
      take: 2,
      cursor: { id: ledgerId },
      skip: 1,
    }));
  });

  test.each([
    '/api/seeker/payments',
    '/api/seeker/payments/transactions',
    '/api/seeker/payments/withdrawals',
  ])('rejects unsupported currency for %s before querying payment data', async (endpoint) => {
    const response = await request(app)
      .get(`${endpoint}?currency=EUR`)
      .set('Authorization', ['Bearer', token()].join(' '));

    expect(response.status).toBe(400);
    expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.financialLedgerEntry.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.withdrawal.findMany).not.toHaveBeenCalled();
  });

  test.each([
    '/api/seeker/payments',
    '/api/seeker/payments/transactions',
    '/api/seeker/payments/withdrawals',
  ])('does not allow a client-supplied owner ID on %s', async (endpoint) => {
    const response = await request(app)
      .get(`${endpoint}?userId=${otherSeekerId}`)
      .set('Authorization', ['Bearer', token()].join(' '));

    expect(response.status).toBe(400);
    expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.financialLedgerEntry.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.withdrawal.findMany).not.toHaveBeenCalled();
  });

  test.each([['EMPLOYER', employerId], ['ADMIN', adminId]])('forbids %s from seeker payment endpoints', async (role, subject) => {
    const response = await request(app).get('/api/seeker/payments/summary').set('Authorization', ['Bearer', token(role, subject)].join(' '));
    expect(response.status).toBe(403);
    expect(mockPrisma.wallet.findMany).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated access and never accepts another owner id', async () => {
    const unauthenticated = await request(app).get('/api/seeker/payments/summary');
    const scoped = await request(app).get(`/api/seeker/payments?userId=${otherSeekerId}`).set('Authorization', `Bearer ${token()}`);

    expect(unauthenticated.status).toBe(401);
    expect(scoped.status).toBe(400);
    expect(mockPrisma.wallet.findMany).not.toHaveBeenCalled();
  });

  test('returns a server error when the database read fails', async () => {
    mockPrisma.wallet.findMany.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app).get('/api/seeker/payments/summary').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(500);
  });
});
