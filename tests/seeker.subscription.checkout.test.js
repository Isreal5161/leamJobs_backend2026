import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  withdrawal: { findUnique: jest.fn().mockResolvedValue(null) },
  subscriptionPlan: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  subscription: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  payment: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  subscriptionEvent: { create: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  FlutterwaveRequestError: class FlutterwaveRequestError extends Error {},
  getFlutterwaveBanks: jest.fn(),
  resolveFlutterwaveBankAccount: jest.fn(),
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
  assertFlutterwaveWebhookSignature: jest.fn(),
  createFlutterwaveTransfer: jest.fn(),
  getFlutterwaveTransferById: jest.fn(),
  isFlutterwaveConfigured: jest.fn(),
  normalizeFlutterwaveTransferStatus: jest.fn(),
}));
const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const adminId = '99999999-9999-4999-8999-999999999999';
const planId = '33333333-3333-4333-8333-333333333333';
const paymentProviderRef = 'leamjobs_sub_123';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });

const subscriptionPlan = {
  id: planId,
  key: 'PROFESSIONAL',
  displayName: 'Professional',
  description: 'Career visibility tools',
  price: '49.00',
  currency: 'NGN',
  billingInterval: 'MONTHLY',
  isActive: true,
  isPublic: true,
  displayOrder: 1,
  benefits: ['Boost'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const paymentRecord = {
  id: 'payment-1',
  userId: seekerId,
  subscriptionId: 'sub-1',
  providerReference: paymentProviderRef,
  transactionId: null,
  idempotencyKey: 'payment-key',
  amount: '49.00',
  currency: 'NGN',
  status: 'SUCCESSFUL',
  paymentType: 'SUBSCRIPTION',
  provider: 'FLUTTERWAVE',
  metadata: { planId, checkoutUrl: 'https://checkout.test' },
  verifiedAt: new Date(),
  createdAt: new Date(),
};

const pendingPayment = (overrides = {}) => ({
  ...paymentRecord,
  transactionId: null,
  status: 'PENDING',
  metadata: { userId: seekerId, planId, planKey: subscriptionPlan.key, subscriptionId: 'sub-1', customerEmail: 'seeker@example.com' },
  subscription: {
    id: 'sub-1',
    userId: seekerId,
    planId,
    status: 'PENDING',
    priceSnapshot: '49.00',
    currencySnapshot: 'NGN',
    billingIntervalSnapshot: 'MONTHLY',
    plan: subscriptionPlan,
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscriptionPlan.findMany.mockResolvedValue([subscriptionPlan]);
  mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(subscriptionPlan);
  mockPrisma.subscriptionPlan.findUnique.mockResolvedValue(subscriptionPlan);
  mockPrisma.user.findUnique.mockResolvedValue({ id: seekerId, email: 'seeker@example.com', firstName: 'Seeker', lastName: 'User' });
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.subscription.findUnique.mockResolvedValue({
    id: 'sub-1',
    userId: seekerId,
    planId,
    status: 'PENDING',
    priceSnapshot: '49.00',
    currencySnapshot: 'NGN',
    billingIntervalSnapshot: 'MONTHLY',
    startDate: new Date(),
    endDate: null,
    nextRenewalAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    plan: subscriptionPlan,
    payments: [{ ...paymentRecord, status: 'PENDING' }],
  });
  mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1', userId: seekerId, planId, status: 'PENDING', priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', startDate: new Date(), endDate: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date() });
  mockPrisma.payment.create.mockResolvedValue({ ...paymentRecord, id: 'payment-1', status: 'PENDING', metadata: { planId, checkoutUrl: null } });
  mockPrisma.payment.findFirst.mockResolvedValue({ ...paymentRecord, status: 'PENDING', metadata: { planId, checkoutUrl: 'https://checkout.test' } });
  mockPrisma.payment.findUnique.mockResolvedValue({ ...paymentRecord, status: 'PENDING', metadata: { planId, checkoutUrl: 'https://checkout.test' } });
  mockPrisma.payment.update.mockImplementation(async ({ data }) => ({ ...paymentRecord, ...data, id: 'payment-1' }));
  mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription.update.mockImplementation(async ({ data }) => ({ id: 'sub-1', userId: seekerId, planId, status: data.status ?? 'ACTIVE', priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', createdAt: new Date(), updatedAt: new Date(), plan: subscriptionPlan }));
  mockPrisma.subscription.updateMany.mockImplementation(async ({ data }) => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', userId: seekerId, planId, status: data.status, priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', startDate: data.startDate, endDate: data.endDate, createdAt: new Date(), updatedAt: new Date(), plan: subscriptionPlan, payments: [{ ...paymentRecord, status: 'SUCCESSFUL' }] });
    return { count: 1 };
  });
  mockPrisma.subscriptionEvent.create.mockResolvedValue({ id: 'event-1' });
  initializeFlutterwavePayment.mockResolvedValue({ checkoutUrl: 'https://checkout.test', providerReference: paymentProviderRef });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 123, tx_ref: paymentProviderRef, amount: 49, currency: 'NGN', status: 'successful' });
});

