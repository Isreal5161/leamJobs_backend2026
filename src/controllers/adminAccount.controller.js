import { anonymizeAdminManagedAccount } from '../services/adminAccountAnonymization.service.js';

export const anonymizeAdminAccount = async (req, res, next) => {
  try {
    const data = await anonymizeAdminManagedAccount(req.params.userId, req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
