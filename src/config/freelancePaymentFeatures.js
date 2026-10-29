import { env } from './env.js';

export const resolveFreelancePaymentFeatures = (configuration = env) => {
  const enabled = configuration.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED === true;
  return {
    enabled,
    contractFundingEnabled: enabled && configuration.LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED === true,
    escrowReleaseEnabled: enabled && configuration.LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED === true,
    withdrawalsEnabled: enabled && configuration.LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED === true,
    usdWithdrawalsEnabled: enabled
      && configuration.LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED === true
      && configuration.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED === true,
  };
};

export class FreelancePaymentFeatureDisabledError extends Error {
  constructor(feature) {
    const messages = {
      contractFundingEnabled: 'New freelance contract funding is temporarily disabled',
      escrowReleaseEnabled: 'New freelance escrow releases are temporarily disabled',
      withdrawalsEnabled: 'New freelance withdrawal operations are temporarily disabled',
    };
    super(messages[feature] ?? 'This freelance payment operation is temporarily disabled');
    this.name = 'FreelancePaymentFeatureDisabledError';
    this.status = 503;
  }
}

export const assertFreelancePaymentFeatureEnabled = (feature) => {
  if (!resolveFreelancePaymentFeatures()[feature]) {
    throw new FreelancePaymentFeatureDisabledError(feature);
  }
};
