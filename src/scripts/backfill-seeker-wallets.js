import 'dotenv/config.js';
import { prisma, disconnectDatabase } from '../config/database.js';
import { backfillSeekerWallets } from '../services/walletBackfill.service.js';

const args = process.argv.slice(2);
const unknownArgs = args.filter((argument) => !['--dry-run', '--apply'].includes(argument));

try {
  if (unknownArgs.length || (args.includes('--dry-run') && args.includes('--apply'))) {
    console.error('Usage: npm run wallets:backfill -- [--dry-run | --apply]');
    process.exitCode = 2;
  } else {
    const dryRun = !args.includes('--apply');
    const result = await backfillSeekerWallets(prisma, { dryRun });

    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
    console.log(`Total SEEKER users: ${result.totalSeekers}`);
    console.log(`SEEKERs already having wallets: ${result.alreadyHavingWallets}`);
    if (dryRun) {
      console.log(`Wallets that would be created: ${result.walletsWouldBeCreated}`);
    } else {
      console.log(`Wallets created: ${result.walletsCreated}`);
    }
    console.log(`Failures: ${result.failures.length}`);
    for (const failure of result.failures) {
      console.error(`Wallet initialization failed for user ${failure.userId}: ${failure.message}`);
    }

    if (result.failures.length > 0) process.exitCode = 1;
  }
} catch (error) {
  console.error('Seeker wallet backfill failed before completion:', error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
