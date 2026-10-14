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
const webhookEvents = new Map();

const payment = ({
  status = 'PENDING',
  amount = '100000.00',
  currency = 'NGN',
  paymentType = 'CONTRACT_FUNDING',
  provider = 'FLUTTERWAVE',
  userId: paymentUserId = employerId,
  escrowId: paymentEscrowId = escrowId,
} = {}) => ({
  id: paymentId,
  userId: paymentUserId,
  escrowId: paymentEscrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'payment-key',
  amount: new Prisma.Decimal(amount),
  currency,
  status,
  paymentType,
  provider,
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
  freelanceContract: { update: jest.fn() },
  payment: { findUnique: jest.fn(), update: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  financialLedgerEntry: { createMany: jest.fn() },
  providerWebhookEvent: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { handleFlutterwaveWebhook, processPendingContractWebhookEvents } = await import('../src/services/contractPayment.service.js');
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
  webhookEvents.clear();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: escrowId }]);
  mockPrisma.providerWebhookEvent.create.mockImplementation(async ({ data }) => {
    if (webhookEvents.has(data.providerEventId)) throw { code: 'P2002' };
    const event = {
      attempts: 0,
      processingStartedAt: null,
      claimToken: null,
      lastError: null,
      ...data,
      processedAt: null,
    };
    webhookEvents.set(data.providerEventId, event);
    return event;
  });
  mockPrisma.providerWebhookEvent.findUnique.mockImplementation(async ({ where }) => (
    webhookEvents.get(where.provider_providerEventId.providerEventId) ?? null
  ));
  mockPrisma.providerWebhookEvent.update.mockImplementation(async ({ where, data }) => {
    const event = webhookEvents.get(where.provider_providerEventId.providerEventId);
    if (event) Object.assign(event, data);
    return event;
  });
  mockPrisma.providerWebhookEvent.updateMany.mockImplementation(async ({ where, data }) => {
    const event = webhookEvents.get(where.provider_providerEventId.providerEventId);
    if (!event || event.processedAt || (where.claimToken && event.claimToken !== where.claimToken)) return { count: 0 };
    if (where.attempts && event.attempts >= where.attempts.lt) return { count: 0 };
    if (where.nextAttemptAt && event.nextAttemptAt > where.nextAttemptAt.lte) return { count: 0 };
    if (where.OR && !event.processingStartedAt
      && (!event.nextAttemptAt || event.nextAttemptAt > where.OR[0].nextAttemptAt.lte)) return { count: 0 };
    if (where.OR && event.processingStartedAt && !(event.processingStartedAt < where.OR[1].processingStartedAt.lt)) return { count: 0 };
    if (data.attempts?.increment) event.attempts += data.attempts.increment;
    Object.assign(event, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'attempts')));
    return { count: 1 };
  });
  mockPrisma.providerWebhookEvent.findMany.mockImplementation(async () => (
    [...webhookEvents.values()]
      .filter((event) => !event.processedAt && event.paymentReference && event.transactionId
        && event.attempts < 6
        && ((event.nextAttemptAt && event.nextAttemptAt <= new Date() && !event.processingStartedAt)
          || (event.processingStartedAt && event.processingStartedAt < new Date(Date.now() - 15 * 60 * 1000))))
      .map(({ providerEventId }) => ({ providerEventId }))
  ));
  mockPrisma.providerWebhookEvent.delete.mockResolvedValue({});
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  mockPrisma.payment.update.mockResolvedValue(payment({ status: 'SUCCESSFUL' }));
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', currency: 'NGN', grossAmount: new Prisma.Decimal('100000.00'), platformFeeAmount: new Prisma.Decimal('5000.00'), seekerNetAmount: new Prisma.Decimal('95000.00') });
  mockPrisma.escrow.update.mockResolvedValue({});
  mockPrisma.freelanceContract.update.mockResolvedValue({});
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : {
    id: contractId,
    employerId,
    freelanceDetails: { currency: 'NGN', escrow: { id: escrowId, currency: 'NGN', payments: [payment()] } },
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
  const result = await handleFlutterwaveWebhook({ payload: webhookPayload() });
  expect(result).toEqual({ duplicate: true });
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.financialLedgerEntry.createMany).toHaveBeenCalledTimes(1);
});

test('does not process a webhook whose transaction ID differs from the successful local payment', async () => {
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: {
      escrow: {
        id: escrowId,
        payments: [{ ...payment({ status: 'SUCCESSFUL' }), transactionId: '123456' }],
      },
    },
  }));

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() }))
    .rejects.toMatchObject({ status: 409 });

  expect(webhookEvents.get('webhook-event-1').processedAt).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.createMany).not.toHaveBeenCalled();
});

