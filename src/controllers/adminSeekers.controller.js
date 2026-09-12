import { listAdminSeekers } from '../services/adminSeekers.service.js';

export const listSeekers = async (req, res, next) => {
  try {
    const data = await listAdminSeekers(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};