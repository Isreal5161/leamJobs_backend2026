import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';

const mockPrisma = {
  entitlement: { upsert: jest.fn() },
  subscriptionPlan: { upsert: jest.fn() },
  planEntitlement: { upsert: jest.fn() },
  subscriptionEvent: { create: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
const { ensureDefaultSubscriptionFoundation, recordSubscriptionEvent, subscriptionEntitlements, subscriptionPlans } = await import('../src/services/subscriptionFoundation.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.entitlement.upsert.mockImplementation(async ({ create }) => ({ id: `entitlement-${create.key}`, ...create }));
  mockPrisma.subscriptionPlan.upsert.mockImplementation(async ({ create }) => ({ id: `plan-${create.key}`, ...create }));
  mockPrisma.planEntitlement.upsert.mockResolvedValue({});
  mockPrisma.subscriptionEvent.create.mockResolvedValue({ id: 'event-1' });
});

test('defines unique monthly Professional and Premium plans with stable entitlement keys', async () => {
  const result = await ensureDefaultSubscriptionFoundation(mockPrisma);

  expect(subscriptionPlans.map((plan) => plan.key)).toEqual(['PROFESSIONAL', 'PREMIUM']);
  expect(new Set(subscriptionEntitlements.map((entitlement) => entitlement.key)).size).toBe(subscriptionEntitlements.length);
  expect(subscriptionPlans.every((plan) => plan.billingInterval === 'MONTHLY')).toBe(true);
  expect(subscriptionPlans.every((plan) => plan.price === null && plan.currency === null)).toBe(true);
  expect(Object.keys(result.plans)).toEqual(['PROFESSIONAL', 'PREMIUM']);
  expect(mockPrisma.subscriptionPlan.upsert).toHaveBeenCalledTimes(2);
  expect(mockPrisma.planEntitlement.upsert).toHaveBeenCalledTimes(12);
});

test('records subscription lifecycle events without payment or entitlement side effects', async () => {
  await recordSubscriptionEvent({
    subscriptionId: 'subscription-1',
    eventType: 'CREATED',
    providerReference: 'provider-ref-1',
    metadata: { source: 'foundation-test' },
  }, mockPrisma);

  expect(mockPrisma.subscriptionEvent.create).toHaveBeenCalledWith({
    data: {
      subscriptionId: 'subscription-1',
      eventType: 'CREATED',
      providerReference: 'provider-ref-1',
      metadata: { source: 'foundation-test' },
    },
  });
});

test('documents the active-only uniqueness lifecycle for upgrades', () => {
  const migration = readFileSync(new URL('../prisma/migrations/20260914160000_allow_pending_subscription_upgrade/migration.sql', import.meta.url), 'utf8');

  expect(migration).toContain('DROP INDEX "Subscription_one_current_per_user_idx"');
  expect(migration).toContain('CREATE UNIQUE INDEX "Subscription_one_active_per_user_idx"');
  expect(migration).toContain('WHERE "status" = \'ACTIVE\'');
  expect(migration).not.toContain("WHERE \"status\" IN ('PENDING', 'ACTIVE')");
});
