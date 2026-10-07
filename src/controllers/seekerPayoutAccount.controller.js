import {
  createSeekerPayoutAccount,
  getEligibleSeekerPayoutAccounts,
  listAllSeekerPayoutAccounts,
  updateSeekerPayoutAccount,
} from '../services/seekerPayoutAccount.service.js';
import { getFlutterwaveBanks } from '../services/flutterwave.service.js';
import { PAYOUT_CAPABILITIES } from '../config/payoutCountries.js';

export const listSeekerPayoutCapabilities = async (_req, res) => res.status(200).json({
  success: true,
  data: { capabilities: PAYOUT_CAPABILITIES },
});

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
