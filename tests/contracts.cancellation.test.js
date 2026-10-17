import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const employerId = '11111111-1111-4111-8111-111111111111';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const escrowRecord = ({
  status = 'UNFUNDED',
  fundedAmount = '0.00',
  payments = [],
} = {}) => ({
  id: escrowId,
  freelanceContractId: contractId,
  status,
  grossAmount: new Prisma.Decimal('100000.00'),
  platformFeeAmount: new Prisma.Decimal('5000.00'),
  seekerNetAmount: new Prisma.Decimal('100000.00'),
  fundedAmount: new Prisma.Decimal(fundedAmount),
  releasedAmount: new Prisma.Decimal('0.00'),
  refundedAmount: new Prisma.Decimal('0.00'),
  fundedAt: null,
  releasedAt: null,
  releaseEligibleAt: null,
  cancelledAt: null,
  refunds: [],
  disputes: [],
  ledgerEntries: [],
  payments,
});

const contractRecord = (escrow = escrowRecord()) => ({
  id: contractId,
  applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  jobId,
  employerId,
  seekerId: '33333333-3333-4333-8333-333333333333',
  type: 'FREELANCE_PROJECT',
  status: 'PENDING',
  cancelledAt: null,
  startDate: null,
  expectedEndDate: null,
  completedAt: null,
  endedAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  job: { id: jobId, employerId, title: 'Freelance Engineer', description: '', jobType: 'FREELANCE_PROJECT', engagementType: 'FREELANCE' },
  application: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    jobId,
    seekerId: '33333333-3333-4333-8333-333333333333',
    status: 'ACCEPTED',
    createdAt: new Date(),
  },
  employer: { id: employerId, firstName: 'Employer', lastName: 'One' },
  seeker: { id: '33333333-3333-4333-8333-333333333333', firstName: 'Ada', lastName: 'Lovelace', seekerProfile: null },
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
    workStatus: 'PENDING',
    expectedCompletionDate: null,
    escrow,
  },
});

const mockPrisma = {
  contract: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  freelanceContract: { update: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  application: { update: jest.fn() },
  payment: { findFirst: jest.fn(), findMany: jest.fn() },
  financialLedgerEntry: { findFirst: jest.fn() },
  financialAuditLog: { findFirst: jest.fn() },
  dispute: { findFirst: jest.fn() },
  job: { update: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }),
}));

const { cancelEmployerFreelanceContract, getContractForParty } = await import('../src/services/contract.service.js');
const { createNotification } = await import('../src/services/notification.service.js');

const prepareCancellation = (escrow = escrowRecord(), type = 'FREELANCE_PROJECT') => {
  const contract = contractRecord(escrow);
  if (type === 'CONTRACT_PROJECT') {
    contract.type = type;
    contract.job = { ...contract.job, jobType: 'NORMAL_EMPLOYMENT', engagementType: 'CONTRACT' };
    contract.application = { ...contract.application, status: 'PAYMENT_PENDING' };
  }
  mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: contractId, jobId });
  mockPrisma.contract.findFirst.mockResolvedValueOnce(contract);
  mockPrisma.contract.findUnique.mockImplementation(async () => ({
    ...contract,
    status: 'CANCELLED',
    cancelledAt: new Date(),
    application: { ...contract.application, status: 'REJECTED' },
    freelanceDetails: {
      ...contract.freelanceDetails,
      workStatus: 'CANCELLED',
      escrow: escrow ? { ...escrow, status: 'CANCELLED', cancelledAt: new Date() } : null,
    },
  }));
  mockPrisma.escrow.findUnique.mockResolvedValue(escrow);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: jobId }]);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue(null);
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
  return contract;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue(null);
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
});

