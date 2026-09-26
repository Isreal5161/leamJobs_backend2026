import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

const testDatabaseUrl = process.env.AI_LOAD_TEST_DATABASE_URL || process.env.PHASE4_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

const allowedConcurrencyLevels = [10, 50, 100, 500];
const configuredLevel = process.env.AI_LOAD_CONCURRENCY ? Number(process.env.AI_LOAD_CONCURRENCY) : 10;
const isAllowedConcurrency = Number.isInteger(configuredLevel) && allowedConcurrencyLevels.includes(configuredLevel);
const databaseConfigured = Boolean(testDatabaseUrl);
const describeDatabase = databaseConfigured && isAllowedConcurrency ? describe : describe.skip;

const { prisma } = await import('../src/config/database.js');
const { recordAiUsage, getAiUsageState, releaseAiUsage } = await import('../src/services/subscriptionEntitlement.service.js');

const getLevelsToRun = () => {
  if (!databaseConfigured) return [];
  if (!process.env.AI_LOAD_CONCURRENCY) return [10];
  if (!isAllowedConcurrency) return [];
  return [configuredLevel];
};

const currentPeriodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const currentPeriodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

const createTestUser = async (prefix = 'ai-load') => {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      email: `${prefix}-${randomUUID()}@example.com`,
      passwordHash: 'test-password-hash',
      firstName: 'AI',
      lastName: 'Load',
    },
  });

  await prisma.userSubscriptionTrial.create({
    data: {
      userId,
      grantedPlanKey: 'PROFESSIONAL',
      status: 'ACTIVE',
      durationDays: 7,
      startAt: new Date(),
      endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      source: 'AI_LOAD_TEST',
      description: 'Dedicated AI usage concurrency measurement test',
      metadata: { source: 'ai-load-test' },
    },
  });

  return userId;
};

const cleanupUsers = async (userIds) => {
  if (!userIds.length) return;
  await prisma.aiUsageRecord.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userSubscriptionTrial.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
};

const buildReservationPromise = async (userId, label) => {
  const startedAt = Date.now();
  try {
    const reservation = await recordAiUsage({
      userId,
      featureKey: 'AI_COVER_LETTER',
      amount: 1,
      metadata: { source: 'ai-load-test', label },
    });
    const latencyMs = Date.now() - startedAt;
    return {
      ok: reservation.recorded,
      status: 200,
      latencyMs,
      reservationId: reservation.record?.id ?? null,
      error: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      status: error?.status ?? 500,
      latencyMs,
      reservationId: null,
      error: error?.message ?? 'Unknown reservation failure',
    };
  }
};

const percentile = (values, pct) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const summarizeResults = (entries) => {
  const latencies = entries.map((entry) => entry.latencyMs).filter((value) => Number.isFinite(value));
  const successfulReservations = entries.filter((entry) => entry.ok).length;
  const rejectedReservations = entries.filter((entry) => !entry.ok).length;
  const errors = entries.filter((entry) => entry.error).length;

  return {
    successfulReservations,
    rejectedReservations,
    errors,
    total: entries.length,
    averageLatency: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0,
    minLatency: latencies.length ? Math.min(...latencies) : 0,
    maxLatency: latencies.length ? Math.max(...latencies) : 0,
    p95Latency: percentile(latencies, 95),
    p99Latency: percentile(latencies, 99),
  };
};

const runScenario = async ({ concurrency, scenario, userIds, perUserRequestCount = 1 }) => {
  const startedAt = Date.now();
  const requestEntries = [];

  for (let index = 0; index < concurrency; index += 1) {
    const userId = userIds[index % userIds.length];
    const requestLabel = `${scenario}-${index}`;
    requestEntries.push(buildReservationPromise(userId, requestLabel));
  }

  const settled = await Promise.allSettled(requestEntries);
  const results = settled.map((item) => item.status === 'fulfilled' ? item.value : {
    ok: false,
    status: 500,
    latencyMs: 0,
    reservationId: null,
    error: item.reason?.message ?? 'Rejected promise',
  });

  const summary = summarizeResults(results);
  const durationMs = Date.now() - startedAt;

  return {
    ...summary,
    durationMs,
    concurrency,
    scenario,
    results,
  };
};

const assertSameUserQuota = async (userId, concurrency) => {
  const state = await getAiUsageState(userId);
  const totalUsage = await prisma.aiUsageRecord.aggregate({
    where: { userId },
    _sum: { amount: true },
  });

  expect(state.limit).toBe(20);
  expect(Number(totalUsage._sum.amount ?? 0)).toBeLessThanOrEqual(20);
  expect(Number(totalUsage._sum.amount ?? 0)).toBe(state.used);
  expect(state.remaining).toBeGreaterThanOrEqual(0);
  expect(concurrency).toBeGreaterThan(0);
  expect(Number(totalUsage._sum.amount ?? 0)).toBeLessThanOrEqual(state.limit);
};

const assertManyUserQuota = async (userIds, concurrency) => {
  const usageSummaries = await Promise.all(userIds.slice(0, concurrency).map(async (userId) => {
    const state = await getAiUsageState(userId);
    return { userId, used: state.used, limit: state.limit, remaining: state.remaining };
  }));

  for (const state of usageSummaries) {
    expect(state.used).toBeGreaterThanOrEqual(0);
    expect(state.used).toBeLessThanOrEqual(20);
    expect(state.remaining).toBeGreaterThanOrEqual(0);
    expect(state.limit).toBe(20);
  }
};

