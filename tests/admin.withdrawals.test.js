import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const adminId = '99999999-9999-4999-8999-999999999999';
const staffId = '88888888-8888-4888-8888-888888888888';
const withdrawalId = '22222222-2222-4222-8222-222222222222';
const secondWithdrawalId = '33333333-3333-4333-8333-333333333333';
const seekerId = '11111111-1111-4111-8111-111111111111';
let staffHasViewPermission = false;
let staffSuspended = false;
let adminTier = 'SUPER_ADMIN';

const mockPrisma = {
  adminAccount: {
    findUnique: jest.fn(async ({ where }) => ({
      userId: where.userId,
      tier: where.userId === staffId ? 'STAFF_ADMIN' : adminTier,
      suspendedAt: where.userId === staffId && staffSuspended ? new Date() : null,
      user: { id: where.userId, role: 'ADMIN', isActive: true },
    })),
  },
  adminPermission: { findUnique: jest.fn(async ({ where }) => ({ key: where.key, isEnabled: true })) },
  adminPermissionGrant: {
    findUnique: jest.fn(async () => (staffHasViewPermission ? { adminUserId: staffId } : null)),
  },
  authSession: {
    findFirst: jest.fn(async ({ where }) => ({
      userId: where.userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { isActive: true, role: where.id },
    })),
  },
  user: {
    findUnique: jest.fn(async ({ where }) => ({ id: where.id, role: 'ADMIN', isActive: true })),
  },
  withdrawal: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    findUnique: jest.fn(),
  },
  financialLedgerEntry: { groupBy: jest.fn() },
  financialAuditLog: { findMany: jest.fn(), create: jest.fn() },
  providerWebhookEvent: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const token = (subject) => jwt.sign(
  { sub: subject, role: 'ADMIN', sid: 'ADMIN' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' },
);
const auth = (subject) => `Bearer ${token(subject)}`;
const person = { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };
const withdrawalRecord = ({
  id = withdrawalId,
  status = 'FAILED',
  amount = '30.00',
  payoutAmount = '29.00',
  currency = 'NGN',
  walletId = 'wallet-id',
  payoutId = 'payout-id',
  ledgerEntries = [{ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }],
} = {}) => ({
  id,
  walletId,
  amount,
  payoutAmount,
  currency,
  status,
  provider: 'PAYSTACK',
  providerReference: 'lj_wd_reference',
  requestedAt: new Date('2026-04-01T10:00:00.000Z'),
  updatedAt: new Date('2026-04-01T10:10:00.000Z'),
  seeker: person,
  payout: {
    id: payoutId,
    amount: payoutAmount,
    status,
    providerReference: 'lj_wd_reference',
    attempts: [{ providerReference: 'transfer-code-1' }],
  },
  ledgerEntries: ledgerEntries.map((entry) => ({
    payoutId,
    walletId,
    currency,
    amount: entry.entryType === 'WITHDRAWAL_SUCCESSFUL' ? payoutAmount : amount,
    ...entry,
  })),
});

beforeEach(() => {
  jest.clearAllMocks();
  staffHasViewPermission = false;
  staffSuspended = false;
  adminTier = 'SUPER_ADMIN';
  mockPrisma.withdrawal.findMany.mockResolvedValue([]);
  mockPrisma.withdrawal.groupBy.mockResolvedValue([]);
  mockPrisma.withdrawal.findUnique.mockResolvedValue(null);
  mockPrisma.financialLedgerEntry.groupBy.mockResolvedValue([]);
  mockPrisma.financialAuditLog.findMany.mockResolvedValue([]);
  mockPrisma.financialAuditLog.create.mockResolvedValue({});
  mockPrisma.providerWebhookEvent.findMany.mockResolvedValue([]);
});

test('requires authentication and the dedicated withdrawal-view permission', async () => {
  expect((await request(app).get('/api/admin/withdrawals')).status).toBe(401);

  const denied = await request(app).get('/api/admin/withdrawals').set('Authorization', auth(staffId));
  expect(denied.status).toBe(403);

  staffHasViewPermission = true;
  const allowed = await request(app).get('/api/admin/withdrawals').set('Authorization', auth(staffId));
  expect(allowed.status).toBe(200);
  expect(mockPrisma.adminPermissionGrant.findUnique).toHaveBeenCalledWith({
    where: { adminUserId_permissionKey: { adminUserId: staffId, permissionKey: 'finance.withdrawals.view' } },
    select: { adminUserId: true },
  });

  staffSuspended = true;
  const suspended = await request(app).get('/api/admin/withdrawals').set('Authorization', auth(staffId));
  expect(suspended.status).toBe(403);
});

test('Super Admin can view paginated records and currency-specific summary totals', async () => {
  mockPrisma.withdrawal.findMany
    .mockResolvedValueOnce([
    withdrawalRecord({
      status: 'PROCESSING',
      amount: '50.00',
      ledgerEntries: [],
    }),
    withdrawalRecord({
      id: secondWithdrawalId,
      ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }, { entryType: 'WITHDRAWAL_FAILED_REVERSAL' }],
    }),
    ])
    .mockResolvedValueOnce([withdrawalRecord({
      id: secondWithdrawalId,
      ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }, { entryType: 'WITHDRAWAL_FAILED_REVERSAL' }],
    })])
    .mockResolvedValueOnce([withdrawalRecord({
      id: '77777777-7777-4777-8777-777777777777',
      status: 'SUCCESSFUL',
      amount: '25.00',
      payoutAmount: '24.00',
      currency: 'USD',
      walletId: 'usd-wallet',
      payoutId: 'usd-payout',
      ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }],
    })]);
  mockPrisma.withdrawal.groupBy
    .mockResolvedValueOnce([
      { currency: 'NGN', status: 'PROCESSING', _count: { _all: 1 }, _sum: { amount: '50.00', payoutAmount: '48.00' } },
      { currency: 'NGN', status: 'FAILED', _count: { _all: 1 }, _sum: { amount: '30.00', payoutAmount: '30.00' } },
      { currency: 'USD', status: 'SUCCESSFUL', _count: { _all: 1 }, _sum: { amount: '25.00', payoutAmount: '24.00' } },
    ]);
  const response = await request(app)
    .get('/api/admin/withdrawals?limit=1')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.items).toHaveLength(1);
  expect(response.body.data.items[0].status).toBe('PROCESSING');
  expect(response.body.data.nextCursor).toBe(withdrawalId);
  expect(response.body.data.summaryByCurrency).toEqual(expect.arrayContaining([
    expect.objectContaining({ currency: 'NGN', totalWithdrawals: 2, processing: 1, failed: 0, reversed: 1, totalAwaitingProcessing: '48.00' }),
    expect.objectContaining({ currency: 'USD', totalWithdrawals: 1, successful: 1, totalSuccessfullyPaid: '24.00' }),
  ]));
  expect(mockPrisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: 'SUCCESSFUL' }),
    select: expect.objectContaining({
      ledgerEntries: expect.any(Object),
      payoutAmount: true,
    }),
  }));
});

