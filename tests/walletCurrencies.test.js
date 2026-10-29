import { roundWalletAmount, WALLET_CURRENCY_POLICY } from '../src/config/walletCurrencies.js';

test.each(['NGN', 'USD'])('%s uses explicit two-decimal half-up rounding', (currency) => {
  expect(roundWalletAmount(currency, '1.005').toFixed(2)).toBe('1.01');
  expect(WALLET_CURRENCY_POLICY[currency].minorUnits).toBe(2);
  expect(WALLET_CURRENCY_POLICY[currency].roundingMode).toBe('HALF_UP');
});