test('cancels an owned, unfunded freelance contract and preserves its records', async () => {
  const contract = prepareCancellation();

  const result = await cancelEmployerFreelanceContract({ contractId, employerId });

  expect(result.status).toBe('CANCELLED');
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({
    where: { id: contract.id },
    data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
  });
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith({
    where: { contractId },
    data: { workStatus: 'CANCELLED' },
  });
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith({
    where: { id: escrowId },
    data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
  });
  expect(mockPrisma.application.update).toHaveBeenCalledWith({
    where: { id: contract.applicationId },
    data: { status: 'REJECTED' },
  });
  expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
    recipientUserId: contract.seekerId,
    actorUserId: employerId,
    category: 'CONTRACT',
    eventKey: `contract:cancelled:${contractId}`,
    title: 'Contract cancelled before funding',
  }), mockPrisma);
  expect(mockPrisma.job.update).not.toHaveBeenCalled();
});

test('cancels an eligible contract with no escrow without creating one', async () => {
  const contract = prepareCancellation(null);

  const result = await cancelEmployerFreelanceContract({ contractId, employerId });

  expect(result.status).toBe('CANCELLED');
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({
    where: { id: contract.id },
    data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
  });
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith({
    where: { contractId },
    data: { workStatus: 'CANCELLED' },
  });
  expect(mockPrisma.application.update).toHaveBeenCalledWith({
    where: { id: contract.applicationId },
    data: { status: 'REJECTED' },
  });
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      OR: [
        { metadata: { path: ['contractId'], equals: contractId } },
        { providerReference: { startsWith: `leamjobs_${contractId}_` } },
      ],
    },
  }));
});

test.each([escrowRecord(), null])('cancels an eligible Contract Job with %s escrow', async (escrow) => {
  const contract = prepareCancellation(escrow, 'CONTRACT_PROJECT');

  const result = await cancelEmployerFreelanceContract({ contractId, employerId });

  expect(result.status).toBe('CANCELLED');
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({
    where: { id: contract.id },
    data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
  });
  expect(mockPrisma.application.update).toHaveBeenCalledWith({
    where: { id: contract.applicationId },
    data: { status: 'REJECTED' },
  });
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(escrow ? 1 : 0);
});

test('exposes no-escrow cancellation only after payment and financial history checks are clear', async () => {
  mockPrisma.contract.findUnique.mockResolvedValueOnce(contractRecord(null));

  const result = await getContractForParty({ contractId, userId: employerId, role: 'EMPLOYER' });

  expect(result.availableActions.cancel).toBe(true);
  expect(mockPrisma.financialLedgerEntry.findFirst).toHaveBeenCalledWith({
    where: { OR: [{ contractId }] },
    select: { id: true },
  });
  expect(mockPrisma.dispute.findFirst).toHaveBeenCalledWith({
    where: { OR: [{ contractId }] },
    select: { id: true },
  });
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: expect.arrayContaining([
      { metadata: { path: ['contractId'], equals: contractId } },
      { providerReference: { startsWith: `leamjobs_${contractId}_` } },
    ]) },
  }));
});

test('does not expose no-escrow cancellation when contract metadata finds a funding attempt', async () => {
  const contract = contractRecord(null);
  mockPrisma.contract.findUnique.mockResolvedValueOnce(contract);
  mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: 'payment-1' });

  const result = await getContractForParty({ contractId, userId: employerId, role: 'EMPLOYER' });

  expect(result.availableActions.cancel).toBe(false);
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: expect.arrayContaining([
      { metadata: { path: ['contractId'], equals: contractId } },
      { providerReference: { startsWith: `leamjobs_${contractId}_` } },
    ]) },
  }));
});

test('exposes cancellation for an eligible Contract Job without escrow', async () => {
  const contract = contractRecord(null);
  contract.type = 'CONTRACT_PROJECT';
  contract.job = { ...contract.job, jobType: 'NORMAL_EMPLOYMENT', engagementType: 'CONTRACT' };
  contract.application = { ...contract.application, status: 'PAYMENT_PENDING' };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(contract);

  const result = await getContractForParty({ contractId, userId: employerId, role: 'EMPLOYER' });

  expect(result.availableActions.cancel).toBe(true);
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: expect.arrayContaining([
      { metadata: { path: ['contractId'], equals: contractId } },
      { providerReference: { startsWith: `leamjobs_${contractId}_` } },
      { userId: employerId, paymentType: 'CONTRACT_FUNDING', escrowId: null },
    ]) },
  }));
});

