import { readPublicCompanyLogo } from '../services/publicCompanyLogo.service.js';

export const getPublicCompanyLogo = async (req, res, next) => {
  try {
    const result = await readPublicCompanyLogo(req.params.employerId);
    res.type(result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
};