test('list applies server-side lifecycle, seeker, provider, currency, and date filters', async () => {
  const response = await request(app)
    .get('/api/admin/withdrawals?status=REVERSED&provider=PAYSTACK&currency=ngn&from=2026-04-01&to=2026-04-30&search=transfer-code-1&seeker=ada%40example.com')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  const query = mockPrisma.withdrawal.findMany.mock.calls[0][0];
  expect(query.where.currency).toBe('NGN');
  expect(query.where.provider).toBe('PAYSTACK');
  expect(query.where.requestedAt.gte).toEqual(new Date('2026-04-01T00:00:00.000Z'));
  expect(query.where.requestedAt.lt).toEqual(new Date('2026-05-01T00:00:00.000Z'));
  expect(query.where.AND).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'FAILED' }),
    ...[
      { ledgerEntries: { some: { entryType: 'WITHDRAWAL_SUCCESSFUL' } } },
      { ledgerEntries: { some: { entryType: 'WITHDRAWAL_FAILED_REVERSAL' } } },
    ],
  ]));
  expect(query.where.AND[0].OR).toEqual(expect.arrayContaining([
    expect.objectContaining({ payout: expect.any(Object) }),
    expect.objectContaining({ seeker: expect.any(Object) }),
  ]));
});

test('search supports withdrawal IDs and seeker names', async () => {
  const byId = await request(app)
    .get(`/api/admin/withdrawals?search=${withdrawalId}`)
    .set('Authorization', auth(adminId));

  expect(byId.status).toBe(200);
  expect(mockPrisma.withdrawal.findMany.mock.calls[0][0].where.AND[0].OR).toContainEqual({ id: withdrawalId });

  const bySeeker = await request(app)
    .get('/api/admin/withdrawals?search=Ada%20Lovelace')
    .set('Authorization', auth(adminId));

  expect(bySeeker.status).toBe(200);
  const seekerSearchQuery = mockPrisma.withdrawal.findMany.mock.calls
    .map(([query]) => query)
    .find(({ where }) => where.AND?.[0]?.OR?.some((clause) => clause.seeker?.is?.AND));
  expect(seekerSearchQuery.where.AND[0].OR).toContainEqual({
    seeker: {
      is: {
        AND: [
          { OR: [
            { firstName: { contains: 'Ada', mode: 'insensitive' } },
            { lastName: { contains: 'Ada', mode: 'insensitive' } },
            { email: { contains: 'Ada', mode: 'insensitive' } },
          ] },
          { OR: [
            { firstName: { contains: 'Lovelace', mode: 'insensitive' } },
            { lastName: { contains: 'Lovelace', mode: 'insensitive' } },
            { email: { contains: 'Lovelace', mode: 'insensitive' } },
          ] },
        ],
      },
    },
  });
});

