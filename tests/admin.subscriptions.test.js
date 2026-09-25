import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const model = () => ({ findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), groupBy: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() });
const mockPrisma = {
  subscriptionPlan: model(), entitlement: model(), planEntitlement: model(), subscription: model(), payment: model(),
  subscriptionEvent: model(),
  subscriptionSettings: model(),
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '11111111-1111-4111-8111-111111111111';
const employerId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const subscriptionId = '44444444-4444-4444-8444-444444444444';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });
const plan = (key = 'PROFESSIONAL') => ({ id: planId, key, displayName: key, description: 'Plan', price: '10.00', currency: 'NGN', billingInterval: 'MONTHLY', isActive: true, isPublic: true, displayOrder: 0, benefits: ['Benefit'], createdAt: new Date(), updatedAt: new Date(), entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS', displayName: 'Profile analytics', description: null, isActive: true } }] });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscriptionPlan.findMany.mockResolvedValue([plan()]);
  mockPrisma.subscriptionPlan.findUnique.mockResolvedValue(plan());
  mockPrisma.entitlement.findMany.mockResolvedValue([{ id: 'entitlement-1', key: 'PROFILE_ANALYTICS' }]);
  mockPrisma.subscriptionPlan.create.mockResolvedValue(plan());
  mockPrisma.subscriptionPlan.update.mockResolvedValue(plan());
  mockPrisma.subscription.count.mockResolvedValue(4);
  mockPrisma.subscription.groupBy.mockResolvedValue([]);
  mockPrisma.payment.count.mockResolvedValue(2);
  mockPrisma.payment.groupBy.mockResolvedValue([{ currency: 'NGN', _sum: { amount: '100.00' } }]);
  mockPrisma.subscription.findMany.mockResolvedValue([]);
  mockPrisma.subscription.findUnique.mockResolvedValue(null);
  mockPrisma.subscriptionSettings.upsert.mockResolvedValue({ id: 'default', trialEnabled: true, trialDurationDays: 7, trialPlanKey: 'PREMIUM', updatedAt: new Date() });
});

test('protects all Admin Subscription endpoints', async () => {
  expect((await request(app).get('/api/admin/subscription-plans')).status).toBe(401);
  expect((await request(app).get('/api/admin/subscriptions/summary')).status).toBe(401);
  expect((await request(app).get('/api/admin/subscription-trial-settings')).status).toBe(401);
  for (const role of ['SEEKER', 'EMPLOYER']) {
    expect((await request(app).get('/api/admin/subscriptions').set('Authorization', `Bearer ${token(role, seekerId)}`)).status).toBe(403);
    expect((await request(app).patch('/api/admin/subscription-trial-settings').set('Authorization', `Bearer ${token(role, seekerId)}`).send({ trialEnabled: false, trialDurationDays: 7, trialPlanKey: 'PREMIUM' })).status).toBe(403);
  }
});

test('admin can read and update persisted trial settings', async () => {
  const response = await request(app).patch('/api/admin/subscription-trial-settings').set('Authorization', `Bearer ${token('ADMIN', adminId)}`).send({ trialEnabled: false, trialDurationDays: 14, trialPlanKey: 'PREMIUM' });
  expect(response.status).toBe(200);
  expect(mockPrisma.subscriptionSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { trialEnabled: false, trialDurationDays: 14, trialPlanKey: 'PREMIUM' } }));
});

test('trial settings update ignores response-only fields from older clients', async () => {
  const response = await request(app)
    .patch('/api/admin/subscription-trial-settings')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .send({ id: 'default', trialEnabled: true, trialDurationDays: 14, trialPlanKey: 'PREMIUM', updatedAt: '2026-09-25T00:00:00.000Z' });

  expect(response.status).toBe(200);
  expect(mockPrisma.subscriptionSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: { trialEnabled: true, trialDurationDays: 14, trialPlanKey: 'PREMIUM' },
  }));
});

test('admin can list and create plans with known entitlements', async () => {
  const list = await request(app).get('/api/admin/subscription-plans').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(list.status).toBe(200);
  expect(list.body.data.plans[0]).toEqual(expect.objectContaining({ key: 'PROFESSIONAL', entitlements: expect.any(Array) }));

  const created = await request(app).post('/api/admin/subscription-plans').set('Authorization', `Bearer ${token('ADMIN', adminId)}`).send({
    key: 'CAREER_PLUS', displayName: 'Career Plus', description: 'Test plan', price: 10, currency: 'NGN', billingInterval: 'MONTHLY', isActive: true, isPublic: true, displayOrder: 2, benefits: ['Analytics'], entitlementKeys: ['PROFILE_ANALYTICS'],
  });
  expect(created.status).toBe(201);
  expect(mockPrisma.subscriptionPlan.create).toHaveBeenCalled();
});

test('summary uses real counts and successful subscription payments by currency', async () => {
  mockPrisma.subscription.count.mockImplementation(async ({ where } = {}) => {
    if (!where) return 4;
    if (where.status === 'ACTIVE') return 2;
    return 0;
  });
  mockPrisma.subscription.groupBy.mockResolvedValue([{ planId, status: 'ACTIVE', _count: { _all: 2 } }]);
  mockPrisma.subscriptionPlan.findMany.mockResolvedValue([{ id: planId, key: 'PROFESSIONAL' }]);
  const response = await request(app).get('/api/admin/subscriptions/summary').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.subscriptionCounts).toEqual(expect.objectContaining({ total: 4, active: 2, pending: 0 }));
  expect(response.body.data.revenue).toEqual([{ currency: 'NGN', amount: '100.00' }]);
  expect(mockPrisma.payment.groupBy.mock.calls[0][0].where).toEqual({ paymentType: 'SUBSCRIPTION', status: 'SUCCESSFUL' });
});

