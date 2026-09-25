import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const transaction = {
  $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]),
  jobAlert: { findMany: jest.fn() },
};
const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(async (callback) => callback(transaction)),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { processJobAlerts } = await import('../src/services/jobAlerts.service.js');

test('skips alert processing when another process owns the advisory lock', async () => {
  await expect(processJobAlerts()).resolves.toMatchObject({ skipped: true, alertsProcessed: 0, matchesQueued: 0 });
  expect(transaction.jobAlert.findMany).not.toHaveBeenCalled();
});
