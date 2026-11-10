import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const adminId = '44444444-4444-4444-8444-444444444444';
const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const staffAdminId = '55555555-5555-4555-8555-555555555555';
const mockGetLeamJobsEmployerIdentity = jest.fn().mockResolvedValue({ userId: employerId });

const mockPrisma = {
  contract: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  freelanceContract: { update: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  application: { update: jest.fn() },
  payment: { findFirst: jest.fn(), findMany: jest.fn() },
  financialLedgerEntry: { findFirst: jest.fn() },
  financialAuditLog: { findFirst: jest.fn(), create: jest.fn() },
  dispute: { findFirst: jest.fn() },
  providerWebhookEvent: { findFirst: jest.fn() },
  adminAuditEvent: { create: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/leamjobsEmployer.service.js', () => ({
  getLeamJobsEmployerIdentity: mockGetLeamJobsEmployerIdentity,
}));
const mockCreateNotification = jest.fn().mockResolvedValue({ id: 'notification-1' });
jest.unstable_mockModule('../src/services/notification.service.js', () => ({
  createNotification: mockCreateNotification,
}));

const {
  archiveAdminContract,
  cancelAdminContract,
  getAdminContractById,
  listAdminContracts,
} = await import('../src/services/contract.service.js');

const makeContract = ({
  type = 'FREELANCE_PROJECT',
  status = 'PENDING',
  applicationStatus = 'ACCEPTED',
  workStatus = 'PENDING',
  escrowStatus = 'UNFUNDED',
  archivedAt = null,
  disputes = [],
  escrowDisputes = [],
  payments = [],
} = {}) => {
  const cancelled = status === 'CANCELLED';
  return {
    id: contractId,
    applicationId,
    jobId,
    employerId,
    seekerId,
    type,
    status,
    startDate: null,
    expectedEndDate: null,
    completedAt: status === 'COMPLETED' ? new Date('2026-10-10T00:00:00.000Z') : null,
    endedAt: null,
    cancelledAt: cancelled ? new Date('2026-09-11T12:00:00.000Z') : null,
    employerArchivedAt: archivedAt,
    disputes,
    ledgerEntries: [],
    job: {
      id: jobId,
      employerId,
      title: 'Freelance Engineer',
      description: 'private job details',
      jobType: type === 'CONTRACT_PROJECT' ? 'NORMAL_EMPLOYMENT' : 'FREELANCE_PROJECT',
      engagementType: type === 'CONTRACT_PROJECT' ? 'CONTRACT' : 'FREELANCE',
    },
    application: { id: applicationId, jobId, seekerId, status: cancelled ? 'REJECTED' : applicationStatus, createdAt: new Date() },
    employer: { id: employerId, firstName: 'Erin', lastName: 'Employer', email: 'employer@example.test' },
    seeker: { id: seekerId, firstName: 'Sam', lastName: 'Seeker', seekerProfile: { professionalTitle: 'Engineer', profilePictureUrl: 'private-image-url' } },
    createdAt: new Date('2026-09-11T10:00:00.000Z'),
    updatedAt: new Date('2026-09-11T10:00:00.000Z'),
    freelanceDetails: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      contractId,
      agreedAmount: new Prisma.Decimal('100000.00'),
      currency: 'NGN',
      duration: null,
      startMode: null,
      platformFeePercentage: new Prisma.Decimal('5.00'),
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('100000.00'),
      employerConfirmedAt: null,
      seekerConfirmedAt: null,
      employerCompletionConfirmedAt: null,
      completionSubmittedAt: null,
      completionNote: null,
      workStatus: cancelled ? 'CANCELLED' : workStatus,
      expectedCompletionDate: null,
      escrow: {
        id: escrowId,
        freelanceContractId: contractId,
        grossAmount: new Prisma.Decimal('100000.00'),
        platformFeeAmount: new Prisma.Decimal('5000.00'),
        seekerNetAmount: new Prisma.Decimal('100000.00'),
        currency: 'NGN',
        fundedAmount: new Prisma.Decimal(escrowStatus === 'FUNDED' ? '100000.00' : '0.00'),
        releasedAmount: new Prisma.Decimal('0.00'),
        refundedAmount: new Prisma.Decimal('0.00'),
        status: cancelled ? 'CANCELLED' : escrowStatus,
        fundedAt: escrowStatus === 'FUNDED' ? new Date() : null,
        releaseEligibleAt: null,
        releasedAt: null,
        cancelledAt: cancelled ? new Date('2026-09-11T12:00:00.000Z') : null,
        payments,
        refunds: [],
        disputes: escrowDisputes,
        ledgerEntries: [],
        conversionOperation: null,
      },
    },
  };
};

