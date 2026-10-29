import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = 'true';
process.env.LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED = 'true';

const adminId = '99999999-9999-4999-8999-999999999999';
const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const walletId = 'wwwwwwww-wwww-4www-8www-wwwwwwwwwwww';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const escrowRecord = ({ status = 'RELEASE_ELIGIBLE', releasedAmount = '0.00', releasedAt = null } = {}) => ({
  id: escrowId,
  freelanceContractId: contractId,
  grossAmount: new Prisma.Decimal('100000.00'),
  platformFeeAmount: new Prisma.Decimal('5000.00'),
  seekerNetAmount: new Prisma.Decimal('95000.00'),
  currency: 'NGN',
  status,
  fundedAmount: new Prisma.Decimal('100000.00'),
  fundedAt: new Date('2026-09-11T09:00:00.000Z'),
  refundedAmount: new Prisma.Decimal('0.00'),
  releasedAmount: new Prisma.Decimal(releasedAmount),
  releasedAt,
  refunds: [],
  payments: [{
    id: 'payment-1',
    provider: 'FLUTTERWAVE',
    providerReference: 'leamjobs_contract_payment_1',
    paymentType: 'CONTRACT_FUNDING',
    amount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    status: 'SUCCESSFUL',
    transactionId: 'provider-transaction-1',
    verifiedAt: new Date('2026-09-11T08:00:00.000Z'),
  }],
  freelanceContract: {
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    completionSubmittedAt: new Date('2026-09-11T10:00:00.000Z'),
    employerCompletionConfirmedAt: new Date('2026-09-11T11:00:00.000Z'),
    workStatus: 'RELEASE_ELIGIBLE',
    contract: { id: contractId, type: 'FREELANCE_PROJECT', status: 'ACTIVE', seekerId },
  },
});

const mockPrisma = {
  user: { findUnique: jest.fn() },
  contract: { findMany: jest.fn(), count: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  dispute: { findFirst: jest.fn() },
  wallet: { update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  financialLedgerEntry: { create: jest.fn() },
  financialAuditLog: { create: jest.fn() },
  conversionOperation: { upsert: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { listReleaseEligibleContracts } = await import('../src/services/adminRelease.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = true;
  env.LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED = true;
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    isActive: true,
    role: where.id === adminId ? 'ADMIN' : where.id === seekerId ? 'SEEKER' : 'EMPLOYER',
  }));
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockImplementation(async (query) => {
    const statement = query.join('');
    if (statement.includes('"Escrow"')) return [{ id: escrowId }];
    if (statement.includes('"Wallet"')) {
      return [{ id: walletId, currency: 'NGN', availableBalance: new Prisma.Decimal('1000.00'), pendingWithdrawalBalance: new Prisma.Decimal('0.00') }];
    }
    return [];
  });
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord());
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
  mockPrisma.wallet.update.mockResolvedValue({ availableBalance: new Prisma.Decimal('96000.00') });
  mockPrisma.financialLedgerEntry.create.mockResolvedValue({ id: 'ledger-id' });
  mockPrisma.financialAuditLog.create.mockResolvedValue({ id: 'audit-id' });
  mockPrisma.escrow.update.mockResolvedValue(escrowRecord({ status: 'RELEASED', releasedAmount: '95000.00', releasedAt: new Date('2026-09-11T12:00:00.000Z') }));
  mockPrisma.freelanceContract.update.mockResolvedValue({});
  mockPrisma.conversionOperation.upsert.mockResolvedValue({
    id: 'conversion-id',
    status: 'BLOCKED',
    statusReason: 'Cross-currency settlement is disabled pending provider and account approval.',
  });
  mockPrisma.conversionOperation.findMany.mockResolvedValue([]);
});

test('unauthenticated users cannot release contract funds', async () => {
  const response = await request(app).post(`/api/admin/contracts/${contractId}/release`);
  expect(response.status).toBe(401);
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('admin reconciliation view is read-only and currency-filtered', async () => {
  mockPrisma.conversionOperation.findMany.mockResolvedValue([{
    id: 'conversion-id',
    escrowId,
    seekerId,
    sourceCurrency: 'USD',
    destinationCurrency: 'NGN',
    sourceAmount: new Prisma.Decimal('95000.00000000'),
    convertedAmount: null,
    status: 'BLOCKED',
    statusReason: 'Cross-currency settlement is disabled.',
    providerTransactionId: null,
    reconciliationAttempts: 0,
    createdAt: new Date('2026-09-11T12:00:00.000Z'),
    updatedAt: new Date('2026-09-11T12:00:00.000Z'),
    lastReconciledAt: null,
    events: [],
  }]);

  const response = await request(app)
    .get('/api/admin/conversion-operations?currency=USD&staleMinutes=1440')
    .set('Authorization', ['Bearer', token('ADMIN', adminId)].join(' '));

  expect(response.status).toBe(200);
  expect(response.body.data.items[0]).toMatchObject({
    sourceCurrency: 'USD',
    destinationCurrency: 'NGN',
    sourceAmount: '95000',
    status: 'BLOCKED',
  });
  expect(mockPrisma.conversionOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      OR: [{ sourceCurrency: 'USD' }, { destinationCurrency: 'USD' }],
      updatedAt: { lt: expect.any(Date) },
    }),
  }));
  expect(mockPrisma.conversionOperation.upsert).not.toHaveBeenCalled();
});

