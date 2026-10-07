export const PAYOUT_CAPABILITIES = [
  {
    country: 'Nigeria',
    countryCode: 'NG',
    currency: 'NGN',
    provider: 'FLUTTERWAVE',
    payoutMethod: 'BANK_ACCOUNT',
    verificationMethod: 'FLUTTERWAVE_ACCOUNT_RESOLVE',
    verifiedBeforeWithdrawal: true,
    bankListAvailable: true,
    requiredFields: ['bankCode', 'accountNumber'],
  },
];

export const PAYOUT_COUNTRIES = PAYOUT_CAPABILITIES.map(({ country }) => country);
export const getPayoutCapability = (country) => PAYOUT_CAPABILITIES.find((capability) => capability.country === country) ?? null;
export const isSupportedPayoutAccount = (account) => PAYOUT_CAPABILITIES.some((capability) => (
  account.provider === capability.provider
  && account.payoutMethod === capability.payoutMethod
  && account.country === capability.country
  && account.currency === capability.currency
  && (capability.verifiedBeforeWithdrawal
    ? Boolean(account.verifiedAt)
    : !account.verifiedAt && Boolean(account.encryptedPayoutMetadata))
));
