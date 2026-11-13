import 'dotenv/config.js';
import { executePendingWithdrawals } from '../services/withdrawalExecution.service.js';
import { disconnectDatabase } from '../config/database.js';
import { withWithdrawalJobLock } from './withdrawal-job-lock.js';

const reportResults = (results) => {
  let skipped = 0;
  let failed = 0;
  for (const result of results) {
    const withdrawalId = result.withdrawalId ?? 'unknown';
    if (result.error) {
      failed += 1;
      console.error('Withdrawal processing failed', {
        withdrawalId,
        errorName: result.error.name,
        message: result.error.message,
      });
    } else if (result.unresolved || result.alreadyHandled || result.manualReviewRequired) {
      skipped += 1;
      console.warn('Withdrawal processing skipped or unresolved', {
        withdrawalId,
        status: result.status,
        manualReviewRequired: Boolean(result.manualReviewRequired),
        ...(result.message ? { message: result.message } : {}),
      });
    } else {
      console.info('Withdrawal processing completed', { withdrawalId, status: result.status });
    }
  }
  console.log('Withdrawal processing run completed', {
    processed: results.length - skipped - failed,
    skipped,
    failed,
  });
  if (failed > 0) process.exitCode = 1;
};

try {
  const run = await withWithdrawalJobLock('withdrawals', executePendingWithdrawals);
  if (!run.acquired) {
    console.info('Withdrawal processing skipped because another withdrawal job is active.');
  } else {
    reportResults(run.result);
  }
} catch (error) {
  console.error('Withdrawal processing run failed', {
    errorName: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : 'Unexpected withdrawal processing error',
  });
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}