import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondApplicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const freelanceContractId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const paymentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const providerReference = 'contract-job-reference';

const contractJobApplication = ({ status = 'SHORTLISTED', id = applicationId, selectedSeekerId = seekerId } = {}) => ({
  id,
  seekerId: selectedSeekerId,
  status,
  contract: null,
  job: {
    id: jobId,
    employerId,
    status: 'APPROVED',
    jobType: 'NORMAL_EMPLOYMENT',
    engagementType: 'CONTRACT',
    contractCompensation: {
      amount: new Prisma.Decimal('300000.00'),
      currency: 'NGN',
      duration: '30 days',
      startMode: 'SCHEDULED',
      scheduledStartDate: new Date('2026-10-01T00:00:00.000Z'),
      expectedCompletionDate: new Date('2026-10-31T00:00:00.000Z'),
    },
  },
});

const contractRecord = ({ status = 'PENDING', escrowStatus = 'UNFUNDED' } = {}) => ({
  id: contractId,
  applicationId,
  jobId,
  employerId,
  seekerId,
  type: 'CONTRACT_PROJECT',
  status,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  expectedEndDate: new Date('2026-10-31T00:00:00.000Z'),
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  job: { id: jobId, title: 'Build company website' },
  employer: { id: employerId, firstName: 'Employer', lastName: 'One', email: 'employer@example.com' },
  seeker: { id: seekerId, firstName: 'Seeker', lastName: 'One' },
  freelanceDetails: {
    id: freelanceContractId,
    agreedAmount: new Prisma.Decimal('300000.00'),
    currency: 'NGN',
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('15000.00'),
    seekerNetAmount: new Prisma.Decimal('285000.00'),
    employerConfirmedAt: null,
    seekerConfirmedAt: null,
    employerCompletionConfirmedAt: null,
    completionSubmittedAt: null,
    completionNote: null,
    workStatus: 'PENDING',
    escrow: {
      id: escrowId,
      grossAmount: new Prisma.Decimal('300000.00'),
      platformFeeAmount: new Prisma.Decimal('15000.00'),
      seekerNetAmount: new Prisma.Decimal('285000.00'),
      currency: 'NGN',
      fundedAmount: escrowStatus === 'FUNDED' ? new Prisma.Decimal('300000.00') : new Prisma.Decimal('0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: escrowStatus === 'FUNDED' ? new Date() : null,
      releaseEligibleAt: null,
      payments: escrowStatus === 'FUNDED' ? [{ id: paymentId, amount: new Prisma.Decimal('300000.00'), currency: 'NGN', status: 'SUCCESSFUL', paymentType: 'CONTRACT_FUNDING', verifiedAt: new Date(), createdAt: new Date() }] : [],
    },
  },
});

const payment = ({ status = 'PENDING' } = {}) => ({
  id: paymentId,
  escrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'contract-job-payment-key',
  amount: new Prisma.Decimal('300000.00'),
  currency: 'NGN',
  status,
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  metadata: { contractId },
  verifiedAt: null,
  createdAt: new Date(),
});

const mockPrisma = {
  application: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  contract: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  escrow: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  platformFeeConfiguration: { findUnique: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
}));

const { selectContractJobApplication, updateEmployerApplicationStatus } = await import('../src/services/employerApplications.service.js');
const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { initializeContractPayment, verifyContractPayment } = await import('../src/services/contractPayment.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: applicationId }]);
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({ percentage: new Prisma.Decimal('5.00'), isActive: true });
  mockPrisma.contract.create.mockResolvedValue({ id: contractId });
  mockPrisma.escrow.create.mockResolvedValue({ id: escrowId, status: 'UNFUNDED' });
  mockPrisma.application.update.mockResolvedValue({});
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  mockPrisma.contract.findFirst.mockResolvedValue(null);
  mockPrisma.payment.create.mockResolvedValue(payment());
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  mockPrisma.payment.update.mockImplementation(async ({ data }) => ({ ...payment({ status: data.status ?? 'PENDING' }), metadata: data.metadata ?? payment().metadata }));
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', grossAmount: new Prisma.Decimal('300000.00') });
  mockPrisma.escrow.update.mockResolvedValue({});
  mockPrisma.contract.update.mockResolvedValue({});
  mockPrisma.application.updateMany.mockResolvedValue({ count: 1 });
  initializeFlutterwavePayment.mockResolvedValue({ checkoutUrl: 'https://checkout.test', providerReference });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, amount: 300000, currency: 'NGN', status: 'successful' });
});

