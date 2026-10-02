import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.FLW_SECRET_KEY = 'test-secret';

const userId = '11111111-1111-4111-8111-111111111111';
const planId = '33333333-3333-4333-8333-333333333333';
const reference = 'leamjobs_sub_webhook_test';
const eventKey = 'event-1:charge.completed:successful';

const plan = {
  id: planId,
  key: 'PROFESSIONAL',
  displayName: 'Professional',
  description: 'Career tools',
  price: '49.00',
  currency: 'NGN',
  billingInterval: 'MONTHLY',
  isActive: true,
  isPublic: true,
  benefits: [],
  aiAllowance: null,
  aiUnlimited: false,
  featureConfig: {},
  entitlements: [],
};

const subscription = (status = 'PENDING') => ({
  id: 'sub-1',
  userId,
  planId,
  status,
  priceSnapshot: '49.00',
  currencySnapshot: 'NGN',
  billingIntervalSnapshot: 'MONTHLY',
  startDate: new Date(),
  endDate: null,
  nextRenewalAt: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  plan,
  payments: [],
});

const payment = (status = 'PENDING') => ({
  id: 'payment-1',
  userId,
  subscriptionId: 'sub-1',
  providerReference: reference,
  transactionId: null,
  idempotencyKey: 'checkout-key',
  amount: '49.00',
  currency: 'NGN',
  status,
  paymentType: 'SUBSCRIPTION',
  provider: 'FLUTTERWAVE',
  metadata: {
    userId,
    planId,
    planKey: plan.key,
    subscriptionId: 'sub-1',
    customerEmail: 'seeker@example.com',
  },
  verifiedAt: null,
  createdAt: new Date(),
  subscription: subscription(status === 'SUCCESSFUL' ? 'ACTIVE' : status === 'FAILED' ? 'FAILED' : 'PENDING'),
});

let currentPaymentStatus = 'PENDING';
let currentSubscriptionStatus = 'PENDING';
let webhookEvents;

const mockPrisma = {
  payment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  subscription: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  subscriptionEvent: { create: jest.fn() },
  providerWebhookEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  notification: { create: jest.fn() },
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

const mockContractWebhook = jest.fn();
const mockVerifyFlutterwaveTransaction = jest.fn();
const mockInitializeFlutterwavePayment = jest.fn();
const mockAssertFlutterwaveWebhookSignature = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/contractPayment.service.js', () => ({
  handleFlutterwaveWebhook: mockContractWebhook,
  initializeContractPayment: jest.fn(),
  verifyContractPayment: jest.fn(),
}));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: mockInitializeFlutterwavePayment,
  verifyFlutterwaveTransaction: mockVerifyFlutterwaveTransaction,
  assertFlutterwaveWebhookSignature: mockAssertFlutterwaveWebhookSignature,
}));

const { handleFlutterwaveWebhook } = await import('../src/services/flutterwaveWebhook.service.js');
const { flutterwaveWebhook } = await import('../src/controllers/contract.controller.js');

