import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.FLW_SECRET_KEY = 'test-secret';
process.env.FLW_SECRET_HASH = 'webhook-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const employerId = '11111111-1111-4111-8111-111111111111';
const paymentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const providerReference = 'leamjobs_contract_ref';

const payment = ({ status = 'PENDING', amount = '100000.00', currency = 'NGN' } = {}) => ({
  id: paymentId,
  escrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'payment-key',
  amount: new Prisma.Decimal(amount),
  currency,
  status,
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  metadata: { contractId },
  verifiedAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
});

const fullContract = ({ escrowStatus = 'UNFUNDED' } = {}) => ({
  id: contractId,
  applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employerId,
  seekerId: '33333333-3333-4333-8333-333333333333',
  type: 'FREELANCE_PROJECT',
  status: 'ACTIVE',
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
    completionSubmittedAt: null,
    completionNote: null,
    workStatus: 'IN_PROGRESS',
    escrow: {
      id: escrowId,
      grossAmount: new Prisma.Decimal('100000.00'),
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('95000.00'),
      currency: 'NGN',
      fundedAmount: new Prisma.Decimal('0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: null,
      releaseEligibleAt: null,
      payments: escrowStatus === 'FUNDED' ? [payment({ status: 'SUCCESSFUL' })] : [],
    },
  },
});

const mockPrisma = {
  contract: { findFirst: jest.fn(), findUnique: jest.fn() },
  payment: { findUnique: jest.fn(), update: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  providerWebhookEvent: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { handleFlutterwaveWebhook } = await import('../src/services/contractPayment.service.js');
const { assertFlutterwaveWebhookSignature } = await import('../src/services/flutterwave.service.js');

const webhookPayload = (overrides = {}) => ({
  id: 'webhook-event-1',
  event: 'charge.completed',
  data: {
    id: 987654,
    tx_ref: providerReference,
    meta: { contractId },
    ...overrides,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: escrowId }]);
  mockPrisma.providerWebhookEvent.create.mockResolvedValue({});
  mockPrisma.providerWebhookEvent.update.mockResolvedValue({});
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  mockPrisma.payment.update.mockResolvedValue(payment({ status: 'SUCCESSFUL' }));
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', grossAmount: new Prisma.Decimal('100000.00') });
  mockPrisma.escrow.update.mockResolvedValue({});
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : {
    id: contractId,
    employerId,
    freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } },
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'successful' } }),
  });
});

test('invalid webhook signature is rejected by the real signature verifier', () => {
  expect(() => assertFlutterwaveWebhookSignature('wrong-secret')).toThrow('Invalid Flutterwave webhook signature');
});

test('valid webhook is accepted and funds escrow once', async () => {
  assertFlutterwaveWebhookSignature('webhook-secret');
  const result = await handleFlutterwaveWebhook({ payload: webhookPayload() });
  expect(result.duplicate).toBe(false);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/transactions/987654/verify'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }) }));
  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL' }) }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FUNDED', fundedAmount: new Prisma.Decimal('100000.00') }) }));
});

test('duplicate ProviderWebhookEvent is ignored without a second funding transition', async () => {
  await handleFlutterwaveWebhook({ payload: webhookPayload() });
  mockPrisma.providerWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
  const result = await handleFlutterwaveWebhook({ payload: webhookPayload() });
  expect(result).toEqual({ duplicate: true });
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
});

test.each([
  ['wrong amount', { amount: 99999, currency: 'NGN' }],
  ['wrong currency', { amount: 100000, currency: 'USD' }],
])('%s webhook is rejected without funding escrow', async (_label, providerData) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, status: 'successful', ...providerData } }),
  });
  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 422 });
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
});
