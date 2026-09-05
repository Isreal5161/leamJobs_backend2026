import { getEligibleSeekerPayoutAccounts } from '../services/seekerPayoutAccount.service.js';

export const listSeekerPayoutAccounts = async (req, res, next) => {
  try {
    const payoutAccounts = await getEligibleSeekerPayoutAccounts(req.user.sub);
    return res.status(200).json({ success: true, data: { payoutAccounts } });
  } catch (error) {
    return next(error);
  }
};
