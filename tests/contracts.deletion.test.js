import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const employerId = '11111111-1111-4111-8111-111111111111';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const mockPrisma = {
  contract: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  payment: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  financialLedgerEntry: { findFirst: jest.fn() },
  financialAuditLog: { findFirst: jest.fn() },
  dispute: { findFirst: jest.fn() },
  providerWebhookEvent: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({ createNotification: jest.fn() }));
const { archiveEmployerContract, listEmployerContracts } = await import('../src/services/contract.service.js');

const makeContract = ({ status = 'PENDING', escrowStatus = 'UNFUNDED', archivedAt = null } = {}) => {
  const cancelled = status === 'CANCELLED';
  const released = escrowStatus === 'RELEASED';
  const grossAmount = new Prisma.Decimal(released ? '525.00' : '0.00');
  const netAmount = new Prisma.Decimal(released ? '500.00' : '0.00');
  return {
    id: contractId,
    applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    employerId,
    seekerId: '33333333-3333-4333-8333-333333333333',
    type: 'CONTRACT_PROJECT',
    status,
    completedAt: null,
    endedAt: null,
    cancelledAt: cancelled ? new Date('2026-09-12T10:00:00.000Z') : null,
    employerArchivedAt: archivedAt,
    disputes: [],
    ledgerEntries: [],
    job: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      employerId,
      jobType: 'NORMAL_EMPLOYMENT',
      engagementType: 'CONTRACT',
    },
    application: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seekerId: '33333333-3333-4333-8333-333333333333',
      status: cancelled ? 'REJECTED' : 'PAYMENT_PENDING',
    },
    freelanceDetails: {
      contractId,
      agreedAmount: new Prisma.Decimal('500.00'),
      currency: 'NGN',
      platformFeeAmount: new Prisma.Decimal('25.00'),
      seekerNetAmount: new Prisma.Decimal(released ? '500.00' : '500.00'),
      employerConfirmedAt: released ? new Date('2026-09-11T11:00:00.000Z') : null,
      seekerConfirmedAt: released ? new Date('2026-09-11T11:10:00.000Z') : null,
      completionSubmittedAt: released ? new Date('2026-10-20T12:00:00.000Z') : null,
      employerCompletionConfirmedAt: released ? new Date('2026-10-20T12:30:00.000Z') : null,
      workStatus: cancelled ? 'CANCELLED' : released ? 'RELEASED' : 'PENDING',
      escrow: escrowStatus === null ? null : {
        id: escrowId,
        freelanceContractId: contractId,
        grossAmount,
        platformFeeAmount: new Prisma.Decimal('25.00'),
        seekerNetAmount: netAmount,
        currency: 'NGN',
        fundedAmount: new Prisma.Decimal(released ? '525.00' : '0.00'),
        releasedAmount: new Prisma.Decimal(released ? '500.00' : '0.00'),
        refundedAmount: new Prisma.Decimal('0.00'),
        status: escrowStatus,
        fundedAt: released ? new Date('2026-09-11T11:30:00.000Z') : null,
        releaseEligibleAt: released ? new Date('2026-10-20T12:30:00.000Z') : null,
        releasedAt: released ? new Date('2026-10-20T13:00:00.000Z') : null,
        cancelledAt: cancelled ? new Date('2026-09-12T10:00:00.000Z') : null,
        payments: released ? [{
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          amount: new Prisma.Decimal('525.00'),
          currency: 'NGN',
          transactionId: 'provider-transaction',
          status: 'SUCCESSFUL',
          paymentType: 'CONTRACT_FUNDING',
          verifiedAt: new Date('2026-09-11T11:30:00.000Z'),
        }] : [],
        refunds: [],
        disputes: [],
        ledgerEntries: released ? [{ id: 'ledger-release' }] : [],
        conversionOperation: null,
      },
    },
  };
};

const setContract = (contract) => {
  mockPrisma.contract.findFirst.mockResolvedValue(contract);
  mockPrisma.contract.update.mockResolvedValue({ id: contractId });
  mockPrisma.$queryRaw.mockResolvedValue([{ id: contractId }]);
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.payment.findMany.mockResolvedValue(contract.freelanceDetails?.escrow?.payments ?? []);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(contract.freelanceDetails?.escrow?.status === 'RELEASED' ? { id: 'ledger-release' } : null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue(contract.freelanceDetails?.escrow?.status === 'RELEASED' ? { id: 'audit-release' } : null);
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue(null);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
});