const configureCleanHistory = () => {
  mockPrisma.escrow.findUnique.mockResolvedValue(null);
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue(null);
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue(null);
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
};

const makeSettledCompletedContract = () => {
  const contract = makeContract({ status: 'ACTIVE', workStatus: 'RELEASED', escrowStatus: 'RELEASED' });
  const escrow = contract.freelanceDetails.escrow;
  contract.completedAt = null;
  contract.freelanceDetails.completionSubmittedAt = new Date('2026-10-09T10:00:00.000Z');
  contract.freelanceDetails.employerCompletionConfirmedAt = new Date('2026-10-09T11:00:00.000Z');
  contract.freelanceDetails.workStatus = 'RELEASED';
  escrow.grossAmount = new Prisma.Decimal('105000.00');
  escrow.platformFeeAmount = new Prisma.Decimal('5000.00');
  escrow.seekerNetAmount = new Prisma.Decimal('100000.00');
  escrow.fundedAmount = new Prisma.Decimal('105000.00');
  escrow.releasedAmount = new Prisma.Decimal('100000.00');
  escrow.fundedAt = new Date('2026-10-08T10:00:00.000Z');
  escrow.releaseEligibleAt = new Date('2026-10-09T11:00:00.000Z');
  escrow.releasedAt = new Date('2026-10-09T12:00:00.000Z');
  escrow.payments = [{
    id: 'funding-payment',
    amount: new Prisma.Decimal('105000.00'),
    currency: 'NGN',
    transactionId: 'provider-transaction',
    providerReference: `leamjobs_${contractId}_funding`,
    status: 'SUCCESSFUL',
    paymentType: 'CONTRACT_FUNDING',
    verifiedAt: new Date('2026-10-08T10:00:00.000Z'),
  }];
  mockPrisma.payment.findMany.mockResolvedValue([{
    id: 'funding-payment',
    status: 'SUCCESSFUL',
    escrowId,
    providerReference: `leamjobs_${contractId}_funding`,
  }]);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue({ id: 'release-ledger' });
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue({ id: 'release-audit' });
  return contract;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLeamJobsEmployerIdentity.mockResolvedValue({ userId: employerId });
  configureCleanHistory();
});

test('global listing paginates, searches all participants, filters lifecycle state, and includes archived records', async () => {
  const contract = makeContract({ archivedAt: new Date('2026-10-01T00:00:00.000Z') });
  mockPrisma.contract.findMany.mockResolvedValue([contract]);
  mockPrisma.contract.count.mockResolvedValue(1);

  const result = await listAdminContracts({
    page: 2,
    limit: 10,
    search: 'Engineer',
    status: 'PENDING',
    escrowStatus: 'UNFUNDED',
    workStatus: 'PENDING',
  });

  expect(mockPrisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      status: 'PENDING',
      OR: expect.arrayContaining([
        { id: { contains: 'Engineer', mode: 'insensitive' } },
        { job: { is: { title: { contains: 'Engineer', mode: 'insensitive' } } } },
      ]),
      freelanceDetails: { is: { workStatus: 'PENDING', escrow: { is: { status: 'UNFUNDED' } } } },
    }),
    skip: 10,
    take: 10,
  }));
  expect(result.contracts[0].employerArchivedAt).toEqual(contract.employerArchivedAt);
  expect(result.contracts[0].job).toEqual({ id: jobId, title: 'Freelance Engineer' });
  expect(result.contracts[0].employer.email).toBeUndefined();
  expect(result.contracts[0].seeker.profilePictureUrl).toBeUndefined();
  expect(result.contracts[0].freelance.escrow.payments).toBeUndefined();
  expect(result.contracts[0].availableActions.archive).toBe(false);
  expect(result.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
});

test('Admin detail loads a contract belonging to any employer and exposes archive state', async () => {
  const contract = makeContract({ archivedAt: new Date('2026-10-01T00:00:00.000Z') });
  mockPrisma.contract.findUnique.mockResolvedValue(contract);

  const result = await getAdminContractById(contractId);

  expect(mockPrisma.contract.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: contractId },
  }));
  expect(result.employerId).toBe(employerId);
  expect(result.employerArchivedAt).toEqual(contract.employerArchivedAt);
  expect(result.availableActions.archive).toBe(false);
});

