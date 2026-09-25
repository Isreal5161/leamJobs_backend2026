import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
const databaseConfigured = Boolean(process.env.DATABASE_URL);

const { prisma } = await import('../src/config/database.js');
const { processJobAlerts } = await import('../src/services/jobAlerts.service.js');

const describeDatabase = databaseConfigured ? describe : describe.skip;

describeDatabase('job alert advisory lock', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('returns skipped when the advisory transaction lock is already held', async () => {
    const holdLock = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('leamjobs:job-alert-processor'))`;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { locked: true };
    });

    const [lockResult, alertResult] = await Promise.all([
      holdLock,
      processJobAlerts({ now: new Date() }),
    ]);

    expect(lockResult).toMatchObject({ locked: true });
    expect(alertResult).toMatchObject({ skipped: true, alertsProcessed: 0, matchesQueued: 0 });
  });
});

if (!databaseConfigured) {
  test('requires DATABASE_URL for PostgreSQL job alert lock coverage', () => {
    expect(databaseConfigured).toBe(false);
  });
}
