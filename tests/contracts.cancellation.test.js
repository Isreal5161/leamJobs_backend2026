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
  job: { id: jobId, title: 'Freelance Engineer', description: '', jobType: 'FREELANCE_PROJECT', engagementType: 'FREELANCE' },
  application: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'ACCEPTED', createdAt: new Date() },
  employer: { id: employerId, firstName: 'Employer', lastName: 'One' },
  seeker: { id: '33333333-3333-4333-8333-333333333333', firstName: 'Ada', lastName: 'Lovelace', seekerProfile: null },
  freelanceDetails: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }),
}));

const { cancelEmployerFreelanceContract } = await import('../src/services/contract.service.js');

const prepareCancellation = (escrow = escrowRecord()) => {
  const contract = contractRecord(escrow);
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
      escrow: { ...escrow, status: 'CANCELLED', cancelledAt: new Date() },
    },
  }));
  mockPrisma.escrow.findUnique.mockResolvedValue(escrow);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: jobId }]);
  return contract;
};

beforeEach(() => {
  jest.clearAllMocks();
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

test('refuses cancellation once escrow has funded value', async () => {
  const escrow = escrowRecord({ status: 'FUNDED', fundedAmount: '100000.00' });
  prepareCancellation(escrow);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId }))
    .rejects.toThrow('financial activity or is no longer unfunded');

  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('does not reveal or mutate another employer’s contract', async () => {
  mockPrisma.contract.findFirst.mockResolvedValueOnce(null);

  await expect(cancelEmployerFreelanceContract({ contractId, employerId: '22222222-2222-4222-8222-222222222222' }))
    .rejects.toMatchObject({ status: 404 });

  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});
