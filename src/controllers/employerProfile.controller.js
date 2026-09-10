import { getEmployerProfile, updateEmployerProfile } from '../services/employerProfile.service.js';

export const getProfile = async (req, res, next) => {
  try {
    const data = await getEmployerProfile(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const data = await updateEmployerProfile(req.user.sub, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