test.each([
  ['payment belongs to another employer', payment({ userId: '22222222-2222-4222-8222-222222222222' })],
  ['payment belongs to another escrow', payment({ escrowId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef' })],
])('does not reconcile when the local %s', async (_description, mismatchedPayment) => {
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: { escrow: { id: escrowId, payments: [mismatchedPayment] } },
  }));

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() }))
    .rejects.toMatchObject({ status: 409 });

  expect(webhookEvents.get('webhook-event-1').processedAt).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.createMany).not.toHaveBeenCalled();
});

test('an unresolved webhook with a missing Payment can retry after local reconciliation becomes available', async () => {
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: { currency: 'NGN', escrow: { id: escrowId, currency: 'NGN', payments: [] } },
  }));

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() }))
    .rejects.toMatchObject({ status: 503 });
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  webhookEvents.get('webhook-event-1').nextAttemptAt = new Date(0);

  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: { currency: 'NGN', escrow: { id: escrowId, currency: 'NGN', payments: [payment()] } },
  }));
  const retry = await handleFlutterwaveWebhook({ payload: webhookPayload() });

  expect(retry.duplicate).toBe(false);
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeInstanceOf(Date);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
});

test('a pending provider result stays retryable and is not acknowledged as processed', async () => {
  mockPrisma.payment.update.mockImplementation(async ({ data }) => payment({ status: data.status }));
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'pending' } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'successful' } }),
    });

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() }))
    .rejects.toMatchObject({ status: 503 });
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeNull();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  webhookEvents.get('webhook-event-1').nextAttemptAt = new Date(0);

  const retry = await handleFlutterwaveWebhook({ payload: webhookPayload() });

  expect(retry.duplicate).toBe(false);
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeInstanceOf(Date);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
});

test('a reused webhook event ID with different content is rejected', async () => {
  await handleFlutterwaveWebhook({ payload: webhookPayload() });
  const conflictingPayload = webhookPayload({ status: 'failed' });

  await expect(handleFlutterwaveWebhook({ payload: conflictingPayload }))
    .rejects.toMatchObject({ status: 409 });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
});

test('scheduled recovery processes a due event after its local Payment becomes available', async () => {
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: { escrow: { id: escrowId, payments: [] } },
  }));
  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 503 });
  const event = webhookEvents.get('webhook-event-1');
  expect(event.paymentReference).toBe(providerReference);
  expect(event.transactionId).toBe('987654');
  expect(event.processedAt).toBeNull();

  event.nextAttemptAt = new Date(0);
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : ({
    id: contractId,
    employerId,
    freelanceDetails: { currency: 'NGN', escrow: { id: escrowId, currency: 'NGN', payments: [payment()] } },
  }));
  const recovery = await processPendingContractWebhookEvents();

  expect(recovery).toEqual({ examined: 1, processed: 1, deferred: 0 });
  expect(event.processedAt).toBeInstanceOf(Date);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.financialLedgerEntry.createMany).toHaveBeenCalledTimes(1);
});

test('scheduled recovery reclaims an interrupted attempt after its lease expires', async () => {
  mockPrisma.payment.update.mockImplementation(async ({ data }) => payment({ status: data.status }));
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'pending' } }),
    })
    .mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'successful' } }),
    });
  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 503 });
  const event = webhookEvents.get('webhook-event-1');
  expect(event.processedAt).toBeNull();
  event.nextAttemptAt = null;
  event.processingStartedAt = new Date(Date.now() - 16 * 60 * 1000);
  event.claimToken = 'abandoned-claim';

  const recovery = await processPendingContractWebhookEvents();

  expect(recovery).toEqual({ examined: 1, processed: 1, deferred: 0 });
  expect(event.attempts).toBe(2);
  expect(event.processedAt).toBeInstanceOf(Date);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
});

test('concurrent deliveries claim one event and produce one funding transition', async () => {
  const results = await Promise.all([
    handleFlutterwaveWebhook({ payload: webhookPayload() }),
    handleFlutterwaveWebhook({ payload: webhookPayload() }),
  ]);

  expect(results.filter((result) => result.processing)).toHaveLength(1);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.financialLedgerEntry.createMany).toHaveBeenCalledTimes(1);
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeInstanceOf(Date);
});

