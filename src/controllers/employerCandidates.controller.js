import { listEmployerCandidates } from '../services/employerCandidates.service.js';

export const listCandidates = async (req, res, next) => {
  try {
    const data = await listEmployerCandidates(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};