const payload = (overrides = {}) => ({
  id: 'event-1',
  event: 'charge.completed',
  data: {
    id: 123,
    tx_ref: reference,
    status: 'successful',
    amount: 49,
    currency: 'NGN',
    customer: { email: 'seeker@example.com' },
    meta: { userId, planId, subscriptionId: 'sub-1', planKey: 'PROFESSIONAL' },
    ...overrides,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  currentPaymentStatus = 'PENDING';
  currentSubscriptionStatus = 'PENDING';
  webhookEvents = new Map();

  mockPrisma.payment.findUnique.mockImplementation(async ({ where }) => {
    if (where.providerReference === reference || where.transactionId === '123') {
      return { ...payment(currentPaymentStatus), transactionId: currentPaymentStatus === 'SUCCESSFUL' ? '123' : null };
    }
    if (where.id === 'payment-1') {
      return {
        ...payment(currentPaymentStatus),
        transactionId: currentPaymentStatus === 'SUCCESSFUL' ? '123' : null,
        subscription: subscription(currentSubscriptionStatus),
      };
    }
    return null;
  });
  mockPrisma.payment.findFirst.mockImplementation(async () => ({
    ...payment(currentPaymentStatus),
    transactionId: currentPaymentStatus === 'SUCCESSFUL' ? '123' : null,
    subscription: subscription(currentSubscriptionStatus),
  }));
  mockPrisma.payment.update.mockImplementation(async ({ data }) => {
    currentPaymentStatus = data.status;
    return { ...payment(currentPaymentStatus), ...data, transactionId: data.transactionId ?? null };
  });
  mockPrisma.payment.updateMany.mockImplementation(async ({ where, data }) => {
    if (currentPaymentStatus !== where.status) return { count: 0 };
    currentPaymentStatus = data.status;
    return { count: 1 };
  });
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.subscription.findUnique.mockImplementation(async () => subscription(currentSubscriptionStatus));
  mockPrisma.subscription.updateMany.mockImplementation(async ({ where, data }) => {
    if (currentSubscriptionStatus !== where.status) return { count: 0 };
    currentSubscriptionStatus = data.status;
    return { count: 1 };
  });
  mockPrisma.subscriptionEvent.create.mockResolvedValue({ id: 'event-record-1' });
  mockPrisma.providerWebhookEvent.create.mockImplementation(async ({ data }) => {
    if (webhookEvents.has(data.providerEventId)) throw { code: 'P2002' };
    webhookEvents.set(data.providerEventId, { ...data, processedAt: null });
    return webhookEvents.get(data.providerEventId);
  });
  mockPrisma.providerWebhookEvent.findUnique.mockImplementation(async ({ where }) => (
    webhookEvents.get(where.provider_providerEventId.providerEventId) ?? null
  ));
  mockPrisma.providerWebhookEvent.update.mockImplementation(async ({ where, data }) => {
    const event = webhookEvents.get(where.provider_providerEventId.providerEventId);
    if (event) Object.assign(event, data);
    return event;
  });
  mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'seeker@example.com' });
  mockVerifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: reference,
    status: 'successful',
    amount: 49,
    currency: 'NGN',
    customer: { email: 'seeker@example.com' },
    meta: { userId, planId, subscriptionId: 'sub-1', planKey: 'PROFESSIONAL' },
  });
  mockContractWebhook.mockResolvedValue({ contractProcessed: true });
  mockAssertFlutterwaveWebhookSignature.mockImplementation(() => undefined);
});

const makeWebhookResponse = () => {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return response;
};

test.each([
  ['missing', undefined],
  ['invalid', 'wrong-signature'],
])('%s webhook signature is rejected before payment lookup', async (_label, signature) => {
  const error = new Error('Invalid Flutterwave webhook signature');
  error.status = 401;
  mockAssertFlutterwaveWebhookSignature.mockImplementationOnce(() => { throw error; });
  const response = makeWebhookResponse();
  const next = jest.fn();

  await flutterwaveWebhook({
    body: payload(),
    get: () => signature,
  }, response, next);

  expect(mockAssertFlutterwaveWebhookSignature).toHaveBeenCalledWith(signature);
  expect(mockPrisma.payment.findUnique).not.toHaveBeenCalled();
  expect(mockContractWebhook).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(error);
});

test('valid webhook signature proceeds to payment routing and returns an acknowledgement', async () => {
  mockPrisma.payment.findUnique.mockResolvedValue(null);
  const response = makeWebhookResponse();
  const next = jest.fn();

  await flutterwaveWebhook({
    body: payload(),
    get: (header) => header === 'verif-hash' ? 'valid-signature' : undefined,
  }, response, next);

  expect(mockAssertFlutterwaveWebhookSignature).toHaveBeenCalledWith('valid-signature');
  expect(mockContractWebhook).toHaveBeenCalledWith({ payload: payload() });
  expect(response.statusCode).toBe(200);
  expect(response.body.success).toBe(true);
  expect(next).not.toHaveBeenCalled();
});

test('subscription payments route from stored payment identifiers and activate only after provider verification', async () => {
  const result = await handleFlutterwaveWebhook({ payload: payload() });

  expect(result.duplicate).toBe(false);
  expect(result.status).toBe('SUCCESSFUL');
  expect(mockVerifyFlutterwaveTransaction).toHaveBeenCalledWith('123');
  expect(currentPaymentStatus).toBe('SUCCESSFUL');
  expect(currentSubscriptionStatus).toBe('ACTIVE');
  expect(mockContractWebhook).not.toHaveBeenCalled();
  expect(webhookEvents.get(eventKey).processedAt).toBeInstanceOf(Date);
});