test('Admin-created unfunded contracts show Cancel without a payment record', async () => {
  const contract = makeContract({ type: 'CONTRACT_PROJECT', applicationStatus: 'PAYMENT_PENDING' });
  mockPrisma.contract.findUnique.mockResolvedValue(contract);

  const result = await getAdminContractById(contractId);

  expect(result.availableActions.cancel).toBe(true);
  expect(result.funding.paymentStatus).toBeNull();
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: expect.arrayContaining([
      { metadata: { path: ['contractId'], equals: contractId } },
      { providerReference: { startsWith: `leamjobs_${contractId}_` } },
    ]) },
  }));
});

test('ordinary employer-owned contracts do not expose Admin cancellation', async () => {
  const ordinaryEmployerId = '66666666-6666-4666-8666-666666666666';
  const contract = makeContract();
  contract.employerId = ordinaryEmployerId;
  contract.job.employerId = ordinaryEmployerId;
  mockPrisma.contract.findUnique.mockResolvedValue(contract);

  const result = await getAdminContractById(contractId);

  expect(result.availableActions.cancel).toBe(false);
});

test('Admin cancellation allows a clean unfunded Contract Job with no payment record and audits the actor', async () => {
  const contract = makeContract({ type: 'CONTRACT_PROJECT', applicationStatus: 'PAYMENT_PENDING' });
  const cancelledContract = makeContract({ type: 'CONTRACT_PROJECT', status: 'CANCELLED', applicationStatus: 'REJECTED' });
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.contract.findUnique.mockResolvedValue(cancelledContract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);

  const result = await cancelAdminContract({ contractId, adminId });

  expect(result.status).toBe('CANCELLED');
  expect(mockPrisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      OR: [
        { metadata: { path: ['contractId'], equals: contractId } },
        { providerReference: { startsWith: `leamjobs_${contractId}_` } },
      ],
    },
  }));
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({
    where: { id: contractId },
    data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
  });
  expect(mockPrisma.application.update).toHaveBeenCalledWith({
    where: { id: applicationId },
    data: { status: 'REJECTED' },
  });
  expect(mockPrisma.financialAuditLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ actorUserId: adminId, entityId: contractId, action: 'CANCELLED' }),
  });
  expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
    recipientUserId: seekerId,
    actorUserId: adminId,
    eventKey: `contract:cancelled:${contractId}`,
  }), mockPrisma);
});

test('Staff Admin cancellation audits the actual acting Staff Admin', async () => {
  const contract = makeContract();
  const cancelledContract = makeContract({ status: 'CANCELLED', applicationStatus: 'REJECTED' });
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);
  mockPrisma.contract.findUnique.mockResolvedValue(cancelledContract);

  const result = await cancelAdminContract({ contractId, adminId: staffAdminId });

  expect(result.status).toBe('CANCELLED');
  expect(mockPrisma.financialAuditLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      actorUserId: staffAdminId,
      entityType: 'CONTRACT',
      entityId: contractId,
      action: 'CANCELLED',
    }),
  });
  expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
    recipientUserId: seekerId,
    actorUserId: staffAdminId,
    eventKey: `contract:cancelled:${contractId}`,
  }), mockPrisma);
});

