import { getSeekerRecommendations } from '../services/seekerRecommendations.service.js';

export const listSeekerRecommendations = async (req, res, next) => {
  try {
    const data = await getSeekerRecommendations(req.user.sub, req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
