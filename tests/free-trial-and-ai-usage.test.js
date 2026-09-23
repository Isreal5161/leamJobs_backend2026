import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const mockPrisma = {
  subscription: { findFirst: jest.fn() },
  userSubscriptionTrial: { findFirst: jest.fn(), create: jest.fn() },
  aiUsageRecord: { findMany: jest.fn(), create: jest.fn() },
  subscriptionPlan: { findUnique: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { resolveEffectiveEntitlements, getAiUsageState, canUseAiFeature, startFreeTrial } = await import('../src/services/subscriptionEntitlement.service.js');

describe('free-trial and AI allowance enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('active trial grants premium entitlements and uses the granted plan', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.userSubscriptionTrial.findFirst.mockResolvedValue({
      id: 'trial-1',
      userId: 'user-1',
      grantedPlanKey: 'PREMIUM',
      status: 'ACTIVE',
      startAt: new Date(Date.now() - 1000),
      endAt: new Date(Date.now() + 60_000),
      metadata: {},
    });
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-premium',
      key: 'PREMIUM',
      displayName: 'Premium',
      entitlements: [{ entitlement: { key: 'FEATURED_CANDIDATE' } }, { entitlement: { key: 'AI_COVER_LETTER' } }],
    });

    const state = await resolveEffectiveEntitlements('user-1');
    expect(state.planKey).toBe('PREMIUM');
    expect(state.entitlements).toEqual(expect.arrayContaining(['FEATURED_CANDIDATE', 'PROFILE_VISIBILITY_BOOST', 'AI_COVER_LETTER']));
    expect(state.source).toBe('TRIAL');
  });

  test('AI allowance tracks remaining usage and rejects exhausted plans', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.userSubscriptionTrial.findFirst.mockResolvedValue(null);
    mockPrisma.aiUsageRecord.findMany.mockResolvedValue([{ amount: 4 }, { amount: 1 }]);

    const state = await getAiUsageState('user-1');
    expect(state.planKey).toBe('BASIC');
    expect(state.limit).toBe(5);
    expect(state.used).toBe(5);
    expect(state.remaining).toBe(0);

    await expect(canUseAiFeature('user-1')).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  test('trial creation records the granted plan without permanently converting the user', async () => {
    mockPrisma.userSubscriptionTrial.findFirst.mockResolvedValue(null);
    mockPrisma.userSubscriptionTrial.create.mockResolvedValue({
      id: 'trial-2',
      userId: 'user-9',
      grantedPlanKey: 'PREMIUM',
      status: 'ACTIVE',
      startAt: new Date(),
      endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      source: 'ADMIN',
    });

    const trial = await startFreeTrial({ userId: 'user-9', grantedPlanKey: 'PREMIUM', durationDays: 7, source: 'ADMIN' });
    expect(trial.grantedPlanKey).toBe('PREMIUM');
    expect(trial.status).toBe('ACTIVE');
    expect(trial.source).toBe('ADMIN');
  });

  test('unlimited plan allowance remains available without a numeric sentinel', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-unlimited',
      userId: 'user-unlimited',
      status: 'ACTIVE',
      startDate: new Date(Date.now() - 1000),
      endDate: new Date(Date.now() + 60_000),
      plan: { key: 'PREMIUM', aiAllowance: 100, aiUnlimited: true, entitlements: [{ entitlement: { key: 'AI_COVER_LETTER' } }] },
    });
    mockPrisma.aiUsageRecord.findMany.mockResolvedValue([{ amount: 10000 }]);

    await expect(canUseAiFeature('user-unlimited', 'AI_COVER_LETTER')).resolves.toMatchObject({ allowed: true, unlimited: true });
  });
});
