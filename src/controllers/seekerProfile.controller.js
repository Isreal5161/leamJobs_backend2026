import { getSeekerProfileForUser, upsertSeekerProfileForUser, updateSeekerCVForUser } from '../services/seekerProfile.service.js';

export const getProfile = async (req, res, next) => {
  try {
    const data = await getSeekerProfileForUser(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const data = await upsertSeekerProfileForUser(req.user.sub, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const updateCVProfile = async (req, res, next) => {
  try {
    const data = await updateSeekerCVForUser(req.user.sub, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
