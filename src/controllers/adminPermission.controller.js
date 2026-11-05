import { getEffectiveAdminPermissions } from '../services/adminPermission.service.js';

export const getCurrentAdminPermissionsController = async (req, res, next) => {
  try {
    const data = await getEffectiveAdminPermissions(req.adminContext);
    if (!data) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
