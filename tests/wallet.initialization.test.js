import { jest } from '@jest/globals';
import { initializeSeekerWallet } from '../src/services/wallet.service.js';

test('NGN wallet initialization is composite-keyed and does not overwrite existing funds', async () => {
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
    where: { userId_currency: { userId: 'seeker-1', currency: 'NGN' } },
    create: { userId: 'seeker-1', currency: 'NGN' },
    update: {},
  });
  expect(database.wallet.upsert).toHaveBeenNthCalledWith(2, {
    where: { userId_currency: { userId: 'seeker-1', currency: 'NGN' } },
    create: { userId: 'seeker-1', currency: 'NGN' },
    update: {},
  });
  expect(existingWallet).toMatchObject({
    currency: 'NGN',
    availableBalance: '125.00',
    pendingWithdrawalBalance: '25.00',
    version: 4,
  });
});

test('USD wallet provisioning uses the same-currency composite key without enabling withdrawals', async () => {
  const wallet = { id: 'usd-wallet-1', userId: 'seeker-1', currency: 'USD' };
  const database = { wallet: { upsert: jest.fn().mockResolvedValue(wallet) } };

  await expect(initializeSeekerWallet(database, 'seeker-1', 'USD')).resolves.toBe(wallet);
  expect(database.wallet.upsert).toHaveBeenCalledWith({
    where: { userId_currency: { userId: 'seeker-1', currency: 'USD' } },
    create: { userId: 'seeker-1', currency: 'USD' },
    update: {},
  });
});