test('blocks no-escrow cancellation when an unlinked employer funding payment exists', async () => {
  prepareCancellation(null);
  mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: 'orphan-payment-1' });

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('payment attempt on record');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('refuses cancellation if a funding payment attempt could still settle', async () => {
  const escrow = escrowRecord({ payments: [{ status: 'PENDING' }] });
  prepareCancellation(escrow);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('A provider may still report a late result');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses no-escrow cancellation if any matching funding attempt exists', async () => {
  prepareCancellation(null);
  mockPrisma.payment.findMany.mockResolvedValueOnce([{ id: 'payment-1', status: 'FAILED' }]);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('A provider may still report a late result');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('refuses no-escrow cancellation for a successful payment attempt', async () => {
  prepareCancellation(null);
  mockPrisma.payment.findMany.mockResolvedValueOnce([{ id: 'payment-1', status: 'SUCCESSFUL' }]);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('A provider may still report a late result');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses cancellation once escrow has funded value', async () => {
  const escrow = escrowRecord({ status: 'FUNDED', fundedAmount: '100000.00' });
  prepareCancellation(escrow);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('refuses cancellation when a no-escrow contract has ledger activity', async () => {
  prepareCancellation(null);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValueOnce({ id: 'ledger-1' });

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('financial activity or is no longer unfunded');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses cancellation when financial audit history exists', async () => {
  prepareCancellation(null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValueOnce({ id: 'audit-1' });

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('financial activity or is no longer unfunded');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('refuses freelance cancellation when job type and engagement do not match', async () => {
  const contract = prepareCancellation(null);
  contract.job.engagementType = 'CONTRACT';

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test.each([
  ['the contract is related to a different job', (contract) => { contract.job.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'; }],
  ['the job belongs to a different employer', (contract) => { contract.job.employerId = '22222222-2222-4222-8222-222222222222'; }],
  ['the contract points to a different application', (contract) => { contract.application.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'; }],
  ['the application belongs to a different job', (contract) => { contract.application.jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'; }],
  ['the application belongs to a different seeker', (contract) => { contract.application.seekerId = '33333333-3333-4333-8333-333333333334'; }],
  ['the work record belongs to a different contract', (contract) => { contract.freelanceDetails.contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd'; }],
  ['the escrow belongs to a different contract', (contract) => { contract.freelanceDetails.escrow.freelanceContractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd'; }],
])('refuses cancellation when %s', async (_description, makeInconsistent) => {
  const contract = prepareCancellation();
  makeInconsistent(contract);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses cancellation when an unfunded escrow has a cancellation timestamp', async () => {
  const escrow = escrowRecord();
  escrow.cancelledAt = new Date();
  prepareCancellation(escrow);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses cancellation when the locked escrow reread has a cancellation timestamp', async () => {
  const escrow = escrowRecord();
  prepareCancellation(escrow);
  mockPrisma.escrow.findUnique.mockResolvedValueOnce({
    ...escrow,
    cancelledAt: new Date(),
  });

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('contradictory lifecycle or financial history');

  expect(mockPrisma.contract.findFirst.mock.calls[1][0].select.freelanceDetails.select.escrow.select)
    .toEqual(expect.objectContaining({ cancelledAt: true, releaseEligibleAt: true }));
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses cancellation for NORMAL_EMPLOYMENT contracts', async () => {
  const contract = prepareCancellation(null, 'CONTRACT_PROJECT');
  contract.type = 'NORMAL_EMPLOYMENT';

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
});

test('refuses Contract Job cancellation when application or contract lifecycle is inconsistent', async () => {
  const contract = prepareCancellation(null, 'CONTRACT_PROJECT');
  contract.application.status = 'ACCEPTED';

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('no longer eligible for cancellation');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('does not reveal or mutate another employer’s contract', async () => {
  mockPrisma.contract.findFirst.mockResolvedValueOnce(null);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId: '22222222-2222-4222-8222-222222222222' }))
    .rejects.toMatchObject({ status: 404 });

  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});