test('Admin cannot cancel an ordinary employer-owned contract', async () => {
  const ordinaryEmployerId = '66666666-6666-4666-8666-666666666666';
  const contract = makeContract();
  contract.employerId = ordinaryEmployerId;
  contract.job.employerId = ordinaryEmployerId;
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.contract.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: contractId, employerId },
  }));
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin cancellation rejects funded contracts', async () => {
  const funded = makeContract({ status: 'ACTIVE', escrowStatus: 'FUNDED' });
  mockPrisma.contract.findFirst.mockResolvedValue(funded);

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin cancellation rejects pending payment attempts', async () => {
  const contract = makeContract();
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);
  mockPrisma.payment.findMany.mockResolvedValue([{ id: 'payment-1', status: 'PENDING' }]);

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin cancellation rejects pending provider webhooks', async () => {
  jest.clearAllMocks();
  mockGetLeamJobsEmployerIdentity.mockResolvedValue({ userId: employerId });
  configureCleanHistory();
  const contract = makeContract();
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue({ id: 'webhook-1' });

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test.each([
  ['open dispute', (contract) => {
    contract.disputes = [{ id: 'dispute-1', status: 'OPEN' }];
    contract.freelanceDetails.escrow.disputes = [{ id: 'dispute-1', status: 'OPEN' }];
  }],
  ['unresolved refund', (contract) => {
    contract.freelanceDetails.escrow.refunds = [{ id: 'refund-1', status: 'PENDING' }];
  }],
])('Admin cancellation rejects contracts with an %s', async (_label, applyUnsafeState) => {
  const contract = makeContract();
  applyUnsafeState(contract);
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin cancellation serialization conflict fails safely before updates', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue(makeContract());
  mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({
    status: 409,
    publicMessage: 'The contract financial state changed during cancellation review. Refresh the contract and try again.',
  });
  expect(mockPrisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin cancellation rechecks payment state inside the serializable transaction', async () => {
  const contract = makeContract();
  const pendingPayment = {
    id: 'concurrent-payment',
    status: 'PENDING',
    paymentType: 'CONTRACT_FUNDING',
  };
  mockPrisma.contract.findFirst
    .mockResolvedValueOnce(contract)
    .mockResolvedValueOnce(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue({
    ...contract.freelanceDetails.escrow,
    payments: [pendingPayment],
  });
  mockPrisma.payment.findMany.mockResolvedValue([pendingPayment]);

  await expect(cancelAdminContract({ contractId, adminId })).rejects.toMatchObject({
    status: 409,
    publicMessage: 'This contract has a payment attempt on record. A provider may still report a late result, so resolve the payment state before cancelling.',
  });
  expect(mockPrisma.contract.findFirst).toHaveBeenCalledTimes(2);
  expect(mockPrisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test.each([
  ['disputed', makeContract({ status: 'DISPUTED', escrowStatus: 'DISPUTED', disputes: [{ id: 'dispute-1', status: 'OPEN' }] })],
  ['completed', makeContract({ status: 'COMPLETED', workStatus: 'COMPLETED' })],
])('Admin archive rejects %s contracts', async (_label, contract) => {
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);

  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.adminAuditEvent.create).not.toHaveBeenCalled();
});

test('Admin can soft-archive a fully completed contract with verified release evidence', async () => {
  const contract = makeSettledCompletedContract();
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(archiveAdminContract({ contractId, adminId })).resolves.toEqual({
    archived: true,
    alreadyArchived: false,
  });
  expect(mockPrisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  expect(mockPrisma.financialLedgerEntry.findFirst).toHaveBeenCalledWith({
    where: {
      contractId,
      escrowId,
      entryType: 'WALLET_CREDIT',
      idempotencyKey: `escrow:${escrowId}:release`,
      amount: contract.freelanceDetails.escrow.seekerNetAmount,
      currency: 'NGN',
    },
    select: { id: true },
  });
  expect(mockPrisma.financialAuditLog.findFirst).toHaveBeenCalledWith({
    where: {
      entityType: 'ESCROW',
      entityId: escrowId,
      action: 'RELEASED',
      fromStatus: 'RELEASE_ELIGIBLE',
      toStatus: 'RELEASED',
      amount: contract.freelanceDetails.escrow.seekerNetAmount,
      currency: 'NGN',
    },
    select: { id: true },
  });
  expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ actorId: adminId, action: 'ADMIN_CONTRACT_ARCHIVED', entityId: contractId }),
  });
});

test('Admin archives a settled contract in the existing ACTIVE lifecycle without completedAt', async () => {
  const contract = makeSettledCompletedContract();
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(archiveAdminContract({ contractId, adminId })).resolves.toEqual({
    archived: true,
    alreadyArchived: false,
  });
  expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ actorId: adminId, action: 'ADMIN_CONTRACT_ARCHIVED', entityId: contractId }),
  });
});

test('Admin archives a settled contract in the existing IN_PROGRESS lifecycle', async () => {
  const contract = makeSettledCompletedContract();
  contract.status = 'IN_PROGRESS';
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(archiveAdminContract({ contractId, adminId })).resolves.toEqual({
    archived: true,
    alreadyArchived: false,
  });
});

test('Admin does not archive an already archived settled contract again', async () => {
  const contract = makeSettledCompletedContract();
  contract.employerArchivedAt = new Date('2026-11-09T12:00:00.000Z');
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(archiveAdminContract({ contractId, adminId })).resolves.toEqual({
    archived: true,
    alreadyArchived: true,
  });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.adminAuditEvent.create).not.toHaveBeenCalled();
});