test('unauthenticated user cannot start a subscription purchase', async () => {
  const response = await request(app).post('/api/seeker/subscriptions/checkout').send({ planId });
  expect(response.status).toBe(401);
});

test('non-seeker cannot start a subscription purchase', async () => {
  const response = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('EMPLOYER', adminId)}`)
    .send({ planId });

  expect(response.status).toBe(403);
});

test('authenticated seeker can cancel their own pending subscription checkout', async () => {
  const pending = pendingPayment();
  mockPrisma.payment.findFirst.mockResolvedValue(pending);

  const response = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, data: { status: 'CANCELLED' } });
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      userId: seekerId,
      providerReference: paymentProviderRef,
      paymentType: 'SUBSCRIPTION',
      provider: 'FLUTTERWAVE',
    },
  }));
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith({
    where: { id: 'sub-1', userId: seekerId, status: 'PENDING' },
    data: expect.objectContaining({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
      cancellationReason: 'USER_CANCELLED_CHECKOUT',
    }),
  });
  expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'payment-1',
      userId: seekerId,
      subscriptionId: 'sub-1',
      providerReference: paymentProviderRef,
      paymentType: 'SUBSCRIPTION',
      provider: 'FLUTTERWAVE',
      status: 'PENDING',
    },
    data: { status: 'CANCELLED' },
  });
  expect(mockPrisma.subscriptionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      subscriptionId: 'sub-1',
      eventType: 'CANCELLED',
      providerReference: paymentProviderRef,
    }),
  }));
});

test('seeker cannot cancel another user payment and client ownership fields are rejected', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(null);

  const otherUserResponse = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', otherSeekerId)}`)
    .send({ providerReference: paymentProviderRef });
  expect(otherUserResponse.status).toBe(404);
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ userId: otherSeekerId, providerReference: paymentProviderRef }),
  }));

  const manipulatedResponse = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, userId: otherSeekerId, status: 'CANCELLED' });
  expect(manipulatedResponse.status).toBe(400);
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
});

test.each([
  ['successful payment', { status: 'SUCCESSFUL', subscription: { ...pendingPayment().subscription, status: 'ACTIVE' } }],
  ['active subscription', { subscription: { ...pendingPayment().subscription, status: 'ACTIVE' } }],
])('%s cannot be cancelled', async (_label, overrides) => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment(overrides));

  const response = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef });

  expect(response.status).toBe(409);
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.subscriptionEvent.create).not.toHaveBeenCalled();
});

test('already cancelled checkout cancellation is idempotent and does not record another event', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment({
    status: 'CANCELLED',
    subscription: { ...pendingPayment().subscription, status: 'CANCELLED' },
  }));

  const response = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef });

  expect(response.status).toBe(200);
  expect(response.body.data.status).toBe('CANCELLED');
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.subscriptionEvent.create).not.toHaveBeenCalled();
});

