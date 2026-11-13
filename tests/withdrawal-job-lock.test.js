import { jest } from '@jest/globals';
import { withWithdrawalJobLock } from '../src/scripts/withdrawal-job-lock.js';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/unused_test_db';

const createLockClientFactory = () => {
  const heldLocks = new Set();
  return () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockImplementation(async (sql, params) => {
      const key = params.join(':');
      if (sql.includes('pg_try_advisory_lock')) {
        if (heldLocks.has(key)) return { rows: [{ acquired: false }] };
        heldLocks.add(key);
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        heldLocks.delete(key);
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      throw new Error('Unexpected lock query');
    }),
  });
};

test('withdrawal job advisory lock prevents overlapping runs and is released for a later run', async () => {
  const clientFactory = createLockClientFactory();
  let markStarted;
  let finishRun;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blockedRun = new Promise((resolve) => { finishRun = resolve; });
  const firstRun = withWithdrawalJobLock('withdrawals', async () => {
    markStarted();
    await blockedRun;
    return 'completed';
  }, clientFactory);
  await started;

  const overlappingRun = await withWithdrawalJobLock('withdrawals', jest.fn(), clientFactory);
  expect(overlappingRun).toEqual({ acquired: false });

  finishRun();
  await expect(firstRun).resolves.toEqual({ acquired: true, result: 'completed' });
  await expect(withWithdrawalJobLock('withdrawals', async () => 'next run', clientFactory))
    .resolves.toEqual({ acquired: true, result: 'next run' });
});

test('withdrawal job advisory lock is released when the run fails', async () => {
  const clientFactory = createLockClientFactory();
  await expect(withWithdrawalJobLock('withdrawals', async () => {
    throw new Error('job failure');
  }, clientFactory)).rejects.toThrow('job failure');

  await expect(withWithdrawalJobLock('withdrawals', async () => 'retry', clientFactory))
    .resolves.toEqual({ acquired: true, result: 'retry' });
});
