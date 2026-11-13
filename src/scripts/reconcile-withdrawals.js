import 'dotenv/config.js';
import { reconcilePendingWithdrawals } from '../services/withdrawalExecution.service.js';
import { disconnectDatabase } from '../config/database.js';
import { withWithdrawalJobLock } from './withdrawal-job-lock.js';

const reportResults = (results) => {
  let reconciled = 0;
  let skipped = 0;
  let failed = 0;
  for (const result of results) {
    const withdrawalId = result.withdrawalId ?? 'unknown';
    if (result.error) {
      failed += 1;
      console.error('Withdrawal reconciliation failed', {
        withdrawalId,
        errorName: result.error.name,
        message: result.error.message,
      });
    } else if (result.unresolved || result.alreadyHandled || result.manualReviewRequired) {
      skipped += 1;
      console.warn('Withdrawal reconciliation remains unresolved', {
        withdrawalId,
        status: result.status,
        manualReviewRequired: Boolean(result.manualReviewRequired),
        ...(result.message ? { message: result.message } : {}),
      });
    } else {
      reconciled += 1;
      console.info('Withdrawal reconciled', { withdrawalId, status: result.status });
    }
  }
  console.log('Withdrawal reconciliation run completed', { reconciled, skipped, failed });
  if (failed > 0) process.exitCode = 1;
};

try {
  const run = await withWithdrawalJobLock('withdrawals', reconcilePendingWithdrawals);
  if (!run.acquired) {
    console.info('Withdrawal reconciliation skipped because another withdrawal job is active.');
  } else {
    reportResults(run.result);
  }
} catch (error) {
  console.error('Withdrawal reconciliation run failed', {
    errorName: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : 'Unexpected withdrawal reconciliation error',
  });
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}