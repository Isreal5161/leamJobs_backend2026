import { backfillSeekerWallets } from '../src/services/walletBackfill.service.js';

const createDatabase = (users) => ({
  users: users.map((user) => ({ ...user })),
  wallet: {
    upsert: async ({ where, create, update }) => {
      if (Object.keys(update).length !== 0) throw new Error('Existing wallet update must be empty');
      const user = database.users.find(({ id }) => id === where.userId);
      if (!user) throw new Error('User not found');
      if (!user.wallet) {
        user.wallet = {
          id: `wallet-${user.id}`,
          userId: create.userId,
          currency: 'NGN',
          availableBalance: '0.00',
          pendingWithdrawalBalance: '0.00',
          version: 0,
          updatedAt: 'unchanged-on-retry',
        };
      }
      return user.wallet;
    },
  },
  user: {
    findMany: async ({ where }) => database.users
      .filter((user) => user.role === where.role)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, wallet }) => ({ id, wallet: wallet ? { id: wallet.id } : null })),
  },
});

let database;

beforeEach(() => {
  database = createDatabase([
    {
      id: 'seeker-with-wallet',
      role: 'SEEKER',
      wallet: {
        id: 'existing-wallet',
        userId: 'seeker-with-wallet',
        currency: 'NGN',
        availableBalance: '125.00',
        pendingWithdrawalBalance: '25.00',
        version: 3,
        updatedAt: 'must-not-change',
      },
    },
    { id: 'seeker-without-wallet', role: 'SEEKER', wallet: null },
    { id: 'employer-without-wallet', role: 'EMPLOYER', wallet: null },
  ]);
});

test('dry run counts missing seeker wallets without creating any', async () => {
  const result = await backfillSeekerWallets(database, { dryRun: true });

  expect(result).toMatchObject({
    totalSeekers: 2,
    alreadyHavingWallets: 1,
    walletsWouldBeCreated: 1,
    walletsCreated: 0,
    failures: [],
  });
  expect(database.users.find(({ id }) => id === 'seeker-without-wallet').wallet).toBeNull();
  expect(database.users.find(({ id }) => id === 'employer-without-wallet').wallet).toBeNull();
});

test('backfill initializes only missing seeker wallets and preserves existing financial state', async () => {
  const existingWallet = database.users[0].wallet;

  const result = await backfillSeekerWallets(database, { dryRun: false });

  expect(result).toMatchObject({
    totalSeekers: 2,
    alreadyHavingWallets: 1,
    walletsWouldBeCreated: 1,
    walletsCreated: 1,
    failures: [],
  });
  expect(database.users[0].wallet).toBe(existingWallet);
  expect(database.users[0].wallet).toMatchObject({
    currency: 'NGN',
    availableBalance: '125.00',
    pendingWithdrawalBalance: '25.00',
    version: 3,
    updatedAt: 'must-not-change',
  });
  expect(database.users[1].wallet).toMatchObject({
    userId: 'seeker-without-wallet',
    currency: 'NGN',
    availableBalance: '0.00',
    pendingWithdrawalBalance: '0.00',
    version: 0,
  });
  expect(database.users[2].wallet).toBeNull();
});

test('a second backfill creates no additional wallets', async () => {
  await backfillSeekerWallets(database, { dryRun: false });

  const secondResult = await backfillSeekerWallets(database, { dryRun: false });

  expect(secondResult).toMatchObject({
    totalSeekers: 2,
    alreadyHavingWallets: 2,
    walletsWouldBeCreated: 0,
    walletsCreated: 0,
    failures: [],
  });
});

test('wallet failures are reported per seeker and do not stop other seekers', async () => {
  const originalUpsert = database.wallet.upsert;
  database.wallet.upsert = async (arguments_) => {
    if (arguments_.where.userId === 'seeker-without-wallet') throw new Error('simulated failure');
    return originalUpsert(arguments_);
  };
  database.users.push({ id: 'seeker-also-missing', role: 'SEEKER', wallet: null });

  const result = await backfillSeekerWallets(database, { dryRun: false });

  expect(result.walletsCreated).toBe(1);
  expect(result.failures).toEqual([{ userId: 'seeker-without-wallet', message: 'simulated failure' }]);
  expect(database.users.find(({ id }) => id === 'seeker-also-missing').wallet).not.toBeNull();
});
