import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const adminId = '99999999-9999-4999-8999-999999999999';
const employerId = '11111111-1111-4111-8111-111111111111';
const otherEmployerId = '22222222-2222-4222-8222-222222222222';
const seekerId = '33333333-3333-4333-8333-333333333333';
const otherSeekerId = '44444444-4444-4444-8444-444444444444';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const disputeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const walletId = 'wwwwwwww-wwww-4www-8www-wwwwwwwwwwww';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const fundedEscrow = (status = 'FUNDED') => ({
  id: escrowId,
  freelanceContractId: contractId,
  grossAmount: new Prisma.Decimal('100000.00'),
  platformFeeAmount: new Prisma.Decimal('5000.00'),
  seekerNetAmount: new Prisma.Decimal('95000.00'),
  currency: 'NGN',
  fundedAmount: new Prisma.Decimal('100000.00'),
  releasedAmount: new Prisma.Decimal('0.00'),
  refundedAmount: new Prisma.Decimal('0.00'),
  status,
  releasedAt: null,
  freelanceContract: {
    contractId,
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    completionSubmittedAt: new Date('2026-10-01T10:00:00.000Z'),
    employerCompletionConfirmedAt: new Date('2026-10-01T11:00:00.000Z'),
    workStatus: 'RELEASE_ELIGIBLE',
    contract: {
      id: contractId,
      type: 'FREELANCE_PROJECT',
      status: 'ACTIVE',
      employerId,
      seekerId,
    },
  },
});

