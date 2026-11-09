import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const transaction = {
  $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
  jobAlert: { findMany: jest.fn(), update: jest.fn() },
  job: { findMany: jest.fn() },
};
const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(async (callback) => callback(transaction)),
  jobAlert: transaction.jobAlert,
  job: transaction.job,
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({
  EMAIL_TYPES: { JOB_ALERT_MATCH: 'JOB_ALERT_MATCH' },
  queueEmail: jest.fn(),
}));
jest.unstable_mockModule('../src/services/subscriptionEntitlement.service.js', () => ({
  resolveEffectiveEntitlements: jest.fn(async () => ({
    planKey: 'BASIC',
    effectivePlan: { featureConfig: { jobAlertsLimit: null } },
  })),
}));
jest.unstable_mockModule('../src/services/subscriptionFoundation.service.js', () => ({
  subscriptionPlanFeatureDefaults: { BASIC: { jobAlertsLimit: 100 } },
}));

const { processJobAlerts } = await import('../src/services/jobAlerts.service.js');
const { queueEmail } = await import('../src/services/email.service.js');

test('reads active alerts in bounded pages and updates each eligible alert', async () => {
  const firstBatch = Array.from({ length: 100 }, (_, index) => ({
    id: `alert-${index}`,
    seekerId: 'seeker-1',
    createdAt: new Date(index),
    lastRunAt: null,
    name: `Alert ${index}`,
    seeker: { email: 'seeker@example.com' },
  }));
  const lastAlert = {
    id: 'alert-100',
    seekerId: 'seeker-1',
    createdAt: new Date(100),
    lastRunAt: null,
    name: 'Alert 100',
    seeker: { email: 'seeker@example.com' },
  };
  transaction.jobAlert.findMany
    .mockResolvedValueOnce(firstBatch)
    .mockResolvedValueOnce([lastAlert])
    .mockResolvedValueOnce([]);
  transaction.job.findMany.mockResolvedValue([]);

  await expect(processJobAlerts({ now: new Date('2026-01-01T00:00:00.000Z') })).resolves.toEqual({
    skipped: false,
    alertsProcessed: 101,
    matchesQueued: 0,
  });

  expect(transaction.jobAlert.findMany).toHaveBeenCalledTimes(2);
  expect(transaction.jobAlert.findMany.mock.calls[0][0].take).toBe(100);
  expect(transaction.jobAlert.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
    cursor: { id: 'alert-99' },
    skip: 1,
  }));
  expect(transaction.jobAlert.update).toHaveBeenCalledTimes(101);
  expect(transaction.job.findMany.mock.calls.every(([query]) => query.take === 100)).toBe(true);
});

test('retries queue job matches with the same idempotency key', async () => {
  transaction.jobAlert.findMany.mockReset();
  transaction.job.findMany.mockReset();
  transaction.jobAlert.update.mockReset();
  queueEmail.mockReset();
  const alert = {
    id: 'alert-idempotent',
    seekerId: 'seeker-1',
    createdAt: new Date('2025-12-30T00:00:00.000Z'),
    lastRunAt: null,
    name: 'Engineering',
    seeker: { email: 'seeker@example.com' },
  };
  const job = {
    id: 'job-idempotent',
    title: 'Engineer',
    description: 'Engineering role',
    location: 'Remote',
    skills: [],
    jobType: 'FULL_TIME',
    workArrangement: 'REMOTE',
    employmentCompensation: null,
    freelanceCompensation: null,
  };
  transaction.jobAlert.findMany.mockResolvedValue([alert]);
  transaction.job.findMany.mockResolvedValue([job]);
  queueEmail.mockResolvedValue({ id: 'delivery-idempotent' });

  await processJobAlerts({ now: new Date('2026-01-01T00:00:00.000Z') });
  await processJobAlerts({ now: new Date('2026-01-01T00:00:00.000Z') });

  expect(queueEmail).toHaveBeenCalledTimes(2);
  expect(queueEmail.mock.calls.map(([delivery]) => delivery.eventKey)).toEqual([
    'job-alert:alert-idempotent:job-idempotent',
    'job-alert:alert-idempotent:job-idempotent',
  ]);
});
