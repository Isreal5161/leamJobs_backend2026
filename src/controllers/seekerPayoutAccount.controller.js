import {
  createSeekerPayoutAccount,
  getEligibleSeekerPayoutAccounts,
  listAllSeekerPayoutAccounts,
  updateSeekerPayoutAccount,
} from '../services/seekerPayoutAccount.service.js';
import { getFlutterwaveBanks } from '../services/flutterwave.service.js';
import { getMissingFlutterwaveDomRemitterConfiguration, PAYOUT_CAPABILITIES } from '../config/payoutCountries.js';
import { resolveFreelancePaymentFeatures } from '../config/freelancePaymentFeatures.js';
import { isWithdrawalCurrencyEnabled } from '../config/walletCurrencies.js';

export const listSeekerPayoutCapabilities = async (_req, res) => {
  const features = resolveFreelancePaymentFeatures();
  const domRemitterConfigured = getMissingFlutterwaveDomRemitterConfiguration().length === 0;
  return res.status(200).json({
    success: true,
    data: {
      capabilities: PAYOUT_CAPABILITIES.map((capability) => ({
        ...capability,
        withdrawalEnabled: features.withdrawalsEnabled
          && isWithdrawalCurrencyEnabled(capability.currency, features)
          && (capability.route !== 'NG_DOMICILIARY_USD'
            || (capability.providerAvailable === true && domRemitterConfigured)),
        destinationSetupEnabled: capability.route !== 'NG_DOMICILIARY_USD'
          || (capability.providerAvailable === true && domRemitterConfigured),
        ...(capability.route === 'NG_DOMICILIARY_USD' && (!capability.providerAvailable || !domRemitterConfigured)
          ? {
            unavailableReason: !capability.providerAvailable
              ? 'Flutterwave currently reports Nigerian USD domiciliary IMTO transfers as unavailable.'
              : 'Verified Flutterwave merchant remitter configuration is missing.',
          }
          : {}),
      })),
    },
  });
};

export const listSeekerPayoutAccounts = async (req, res, next) => {
  try {
    const payoutAccounts = req.query.scope === 'all'
      ? await listAllSeekerPayoutAccounts(req.user.sub)
      : await getEligibleSeekerPayoutAccounts(req.user.sub);
    return res.status(200).json({ success: true, data: { payoutAccounts } });
  } catch (error) {
    return next(error);
  }
};

export const listSeekerPayoutBanks = async (req, res, next) => {
  try {
    const capability = PAYOUT_CAPABILITIES.find((entry) => entry.countryCode === req.query.country);
    if (!capability?.bankListAvailable) {
      return res.status(400).json({ message: 'Bank listings are not available for this payout destination.' });
    }
    const banks = await getFlutterwaveBanks(capability.countryCode);
    return res.status(200).json({ success: true, data: { banks } });
  } catch (error) {
    return next(error);
  }
};

export const createPayoutAccount = async (req, res, next) => {
  try {
    const payoutAccount = await createSeekerPayoutAccount(req.user.sub, req.validatedPayoutAccount);
    return res.status(201).json({ success: true, data: { payoutAccount } });
  } catch (error) {
    return next(error);
  }
};

export const updatePayoutAccount = async (req, res, next) => {
  try {
    const payoutAccount = await updateSeekerPayoutAccount(req.user.sub, req.params.id, req.validatedPayoutAccount);
    return res.status(200).json({ success: true, data: { payoutAccount } });
  } catch (error) {
    return next(error);
  }
};
