import {
  deleteEmployerCompanyLogoForUser,
  getEmployerProfile,
  readEmployerCompanyLogoForUser,
  updateEmployerCompanyLogoForUser,
  updateEmployerProfile,
} from '../services/employerProfile.service.js';
import { validateUploadedImage } from '../utils/fileValidation.js';

const sendLogo = async (res, result) => {
  if (!result) return res.status(404).json({ message: 'Company logo not found' });
  const extension = result.objectKey.split('.').pop();
  const contentTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  res.type(contentTypes[extension] ?? 'application/octet-stream');
  return res.send(result.buffer);
};

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

export const uploadLogo = async (req, res, next) => {
  try {
    const { extension } = validateUploadedImage(req.file);
    const profile = await updateEmployerCompanyLogoForUser(req.user.sub, req.file, extension);
    return res.status(200).json({ success: true, data: { profile } });
  } catch (error) {
    return next(error);
  }
};

export const deleteLogo = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await deleteEmployerCompanyLogoForUser(req.user.sub) });
  } catch (error) {
    return next(error);
  }
};

export const getLogo = async (req, res, next) => {
  try {
    return sendLogo(res, await readEmployerCompanyLogoForUser(req.user.sub));
  } catch (error) {
    return next(error);
  }
};
