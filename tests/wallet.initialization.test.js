import { jest } from '@jest/globals';
import { initializeSeekerWallet } from '../src/services/wallet.service.js';

test('wallet initialization creates using Prisma defaults and does not overwrite an existing wallet', async () => {
  const existingWallet = {
    id: 'wallet-1',
    userId: 'seeker-1',
    currency: 'NGN',
    availableBalance: '125.00',
    pendingWithdrawalBalance: '25.00',
    version: 4,
  };
  const database = {
    wallet: {
      upsert: jest.fn().mockResolvedValue(existingWallet),
    },
  };

  await expect(initializeSeekerWallet(database, 'seeker-1')).resolves.toBe(existingWallet);
  await expect(initializeSeekerWallet(database, 'seeker-1')).resolves.toBe(existingWallet);

  expect(database.wallet.upsert).toHaveBeenCalledTimes(2);
  expect(database.wallet.upsert).toHaveBeenNthCalledWith(1, {
    where: { userId: 'seeker-1' },
    create: { userId: 'seeker-1' },
    update: {},
  });
  expect(database.wallet.upsert).toHaveBeenNthCalledWith(2, {
    where: { userId: 'seeker-1' },
    create: { userId: 'seeker-1' },
    update: {},
  });
  expect(existingWallet).toMatchObject({
    currency: 'NGN',
    availableBalance: '125.00',
    pendingWithdrawalBalance: '25.00',
    version: 4,
  });
});
