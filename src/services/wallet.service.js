import { assertWalletProvisioningEnabled } from '../config/walletCurrencies.js';

export const initializeSeekerWallet = async (database, seekerId, currency = 'NGN') => {
  assertWalletProvisioningEnabled(currency);
  return database.wallet.upsert({
    where: { userId_currency: { userId: seekerId, currency } },
    create: { userId: seekerId, currency },
    update: {},
  });
};
