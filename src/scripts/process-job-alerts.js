import 'dotenv/config';
import { disconnectDatabase } from '../config/database.js';
import { processJobAlerts } from '../services/jobAlerts.service.js';

try {
  const result = await processJobAlerts();
  console.log(`Processed ${result.alertsProcessed} job alerts and queued ${result.matchesQueued} matches.`);
} catch (error) {
  console.error('Job alert processing failed:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}