import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
const databaseConfigured = Boolean(process.env.DATABASE_URL);

const { prisma } = await import('../src/config/database.js');
const { createSeekerApplication } = await import('../src/services/seekerApplications.service.js');

const describeDatabase = databaseConfigured ? describe : describe.skip;

describeDatabase('application limit concurrency', () => {
  let employerId;
  let seekerId;
  let jobOneId;
  let jobTwoId;

  beforeAll(async () => {
    await prisma.$connect();

    employerId = randomUUID();
    seekerId = randomUUID();
    jobOneId = randomUUID();
    jobTwoId = randomUUID();

    const planKey = `test-application-limit-${randomUUID().slice(0, 8)}`;

    await prisma.user.createMany({
      data: [
        {
          id: employerId,
          email: `application-limit-employer-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          firstName: 'Employer',
          lastName: 'Limit',
          role: 'EMPLOYER',
        },
        {
          id: seekerId,
          email: `application-limit-seeker-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          firstName: 'Seeker',
          lastName: 'Limit',
          role: 'SEEKER',
        },
      ],
    });

    await prisma.employerProfile.create({
      data: {
        userId: employerId,
        companyName: 'Limit Test Company',
      },
    });

    await prisma.seekerProfile.create({
      data: {
        userId: seekerId,
        professionalTitle: 'Frontend Engineer',
        bio: 'Builds accessible products.',
        location: 'Remote',
        skills: ['JavaScript', 'React'],
      },
    });

    const subscriptionPlan = await prisma.subscriptionPlan.create({
      data: {
        key: planKey,
        displayName: 'Application Limit Test Plan',
        isActive: true,
        isPublic: false,
        featureConfig: { applicationLimit: 1 },
        aiAllowance: 20,
      },
    });

    await prisma.subscription.create({
      data: {
        userId: seekerId,
        planId: subscriptionPlan.id,
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 60 * 60 * 1000),
        priceSnapshot: 0,
        currencySnapshot: 'NGN',
        billingIntervalSnapshot: 'MONTHLY',
      },
    });

    await prisma.job.createMany({
      data: [
        {
          id: jobOneId,
          employerId,
          title: 'Senior Frontend Engineer',
          description: 'A strong frontend role with React and design systems.',
          location: 'Remote',
          jobType: 'NORMAL_EMPLOYMENT',
          engagementType: 'MONTHLY',
          workArrangement: 'REMOTE',
          status: 'APPROVED',
          skills: ['React', 'TypeScript', 'CSS'],
        },
        {
          id: jobTwoId,
          employerId,
          title: 'Product Engineer',
          description: 'Help build polished user experiences for a SaaS platform.',
          location: 'Remote',
          jobType: 'NORMAL_EMPLOYMENT',
          engagementType: 'MONTHLY',
          workArrangement: 'REMOTE',
          status: 'APPROVED',
          skills: ['React', 'JavaScript', 'UX'],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { seekerId } });
    await prisma.job.deleteMany({ where: { id: { in: [jobOneId, jobTwoId] } } });
    await prisma.subscription.deleteMany({ where: { userId: seekerId } });
    await prisma.subscriptionPlan.deleteMany({ where: { key: { contains: 'test-application-limit-' } } });
    await prisma.seekerProfile.deleteMany({ where: { userId: seekerId } });
    await prisma.employerProfile.deleteMany({ where: { userId: employerId } });
    await prisma.user.deleteMany({ where: { id: { in: [employerId, seekerId] } } });
    await prisma.$disconnect();
  });

  test('concurrent applications respect the monthly cap and only one succeeds', async () => {
    const results = await Promise.allSettled([
      createSeekerApplication(seekerId, { jobId: jobOneId, coverLetter: 'I am excited to work with your product team.' }),
      createSeekerApplication(seekerId, { jobId: jobTwoId, coverLetter: 'I would enjoy contributing to your product and design quality.' }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(403);
    expect(rejected[0].reason.publicCode).toBe('APPLICATION_LIMIT_REACHED');

    const count = await prisma.application.count({ where: { seekerId } });
    expect(count).toBe(1);
  });
});

if (!databaseConfigured) {
  test('requires DATABASE_URL for PostgreSQL application limit concurrency coverage', () => {
    expect(databaseConfigured).toBe(false);
  });
}
