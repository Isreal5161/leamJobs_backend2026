export const FLUTTERWAVE_USD_CAPABILITIES = Object.freeze({
  collectionEnabled: false,
  collectionUnavailableReason: 'USD collection methods and merchant approval have not been verified.',
  withdrawalRoutes: Object.freeze([]),
  withdrawalUnavailableReason: 'USD beneficiary verification and approved settlement routes have not been verified.',
  conversionRoutes: Object.freeze([]),
  conversionUnavailableReason: 'An approved FX quote and settlement route are not configured.',
});

export class FlutterwaveUsdCapabilityUnavailableError extends Error {
  constructor(capability) {
    const message = capability === 'collection'
      ? FLUTTERWAVE_USD_CAPABILITIES.collectionUnavailableReason
      : FLUTTERWAVE_USD_CAPABILITIES.withdrawalUnavailableReason;
    super(message);
    this.name = 'FlutterwaveUsdCapabilityUnavailableError';
    this.status = 503;
    this.code = `FLUTTERWAVE_USD_${capability.toUpperCase()}_UNAVAILABLE`;
  }
}

export const assertFlutterwaveUsdCollectionAvailable = () => {
  if (!FLUTTERWAVE_USD_CAPABILITIES.collectionEnabled) {
    throw new FlutterwaveUsdCapabilityUnavailableError('collection');
  }
};

export const isFlutterwaveUsdWithdrawalAvailable = () => (
  FLUTTERWAVE_USD_CAPABILITIES.withdrawalRoutes.length > 0
);
