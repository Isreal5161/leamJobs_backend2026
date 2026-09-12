import { readEmployerCompanyLogoForUser } from '../services/employerProfile.service.js';
import { listAdminCompanies } from '../services/adminCompanies.service.js';

const sendLogo = async (res, result) => {
  if (!result) return res.status(404).json({ message: 'Company logo not found' });
  const extension = result.objectKey.split('.').pop();
  const contentTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  res.type(contentTypes[extension] ?? 'application/octet-stream');
  return res.send(result.buffer);
};

export const listCompanies = async (req, res, next) => {
  try {
    const data = await listAdminCompanies(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getCompanyLogo = async (req, res, next) => {
  try {
    return sendLogo(res, await readEmployerCompanyLogoForUser(req.params.userId));
  } catch (error) {
    return next(error);
  }
};