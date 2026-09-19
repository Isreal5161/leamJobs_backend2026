import { getPublicCompany } from '../services/publicCompany.service.js';

export const getPublicCompanyProfile = async (req, res, next) => {
  try {
    const data = await getPublicCompany(req.validatedParams.employerId, req.validatedQuery ?? { page: 1, limit: 12 });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};