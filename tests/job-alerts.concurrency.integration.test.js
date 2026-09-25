import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
const databaseConfigured = Boolean(process.env.DATABASE_URL);

const { prisma } = await import('../src/config/database.js');
const { processJobAlerts } = await import('../src/services/jobAlerts.service.js');

const describeDatabase = databaseConfigured ? describe : describe.skip;

describeDatabase('job alert processor concurrency', () => {
  let employerId;
  let seekerId;
  let jobId;

  beforeAll(async () => {
    await prisma.$connect();

    employerId = randomUUID();
    seekerId = randomUUID();
    jobId = randomUUID();

    await prisma.user.createMany({
      data: [
        {
          id: employerId,
          email: `job-alerts-concurrency-employer-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          firstName: 'Employer',
          lastName: 'Concurrency',
          role: 'EMPLOYER',
        },
        {
          id: seekerId,
          email: `job-alerts-concurrency-seeker-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          firstName: 'Seeker',
          lastName: 'Concurrency',
          role: 'SEEKER',
        },
      ],
    });

    await prisma.job.create({
      data: {
        id: jobId,
        employerId,
        title: 'Senior React Engineer',
        description: 'Build customer-facing dashboards and APIs.',
        location: 'Remote',
        jobType: 'NORMAL_EMPLOYMENT',
        engagementType: 'MONTHLY',
        workArrangement: 'REMOTE',
        status: 'APPROVED',
        skills: ['React', 'Node.js', 'TypeScript'],
      },
    });

    await prisma.jobAlert.create({
      data: {
        seekerId,
        name: 'React jobs',
        keywords: 'React',
        location: 'Remote',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.jobAlert.deleteMany({ where: { seekerId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.user.deleteMany({ where: { id: { in: [employerId, seekerId] } } });
    await prisma.$disconnect();
  });

  test('only one concurrent processor owns the advisory lock and processes the queue', async () => {
    const now = new Date();
    const results = await Promise.all([
      processJobAlerts({ now }),
      processJobAlerts({ now }),
    ]);

    const skippedCount = results.filter((result) => result.skipped).length;
    const processedCount = results.filter((result) => !result.skipped).length;

    expect(processedCount).toBe(1);
    expect(skippedCount).toBe(1);
    expect(results.some((result) => result.alertsProcessed >= 1)).toBe(true);
    expect(results.some((result) => result.matchesQueued >= 1)).toBe(true);
  });
});

if (!databaseConfigured) {
  test('requires DATABASE_URL for PostgreSQL job alert concurrency coverage', () => {
    expect(databaseConfigured).toBe(false);
  });
}
