import 'dotenv/config.js';
import { executePendingWithdrawals } from '../services/withdrawalExecution.service.js';
import { disconnectDatabase } from '../config/database.js';

try {
  const results = await executePendingWithdrawals();
  console.log(`Processed ${results.length} pending withdrawals.`);
} finally {
  await disconnectDatabase();
}