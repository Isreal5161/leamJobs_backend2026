import { Prisma } from '@prisma/client';
import { resolveFreelancePaymentFeatures } from './freelancePaymentFeatures.js';

const DECIMAL_ROUNDING_MODES = Object.freeze({
  HALF_UP: Prisma.Decimal.ROUND_HALF_UP,
});

export const WALLET_CURRENCY_POLICY = Object.freeze({
  NGN: Object.freeze({ provisioningEnabled: true, withdrawalEnabled: true, collectionEnabled: true, minorUnits: 2, roundingMode: 'HALF_UP' }),
  USD: Object.freeze({ provisioningEnabled: true, withdrawalEnabled: true, collectionEnabled: true, minorUnits: 2, roundingMode: 'HALF_UP' }),
});

export const CONVERSION_EXECUTION_ENABLED = false;

export const assertWalletProvisioningEnabled = (currency) => {
  const policy = WALLET_CURRENCY_POLICY[currency];
  if (!policy?.provisioningEnabled) {
    const error = new Error(`Wallet provisioning is not available for ${currency}`);
    error.status = 403;
    error.code = 'WALLET_CURRENCY_UNAVAILABLE';
    throw error;
  }
};

export const isWithdrawalCurrencyEnabled = (currency, features = resolveFreelancePaymentFeatures()) => {
  if (WALLET_CURRENCY_POLICY[currency]?.withdrawalEnabled !== true) return false;
  return currency !== 'USD' || features?.usdWithdrawalsEnabled === true;
};

export const roundWalletAmount = (currency, amount) => {
  const policy = WALLET_CURRENCY_POLICY[currency];
  if (!policy) throw new Error(`Unsupported wallet currency: ${currency}`);
  const roundingMode = DECIMAL_ROUNDING_MODES[policy.roundingMode];
  if (roundingMode === undefined) throw new Error(`Unsupported rounding mode: ${policy.roundingMode}`);
  return new Prisma.Decimal(amount).toDecimalPlaces(policy.minorUnits, roundingMode);
};

export const assertCollectionCurrencyEnabled = (currency) => {
  if (WALLET_CURRENCY_POLICY[currency]?.collectionEnabled !== true) {
    const error = new Error(`Payment collection is not available in ${currency}`);
    error.status = 422;
    error.code = 'COLLECTION_CURRENCY_UNAVAILABLE';
    throw error;
  }
};