test('successful, unknown processing, failed, reversed, and cancelled statuses remain distinct', async () => {
  const lifecycleRecords = [
    withdrawalRecord({ status: 'SUCCESSFUL', ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }] }),
    withdrawalRecord({ id: '77777777-7777-4777-8777-777777777777', status: 'SUCCESSFUL', ledgerEntries: [] }),
    withdrawalRecord({ id: secondWithdrawalId, status: 'PROCESSING', ledgerEntries: [] }),
    withdrawalRecord({ id: '44444444-4444-4444-8444-444444444444', status: 'FAILED', ledgerEntries: [{ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }] }),
    withdrawalRecord({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'FAILED',
      ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }, { entryType: 'WITHDRAWAL_FAILED_REVERSAL' }],
    }),
    withdrawalRecord({ id: '66666666-6666-4666-8666-666666666666', status: 'CANCELLED', ledgerEntries: [] }),
  ];
  mockPrisma.withdrawal.findMany.mockImplementation(async ({ where }) => {
    const status = where.status ?? where.AND?.find((condition) => condition.status)?.status;
    if (status) return lifecycleRecords.filter((record) => record.status === status);
    return lifecycleRecords;
  });
  mockPrisma.withdrawal.groupBy.mockResolvedValueOnce([
    { currency: 'NGN', status: 'SUCCESSFUL', _count: { _all: 2 }, _sum: { amount: '60.00', payoutAmount: '58.00' } },
    { currency: 'NGN', status: 'PROCESSING', _count: { _all: 1 }, _sum: { amount: '30.00', payoutAmount: '29.00' } },
    { currency: 'NGN', status: 'FAILED', _count: { _all: 2 }, _sum: { amount: '60.00', payoutAmount: '58.00' } },
    { currency: 'NGN', status: 'CANCELLED', _count: { _all: 1 }, _sum: { amount: '30.00', payoutAmount: '29.00' } },
  ]);
  mockPrisma.financialLedgerEntry.groupBy.mockResolvedValue([{ currency: 'NGN', _sum: { amount: '29.00' } }]);
  mockPrisma.providerWebhookEvent.findMany.mockResolvedValue([
    { id: '77777777-7777-4777-8777-777777777777', provider: 'PAYSTACK', eventType: 'transfer.failed', createdAt: new Date(), processedAt: new Date() },
    { id: '88888888-8888-4888-8888-888888888888', provider: 'PAYSTACK', eventType: 'transfer.failed', createdAt: new Date(), processedAt: new Date() },
  ]);

  const response = await request(app)
    .get('/api/admin/withdrawals')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.items.map(({ status }) => status)).toEqual([
    'SUCCESSFUL', 'PROCESSING', 'PROCESSING', 'FAILED', 'REVERSED', 'CANCELLED',
  ]);
  expect(response.body.data.summaryByCurrency[0]).toEqual(expect.objectContaining({
    totalWithdrawals: 6,
    successful: 1,
    processing: 2,
    failed: 1,
    reversed: 1,
    cancelled: 1,
    totalAwaitingProcessing: '58.00',
  }));
  expect(mockPrisma.providerWebhookEvent.findMany).not.toHaveBeenCalled();

  const cancelledResponse = await request(app)
    .get('/api/admin/withdrawals?status=CANCELLED')
    .set('Authorization', auth(adminId));
  expect(cancelledResponse.status).toBe(200);
  const cancelledFilterQuery = mockPrisma.withdrawal.findMany.mock.calls
    .map(([query]) => query)
    .find(({ where }) => where.AND?.some((condition) => condition.status === 'CANCELLED'));
  expect(cancelledFilterQuery.where.AND).toContainEqual({ status: 'CANCELLED' });
});

