import {
  createSeekerPayoutAccount,
  getEligibleSeekerPayoutAccounts,
  listAllSeekerPayoutAccounts,
  updateSeekerPayoutAccount,
} from '../services/seekerPayoutAccount.service.js';

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
