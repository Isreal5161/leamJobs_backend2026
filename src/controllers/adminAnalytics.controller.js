import { getAdminAnalytics } from '../services/adminAnalytics.service.js';

export const analytics = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getAdminAnalytics(req.validatedQuery) });
  } catch (error) {
    return next(error);
  }
};