import { getEmployerCandidateProfilePicture, listEmployerCandidates } from '../services/employerCandidates.service.js';

export const listCandidates = async (req, res, next) => {
  try {
    const data = await listEmployerCandidates(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getCandidateProfilePicture = async (req, res, next) => {
  try {
    const result = await getEmployerCandidateProfilePicture(req.params.candidateId);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const extension = result.objectKey.split('.').pop()?.toLowerCase();
    const contentTypes = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    res.type(contentTypes[extension] ?? 'application/octet-stream');
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
};