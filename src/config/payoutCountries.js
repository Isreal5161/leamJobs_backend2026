import { env } from './env.js';

export const FLUTTERWAVE_NIGERIAN_DOM_BANK = Object.freeze({
  code: '144',
  nameIncludes: 'FCMB',
});
export const FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE = false;

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
  {
    country: 'United States',
    countryCode: 'US',
    currency: 'USD',
    provider: 'FLUTTERWAVE',
    payoutMethod: 'BANK_ACCOUNT',
    route: 'INTERNATIONAL_USD',
    verificationMethod: 'BENEFICIARY_DETAILS',
    verifiedBeforeWithdrawal: false,
    bankListAvailable: false,
    requiredFields: ['accountNumber', 'routingNumber', 'swiftCode', 'bankName', 'accountType', 'beneficiaryAddress', 'postalCode', 'streetNumber', 'streetName'],
  },
  {
    country: 'Nigeria',
    countryCode: 'NG',
    currency: 'USD',
    provider: 'FLUTTERWAVE',
    payoutMethod: 'BANK_ACCOUNT',
    route: 'NG_DOMICILIARY_USD',
    providerAvailable: FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE,
    destinationSetupEnabled: false,
    verificationMethod: 'FLUTTERWAVE_DOM_REMITTER_CONFIGURATION',
    verifiedBeforeWithdrawal: false,
    bankListAvailable: true,
    requiredFields: ['bankCode', 'accountNumber', 'beneficiaryFirstName', 'beneficiaryLastName', 'beneficiaryEmail', 'beneficiaryMobileNumber', 'beneficiaryAddress', 'beneficiaryOccupation'],
  },
];

const domRemitterConfigurationKeys = [
  'FLUTTERWAVE_DOM_REMITTER_NAME',
  'FLUTTERWAVE_DOM_REMITTER_ADDRESS',
  'FLUTTERWAVE_DOM_REMITTER_CITY',
  'FLUTTERWAVE_DOM_REMITTER_COUNTRY',
  'FLUTTERWAVE_DOM_REMITTER_ID_NUMBER',
  'FLUTTERWAVE_DOM_REMITTER_ID_TYPE',
  'FLUTTERWAVE_DOM_REMITTER_ID_EXPIRY',
  'FLUTTERWAVE_DOM_REMITTER_MOBILE_NUMBER',
  'FLUTTERWAVE_DOM_REMITTER_EMAIL',
  'FLUTTERWAVE_DOM_REMITTER_OCCUPATION',
  'FLUTTERWAVE_DOM_REMITTER_BENEFICIARY_RELATIONSHIP',
];

export const getMissingFlutterwaveDomRemitterConfiguration = (configuration = env) => {
  const missing = domRemitterConfigurationKeys.filter((key) => !String(configuration[key] ?? '').trim());
  if (configuration.FLUTTERWAVE_DOM_REMITTER_COUNTRY
    && !/^[A-Za-z]{2}$/.test(configuration.FLUTTERWAVE_DOM_REMITTER_COUNTRY.trim())) {
    missing.push('FLUTTERWAVE_DOM_REMITTER_COUNTRY (two-letter country code)');
  }
  if (configuration.FLUTTERWAVE_DOM_REMITTER_ID_TYPE
    && !['PASSPORT', 'DRIVING LICENSE', 'ID CARD', 'VOTER CARD'].includes(configuration.FLUTTERWAVE_DOM_REMITTER_ID_TYPE.trim().toUpperCase())) {
    missing.push('FLUTTERWAVE_DOM_REMITTER_ID_TYPE (PASSPORT, DRIVING LICENSE, ID CARD, or VOTER CARD)');
  }
  if (configuration.FLUTTERWAVE_DOM_REMITTER_EMAIL
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuration.FLUTTERWAVE_DOM_REMITTER_EMAIL.trim())) {
    missing.push('FLUTTERWAVE_DOM_REMITTER_EMAIL (valid email address)');
  }
  return missing;
};

export const getFlutterwaveDomRemitterMetadata = (configuration = env) => {
  const missing = getMissingFlutterwaveDomRemitterConfiguration(configuration);
  if (missing.length) return { missing };
  return {
    missing: [],
    metadata: {
      sender: configuration.FLUTTERWAVE_DOM_REMITTER_NAME.trim(),
      sender_address: configuration.FLUTTERWAVE_DOM_REMITTER_ADDRESS.trim(),
      sender_city: configuration.FLUTTERWAVE_DOM_REMITTER_CITY.trim(),
      sender_country: configuration.FLUTTERWAVE_DOM_REMITTER_COUNTRY.trim().toUpperCase(),
      sender_id_number: configuration.FLUTTERWAVE_DOM_REMITTER_ID_NUMBER.trim(),
      sender_id_type: configuration.FLUTTERWAVE_DOM_REMITTER_ID_TYPE.trim().toUpperCase(),
      sender_id_expiry: configuration.FLUTTERWAVE_DOM_REMITTER_ID_EXPIRY.trim(),
      sender_mobile_number: configuration.FLUTTERWAVE_DOM_REMITTER_MOBILE_NUMBER.trim(),
      sender_email_address: configuration.FLUTTERWAVE_DOM_REMITTER_EMAIL.trim(),
      sender_occupation: configuration.FLUTTERWAVE_DOM_REMITTER_OCCUPATION.trim(),
      sender_beneficiary_relationship: configuration.FLUTTERWAVE_DOM_REMITTER_BENEFICIARY_RELATIONSHIP.trim(),
    },
  };
};

export const PAYOUT_COUNTRIES = [...new Set(PAYOUT_CAPABILITIES.map(({ country }) => country))];
export const getPayoutCapability = (country, currency = country === 'United States' ? 'USD' : 'NGN') => (
  PAYOUT_CAPABILITIES.find((capability) => capability.country === country && capability.currency === currency) ?? null
);
export const isSupportedPayoutAccount = (account) => PAYOUT_CAPABILITIES.some((capability) => (
  account.provider === capability.provider
  && account.payoutMethod === capability.payoutMethod
  && account.country === capability.country
  && account.currency === capability.currency
  && capability.providerAvailable !== false
  && (capability.verifiedBeforeWithdrawal
    ? Boolean(account.verifiedAt)
    : !account.verifiedAt && Boolean(account.encryptedPayoutMetadata)
)));