test('transient provider verification failures schedule bounded retry without processing the event', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('temporary provider network failure'));
  const attemptedAt = Date.now();
  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 503 });

  const event = webhookEvents.get('webhook-event-1');
  expect(event.attempts).toBe(1);
  expect(event.nextAttemptAt.getTime() - attemptedAt).toBeGreaterThanOrEqual(60_000);
  expect(event.nextAttemptAt.getTime() - attemptedAt).toBeLessThan(65_000);
  expect(event.lastError).toBe('HTTP_502');
  expect(event.processedAt).toBeNull();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('retry policy stops after six attempts and does not keep polling an exhausted event', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'pending' } }),
  });
  mockPrisma.payment.update.mockImplementation(async ({ data }) => payment({ status: data.status }));

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) webhookEvents.get('webhook-event-1').nextAttemptAt = new Date(0);
    await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 503 });
  }
  const event = webhookEvents.get('webhook-event-1');
  expect(event.attempts).toBe(6);
  expect(event.nextAttemptAt).toBeNull();
  expect(event.processedAt).toBeNull();

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 409 });
  expect(global.fetch).toHaveBeenCalledTimes(6);
});

test('a provider-confirmed failed payment is recorded as reconciled and remains idempotent', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'failed' } }),
  });
  mockPrisma.payment.update.mockImplementation(async ({ data }) => payment({ status: data.status }));

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() }))
    .rejects.toMatchObject({ status: 422, reconciliationComplete: true });
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeInstanceOf(Date);

  const duplicate = await handleFlutterwaveWebhook({ payload: webhookPayload() });
  expect(duplicate).toEqual({ duplicate: true });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
});

test.each([
  ['another provider', { provider: 'PAYSTACK' }],
  ['another payment type', { paymentType: 'SUBSCRIPTION' }],
])('webhook without contract metadata rejects a payment belonging to %s', async (_label, paymentOverrides) => {
  const webhookWithoutContract = webhookPayload();
  delete webhookWithoutContract.data.meta;
  mockPrisma.payment.findUnique.mockResolvedValue({
    ...payment(paymentOverrides),
    escrow: {
      id: escrowId,
      currency: 'NGN',
      freelanceContract: {
        contract: {
          id: contractId,
          employerId,
          freelanceDetails: { currency: 'NGN' },
        },
      },
    },
  });

  await expect(handleFlutterwaveWebhook({ payload: webhookWithoutContract })).rejects.toMatchObject({ status: 409 });

  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.createMany).not.toHaveBeenCalled();
});

test('funding rejects a payment currency that differs from its escrow currency', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue({
    id: escrowId,
    status: 'UNFUNDED',
    currency: 'NGN',
    currency: 'USD',
    grossAmount: new Prisma.Decimal('100000.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('95000.00'),
  });

  await expect(handleFlutterwaveWebhook({ payload: webhookPayload() })).rejects.toMatchObject({ status: 409 });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.createMany).not.toHaveBeenCalled();
});

test('additive webhook verifies employer total but funds only the project amount', async () => {
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId ? fullContract() : {
    id: contractId,
    employerId,
    freelanceDetails: { currency: 'NGN', escrow: { id: escrowId, currency: 'NGN', payments: [payment({ amount: '105000.00' })] } },
  });
  mockPrisma.payment.findUnique.mockResolvedValue(payment({ amount: '105000.00' }));
  mockPrisma.escrow.findUnique.mockResolvedValue({
    id: escrowId,
    status: 'UNFUNDED',
    currency: 'NGN',
    grossAmount: new Prisma.Decimal('100000.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('100000.00'),
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, amount: 105000, currency: 'NGN', status: 'successful' } }),
  });

  const result = await handleFlutterwaveWebhook({ payload: webhookPayload() });

  expect(result.duplicate).toBe(false);
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FUNDED', fundedAmount: new Prisma.Decimal('100000.00') }),
  }));
  expect(mockPrisma.financialLedgerEntry.createMany.mock.calls[0][0].data.map(({ amount }) => amount.toFixed(2)))
    .toEqual(['105000.00', '100000.00', '5000.00']);
});

test.each([
  ['wrong payment reference', { tx_ref: 'different-reference' }, 503],
  ['wrong amount', { amount: 99999, currency: 'NGN' }, 422],
  ['wrong currency', { amount: 100000, currency: 'USD' }, 422],
])('%s webhook is rejected without funding escrow', async (_label, providerData, status) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { id: 987654, tx_ref: providerReference, status: 'successful', ...providerData } }),
  });
  const payload = _label === 'wrong payment reference' ? webhookPayload(providerData) : webhookPayload();
  await expect(handleFlutterwaveWebhook({ payload })).rejects.toMatchObject({ status });
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
  expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  expect(webhookEvents.get('webhook-event-1').processedAt).toBeNull();
});