test('already-processed subscription webhook is acknowledged without a second activation', async () => {
  await handleFlutterwaveWebhook({ payload: payload() });
  const duplicate = await handleFlutterwaveWebhook({ payload: payload() });

  expect(duplicate).toEqual({ duplicate: true });
  expect(mockVerifyFlutterwaveTransaction).toHaveBeenCalledTimes(1);
  expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledTimes(1);
});

test('concurrent duplicate subscription webhooks activate exactly once', async () => {
  let previousTransaction = Promise.resolve();
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    const currentTransaction = previousTransaction;
    let release;
    previousTransaction = new Promise((resolve) => { release = resolve; });
    await currentTransaction;
    try {
      return await callback(mockPrisma);
    } finally {
      release();
    }
  });

  const results = await Promise.all([
    handleFlutterwaveWebhook({ payload: payload() }),
    handleFlutterwaveWebhook({ payload: payload() }),
  ]);

  expect(results.map((result) => result.duplicate)).toEqual([false, false]);
  expect(currentPaymentStatus).toBe('SUCCESSFUL');
  expect(currentSubscriptionStatus).toBe('ACTIVE');
  expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledTimes(1);
});

test.each(['pending', 'failed'])('stale %s webhook cannot downgrade a successful subscription', async (status) => {
  await handleFlutterwaveWebhook({ payload: payload() });
  const staleResult = await handleFlutterwaveWebhook({
    payload: {
      ...payload({ status }),
      id: `event-${status}`,
    },
  });

  expect(staleResult.status).toBe('SUCCESSFUL');
  expect(currentPaymentStatus).toBe('SUCCESSFUL');
  expect(currentSubscriptionStatus).toBe('ACTIVE');
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
});

test('stale successful webhook cannot reactivate a cancelled subscription payment', async () => {
  currentPaymentStatus = 'CANCELLED';
  currentSubscriptionStatus = 'CANCELLED';
  mockPrisma.payment.findFirst.mockResolvedValue({
    ...payment('CANCELLED'),
    subscription: subscription('CANCELLED'),
  });

  await expect(handleFlutterwaveWebhook({ payload: payload() })).rejects.toMatchObject({ status: 409 });

  expect(currentPaymentStatus).toBe('CANCELLED');
  expect(currentSubscriptionStatus).toBe('CANCELLED');
  expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
});

test('contract payment routing ignores webhook metadata and preserves the existing contract handler', async () => {
  mockPrisma.payment.findUnique.mockImplementation(async ({ where }) => (
    where.providerReference === reference || where.transactionId === '123'
      ? { id: 'contract-payment-1', provider: 'FLUTTERWAVE', paymentType: 'CONTRACT_FUNDING' }
      : null
  ));

  const contractPayload = payload({ meta: { paymentType: 'SUBSCRIPTION', userId, planId } });
  const result = await handleFlutterwaveWebhook({ payload: contractPayload });

  expect(result).toEqual({ contractProcessed: true });
  expect(mockContractWebhook).toHaveBeenCalledWith({ payload: contractPayload });
  expect(mockVerifyFlutterwaveTransaction).not.toHaveBeenCalled();
});

test('pending subscription webhook is acknowledged without activating or failing the subscription', async () => {
  mockVerifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: reference,
    status: 'pending',
  });

  const result = await handleFlutterwaveWebhook({ payload: payload({ status: 'pending' }) });

  expect(result.status).toBe('PENDING');
  expect(currentPaymentStatus).toBe('PENDING');
  expect(currentSubscriptionStatus).toBe('PENDING');
  expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
});

test('failed subscription transaction is not activated and its verified event is acknowledged', async () => {
  mockVerifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: reference,
    status: 'failed',
  });

  const result = await handleFlutterwaveWebhook({ payload: payload({ status: 'failed' }) });

  expect(result.status).toBe('FAILED');
  expect(currentPaymentStatus).toBe('FAILED');
  expect(currentSubscriptionStatus).toBe('FAILED');
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('provider verification mismatch leaves the event unprocessed and does not activate', async () => {
  mockVerifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: 'wrong-reference',
    status: 'successful',
    amount: 49,
    currency: 'NGN',
  });

  await expect(handleFlutterwaveWebhook({ payload: payload() })).rejects.toMatchObject({ status: 422 });

  expect(currentPaymentStatus).toBe('PENDING');
  expect(currentSubscriptionStatus).toBe('PENDING');
  expect(webhookEvents.get(eventKey).processedAt).toBeNull();
});
