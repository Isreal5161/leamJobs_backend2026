process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const featureFlagNames = [
  'LEAMJOBS_FREELANCE_PAYMENTS_ENABLED',
  'LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED',
  'LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED',
  'LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED',
  'LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED',
];
featureFlagNames.forEach((name) => { delete process.env[name]; });

const { env, parseEnabledFlag } = await import('../src/config/env.js');
const { resolveFreelancePaymentFeatures } = await import('../src/config/freelancePaymentFeatures.js');

test('freelance payment flags default off', () => {
  expect(featureFlagNames.map((name) => env[name])).toEqual([false, false, false, false, false]);
  expect(resolveFreelancePaymentFeatures()).toEqual({
    enabled: false,
    contractFundingEnabled: false,
    escrowReleaseEnabled: false,
    withdrawalsEnabled: false,
    usdWithdrawalsEnabled: false,
  });
});

test.each([
  [undefined, false],
  ['', false],
  ['TRUE', false],
  ['True', false],
  ['1', false],
  ['yes', false],
  ['false', false],
  ['true', true],
])('feature flag value %j is parsed strictly', (value, expected) => {
  expect(parseEnabledFlag(value)).toBe(expected);
});

test('the master switch disables every child capability', () => {
  expect(resolveFreelancePaymentFeatures({
    LEAMJOBS_FREELANCE_PAYMENTS_ENABLED: false,
    LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED: true,
    LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED: true,
    LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED: true,
    LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED: true,
  })).toEqual({
    enabled: false,
    contractFundingEnabled: false,
    escrowReleaseEnabled: false,
    withdrawalsEnabled: false,
    usdWithdrawalsEnabled: false,
  });
});

test('each child capability requires both the master switch and its own flag', () => {
  const masterEnabled = {
    LEAMJOBS_FREELANCE_PAYMENTS_ENABLED: true,
    LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED: false,
    LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED: false,
    LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED: false,
    LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED: false,
  };
  expect(resolveFreelancePaymentFeatures(masterEnabled)).toMatchObject({
    enabled: true,
    contractFundingEnabled: false,
    escrowReleaseEnabled: false,
    withdrawalsEnabled: false,
    usdWithdrawalsEnabled: false,
  });

  expect(resolveFreelancePaymentFeatures({
    ...masterEnabled,
    LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED: true,
  }).contractFundingEnabled).toBe(true);
  expect(resolveFreelancePaymentFeatures({
    ...masterEnabled,
    LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED: true,
  }).escrowReleaseEnabled).toBe(true);
  expect(resolveFreelancePaymentFeatures({
    ...masterEnabled,
    LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED: true,
  }).withdrawalsEnabled).toBe(true);
  expect(resolveFreelancePaymentFeatures({
    ...masterEnabled,
    LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED: true,
    LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED: true,
  }).usdWithdrawalsEnabled).toBe(true);
  expect(resolveFreelancePaymentFeatures({
    ...masterEnabled,
    LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED: true,
  }).usdWithdrawalsEnabled).toBe(false);
});
