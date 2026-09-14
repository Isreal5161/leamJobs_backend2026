import { listAdminPayments } from '../services/adminPayments.service.js';

export const listAdminPaymentsController = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await listAdminPayments(req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};