test('concurrent repeat cancellation returns the already-cancelled state without another event', async () => {
  mockPrisma.payment.findFirst
    .mockResolvedValueOnce(pendingPayment())
    .mockResolvedValueOnce(pendingPayment({
      status: 'CANCELLED',
      subscription: { ...pendingPayment().subscription, status: 'CANCELLED' },
    }));
  mockPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

  const response = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef });

  expect(response.status).toBe(200);
  expect(response.body.data.status).toBe('CANCELLED');
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.subscriptionEvent.create).not.toHaveBeenCalled();
});

test('cancellation that loses the activation race cannot change payment state', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment());
  mockPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

  const response = await request(app)
    .post('/api/seeker/subscriptions/payment/cancel')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef });

  expect(response.status).toBe(409);
  expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.subscriptionEvent.create).not.toHaveBeenCalled();
});

test('unknown plan is rejected before payment initialization', async () => {
  mockPrisma.subscriptionPlan.findUnique.mockResolvedValue(null);

  const response = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId: '11111111-1111-4111-8111-111111111111' });

  expect(response.status).toBe(404);
  expect(response.body.message).toMatch(/plan/i);
});

test('backend uses database plan price instead of frontend amount', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  let transactionActive = false;
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    transactionActive = true;
    try {
      return await callback(mockPrisma);
    } finally {
      transactionActive = false;
    }
  });
  initializeFlutterwavePayment.mockImplementation(async () => {
    expect(transactionActive).toBe(false);
    return { checkoutUrl: 'https://checkout.test', providerReference: paymentProviderRef };
  });

  const response = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId, amount: '999.99', currency: 'USD' });

  expect(response.status).toBe(200);
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '49.00', currency: 'NGN' }));
  expect(response.body.data.checkoutUrl).toBe('https://checkout.test');
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({
    redirectUrl: expect.stringContaining('/seeker/subscription/payment-result'),
  }));
  expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'payment-1', status: 'PENDING' },
    data: { status: 'PROCESSING' },
  }));
  expect(transactionActive).toBe(false);
});

test('Flutterwave initialization failure marks the pending intent failed without activating access', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  initializeFlutterwavePayment.mockRejectedValue(Object.assign(new Error('Flutterwave unavailable'), { status: 502 }));

  const response = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId, idempotencyKey: 'checkout-init-failure' });

  expect(response.status).toBe(502);
  expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
    where: { id: 'payment-1', status: 'PROCESSING' },
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'sub-1', status: 'PENDING' },
    data: { status: 'FAILED' },
  }));
});

test('checkout uses the supplied idempotency key to reuse one same-user same-plan intent', async () => {
  const idempotencyKey = 'checkout-attempt-1';
  const existingPayment = {
    ...paymentRecord,
    idempotencyKey,
    transactionId: null,
    status: 'PENDING',
    metadata: { userId: seekerId, planId, subscriptionId: 'sub-1', checkoutUrl: 'https://checkout.test' },
    subscription: { id: 'sub-1', userId: seekerId, planId, status: 'PENDING', plan: subscriptionPlan },
  };
  mockPrisma.payment.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(existingPayment);

  const first = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId, idempotencyKey });
  const second = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId, idempotencyKey });

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.body.data.alreadyInitialized).toBe(true);
  expect(second.body.data.checkoutUrl).toBe('https://checkout.test');
  expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
  expect(initializeFlutterwavePayment).toHaveBeenCalledTimes(1);
});