test('summary counts stale ACTIVE subscriptions as expired without invoking the global worker', async () => {
  mockPrisma.subscription.count.mockImplementation(async ({ where } = {}) => {
    if (!where) return 2;
    if (where.status === 'ACTIVE') return 1;
    if (where.OR) return 1;
    return 0;
  });

  const response = await request(app).get('/api/admin/subscriptions/summary').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.subscriptionCounts).toEqual(expect.objectContaining({ total: 2, active: 1, expired: 1 }));
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  const countWheres = mockPrisma.subscription.count.mock.calls.map(([args]) => args?.where);
  expect(countWheres).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'ACTIVE', endDate: { not: null, gt: expect.any(Date) } }),
    expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ status: 'EXPIRED' }), expect.objectContaining({ status: 'ACTIVE' })]) }),
  ]));
});

test('subscriber list returns latest payment safely and supports filters/cursor', async () => {
  mockPrisma.subscription.findMany.mockResolvedValue([{
    id: subscriptionId, status: 'ACTIVE', startDate: null, endDate: null, priceSnapshot: '10.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', cancelledAt: null, cancellationReason: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date(),
    user: { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, plan: { id: planId, key: 'PROFESSIONAL', displayName: 'Professional' }, payments: [{ id: 'payment-1', amount: '10.00', currency: 'NGN', status: 'SUCCESSFUL', provider: 'FLUTTERWAVE', providerReference: 'ref', transactionId: 'tx', verifiedAt: null, createdAt: new Date() }],
  }, { id: '55555555-5555-4555-8555-555555555555', status: 'ACTIVE', startDate: null, endDate: null, priceSnapshot: null, currencySnapshot: null, billingIntervalSnapshot: null, cancelledAt: null, cancellationReason: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date(), user: { id: seekerId, firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' }, plan: { id: planId, key: 'PREMIUM', displayName: 'Premium' }, payments: [] }]);
  const response = await request(app).get(`/api/admin/subscriptions?limit=1&status=ACTIVE&plan=PROFESSIONAL&currency=NGN&search=ada&cursor=${subscriptionId}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.items[0]).toEqual(expect.objectContaining({ id: subscriptionId, latestPayment: expect.objectContaining({ providerReference: 'ref' }) }));
  expect(response.body.data.items[0].latestPayment.metadata).toBeUndefined();
  expect(response.body.data.nextCursor).toBe(subscriptionId);
  expect(mockPrisma.subscription.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 2, cursor: { id: subscriptionId }, skip: 1 }));
});

test('subscriber list includes stale ACTIVE rows in expired results and returns effective status', async () => {
  mockPrisma.subscription.findMany.mockResolvedValue([{
    id: subscriptionId, status: 'ACTIVE', startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-09-01T00:00:00.000Z'), priceSnapshot: '10.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', cancelledAt: null, cancellationReason: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date(),
    user: { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, plan: { id: planId, key: 'PROFESSIONAL', displayName: 'Professional' }, payments: [],
  }]);

  const response = await request(app).get('/api/admin/subscriptions?limit=1&status=EXPIRED').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.items[0].status).toBe('EXPIRED');
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(mockPrisma.subscription.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({
    OR: expect.arrayContaining([
      { status: 'EXPIRED' },
      { status: 'ACTIVE', endDate: { not: null, lte: expect.any(Date) } },
    ]),
  }));
});

test('details return payments and lifecycle events without sensitive payment fields', async () => {
  mockPrisma.subscription.findUnique.mockResolvedValue({
    id: subscriptionId, status: 'ACTIVE', startDate: null, endDate: null, priceSnapshot: '10.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', cancelledAt: null, cancellationReason: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date(), user: { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, plan: { id: planId, key: 'PROFESSIONAL', displayName: 'Professional' }, payments: [{ id: 'payment-1', amount: '10.00', currency: 'NGN', status: 'SUCCESSFUL', provider: 'FLUTTERWAVE', providerReference: 'ref', transactionId: 'tx', verifiedAt: null, createdAt: new Date() }], events: [{ id: 'event-1', eventType: 'CREATED', occurredAt: new Date(), providerReference: null }],
  });
  const response = await request(app).get(`/api/admin/subscriptions/${subscriptionId}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.subscription.payments).toHaveLength(1);
  expect(response.body.data.subscription.events).toHaveLength(1);
  expect(response.body.data.subscription.payments[0].idempotencyKey).toBeUndefined();
  expect(response.body.data.subscription.payments[0].metadata).toBeUndefined();
});

test('subscription detail returns stale ACTIVE as effective EXPIRED without writing', async () => {
  mockPrisma.subscription.findUnique.mockResolvedValue({
    id: subscriptionId, status: 'ACTIVE', startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-09-01T00:00:00.000Z'), priceSnapshot: '10.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY', cancelledAt: null, cancellationReason: null, nextRenewalAt: null, createdAt: new Date(), updatedAt: new Date(), user: { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, plan: { id: planId, key: 'PROFESSIONAL', displayName: 'Professional' }, payments: [], events: [],
  });

  const response = await request(app).get(`/api/admin/subscriptions/${subscriptionId}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.subscription.status).toBe('EXPIRED');
  expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test.each(['PENDING', 'FAILED', 'CANCELLED'])('status filter preserves stored %s behavior', async (status) => {
  await request(app).get(`/api/admin/subscriptions?limit=1&status=${status}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(mockPrisma.subscription.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ status }));
});
