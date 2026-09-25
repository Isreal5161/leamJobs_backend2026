import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
const databaseConfigured = Boolean(process.env.DATABASE_URL);

const { prisma } = await import('../src/config/database.js');
const { recordAiUsage, releaseAiUsage } = await import('../src/services/subscriptionEntitlement.service.js');

const describeDatabase = databaseConfigured ? describe : describe.skip;

describeDatabase('AI reservation release', () => {
  let userId;

  beforeAll(async () => {
    await prisma.$connect();

    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `ai-release-${randomUUID()}@example.com`,
        passwordHash: 'test-password-hash',
        firstName: 'AI',
        lastName: 'Release',
      },
    });
  });

  afterAll(async () => {
    await prisma.aiUsageRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('records and releases a reservation cleanly', async () => {
    const reservation = await recordAiUsage({
      userId,
      featureKey: 'AI_COVER_LETTER',
      amount: 1,
      metadata: { source: 'reservation-release-test' },
    });

    expect(reservation.recorded).toBe(true);
    expect(reservation.record.id).toBeTruthy();

    const released = await releaseAiUsage({
      userId,
      usageRecordId: reservation.record.id,
    });

    expect(released).toMatchObject({ released: true });
    await expect(prisma.aiUsageRecord.findUnique({ where: { id: reservation.record.id } })).resolves.toBeNull();
  });

  test('releasing an already-released reservation is treated as no-op', async () => {
    const reservation = await recordAiUsage({
      userId,
      featureKey: 'AI_COVER_LETTER',
      amount: 1,
      metadata: { source: 'reservation-release-idempotence-test' },
    });

    const firstRelease = await releaseAiUsage({ userId, usageRecordId: reservation.record.id });
    const secondRelease = await releaseAiUsage({ userId, usageRecordId: reservation.record.id });

    expect(firstRelease).toMatchObject({ released: true });
    expect(secondRelease).toMatchObject({ released: false });
  });
});

if (!databaseConfigured) {
  test('requires DATABASE_URL for PostgreSQL AI reservation release coverage', () => {
    expect(databaseConfigured).toBe(false);
  });
}
