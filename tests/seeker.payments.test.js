import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  wallet: { findUnique: jest.fn() },
  financialLedgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
  withdrawal: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
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
  mockPrisma.wallet.findUnique.mockResolvedValue({ id: walletId, currency: 'NGN', availableBalance: money('1000.00'), pendingWithdrawalBalance: money('250.00') });
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
      totalEarnings: '1250.00',
      totalWithdrawn: '1250.00',
    });
    expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { userId: seekerId },
      select: expect.any(Object),
    });
    expect(mockPrisma.financialLedgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, entryType: 'WALLET_CREDIT' } }));
    expect(mockPrisma.financialLedgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, entryType: 'WITHDRAWAL_SUCCESSFUL' } }));
  });

  test('returns zero summary and empty histories when the seeker has no wallet', async () => {
    mockPrisma.wallet.findUnique.mockResolvedValue(null);

    const summary = await request(app).get('/api/seeker/payments/summary').set('Authorization', `Bearer ${token()}`);
    const payments = await request(app).get('/api/seeker/payments').set('Authorization', `Bearer ${token()}`);

    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({ currency: null, availableBalance: '0.00', pendingWithdrawalBalance: '0.00', totalEarnings: '0.00', totalWithdrawn: '0.00' });
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
    expect(mockPrisma.financialLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId, entryType: 'WALLET_CREDIT' }, take: 2 }));
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
    expect(mockPrisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seekerId } }));
  });

  test.each(['EMPLOYER', 'ADMIN'])('forbids %s from seeker payment endpoints', async (role) => {
    const response = await request(app).get('/api/seeker/payments/summary').set('Authorization', `Bearer ${token(role)}`);
    expect(response.status).toBe(403);
    expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated access and never accepts another owner id', async () => {
    const unauthenticated = await request(app).get('/api/seeker/payments/summary');
    const scoped = await request(app).get(`/api/seeker/payments?userId=${otherSeekerId}`).set('Authorization', `Bearer ${token()}`);

    expect(unauthenticated.status).toBe(401);
    expect(scoped.status).toBe(400);
    expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
  });

  test('returns a server error when the database read fails', async () => {
    mockPrisma.wallet.findUnique.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app).get('/api/seeker/payments/summary').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(500);
  });
});