test('release candidates show matched verified funding and review warnings', async () => {
  mockPrisma.contract.findMany.mockResolvedValue([{
    id: contractId,
    job: { id: 'job-id', title: 'Project' },
    employer: { id: employerId, firstName: 'Employer', lastName: 'One', email: 'employer@example.test' },
    seeker: { id: seekerId, firstName: 'Seeker', lastName: 'One', email: 'seeker@example.test' },
    freelanceDetails: {
      agreedAmount: new Prisma.Decimal('100000.00'),
      currency: 'NGN',
      platformFeePercentage: new Prisma.Decimal('5.00'),
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('95000.00'),
      completionSubmittedAt: new Date(),
      employerCompletionConfirmedAt: new Date(),
      workStatus: 'RELEASE_ELIGIBLE',
      escrow: {
        ...escrowRecord(),
        fundedAt: new Date(),
        releaseEligibleAt: new Date(),
        payments: [
          escrowRecord().payments[0],
          {
            id: 'payment-pending',
            provider: 'FLUTTERWAVE',
            providerReference: 'leamjobs_pending_attempt',
            transactionId: null,
            paymentType: 'CONTRACT_FUNDING',
            amount: new Prisma.Decimal('100000.00'),
            currency: 'NGN',
            status: 'PENDING',
            verifiedAt: null,
            createdAt: new Date(),
          },
        ],
        disputes: [{ id: 'dispute-1', status: 'OPEN', openedAt: new Date() }],
        refunds: [{ id: 'refund-1', amount: new Prisma.Decimal('1.00'), currency: 'NGN', provider: 'FLUTTERWAVE', providerReference: 'refund-reference', status: 'PROCESSING', requestedAt: new Date() }],
      },
    },
  }]);
  mockPrisma.contract.count.mockResolvedValue(1);

  const result = await listReleaseEligibleContracts();

  expect(result.contracts[0].freelance.escrow).toMatchObject({
    fundingVerified: true,
    fundingState: 'REFUND_REVIEW',
    matchedFundingPayment: {
      provider: 'FLUTTERWAVE',
      providerReference: 'leamjobs_contract_payment_1',
      transactionId: 'provider-transaction-1',
      amount: '100000.00',
      currency: 'NGN',
    },
    manualReviewIndicators: ['DISPUTE_PRESENT', 'REFUND_REQUIRES_REVIEW', 'MULTIPLE_FUNDING_ATTEMPTS'],
  });
  expect(result.contracts[0].freelance.escrow.refunds[0]).toMatchObject({
    status: 'PROCESSING',
    providerReference: 'refund-reference',
  });
});

test('non-admins cannot access conversion reconciliation records', async () => {
  const response = await request(app)
    .get('/api/admin/conversion-operations')
    .set('Authorization', ['Bearer', token('SEEKER', seekerId)].join(' '));

  expect(response.status).toBe(403);
  expect(mockPrisma.conversionOperation.findMany).not.toHaveBeenCalled();
});

