import { createHash } from 'node:crypto';
import { Client } from 'pg';

const LOCK_NAMESPACE = 0x4c4a;

const lockIdFor = (jobName) => createHash('sha256').update(jobName).digest().readInt32BE(0);

export const withWithdrawalJobLock = async (
  jobName,
  run,
  clientFactory = () => new Client({ connectionString: process.env.DATABASE_URL }),
) => {
  if (typeof jobName !== 'string' || !jobName.trim() || typeof run !== 'function') {
    throw new TypeError('A withdrawal job name and run function are required');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the withdrawal job lock');

  const client = clientFactory();
  const lockId = lockIdFor(jobName);
  let connected = false;
  let acquired = false;

  try {
    await client.connect();
    connected = true;
    const result = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [LOCK_NAMESPACE, lockId],
    );
    acquired = result.rows?.[0]?.acquired === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, result: await run() };
  } finally {
    if (connected) {
      try {
        if (acquired) {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, lockId]);
        }
      } finally {
        await client.end();
      }
    }
  }
};
