import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';

const databaseConfigured = Boolean(process.env.DATABASE_URL);

const { prisma } = await import('../src/config/database.js');
const { getAiUsageState, recordAiUsage } = await import('../src/services/subscriptionEntitlement.service.js');

const describeDatabase = databaseConfigured ? describe : describe.skip;

const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const periodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

const createUser = () => prisma.user.create({
  data: {
    email: `ai-concurrency-${randomUUID()}@example.com`,
    passwordHash: 'test-password-hash',
    firstName: 'AI',
    lastName: 'Concurrency',
  },
});

const seedUsage = async (userId, amount, planKey = 'BASIC') => {
  if (!amount) return;
  await prisma.aiUsageRecord.create({
    data: {
      userId,
      featureKey: 'AI_COVER_LETTER',
      planKey,
      amount,
      periodStart,
      periodEnd,
      metadata: { source: 'concurrency-test' },
    },
  });
};

const runConcurrentReservations = (userId, count) => Promise.allSettled(
  Array.from({ length: count }, () => recordAiUsage({
    userId,
    featureKey: 'AI_COVER_LETTER',
    metadata: { source: 'concurrency-test' },
  })),
);

const expectAllowanceResult = (results, expectedSuccesses) => {
  const successes = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(successes).toHaveLength(expectedSuccesses);
  expect(rejected.every((result) => result.reason?.status === 403)).toBe(true);
};

describeDatabase('AI usage database concurrency', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('allowance 1 permits exactly one overlapping reservation', async () => {
    const user = await createUser();
    try {
      await seedUsage(user.id, 4);
      const results = await runConcurrentReservations(user.id, 2);
      expectAllowanceResult(results, 1);
      await expect(getAiUsageState(user.id)).resolves.toMatchObject({ limit: 5, used: 5, remaining: 0 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test('allowance 5 caps ten overlapping reservations at five', async () => {
    const user = await createUser();
    try {
      const results = await runConcurrentReservations(user.id, 10);
      expectAllowanceResult(results, 5);
      await expect(getAiUsageState(user.id)).resolves.toMatchObject({ limit: 5, used: 5, remaining: 0 });
      await expect(prisma.aiUsageRecord.count({ where: { userId: user.id } })).resolves.toBe(5);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test('allowance 20 never exceeds twenty overlapping reservations', async () => {
    const user = await createUser();
    try {
      await prisma.userSubscriptionTrial.create({
        data: {
          userId: user.id,
          grantedPlanKey: 'PROFESSIONAL',
          status: 'ACTIVE',
          endAt: new Date(Date.now() + 60_000),
          source: 'TEST',
        },
      });
      const results = await runConcurrentReservations(user.id, 40);
      expectAllowanceResult(results, 20);
      await expect(getAiUsageState(user.id)).resolves.toMatchObject({ limit: 20, used: 20, remaining: 0, source: 'TRIAL' });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test('active Professional trial uses the Professional allowance atomically', async () => {
    const user = await createUser();
    try {
      await prisma.userSubscriptionTrial.create({
        data: {
          userId: user.id,
          grantedPlanKey: 'PROFESSIONAL',
          status: 'ACTIVE',
          endAt: new Date(Date.now() + 60_000),
          source: 'TEST',
        },
      });
      const results = await runConcurrentReservations(user.id, 25);
      expectAllowanceResult(results, 20);
      await expect(getAiUsageState(user.id)).resolves.toMatchObject({ limit: 20, used: 20, remaining: 0, source: 'TRIAL' });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test('active Premium trial uses the Premium allowance atomically', async () => {
    const user = await createUser();
    try {
      await prisma.userSubscriptionTrial.create({
        data: {
          userId: user.id,
          grantedPlanKey: 'PREMIUM',
          status: 'ACTIVE',
          endAt: new Date(Date.now() + 60_000),
          source: 'TEST',
        },
      });
      const results = await runConcurrentReservations(user.id, 55);
      expectAllowanceResult(results, 50);
      await expect(getAiUsageState(user.id)).resolves.toMatchObject({ limit: 50, used: 50, remaining: 0, source: 'TRIAL' });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

if (!databaseConfigured) {
  test('requires DATABASE_URL for PostgreSQL concurrency coverage', () => {
    expect(databaseConfigured).toBe(false);
  });
}