test.each([
  ['unreleased escrow', (contract) => { contract.freelanceDetails.escrow.status = 'FUNDED'; }],
  ['partially released escrow', (contract) => { contract.freelanceDetails.escrow.releasedAmount = new Prisma.Decimal('75000.00'); }],
  ['mismatched release ledger', (_contract) => { mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(null); }],
  ['missing release audit evidence', (_contract) => { mockPrisma.financialAuditLog.findFirst.mockResolvedValue(null); }],
  ['open dispute', (contract) => { contract.disputes = [{ id: 'dispute-open', status: 'OPEN' }]; }],
  ['unresolved refund', (contract) => { contract.freelanceDetails.escrow.refunds = [{ id: 'refund-open', status: 'PENDING' }]; }],
  ['pending payment webhook', (_contract) => { mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue({ id: 'webhook-pending' }); }],
  ['outstanding payment attempt', (_contract) => { mockPrisma.payment.findMany.mockResolvedValue([{ id: 'payment-pending', status: 'PROCESSING', escrowId }]); }],
  ['missing employer confirmation', (contract) => { contract.freelanceDetails.employerCompletionConfirmedAt = null; }],
])('Admin completed-contract archive rejects %s', async (_label, applyUnsafeState) => {
  const contract = makeSettledCompletedContract();
  applyUnsafeState(contract);
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({
    status: 409,
    publicMessage: 'This contract is not eligible for safe archiving. Refresh the contract and review its current lifecycle state.',
  });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.adminAuditEvent.create).not.toHaveBeenCalled();
});

test('Admin archive rechecks financial state after locking records and rejects a concurrent change', async () => {
  const contract = makeSettledCompletedContract();
  const changedContract = makeSettledCompletedContract();
  changedContract.freelanceDetails.escrow.status = 'FUNDED';
  mockPrisma.contract.findFirst
    .mockResolvedValueOnce(contract)
    .mockResolvedValueOnce(contract)
    .mockResolvedValueOnce(changedContract);

  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({
    status: 409,
    publicMessage: 'This contract is not eligible for safe archiving. Refresh the contract and review its current lifecycle state.',
  });
  expect(mockPrisma.contract.findFirst).toHaveBeenCalledTimes(3);
  expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(8);
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.adminAuditEvent.create).not.toHaveBeenCalled();
});

test('serialization conflicts return a safe archive eligibility error', async () => {
  mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });

  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({
    status: 409,
    publicMessage: 'The contract financial state changed during archive review. Refresh the contract and try again.',
  });
});

test('Admin archive rejects funded contracts, payment attempts, and unprocessed provider webhooks', async () => {
  const funded = makeContract({ status: 'ACTIVE', escrowStatus: 'FUNDED' });
  mockPrisma.contract.findFirst.mockResolvedValue(funded);
  mockPrisma.escrow.findUnique.mockResolvedValue(funded.freelanceDetails.escrow);
  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();

  jest.clearAllMocks();
  configureCleanHistory();
  const pendingPayment = makeContract();
  mockPrisma.contract.findFirst.mockResolvedValue(pendingPayment);
  mockPrisma.escrow.findUnique.mockResolvedValue(pendingPayment.freelanceDetails.escrow);
  mockPrisma.payment.findFirst.mockResolvedValue({ id: 'payment-pending' });
  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();

  jest.clearAllMocks();
  configureCleanHistory();
  mockPrisma.contract.findFirst.mockResolvedValue(pendingPayment);
  mockPrisma.escrow.findUnique.mockResolvedValue(pendingPayment.freelanceDetails.escrow);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue({ id: 'webhook-pending' });
  await expect(archiveAdminContract({ contractId, adminId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('Admin archive soft-archives eligible contracts and audits the actual Admin actor', async () => {
  const contract = makeContract();
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.escrow.findUnique.mockResolvedValue(contract.freelanceDetails.escrow);

  await expect(archiveAdminContract({ contractId, adminId })).resolves.toEqual({
    archived: true,
    alreadyArchived: false,
  });
  expect(mockPrisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: contractId },
    data: { employerArchivedAt: expect.any(Date) },
  }));
  expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      actorId: adminId,
      subjectId: employerId,
      action: 'ADMIN_CONTRACT_ARCHIVED',
      entityType: 'CONTRACT',
      entityId: contractId,
    }),
  });
  expect(mockPrisma.payment.deleteMany).toBeUndefined();
});
