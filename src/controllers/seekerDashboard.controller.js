import { getSeekerDashboard } from '../services/seekerDashboard.service.js';

export const dashboard = async (req, res, next) => {
  try {
    const data = await getSeekerDashboard(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