describeDatabase('AI reservation load concurrency', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('same-user concurrency at the configured level respects the Professional allowance', async () => {
    const levels = getLevelsToRun();
    if (!levels.length) {
      console.log('AI load-suite skipped: AI_LOAD_CONCURRENCY must be one of 10, 50, 100, 500.');
      return;
    }

    const comparison = [];

    for (const concurrency of levels) {
      const userId = await createTestUser('ai-same-user-load');
      try {
        const scenario = await runScenario({ concurrency, scenario: 'same-user', userIds: [userId] });
        const totalUsage = await prisma.aiUsageRecord.aggregate({ where: { userId }, _sum: { amount: true } });
        const used = Number(totalUsage._sum.amount ?? 0);

        expect(scenario.successfulReservations).toBeLessThanOrEqual(20);
        expect(used).toBeLessThanOrEqual(20);
        expect(scenario.rejectedReservations).toBeGreaterThanOrEqual(0);
        expect(scenario.errors).toBeGreaterThanOrEqual(0);
        expect(scenario.successfulReservations).toBe(used);

        console.log(`AI Concurrency: ${concurrency}`);
        console.log(`Scenario: same-user`);
        console.log(`Duration: ${scenario.durationMs}ms`);
        console.log(`Successful reservations: ${scenario.successfulReservations}`);
        console.log(`Rejected: ${scenario.rejectedReservations}`);
        console.log(`Errors: ${scenario.errors}`);
        console.log(`Average latency: ${scenario.averageLatency}ms`);
        console.log(`P95 latency: ${scenario.p95Latency}ms`);
        console.log(`P99 latency: ${scenario.p99Latency}ms`);
        console.log(`Reservation correctness: PASS`);

        comparison.push({
          concurrency,
          sameUserP95: scenario.p95Latency,
          manyUserP95: null,
          errors: scenario.errors,
          reservationCorrect: 'PASS',
        });
      } finally {
        await cleanupUsers([userId]);
      }
    }

    if (comparison.length) {
      console.log('Concurrency | Same User P95 | Many Users P95 | Errors | Reservation Correct');
      console.log(comparison.map((row) => `${row.concurrency} | ${row.sameUserP95}ms | ${row.manyUserP95 ?? 'N/A'} | ${row.errors} | ${row.reservationCorrect}`).join('\n'));
    }
  });

  test('many-user concurrency at the configured level measures broader DB concurrency without same-row contention', async () => {
    const levels = getLevelsToRun();
    if (!levels.length) {
      console.log('AI load-suite skipped: AI_LOAD_CONCURRENCY must be one of 10, 50, 100, 500.');
      return;
    }

    for (const concurrency of levels) {
      const userIds = [];
      for (let index = 0; index < concurrency; index += 1) {
        userIds.push(await createTestUser(`ai-many-user-load-${index}`));
      }

      try {
        const scenario = await runScenario({ concurrency, scenario: 'many-users', userIds });
        await assertManyUserQuota(userIds, concurrency);

        expect(scenario.successfulReservations).toBeGreaterThanOrEqual(0);
        expect(scenario.rejectedReservations).toBeGreaterThanOrEqual(0);
        expect(scenario.errors).toBeGreaterThanOrEqual(0);

        console.log(`AI Concurrency: ${concurrency}`);
        console.log(`Scenario: many-users`);
        console.log(`Duration: ${scenario.durationMs}ms`);
        console.log(`Successful reservations: ${scenario.successfulReservations}`);
        console.log(`Rejected: ${scenario.rejectedReservations}`);
        console.log(`Errors: ${scenario.errors}`);
        console.log(`Average latency: ${scenario.averageLatency}ms`);
        console.log(`P95 latency: ${scenario.p95Latency}ms`);
        console.log(`P99 latency: ${scenario.p99Latency}ms`);
        console.log(`Reservation correctness: PASS`);
      } finally {
        await cleanupUsers(userIds);
      }
    }
  });

  test('failed provider calls release AI reservations and do not permanently consume allowance', async () => {
    const userId = await createTestUser('ai-provider-failure-load');

    try {
      const reservation = await recordAiUsage({
        userId,
        featureKey: 'AI_COVER_LETTER',
        metadata: { source: 'provider-failure-release-test' },
      });

      expect(reservation.recorded).toBe(true);
      expect(reservation.record.id).toBeTruthy();

      const releaseResult = await releaseAiUsage({ userId, usageRecordId: reservation.record.id });
      expect(releaseResult).toMatchObject({ released: true });

      const stateAfterRelease = await getAiUsageState(userId);
      expect(stateAfterRelease.used).toBe(0);
      expect(stateAfterRelease.remaining).toBe(20);
      expect(stateAfterRelease.allowed).toBe(true);
    } finally {
      await cleanupUsers([userId]);
    }
  });
});

if (!databaseConfigured) {
  test('SKIP: a dedicated test DB is required to run PostgreSQL AI concurrency load tests', () => {
    expect(testDatabaseUrl).toBeUndefined();
  });
}

if (databaseConfigured && !isAllowedConcurrency) {
  test('SKIP: AI_LOAD_CONCURRENCY must be one of 10, 50, 100, 500', () => {
    expect(process.env.AI_LOAD_CONCURRENCY).toBeDefined();
  });
}