const mockPrisma = {
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  dispute: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  wallet: { update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  financialLedgerEntry: { create: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');
const { submitContractDispute, resolveContractDispute } = await import('../src/services/contractDispute.service.js');
const { releaseContractFunds } = await import('../src/services/adminRelease.service.js');

let currentEscrow;
let currentDispute;
let transactionTail;

beforeEach(() => {
  jest.clearAllMocks();
  currentEscrow = fundedEscrow();
  currentDispute = null;
  transactionTail = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const transaction = transactionTail.then(() => callback(mockPrisma));
    transactionTail = transaction.catch(() => undefined);
    return transaction;
  });
  mockPrisma.$queryRaw.mockImplementation(async (query) => (
    query.join('').includes('"Wallet"')
      ? [{ id: walletId, currency: 'NGN', availableBalance: new Prisma.Decimal('1000.00'), pendingWithdrawalBalance: new Prisma.Decimal('0.00') }]
      : [{ id: escrowId }]
  ));
  mockPrisma.escrow.findUnique.mockImplementation(async () => currentEscrow);
  mockPrisma.escrow.update.mockImplementation(async ({ data }) => {
    currentEscrow = { ...currentEscrow, ...data };
    return currentEscrow;
  });
  mockPrisma.dispute.findFirst.mockImplementation(async ({ where }) => {
    if (!currentDispute) return null;
    if (where.id && where.id !== currentDispute.id) return null;
    if (where.contractId && where.contractId !== currentDispute.contractId) return null;
    if (where.escrowId && where.escrowId !== currentDispute.escrowId) return null;
    return currentDispute;
  });
  mockPrisma.dispute.findMany.mockResolvedValue([]);
  mockPrisma.dispute.count.mockResolvedValue(0);
  mockPrisma.dispute.create.mockImplementation(async ({ data }) => {
    currentDispute = {
      id: disputeId,
      resolutionNote: null,
      resolvedById: null,
      openedAt: new Date('2026-10-09T05:00:00.000Z'),
      resolvedAt: null,
      ...data,
    };
    return currentDispute;
  });
  mockPrisma.dispute.update.mockImplementation(async ({ data }) => {
    currentDispute = { ...currentDispute, ...data };
    return currentDispute;
  });
  mockPrisma.wallet.update.mockResolvedValue({ availableBalance: new Prisma.Decimal('96000.00') });
  mockPrisma.financialLedgerEntry.create.mockResolvedValue({ id: 'ledger-id' });
  mockPrisma.freelanceContract.update.mockResolvedValue({});
});

const adminDisputeRow = () => ({
  id: disputeId,
  contractId,
  escrowId,
  openedByUserId: employerId,
  status: 'OPEN',
  reason: 'The agreed project requirements were not met.',
  resolutionNote: null,
  resolvedById: null,
  openedAt: new Date('2026-10-09T05:00:00.000Z'),
  resolvedAt: null,
  createdAt: new Date('2026-10-09T05:00:00.000Z'),
  updatedAt: new Date('2026-10-09T05:00:00.000Z'),
  openedBy: { id: employerId, firstName: 'Employer', lastName: 'One' },
  resolvedBy: null,
  contract: {
    id: contractId,
    type: 'FREELANCE_PROJECT',
    status: 'ACTIVE',
    startDate: null,
    expectedEndDate: null,
    createdAt: new Date('2026-09-09T05:00:00.000Z'),
    job: { id: 'job-id', title: 'Project' },
    employer: { id: employerId, firstName: 'Employer', lastName: 'One' },
    seeker: { id: seekerId, firstName: 'Candidate', lastName: 'One' },
    freelanceDetails: {
      agreedAmount: new Prisma.Decimal('100000.00'),
      currency: 'NGN',
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('95000.00'),
      workStatus: 'IN_PROGRESS',
    },
  },
  escrow: {
    id: escrowId,
    status: 'DISPUTED',
    grossAmount: new Prisma.Decimal('100000.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('95000.00'),
    fundedAmount: new Prisma.Decimal('100000.00'),
    releasedAmount: new Prisma.Decimal('0.00'),
    refundedAmount: new Prisma.Decimal('0.00'),
    currency: 'NGN',
    fundedAt: new Date('2026-09-10T05:00:00.000Z'),
    releaseEligibleAt: null,
    releasedAt: null,
    payments: [{
      id: 'payment-id',
      amount: new Prisma.Decimal('100000.00'),
      currency: 'NGN',
      status: 'SUCCEEDED',
      paymentType: 'CONTRACT_FUNDING',
      provider: 'FLUTTERWAVE',
      verifiedAt: new Date('2026-09-10T05:00:00.000Z'),
      createdAt: new Date('2026-09-10T04:00:00.000Z'),
    }],
    ledgerEntries: [{
      id: 'ledger-id',
      entryType: 'ESCROW_FUNDING',
      amount: new Prisma.Decimal('100000.00'),
      currency: 'NGN',
      createdAt: new Date('2026-09-10T05:01:00.000Z'),
    }],
  },
});

test('admin dispute list is authorized, paginated, stable, and returns allowlisted data only', async () => {
  mockPrisma.dispute.findMany.mockResolvedValue([adminDisputeRow()]);
  mockPrisma.dispute.count.mockResolvedValue(21);
  const authorization = ['Bearer', token('ADMIN', adminId)].join(' ');
  const before = { status: currentEscrow.status, fundedAmount: currentEscrow.fundedAmount.toFixed(2) };

  const response = await request(app)
    .get('/api/admin/disputes?page=2&limit=10')
    .set('Authorization', authorization);

  expect(response.status).toBe(200);
  expect(response.body.data.pagination).toEqual({
    page: 2, limit: 10, total: 21, totalPages: 3, hasNextPage: true, hasPreviousPage: true,
  });
  expect(response.body.data.disputes[0]).toMatchObject({
    status: 'OPEN',
    reason: 'The agreed project requirements were not met.',
    contract: {
      employer: { id: employerId, firstName: 'Employer', lastName: 'One' },
      candidate: { id: seekerId, firstName: 'Candidate', lastName: 'One' },
    },
    escrow: {
      status: 'DISPUTED',
      fundedAmount: '100000.00',
      payments: [{ status: 'SUCCEEDED', provider: 'FLUTTERWAVE' }],
      ledgerEntries: [{ entryType: 'ESCROW_FUNDING', amount: '100000.00' }],
    },
  });
  expect(response.body.data.disputes[0].escrow.payments[0]).not.toHaveProperty('providerReference');
  expect(response.body.data.disputes[0].contract.employer).not.toHaveProperty('email');
  expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: 10,
    take: 10,
  }));
  expect({ status: currentEscrow.status, fundedAmount: currentEscrow.fundedAmount.toFixed(2) }).toEqual(before);
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('dispute discovery rejects unauthenticated and non-admin users', async () => {
  const unauthenticated = await request(app).get('/api/admin/disputes');
  const nonAdmin = await request(app)
    .get('/api/admin/disputes')
    .set('Authorization', ['Bearer', token('EMPLOYER', employerId)].join(' '));

  expect(unauthenticated.status).toBe(401);
  expect(nonAdmin.status).toBe(403);
  expect(mockPrisma.dispute.findMany).not.toHaveBeenCalled();
});

test('admin dispute detail validates identifiers and returns 404 for missing disputes', async () => {
  const authorization = ['Bearer', token('ADMIN', adminId)].join(' ');
  const invalid = await request(app)
    .get('/api/admin/disputes/not-a-uuid')
    .set('Authorization', authorization);
  const missing = await request(app)
    .get(`/api/admin/disputes/${disputeId}`)
    .set('Authorization', authorization);

  expect(invalid.status).toBe(400);
  expect(missing.status).toBe(404);
  expect(mockPrisma.dispute.findFirst).toHaveBeenCalled();
});

test('admin dispute detail returns selected financial context without mutating it', async () => {
  mockPrisma.dispute.findFirst.mockResolvedValue(adminDisputeRow());
  const authorization = ['Bearer', token('ADMIN', adminId)].join(' ');
  const before = {
    status: currentEscrow.status,
    fundedAmount: currentEscrow.fundedAmount.toFixed(2),
  };

  const response = await request(app)
    .get(`/api/admin/disputes/${disputeId}`)
    .set('Authorization', authorization);

  expect(response.status).toBe(200);
  expect(response.body.data.dispute).toMatchObject({
    status: 'OPEN',
    contract: { candidate: { id: seekerId }, freelance: { agreedAmount: '100000.00' } },
    escrow: { status: 'DISPUTED', payments: [{ status: 'SUCCEEDED' }] },
  });
  expect(response.body.data.dispute.escrow.payments[0]).not.toHaveProperty('metadata');
  expect(response.body.data.dispute.escrow.ledgerEntries[0]).not.toHaveProperty('idempotencyKey');
  expect({ status: currentEscrow.status, fundedAmount: currentEscrow.fundedAmount.toFixed(2) }).toEqual(before);
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test.each([
  ['EMPLOYER', employerId, '/api/employer'],
  ['SEEKER', seekerId, '/api/seeker'],
])('%s can dispute their own funded freelance contract', async (role, userId, path) => {
  const response = await request(app)
    .post(`${path}/contracts/${contractId}/disputes`)
    .set('Authorization', ['Bearer', token(role, userId)].join(' '))
    .send({ reason: 'The agreed project requirements were not met.' });

  expect(response.status).toBe(201);
  expect(response.body.data.dispute.status).toBe('OPEN');
  expect(response.body.data.dispute.escrowStatus).toBe('DISPUTED');
  expect(mockPrisma.dispute.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      contractId,
      escrowId,
      openedByUserId: userId,
      status: 'OPEN',
    }),
  }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith({
    where: { id: escrowId },
    data: { status: 'DISPUTED' },
  });
  expect(currentEscrow.grossAmount).toEqual(new Prisma.Decimal('100000.00'));
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test.each([
  ['EMPLOYER', otherEmployerId, '/api/employer'],
  ['SEEKER', otherSeekerId, '/api/seeker'],
])('%s cannot dispute a contract they do not own', async (role, userId, path) => {
  const response = await request(app)
    .post(`${path}/contracts/${contractId}/disputes`)
    .set('Authorization', ['Bearer', token(role, userId)].join(' '))
    .send({ reason: 'The agreed project requirements were not met.' });

  expect(response.status).toBe(404);
  expect(mockPrisma.dispute.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('duplicate dispute submissions are rejected after the first dispute is recorded', async () => {
  const path = `/api/employer/contracts/${contractId}/disputes`;
  const authorization = ['Bearer', token('EMPLOYER', employerId)].join(' ');
  const first = await request(app).post(path).set('Authorization', authorization)
    .send({ reason: 'The agreed project requirements were not met.' });
  const second = await request(app).post(path).set('Authorization', authorization)
    .send({ reason: 'The agreed project requirements were not met.' });

  expect(first.status).toBe(201);
  expect(second.status).toBe(409);
  expect(mockPrisma.dispute.create).toHaveBeenCalledTimes(1);
});

test('invalid or unfunded contracts cannot enter the dispute lifecycle', async () => {
  currentEscrow = null;
  const noEscrow = await submitContractDispute({
    contractId,
    userId: employerId,
    role: 'EMPLOYER',
    reason: 'The agreed project requirements were not met.',
  }).catch((error) => error);
  expect(noEscrow.status).toBe(404);

  currentEscrow = {
    ...fundedEscrow(),
    freelanceContract: {
      ...fundedEscrow().freelanceContract,
      contract: { ...fundedEscrow().freelanceContract.contract, type: 'CONTRACT_PROJECT' },
    },
  };
  await expect(submitContractDispute({
    contractId,
    userId: employerId,
    role: 'EMPLOYER',
    reason: 'The agreed project requirements were not met.',
  })).rejects.toMatchObject({ status: 404 });

  currentEscrow = fundedEscrow('UNFUNDED');
  await expect(submitContractDispute({
    contractId,
    userId: employerId,
    role: 'EMPLOYER',
    reason: 'The agreed project requirements were not met.',
  })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.dispute.create).not.toHaveBeenCalled();
});

test('client cannot choose dispute ownership or escrow identifiers', async () => {
  const response = await request(app)
    .post(`/api/employer/contracts/${contractId}/disputes`)
    .set('Authorization', ['Bearer', token('EMPLOYER', employerId)].join(' '))
    .send({
      reason: 'The agreed project requirements were not met.',
      escrowId: 'client-controlled',
      openedByUserId: otherEmployerId,
      status: 'RESOLVED_FOR_SEEKER',
    });

  expect(response.status).toBe(400);
  expect(mockPrisma.dispute.create).not.toHaveBeenCalled();
});

test.each(['RESOLVED_FOR_EMPLOYER', 'RESOLVED_FOR_SEEKER', 'PARTIALLY_RESOLVED'])(
  'admin may record %s, but the resolved dispute remains held and blocks release',
  async (status) => {
  await submitContractDispute({
    contractId,
    userId: employerId,
    role: 'EMPLOYER',
    reason: 'The agreed project requirements were not met.',
  });
  const authorization = ['Bearer', token('ADMIN', adminId)].join(' ');
  const review = await request(app)
    .patch(`/api/admin/contracts/${contractId}/disputes/${disputeId}`)
    .set('Authorization', authorization)
    .send({ status: 'UNDER_REVIEW' });
  expect(review.status).toBe(200);
  expect(review.body.data.dispute.status).toBe('UNDER_REVIEW');
  expect(currentEscrow.status).toBe('DISPUTED');

  const response = await request(app)
    .patch(`/api/admin/contracts/${contractId}/disputes/${disputeId}`)
    .set('Authorization', authorization)
    .send({ status, resolutionNote: 'Admin review completed.' });
  expect(response.status).toBe(200);
  expect(response.body.data.dispute.status).toBe(status);
  expect(response.body.data.dispute.escrowStatus).toBe('DISPUTED');
  expect(response.body.data.fundsRemainHeld).toBe(true);
  expect(currentEscrow.status).toBe('DISPUTED');

  const release = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', authorization);
  expect(release.status).toBe(409);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  },
);

test('admin cannot resolve a dispute without a resolution note or resolve it twice', async () => {
  await submitContractDispute({
    contractId,
    userId: seekerId,
    role: 'SEEKER',
    reason: 'The agreed project requirements were not met.',
  });
  const authorization = ['Bearer', token('ADMIN', adminId)].join(' ');
  const missingNote = await request(app)
    .patch(`/api/admin/contracts/${contractId}/disputes/${disputeId}`)
    .set('Authorization', authorization)
    .send({ status: 'PARTIALLY_RESOLVED' });
  expect(missingNote.status).toBe(400);

  const resolved = await resolveContractDispute({
    contractId,
    disputeId,
    adminId,
    status: 'RESOLVED_FOR_EMPLOYER',
    resolutionNote: 'Admin review completed.',
  });
  expect(resolved.fundsRemainHeld).toBe(true);
  await expect(resolveContractDispute({
    contractId,
    disputeId,
    adminId,
    status: 'RESOLVED_FOR_SEEKER',
    resolutionNote: 'A second resolution is not allowed.',
  })).rejects.toMatchObject({ status: 409 });
  expect(currentEscrow.status).toBe('DISPUTED');
});

test('dispute creation and release serialize on the escrow row', async () => {
  const results = await Promise.allSettled([
    submitContractDispute({
      contractId,
      userId: employerId,
      role: 'EMPLOYER',
      reason: 'The agreed project requirements were not met.',
    }),
    releaseContractFunds(contractId),
  ]);

  const submitted = results[0].status === 'fulfilled';
  const released = results[1].status === 'fulfilled';
  expect(submitted || released).toBe(true);
  expect(submitted && released).toBe(false);
  if (submitted) {
    expect(currentEscrow.status).toBe('DISPUTED');
    expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  } else {
    expect(currentEscrow.status).toBe('RELEASED');
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
  }
});
