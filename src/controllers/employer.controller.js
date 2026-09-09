import { getEmployerDashboard } from '../services/employer.service.js';

export const getEmployerMe = (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      id: req.user.sub,
      role: req.user.role,
    },
  });
};

export const dashboard = async (req, res, next) => {
  try {
    const data = await getEmployerDashboard(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};