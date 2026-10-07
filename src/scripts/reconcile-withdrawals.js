import 'dotenv/config.js';
import { reconcilePendingWithdrawals } from '../services/withdrawalExecution.service.js';
import { disconnectDatabase } from '../config/database.js';

try {
  const results = await reconcilePendingWithdrawals();
  console.log(`Reconciled ${results.length} pending withdrawals.`);
} finally {
  await disconnectDatabase();
}