test('idempotency key cannot be reused by another user or for a different plan', async () => {
  const idempotencyKey = 'checkout-attempt-owner';
  const existingPayment = {
    ...paymentRecord,
    idempotencyKey,
    transactionId: null,
    status: 'PENDING',
    metadata: { userId: seekerId, planId, subscriptionId: 'sub-1', checkoutUrl: 'https://checkout.test' },
    subscription: { id: 'sub-1', userId: seekerId, planId, status: 'PENDING', plan: subscriptionPlan },
  };
  mockPrisma.payment.findFirst.mockResolvedValue(existingPayment);

  const otherUserResponse = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', adminId)}`)
    .send({ planId, idempotencyKey });

  expect(otherUserResponse.status).toBe(409);

  const otherPlanId = '44444444-4444-4444-8444-444444444444';
  mockPrisma.subscriptionPlan.findUnique.mockResolvedValue({ ...subscriptionPlan, id: otherPlanId, key: 'PREMIUM' });
  const otherPlanResponse = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId: otherPlanId, idempotencyKey });

  expect(otherPlanResponse.status).toBe(409);
  expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  expect(initializeFlutterwavePayment).not.toHaveBeenCalled();
});

test('successful payment verification activates subscription and records event', async () => {
  const pending = pendingPayment({ metadata: { ...pendingPayment().metadata, checkoutUrl: 'https://checkout.test' } });
  mockPrisma.payment.findFirst.mockResolvedValue(pending);
  mockPrisma.payment.findUnique.mockResolvedValue({
    ...pending,
    subscription: {
      ...pending.subscription,
      startDate: new Date(),
      endDate: null,
      nextRenewalAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      payments: [{ ...paymentRecord, status: 'PENDING' }],
    },
  });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(response.status).toBe(200);
  expect(response.body.data.subscription.status).toBe('ACTIVE');
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'sub-1', status: 'PENDING' },
    data: expect.objectContaining({ status: 'ACTIVE', startDate: expect.any(Date), endDate: expect.any(Date) }),
  }));
  expect(new Date(response.body.data.subscription.endDate).getTime()).toBeGreaterThan(new Date(response.body.data.subscription.startDate).getTime());
  expect(mockPrisma.subscriptionEvent.create).toHaveBeenCalled();
  expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: seekerId, paymentType: 'SUBSCRIPTION', providerReference: paymentProviderRef },
  }));
});

test('transaction ID alone is resolved through Flutterwave and then bound to the owned payment reference', async () => {
  const pending = pendingPayment();
  mockPrisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pending);
  mockPrisma.payment.findUnique.mockResolvedValue(pending);

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ transactionId: '123' });

  expect(response.status).toBe(200);
  expect(verifyFlutterwaveTransaction).toHaveBeenCalledWith('123');
  expect(mockPrisma.payment.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { userId: seekerId, paymentType: 'SUBSCRIPTION', providerReference: paymentProviderRef },
  }));
});

test('stored transaction ID mismatch is rejected before provider verification', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment({ transactionId: '123' }));

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '456' });

  expect(response.status).toBe(409);
  expect(verifyFlutterwaveTransaction).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
});

