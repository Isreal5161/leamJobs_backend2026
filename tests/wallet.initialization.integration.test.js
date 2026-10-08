import { randomUUID } from 'node:crypto';
import { initializeSeekerWallet } from '../src/services/wallet.service.js';

const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

const walletDatabaseDescribe = testDatabaseUrl ? describe : describe.skip;

walletDatabaseDescribe('seeker wallet initialization PostgreSQL integration', () => {
  let database;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    database = new PrismaClient();
    await database.$connect();
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  test('concurrent initialization creates one default wallet and retries preserve its financial state', async () => {
    const userId = randomUUID();
    await database.user.create({
      data: {
        id: userId,
        email: `${userId}@wallet-test.example`,
        passwordHash: 'integration-test-only',
        firstName: 'Wallet',
        lastName: 'Integration',
        role: 'SEEKER',
      },
    });

    try {
      const wallets = await Promise.all([
        initializeSeekerWallet(database, userId),
        initializeSeekerWallet(database, userId),
      ]);

      expect(new Set(wallets.map((wallet) => wallet.id)).size).toBe(1);
      expect(await database.wallet.count({ where: { userId } })).toBe(1);
      const createdWallet = await database.wallet.findUnique({ where: { userId } });
      expect(createdWallet.currency).toBe('NGN');
      expect(createdWallet.availableBalance.toFixed(2)).toBe('0.00');
      expect(createdWallet.pendingWithdrawalBalance.toFixed(2)).toBe('0.00');
      expect(createdWallet.version).toBe(0);

      await database.wallet.update({
        where: { userId },
        data: { availableBalance: '125.00', pendingWithdrawalBalance: '25.00', version: 3 },
      });
      await initializeSeekerWallet(database, userId);

      const retriedWallet = await database.wallet.findUnique({ where: { userId } });
      expect(retriedWallet.currency).toBe('NGN');
      expect(retriedWallet.availableBalance.toFixed(2)).toBe('125.00');
      expect(retriedWallet.pendingWithdrawalBalance.toFixed(2)).toBe('25.00');
      expect(retriedWallet.version).toBe(3);
    } finally {
      await database.wallet.deleteMany({ where: { userId } });
      await database.user.delete({ where: { id: userId } });
    }
  });

  test('wallet initialization and seeker creation roll back together', async () => {
    const userId = randomUUID();

    await expect(database.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          id: userId,
          email: `${userId}@wallet-test.example`,
          passwordHash: 'integration-test-only',
          firstName: 'Rollback',
          lastName: 'Integration',
          role: 'SEEKER',
        },
      });
      await initializeSeekerWallet(transaction, userId);
      throw new Error('force registration transaction rollback');
    })).rejects.toThrow('force registration transaction rollback');

    expect(await database.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await database.wallet.findUnique({ where: { userId } })).toBeNull();
  });
});
