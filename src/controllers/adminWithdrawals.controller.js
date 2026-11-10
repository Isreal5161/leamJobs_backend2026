import { getAdminWithdrawal, listAdminWithdrawals } from '../services/adminWithdrawals.service.js';

export const listAdminWithdrawalsController = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await listAdminWithdrawals(req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};

export const getAdminWithdrawalController = async (req, res, next) => {
  try {
    const withdrawal = await getAdminWithdrawal(req.params.id);
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    return res.status(200).json({ success: true, data: withdrawal });
  } catch (error) {
    return next(error);
  }
};
