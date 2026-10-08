import { initializeSeekerWallet } from './wallet.service.js';

export const backfillSeekerWallets = async (database, { dryRun = true } = {}) => {
  const seekers = await database.user.findMany({
    where: { role: 'SEEKER' },
    orderBy: { id: 'asc' },
    select: { id: true, wallet: { select: { id: true } } },
  });
  const missingWallets = seekers.filter((seeker) => !seeker.wallet);

  if (dryRun) {
    return {
      dryRun: true,
      totalSeekers: seekers.length,
      alreadyHavingWallets: seekers.length - missingWallets.length,
      walletsCreated: 0,
      walletsWouldBeCreated: missingWallets.length,
      failures: [],
    };
  }

  let walletsCreated = 0;
  const failures = [];

  for (const seeker of seekers) {
    try {
      await initializeSeekerWallet(database, seeker.id);
      if (!seeker.wallet) walletsCreated += 1;
    } catch (error) {
      failures.push({
        userId: seeker.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    dryRun: false,
    totalSeekers: seekers.length,
    alreadyHavingWallets: seekers.length - missingWallets.length,
    walletsCreated,
    walletsWouldBeCreated: missingWallets.length,
    failures,
  };
};
