import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  subscriptionPlan: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  subscription: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  payment: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  subscriptionEvent: { create: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
  assertFlutterwaveWebhookSignature: jest.fn(),
}));
const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
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
  transactionId: 'flutterwave_tx_123',
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

  const response = await request(app)
    .post('/api/seeker/subscriptions/checkout')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`)
    .send({ planId, amount: '999.99', currency: 'USD' });

  expect(response.status).toBe(200);
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '49.00', currency: 'NGN' }));
  expect(response.body.data.checkoutUrl).toBe('https://checkout.test');
});

test('successful payment verification activates subscription and records event', async () => {
  mockPrisma.payment.findFirst.mockResolvedValue({
    ...paymentRecord,
    status: 'PENDING',
    amount: '49.00',
    currency: 'NGN',
    metadata: { planId, checkoutUrl: 'https://checkout.test' },
    subscription: {
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
    },
  });
  mockPrisma.payment.findUnique.mockResolvedValue({
    ...paymentRecord,
    status: 'PENDING',
    amount: '49.00',
    metadata: { planId, checkoutUrl: 'https://checkout.test' },
    subscription: {
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
  mockPrisma.payment.findFirst.mockResolvedValue({ ...paymentRecord, status: 'SUCCESSFUL' });
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
