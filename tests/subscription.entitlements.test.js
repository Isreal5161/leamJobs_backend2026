import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  subscription: { findFirst: jest.fn(), findMany: jest.fn() },
  planEntitlement: { findFirst: jest.fn(), findMany: jest.fn() },
  subscriptionPlan: { findUnique: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { hasEntitlement, getCurrentSubscriptionEntitlements, listSeekerSubscriptions } = await import('../src/services/subscriptionEntitlement.service.js');
const { requireEntitlement } = await import('../src/middleware/entitlement.middleware.js');

describe('subscription entitlement enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('free user has no paid entitlement', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);

    await expect(hasEntitlement('user-1', 'PROFILE_ANALYTICS')).resolves.toBe(false);
  });

  test('pending subscription does not grant entitlement', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', userId: 'user-1', planId: 'plan-1', status: 'PENDING' });

    await expect(hasEntitlement('user-1', 'PROFILE_ANALYTICS')).resolves.toBe(false);
  });

  test('active professional grants professional entitlement', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'ACTIVE',
      plan: {
        entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }],
      },
    });

    await expect(hasEntitlement('user-1', 'PROFILE_ANALYTICS')).resolves.toBe(true);
  });

  test('active professional does not grant premium-only entitlement', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }] },
    });

    await expect(hasEntitlement('user-1', 'FEATURED_CANDIDATE')).resolves.toBe(false);
  });

  test('active entitlement lookup requires a currently valid date window', async () => {
    const now = new Date();
    mockPrisma.subscription.findFirst.mockResolvedValue(null);

    await expect(hasEntitlement('user-date-check', 'PROFILE_ANALYTICS')).resolves.toBe(false);

    expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-date-check',
        status: 'ACTIVE',
        startDate: { not: null, lte: expect.any(Date) },
        endDate: { not: null, gt: expect.any(Date) },
      },
    }));
    const where = mockPrisma.subscription.findFirst.mock.calls[0][0].where;
    expect(where.startDate.lte.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    expect(where.endDate.gt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
  });

  test('active premium grants premium-only entitlement', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-2',
      userId: 'user-2',
      planId: 'plan-2',
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'FEATURED_CANDIDATE' } }] },
    });

    await expect(hasEntitlement('user-2', 'FEATURED_CANDIDATE')).resolves.toBe(true);
  });

  test('expired, cancelled and failed subscriptions do not grant access', async () => {
    for (const status of ['EXPIRED', 'CANCELLED', 'FAILED']) {
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: `sub-${status}`, userId: 'user-3', planId: 'plan-1', status });
      await expect(hasEntitlement('user-3', 'PROFILE_ANALYTICS')).resolves.toBe(false);
    }
  });

  test('middleware stores a trusted request-scoped entitlement state for downstream AI checks', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-4',
      planId: 'plan-1',
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }] },
    });

    const request = { user: { sub: 'user-4', role: 'SEEKER' } };
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireEntitlement('PROFILE_ANALYTICS')(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.entitlementState).toMatchObject({
      userId: 'user-4',
      planKey: 'BASIC',
      source: 'SUBSCRIPTION',
      hasActiveSubscription: true,
    });
    expect(request.entitlementState.entitlements).toEqual(expect.arrayContaining(['PROFILE_ANALYTICS']));
  });

  test('middleware allows authorized entitlement and rejects unauthorized requests', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-4',
      planId: 'plan-1',
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }] },
    });

    const request = { user: { sub: 'user-4', role: 'SEEKER' } };
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireEntitlement('PROFILE_ANALYTICS')(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);

    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-2',
      userId: 'user-4',
      planId: 'plan-1',
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }] },
    });
    const denied = { user: { sub: 'user-4', role: 'SEEKER' } };
    const deniedResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const deniedNext = jest.fn();

    await requireEntitlement('FEATURED_CANDIDATE')(denied, deniedResponse, deniedNext);
    expect(deniedResponse.status).toHaveBeenCalledWith(403);
  });

  test('listSeekerSubscriptions includes current entitlements from active plan', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-5',
        status: 'ACTIVE',
        planId: 'plan-1',
        priceSnapshot: '49.00',
        currencySnapshot: 'NGN',
        billingIntervalSnapshot: 'MONTHLY',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelledAt: null,
        cancellationReason: null,
        nextRenewalAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        plan: {
          id: 'plan-1',
          key: 'PROFESSIONAL',
          displayName: 'Professional',
          description: 'desc',
          price: '49.00',
          currency: 'NGN',
          billingInterval: 'MONTHLY',
          isActive: true,
          isPublic: true,
          benefits: ['P'],
          entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }, { entitlement: { key: 'ADVANCED_CV' } }],
        },
      },
    ]);

    const result = await listSeekerSubscriptions('user-5');
    expect(result.entitlements).toEqual(expect.arrayContaining(['PROFILE_ANALYTICS', 'ADVANCED_CV']));
    expect(result.activeSubscription.entitlements).toEqual(expect.arrayContaining(['PROFILE_ANALYTICS', 'ADVANCED_CV']));
  });

  test('stale or not-yet-started active subscriptions are not current', async () => {
    const base = {
      id: 'sub-date', userId: 'user-date', status: 'ACTIVE', planId: 'plan-1',
      priceSnapshot: '49.00', currencySnapshot: 'NGN', billingIntervalSnapshot: 'MONTHLY',
      cancelledAt: null, cancellationReason: null, nextRenewalAt: null,
      createdAt: new Date(), updatedAt: new Date(), plan: { ...{}, entitlements: [] },
    };
    mockPrisma.subscription.findMany.mockResolvedValue([
      { ...base, startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() - 1) },
      { ...base, id: 'sub-future', startDate: new Date(Date.now() + 60_000), endDate: new Date(Date.now() + 86_400_000) },
    ]);

    const result = await listSeekerSubscriptions('user-date');

    expect(result.currentSubscription).toBeNull();
    expect(result.activeSubscription).toBeNull();
    expect(result.entitlements).toEqual([]);
  });
});