test.each(['SEEKER', 'EMPLOYER'])('%s users cannot release contract funds', async (role) => {
  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token(role, role === 'SEEKER' ? seekerId : employerId)}`);
  expect(response.status).toBe(403);
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('admin release credits seeker NET amount and records one wallet ledger entry', async () => {
  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('Contract funds released successfully');
  expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  expect(mockPrisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: walletId },
    data: { availableBalance: new Prisma.Decimal('96000.00'), version: { increment: 1 } },
  }));
  expect(mockPrisma.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      entryType: 'WALLET_CREDIT',
      amount: new Prisma.Decimal('95000.00'),
      walletId,
      contractId,
      escrowId,
      idempotencyKey: `escrow:${escrowId}:release`,
    }),
  }));
  expect(mockPrisma.financialAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      actorUserId: adminId,
      entityType: 'ESCROW',
      entityId: escrowId,
      action: 'RELEASED',
      fromStatus: 'RELEASE_ELIGIBLE',
      toStatus: 'RELEASED',
      amount: new Prisma.Decimal('95000.00'),
      currency: 'NGN',
      metadata: expect.objectContaining({
        contractId,
        paymentId: 'payment-1',
        provider: 'FLUTTERWAVE',
        providerReference: 'leamjobs_contract_payment_1',
      }),
    }),
  }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'RELEASED', releasedAmount: new Prisma.Decimal('95000.00'), releasedAt: expect.any(Date) },
  }));
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith({
    where: { contractId },
    data: { workStatus: 'RELEASED' },
  });
  expect(mockPrisma.conversionOperation.upsert).not.toHaveBeenCalled();
});

test('disabled escrow-release feature blocks the admin API before financial mutation', async () => {
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = false;

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(503);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.conversionOperation.upsert).not.toHaveBeenCalled();
});

test.each([
    ['a positive refunded amount', { refundedAmount: new Prisma.Decimal('1.00'), refunds: [] }],
    ['an active refund record', { refundedAmount: new Prisma.Decimal('0.00'), refunds: [{ id: 'refund-1', status: 'PROCESSING' }] }],
    ['a pending refund record', { refundedAmount: new Prisma.Decimal('0.00'), refunds: [{ id: 'refund-1', status: 'PENDING' }] }],
  ])('release is blocked by %s before financial mutation', async (_label, refundState) => {
    mockPrisma.escrow.findUnique.mockResolvedValue({ ...escrowRecord(), ...refundState });

    const response = await request(app)
      .post(`/api/admin/contracts/${contractId}/release`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('refund');
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
    expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
    expect(mockPrisma.financialAuditLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  });

  test('release requires a verified successful payment matching the escrow', async () => {
    mockPrisma.escrow.findUnique.mockResolvedValue({
      ...escrowRecord(),
      payments: [{ paymentType: 'CONTRACT_FUNDING', status: 'PENDING', amount: new Prisma.Decimal('100000.00'), currency: 'NGN', transactionId: null, verifiedAt: null }],
    });

    const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(409);
  expect(response.body.message).toContain('verified provider funding payment');
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('cross-currency release persists one blocked operation and leaves escrow unreleased', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue({
    ...escrowRecord(),
    currency: 'USD',
    payments: [{
      paymentType: 'CONTRACT_FUNDING',
      amount: new Prisma.Decimal('100000.00'),
      currency: 'USD',
      status: 'SUCCESSFUL',
      transactionId: 'provider-transaction-usd',
      verifiedAt: new Date('2026-09-11T08:00:00.000Z'),
    }],
    freelanceContract: { ...escrowRecord().freelanceContract, currency: 'USD' },
  });

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', ['Bearer', token('ADMIN', adminId)].join(' '));

  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    success: false,
    data: { conversionBlocked: true, conversionOperation: { status: 'BLOCKED' } },
  });
  expect(mockPrisma.conversionOperation.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { escrowId },
    create: expect.objectContaining({
      sourceCurrency: 'USD',
      destinationCurrency: 'NGN',
      sourceAmount: new Prisma.Decimal('95000.00'),
      status: 'BLOCKED',
      idempotencyKey: `escrow:${escrowId}:currency-conversion`,
    }),
  }));
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
});

test('additive funding release credits only the agreed project amount', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue({
    ...escrowRecord(),
    grossAmount: new Prisma.Decimal('500000.00'),
    platformFeeAmount: new Prisma.Decimal('25000.00'),
    seekerNetAmount: new Prisma.Decimal('500000.00'),
    fundedAmount: new Prisma.Decimal('500000.00'),
    payments: [{
      paymentType: 'CONTRACT_FUNDING',
      amount: new Prisma.Decimal('525000.00'),
      currency: 'NGN',
      status: 'SUCCESSFUL',
      transactionId: 'provider-transaction-2',
      verifiedAt: new Date('2026-09-11T08:00:00.000Z'),
    }],
    freelanceContract: {
      ...escrowRecord().freelanceContract,
      agreedAmount: new Prisma.Decimal('500000.00'),
    },
  });
  mockPrisma.wallet.update.mockResolvedValueOnce({ availableBalance: new Prisma.Decimal('501000.00') });
  mockPrisma.escrow.update.mockResolvedValueOnce(escrowRecord({ status: 'RELEASED', releasedAmount: '500000.00', releasedAt: new Date() }));

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', ['Bearer', token('ADMIN', adminId)].join(' '));

  expect(response.status).toBe(200);
  expect(mockPrisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { availableBalance: new Prisma.Decimal('501000.00'), version: { increment: 1 } },
  }));
  expect(mockPrisma.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WALLET_CREDIT', amount: new Prisma.Decimal('500000.00') }),
  }));
});

test('repeated release is idempotent and does not credit again', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord({ status: 'RELEASED', releasedAmount: '95000.00', releasedAt: new Date() }));

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('Contract funds were already released');
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('release rejects an escrow that is not release eligible', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord({ status: 'FUNDED' }));

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(409);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test.each(['OPEN', 'UNDER_REVIEW', 'RESOLVED_FOR_EMPLOYER', 'RESOLVED_FOR_SEEKER', 'PARTIALLY_RESOLVED', 'CLOSED'])(
  'release rejects a dispute record in %s status',
  async (status) => {
    mockPrisma.dispute.findFirst.mockResolvedValue({ id: 'dispute-id', status });

    const response = await request(app)
      .post(`/api/admin/contracts/${contractId}/release`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('dispute record');
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
    expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
    expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  },
);

test('release requires a seeker wallet and never creates one implicitly', async () => {
  mockPrisma.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([{ id: escrowId }])
    .mockResolvedValueOnce([]);

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(409);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});