test.each([
  ['cancelled', makeContract({ status: 'CANCELLED', escrowStatus: 'CANCELLED' })],
  ['unfunded', makeContract()],
  ['released', makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' })],
])('employer can archive an eligible %s contract without deleting its records', async (_label, contract) => {
  setContract(contract);

  await expect(archiveEmployerContract({ contractId, employerId })).resolves.toEqual({
    deleted: true,
    alreadyDeleted: false,
  });
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({
    where: { id: contractId },
    data: { employerArchivedAt: expect.any(Date) },
    select: { id: true },
  });
  expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
});

test.each([
  ['cancelled', makeContract({ status: 'CANCELLED', escrowStatus: 'CANCELLED' })],
  ['unfunded', makeContract()],
  ['released', makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' })],
])('employer contract list exposes deletion only for an eligible %s contract', async (_label, contract) => {
  setContract(contract);
  mockPrisma.contract.findMany.mockResolvedValue([contract]);
  mockPrisma.contract.count.mockResolvedValue(1);

  const result = await listEmployerContracts({ employerId, page: 1, limit: 10 });

  expect(result.contracts[0].availableActions.delete).toBe(true);
});

test.each([
  ['funded but unreleased', makeContract({ status: 'ACTIVE', escrowStatus: 'FUNDED' })],
  ['funding in progress', makeContract({ status: 'PENDING', escrowStatus: 'FUNDING' })],
])('rejects a contract that is %s', async (_label, contract) => {
  contract.freelanceDetails.escrow.fundedAmount = new Prisma.Decimal('500.00');
  setContract(contract);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test.each(['PENDING', 'PROCESSING'])('rejects an otherwise unfunded contract with a %s payment attempt', async (status) => {
  const contract = makeContract();
  setContract(contract);
  mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: 'payment-in-progress', status });

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('rejects released contracts with webhook events keyed only by the payment reference', async () => {
  const contract = makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' });
  setContract(contract);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValueOnce({ id: 'pending-webhook' });

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.providerWebhookEvent.findFirst).toHaveBeenCalledWith({
    where: {
      processedAt: null,
      OR: [
        { contractId },
        { paymentReference: { startsWith: `leamjobs_${contractId}_` } },
      ],
    },
    select: { id: true },
  });
});

test('rejects released contracts with a pending refund', async () => {
  const contract = makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' });
  contract.freelanceDetails.escrow.refunds = [{ id: 'pending-refund', status: 'PROCESSING' }];
  setContract(contract);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('rejects a released contract with multiple successful funding attempts', async () => {
  const contract = makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' });
  contract.freelanceDetails.escrow.payments.push({
    ...contract.freelanceDetails.escrow.payments[0],
    id: 'second-successful-payment',
  });
  setContract(contract);
  mockPrisma.payment.findMany.mockResolvedValue(contract.freelanceDetails.escrow.payments);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('rejects when the authenticated employer does not own the contract', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue(null);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('repeated archive requests succeed idempotently and retain the original archive timestamp', async () => {
  const archivedAt = new Date('2026-11-02T12:00:00.000Z');
  setContract(makeContract({ archivedAt }));

  await expect(archiveEmployerContract({ contractId, employerId })).resolves.toEqual({
    deleted: true,
    alreadyDeleted: true,
  });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('rejects an otherwise released contract without its release ledger record', async () => {
  const contract = makeContract({ status: 'ACTIVE', escrowStatus: 'RELEASED' });
  setContract(contract);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValueOnce(null);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('propagates database failures and leaves the archive unchanged', async () => {
  const contract = makeContract();
  setContract(contract);
  const databaseError = new Error('transaction update failed');
  mockPrisma.contract.update.mockRejectedValueOnce(databaseError);

  await expect(archiveEmployerContract({ contractId, employerId })).rejects.toBe(databaseError);
});
