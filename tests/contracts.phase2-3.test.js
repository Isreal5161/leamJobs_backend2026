import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const paymentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const providerReference = 'leamjobs_contract_ref';

const payment = ({ status = 'PENDING' } = {}) => ({
  id: paymentId,
  escrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'payment-key',
  amount: new Prisma.Decimal('100000.00'),
  currency: 'NGN',
  status,
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  metadata: { contractId },
  verifiedAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
});
const contract = ({ escrowStatus = 'UNFUNDED', completionSubmittedAt = null, completionNote = null } = {}) => ({
  id: contractId,
  applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employerId,
  seekerId,
  type: 'FREELANCE_PROJECT',
  status: 'ACTIVE',
  employer: { email: 'employer@example.com' },
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  freelanceDetails: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('95000.00'),
    employerConfirmedAt: new Date('2026-09-11T09:00:00.000Z'),
    seekerConfirmedAt: new Date('2026-09-11T09:30:00.000Z'),
    employerCompletionConfirmedAt: null,
    completionSubmittedAt,
    completionNote,
    workStatus: completionSubmittedAt ? 'COMPLETION_SUBMITTED' : 'IN_PROGRESS',
    escrow: {
      id: escrowId,
      grossAmount: new Prisma.Decimal('100000.00'),
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('95000.00'),
      currency: 'NGN',
      fundedAmount: escrowStatus === 'FUNDED' ? new Prisma.Decimal('100000.00') : new Prisma.Decimal('0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: escrowStatus === 'FUNDED' ? new Date('2026-09-11T11:00:00.000Z') : null,
      releaseEligibleAt: null,
      payments: escrowStatus === 'FUNDED' ? [payment({ status: 'SUCCESSFUL' })] : [],
    },
  },
});

const mockPrisma = {
  contract: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  providerWebhookEvent: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
  assertFlutterwaveWebhookSignature: jest.fn(),
}));

const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { initializeContractPayment, verifyContractPayment } = await import('../src/services/contractPayment.service.js');
const { submitContractCompletion, confirmContractCompletion } = await import('../src/services/contract.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: contractId }]);
  mockPrisma.contract.findUnique.mockResolvedValue(contract());
  mockPrisma.contract.findFirst.mockResolvedValue(contract());
  mockPrisma.payment.create.mockResolvedValue(payment());
  mockPrisma.payment.update.mockImplementation(async ({ data }) => ({ ...payment({ status: data.status ?? 'PENDING' }), metadata: data.metadata ?? payment().metadata }));
  mockPrisma.payment.findUnique.mockResolvedValue(null);
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', grossAmount: new Prisma.Decimal('100000.00') });
  mockPrisma.escrow.update.mockResolvedValue(undefined);
  mockPrisma.freelanceContract.update.mockResolvedValue(undefined);
  initializeFlutterwavePayment.mockResolvedValue({ checkoutUrl: 'https://checkout.test', providerReference });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'successful' });
});

test('payment initialization uses server-side gross amount and currency', async () => {
  const result = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'payment-key' });
  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal('100000.00'), currency: 'NGN', status: 'PENDING', paymentType: 'CONTRACT_FUNDING', provider: 'FLUTTERWAVE' }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '100000.00', currency: 'NGN' }));
  expect(result.payment.checkoutUrl).toBe('https://checkout.test');
});

test('wrong employer cannot initialize payment', async () => {
  mockPrisma.contract.findUnique.mockResolvedValue(contract());
  await expect(initializeContractPayment({ contractId, employerId: seekerId })).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.payment.create).not.toHaveBeenCalled();
});

test('verified payment atomically funds the escrow', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ ...contract(), freelanceDetails: { ...contract().freelanceDetails, escrow: { ...contract().freelanceDetails.escrow, payments: [payment()] } } });
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  const lockedPayment = { ...payment(), escrowId };
  mockPrisma.payment.findUnique.mockResolvedValueOnce(payment()).mockResolvedValueOnce(lockedPayment);
  const result = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '987654' });
  expect(verifyFlutterwaveTransaction).toHaveBeenCalledWith('987654');
  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL', transactionId: '987654' }) }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FUNDED', fundedAmount: new Prisma.Decimal('100000.00') }) }));
  expect(result.payment.status).toBe('SUCCESSFUL');
});

test('wrong provider amount does not fund escrow', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ ...contract(), freelanceDetails: { ...contract().freelanceDetails, escrow: { ...contract().freelanceDetails.escrow, payments: [payment()] } } });
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 987654, tx_ref: providerReference, amount: 1, currency: 'NGN', status: 'successful' });
  await expect(verifyContractPayment({ contractId, employerId, providerReference, transactionId: '987654' })).rejects.toMatchObject({ status: 422 });
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('seeker can submit completion only after funded escrow', async () => {
  const funded = contract({ escrowStatus: 'FUNDED' });
  mockPrisma.contract.findUnique.mockResolvedValueOnce(funded).mockResolvedValueOnce({ ...funded, freelanceDetails: { ...funded.freelanceDetails, completionSubmittedAt: new Date(), completionNote: 'Done', workStatus: 'COMPLETION_SUBMITTED' } });
  const result = await submitContractCompletion({ contractId, seekerId, completionNote: 'Done' });
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ completionNote: 'Done', workStatus: 'COMPLETION_SUBMITTED' }) }));
  expect(result.freelance.completionNote).toBe('Done');
});

test('employer confirmation makes funded escrow release eligible', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date(), completionNote: 'Done' });
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce({ ...submitted, freelanceDetails: { ...submitted.freelanceDetails, employerCompletionConfirmedAt: new Date(), workStatus: 'RELEASE_ELIGIBLE', escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE', releaseEligibleAt: new Date() } } });
  const result = await confirmContractCompletion({ contractId, employerId });
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASE_ELIGIBLE', releaseEligibleAt: expect.any(Date) }) }));
  expect(result.freelance.escrow.status).toBe('RELEASE_ELIGIBLE');
});