test('processing filter includes successful records without confirmation evidence and matches its summary', async () => {
  const pendingConfirmation = withdrawalRecord({
    id: '77777777-7777-4777-8777-777777777777',
    status: 'SUCCESSFUL',
    ledgerEntries: [],
  });
  const confirmedSuccess = withdrawalRecord({
    id: '66666666-6666-4666-8666-666666666666',
    status: 'SUCCESSFUL',
    ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }],
  });
  const processingWithdrawal = withdrawalRecord({
    id: secondWithdrawalId,
    status: 'PROCESSING',
    ledgerEntries: [],
  });
  mockPrisma.withdrawal.findMany.mockImplementation(async ({ where }) => {
    if (where.status === 'SUCCESSFUL') return [pendingConfirmation, confirmedSuccess];
    if (where.AND?.some((condition) => condition.OR?.some(({ status }) => status === 'PROCESSING'))) {
      return [pendingConfirmation, confirmedSuccess, processingWithdrawal];
    }
    return [];
  });
  mockPrisma.withdrawal.groupBy.mockResolvedValueOnce([
    { currency: 'NGN', status: 'PROCESSING', _count: { _all: 1 }, _sum: { amount: '30.00', payoutAmount: '29.00' } },
    { currency: 'NGN', status: 'SUCCESSFUL', _count: { _all: 2 }, _sum: { amount: '60.00', payoutAmount: '58.00' } },
  ]);

  const response = await request(app)
    .get('/api/admin/withdrawals?status=PROCESSING')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.items.map(({ id }) => id)).toEqual(expect.arrayContaining([
    pendingConfirmation.id,
    processingWithdrawal.id,
  ]));
  expect(response.body.data.items.every(({ status }) => status === 'PROCESSING')).toBe(true);
  expect(response.body.data.summaryByCurrency[0]).toEqual(expect.objectContaining({
    totalWithdrawals: 2,
    processing: 2,
    successful: 0,
    totalSuccessfullyPaid: '0.00',
    totalAwaitingProcessing: '58.00',
  }));
});

test('failed withdrawals without prior success evidence remain failed', async () => {
  mockPrisma.withdrawal.findMany.mockResolvedValue([withdrawalRecord()]);
  const response = await request(app)
    .get('/api/admin/withdrawals')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.items[0].status).toBe('FAILED');
});

test('only ledger-backed reversals become reversed and webhook rows never increase withdrawal counts', async () => {
  mockPrisma.withdrawal.findMany.mockResolvedValue([
    withdrawalRecord({
      ledgerEntries: [
        { entryType: 'WITHDRAWAL_SUCCESSFUL' },
        { entryType: 'WITHDRAWAL_FAILED_REVERSAL', payoutId: 'unrelated-payout' },
      ],
    }),
    withdrawalRecord({
      id: '44444444-4444-4444-8444-444444444444',
      ledgerEntries: [
        { entryType: 'WITHDRAWAL_SUCCESSFUL' },
        { entryType: 'WITHDRAWAL_FAILED_REVERSAL', amount: '99.00' },
      ],
    }),
    withdrawalRecord({
      id: secondWithdrawalId,
      ledgerEntries: [{ entryType: 'WITHDRAWAL_SUCCESSFUL' }, { entryType: 'WITHDRAWAL_FAILED_REVERSAL' }],
    }),
  ]);
  mockPrisma.withdrawal.groupBy
    .mockResolvedValueOnce([{ currency: 'NGN', status: 'FAILED', _count: { _all: 3 }, _sum: { amount: '90.00', payoutAmount: '87.00' } }]);

  const response = await request(app)
    .get('/api/admin/withdrawals')
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.items.map(({ status }) => status)).toEqual(['FAILED', 'FAILED', 'REVERSED']);
  expect(response.body.data.summaryByCurrency[0]).toEqual(expect.objectContaining({
    totalWithdrawals: 3,
    failed: 2,
    reversed: 1,
  }));
  expect(mockPrisma.providerWebhookEvent.findMany).not.toHaveBeenCalled();
});

