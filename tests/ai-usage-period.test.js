import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const now = new Date();
const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
const nextPeriodStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const previousPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

const records = [
  { userId: 'user-1', amount: 5, periodStart: previousPeriodStart },
  { userId: 'user-1', amount: 2, periodStart: currentPeriodStart },
];

const mockPrisma = {
  subscription: { findFirst: jest.fn().mockResolvedValue(null) },
  userSubscriptionTrial: { findFirst: jest.fn().mockResolvedValue(null) },
  subscriptionPlan: {
    findUnique: jest.fn().mockResolvedValue({
      key: 'BASIC',
      aiAllowance: 5,
      aiUnlimited: false,
      entitlements: [],
    }),
  },
  aiUsageRecord: {
    aggregate: jest.fn(({ where }) => {
      const total = records.reduce((sum, record) => {
        if (record.userId === where.userId && record.periodStart >= where.periodStart.gte && record.periodStart < where.periodStart.lt) {
          return sum + Number(record.amount || 0);
        }
        return sum;
      }, 0);
      return { _sum: { amount: total } };
    }),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { getAiUsagePeriod, getAiUsageState } = await import('../src/services/subscriptionEntitlement.service.js');

test('historical AI usage does not consume the current period allowance', async () => {
  await expect(getAiUsageState('user-1')).resolves.toMatchObject({ limit: 5, used: 2, remaining: 3 });
  expect(mockPrisma.aiUsageRecord.aggregate).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      userId: 'user-1',
      periodStart: { gte: currentPeriodStart, lt: nextPeriodStart },
    }),
    _sum: { amount: true },
  }));
});

test('period boundaries use the first instant of the current month and the next month', () => {
  const period = getAiUsagePeriod(now);
  expect(period.periodStart).toEqual(currentPeriodStart);
  expect(period.nextPeriodStart).toEqual(nextPeriodStart);
  expect(period.periodEnd.getTime()).toBe(nextPeriodStart.getTime() - 1);
});