test('contract selection creates protected engagement and leaves application payment pending', async () => {
  mockPrisma.application.findFirst.mockResolvedValue(contractJobApplication());
  const result = await selectContractJobApplication(employerId, jobId, applicationId);

  expect(mockPrisma.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CONTRACT_PROJECT', status: 'PENDING' }) }));
  expect(mockPrisma.escrow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ freelanceContractId: contractId, status: 'UNFUNDED' }) }));
  expect(mockPrisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAYMENT_PENDING' } }));
  expect(result.status).toBe('PAYMENT_PENDING');
});

test('contract selection rejects a non-owned application', async () => {
  mockPrisma.application.findFirst.mockResolvedValue(null);
  await expect(selectContractJobApplication(employerId, jobId, applicationId)).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.contract.create).not.toHaveBeenCalled();
});

test('second Contract Job candidate selection fails before creating another engagement', async () => {
  mockPrisma.application.findFirst.mockResolvedValueOnce(contractJobApplication());
  await selectContractJobApplication(employerId, jobId, applicationId);

  const contractCreateCount = mockPrisma.contract.create.mock.calls.length;
  const escrowCreateCount = mockPrisma.escrow.create.mock.calls.length;
  mockPrisma.application.findFirst.mockResolvedValueOnce(contractJobApplication({ id: secondApplicationId, selectedSeekerId: '33333333-3333-4333-8333-333333333334' }));
  mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: contractId, applicationId });

  await expect(selectContractJobApplication(employerId, jobId, secondApplicationId)).rejects.toMatchObject({
    status: 409,
    message: 'Another candidate has already been selected for this job.',
  });
  expect(mockPrisma.contract.create).toHaveBeenCalledTimes(contractCreateCount);
  expect(mockPrisma.escrow.create).toHaveBeenCalledTimes(escrowCreateCount);
});

test('simultaneous Contract Job selections serialize to one selected candidate', async () => {
  const applications = {
    [applicationId]: contractJobApplication(),
    [secondApplicationId]: contractJobApplication({ id: secondApplicationId, selectedSeekerId: '33333333-3333-4333-8333-333333333334' }),
  };
  let selectedApplicationId = null;
  let transactionTail = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const transaction = transactionTail.then(() => callback(mockPrisma));
    transactionTail = transaction.catch(() => undefined);
    return transaction;
  });
  mockPrisma.application.findFirst.mockImplementation(async ({ where }) => applications[where.id]);
  mockPrisma.contract.findFirst.mockImplementation(async () => selectedApplicationId ? { id: contractId, applicationId: selectedApplicationId } : null);
  mockPrisma.contract.create.mockImplementation(async ({ data }) => {
    selectedApplicationId = data.applicationId;
    return { id: contractId };
  });

  const results = await Promise.allSettled([
    selectContractJobApplication(employerId, jobId, applicationId),
    selectContractJobApplication(employerId, jobId, secondApplicationId),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(mockPrisma.contract.create).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.create).toHaveBeenCalledTimes(1);
  expect(selectedApplicationId).toBeTruthy();
});

test('generic ACCEPTED status cannot bypass Contract Job payment selection', async () => {
  mockPrisma.application.findFirst
    .mockResolvedValueOnce({ id: applicationId })
    .mockResolvedValueOnce(contractJobApplication());

  await expect(updateEmployerApplicationStatus(employerId, jobId, applicationId, 'ACCEPTED'))
    .rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
  expect(mockPrisma.contract.create).not.toHaveBeenCalled();
});

test('contract payment initialization uses the snapshot amount and does not use a separate escrow system', async () => {
  const result = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'contract-job-payment-key' });
  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: new Prisma.Decimal('300000.00'), currency: 'NGN', paymentType: 'CONTRACT_FUNDING' }) }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '300000.00', currency: 'NGN' }));
  expect(result.payment.checkoutUrl).toBe('https://checkout.test');
});

test('verified contract payment funds escrow and finalizes application acceptance atomically', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } });
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  const result = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });

  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL' }) }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FUNDED' }) }));
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({ where: { id: contractId }, data: { status: 'ACTIVE' } });
  expect(mockPrisma.application.updateMany).toHaveBeenCalledWith({ where: { id: applicationId, status: 'PAYMENT_PENDING' }, data: { status: 'ACCEPTED' } });
  expect(result.payment.status).toBe('SUCCESSFUL');
});

test('wrong provider amount does not finalize a Contract Job', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, amount: 1, currency: 'NGN', status: 'successful' });
  await expect(verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' })).rejects.toMatchObject({ status: 422 });
  expect(mockPrisma.application.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});