test.each([
  ['amount', { amount: 50 }],
  ['currency', { currency: 'USD' }],
  ['reference', { tx_ref: 'another-payment-reference' }],
  ['provider transaction ID', { id: 456 }],
  ['customer email', { customer: { email: 'other@example.com' } }],
  ['plan metadata', { meta: { userId: seekerId, planId: '55555555-5555-4555-8555-555555555555', subscriptionId: 'sub-1' } }],
  ['user metadata', { meta: { userId: adminId, planId, subscriptionId: 'sub-1' } }],
  ['subscription metadata', { meta: { userId: seekerId, planId, subscriptionId: 'other-subscription' } }],
])('rejects Flutterwave %s mismatch without activating subscription', async (_label, providerOverrides) => {
  const pending = pendingPayment();
  mockPrisma.payment.findFirst.mockResolvedValue(pending);
  mockPrisma.payment.findUnique.mockResolvedValue(pending);
  verifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: paymentProviderRef,
    amount: 49,
    currency: 'NGN',
    status: 'successful',
    customer: { email: 'seeker@example.com' },
    meta: { userId: seekerId, planId, subscriptionId: 'sub-1', planKey: 'PROFESSIONAL' },
    ...providerOverrides,
  });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(response.status).toBe(422);
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('provider pending response preserves pending subscription and returns pending state', async () => {
  const pending = pendingPayment();
  mockPrisma.payment.findFirst.mockResolvedValue(pending);
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 123, tx_ref: paymentProviderRef, status: 'pending' });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(response.status).toBe(200);
  expect(response.body.data.pending).toBe(true);
  expect(response.body.data.payment.status).toBe('PENDING');
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('reference-only callback remains pending when Flutterwave transaction ID is not available yet', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment());

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, returnFailureState: true });

  expect(response.status).toBe(200);
  expect(response.body.data.pending).toBe(true);
  expect(response.body.data.payment.status).toBe('PENDING');
  expect(verifyFlutterwaveTransaction).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('verified cancelled payment returns a safe cancellation state without activating', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment());
  verifyFlutterwaveTransaction.mockResolvedValue({
    id: 123,
    tx_ref: paymentProviderRef,
    amount: 49,
    currency: 'NGN',
    status: 'cancelled',
  });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123', returnFailureState: true });

  expect(response.status).toBe(200);
  expect(response.body.data.failed).toBe(true);
  expect(response.body.data.failureType).toBe('cancelled');
  expect(response.body.data.payment.status).toBe('FAILED');
  expect(response.body.data.subscription.status).toBe('FAILED');
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('failed provider payment never activates the pending subscription', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue(pendingPayment());
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 123, tx_ref: paymentProviderRef, amount: 49, currency: 'NGN', status: 'failed' });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(response.status).toBe(422);
  expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE' }),
  }));
});

test('concurrent verification requests can activate a pending subscription only once', async () => {
  const pending = pendingPayment();
  mockPrisma.payment.findFirst.mockResolvedValue(pending);
  let paymentSuccessful = false;
  mockPrisma.payment.findUnique.mockImplementation(async () => paymentSuccessful
    ? { ...pending, status: 'SUCCESSFUL', subscription: { ...pending.subscription, status: 'ACTIVE' } }
    : pending);
  mockPrisma.payment.update.mockImplementation(async ({ data }) => {
    if (data.status === 'SUCCESSFUL') paymentSuccessful = true;
    return { ...pending, ...data, id: 'payment-1' };
  });
  let activationClaimed = false;
  mockPrisma.subscription.updateMany.mockImplementation(async () => {
    if (activationClaimed) {
      paymentSuccessful = true;
      return { count: 0 };
    }
    activationClaimed = true;
    return { count: 1 };
  });

  const sendVerification = () => request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });
  const responses = await Promise.all([sendVerification(), sendVerification()]);

  expect(responses.map(({ status }) => status)).toEqual([200, 200]);
  expect(mockPrisma.subscription.updateMany).toHaveBeenCalledTimes(1);
  expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
  expect(responses.filter(({ body }) => body.data?.alreadyVerified)).toHaveLength(1);
});

test.each(['EXPIRED', 'CANCELLED', 'FAILED', 'ACTIVE'])('stale verification cannot activate a %s subscription', async (status) => {
  const subscription = {
    id: 'sub-1', userId: seekerId, planId, status, priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY',
    startDate: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    createdAt: new Date(), updatedAt: new Date(), plan: subscriptionPlan, payments: [{ ...paymentRecord, status: 'PENDING' }],
  };
  mockPrisma.payment.findFirst.mockResolvedValue({ ...paymentRecord, status: 'PENDING', subscription });
  mockPrisma.payment.findUnique.mockResolvedValue({ ...paymentRecord, status: 'PENDING', subscription });
  mockPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

  const response = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(response.status).toBe(409);
  expect(mockPrisma.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL' }) }));
});

test('duplicate verification is idempotent and does not create a second activation', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue({ ...paymentRecord, transactionId: '123', status: 'SUCCESSFUL' });
  mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE', userId: seekerId, planId, priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY' });

  const first = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  const second = await request(app)
    .post('/api/seeker/subscriptions/verify')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ providerReference: paymentProviderRef, transactionId: '123' });

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.body.data.payment.status).toBe('SUCCESSFUL');
});
