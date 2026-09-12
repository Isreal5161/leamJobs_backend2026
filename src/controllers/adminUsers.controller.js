import { listAdminUsers } from '../services/adminUsers.service.js';

export const listUsers = async (req, res, next) => {
  try {
    const data = await listAdminUsers(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};