test('detail masks account information, sanitizes provider messages, and uses actual ledger and webhook events', async () => {
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    walletId: 'wallet-id',
    seekerId,
    amount: '35.00',
    withdrawalFeeAmount: '1.00',
    payoutAmount: '34.00',
    currency: 'NGN',
    status: 'FAILED',
    provider: 'PAYSTACK',
    providerReference: 'lj_wd_reference',
    payoutMethodSnapshot: 'BANK',
    payoutCountrySnapshot: 'Nigeria',
    bankNameSnapshot: 'Test Bank',
    accountNameSnapshot: 'Ada Lovelace',
    accountNumberLast4Snapshot: '1234',
    encryptedAccountNumberSnapshot: 'must-not-return',
    requestedAt: new Date('2026-04-01T10:00:00.000Z'),
    processingAt: new Date('2026-04-01T10:05:00.000Z'),
    completedAt: null,
    failedAt: new Date('2026-04-01T10:10:00.000Z'),
    failureReason: 'Provider token=super-secret account 123456789',
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
    updatedAt: new Date('2026-04-01T10:10:00.000Z'),
    seeker: person,
    payout: {
      id: '44444444-4444-4444-8444-444444444444',
      amount: '34.00',
      currency: 'NGN',
      provider: 'PAYSTACK',
      providerReference: 'lj_wd_reference',
      status: 'FAILED',
      requestedAt: new Date('2026-04-01T10:01:00.000Z'),
      processedAt: null,
      failedAt: new Date('2026-04-01T10:10:00.000Z'),
      failureReason: 'Provider token=secret',
      createdAt: new Date('2026-04-01T10:01:00.000Z'),
      updatedAt: new Date('2026-04-01T10:10:00.000Z'),
      attempts: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          attemptNumber: 1,
          providerReference: 'transfer-code-1',
          status: 'FAILED',
          failureReason: 'token=attempt-secret',
          createdAt: new Date('2026-04-01T10:02:00.000Z'),
          updatedAt: new Date('2026-04-01T10:10:00.000Z'),
          processedAt: new Date('2026-04-01T10:10:00.000Z'),
        },
        {
          id: '88888888-8888-4888-8888-888888888888',
          attemptNumber: 2,
          providerReference: 'transfer-code-2',
          status: 'PROCESSING',
          failureReason: null,
          createdAt: new Date('2026-04-01T10:11:00.000Z'),
          updatedAt: null,
          processedAt: null,
        },
      ],
    },
    ledgerEntries: [{
      id: '66666666-6666-4666-8666-666666666666',
      entryType: 'WITHDRAWAL_FAILED_REVERSAL',
      amount: '35.00',
      currency: 'NGN',
      createdAt: new Date('2026-04-01T10:10:00.000Z'),
      payoutId: '44444444-4444-4444-8444-444444444444',
    }],
  });
  mockPrisma.providerWebhookEvent.findMany.mockResolvedValue([{
    id: '77777777-7777-4777-8777-777777777777',
    provider: 'PAYSTACK',
    eventType: 'transfer.failed',
    attempts: 1,
    lastError: null,
    createdAt: new Date('2026-04-01T10:09:00.000Z'),
    processedAt: new Date('2026-04-01T10:10:00.000Z'),
  }]);
  mockPrisma.financialAuditLog.findMany.mockResolvedValue([{
    id: '99999999-9999-4999-8999-999999999998',
    action: 'RECONCILED',
    toStatus: 'PROCESSING',
    reason: 'Provider reconciliation attempted',
    createdAt: new Date('2026-04-01T10:08:00.000Z'),
  }]);

  const response = await request(app)
    .get(`/api/admin/withdrawals/${withdrawalId}`)
    .set('Authorization', auth(adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.status).toBe('FAILED');
  expect(response.body.data.bankDestination.maskedAccountNumber).toBe('•••• 1234');
  expect(JSON.stringify(response.body)).not.toContain('must-not-return');
  expect(JSON.stringify(response.body)).not.toContain('super-secret');
  expect(response.body.data.payout.attempts).toEqual(expect.arrayContaining([expect.objectContaining({
    id: '55555555-5555-4555-8555-555555555555',
    failureReason: 'token=[redacted]',
  })]));
  expect(response.body.data.payout.attempts).toHaveLength(2);
  expect(response.body.data.payout.attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: '55555555-5555-4555-8555-555555555555', updatedAt: '2026-04-01T10:10:00.000Z' }),
    expect.objectContaining({ id: '88888888-8888-4888-8888-888888888888', updatedAt: null }),
  ]));
  expect(response.body.data.webhookEvents).toHaveLength(1);
  expect(response.body.data.timeline.some(({ title }) => title === 'Provider webhook received')).toBe(true);
  expect(response.body.data.providerInfo.lastReconciliationAt).toBe('2026-04-01T10:08:00.000Z');
  expect(response.body.data.providerInfo.reconciliationTimestampRecorded).toBe(true);
  expect(response.body.data.timeline.some(({ title }) => title === 'Provider reconciliation attempted')).toBe(true);
});
