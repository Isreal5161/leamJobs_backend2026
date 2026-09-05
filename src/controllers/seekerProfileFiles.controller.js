import {
  deleteSeekerProfilePictureForUser,
  deleteSeekerResumeForUser,
  readSeekerFileForUser,
  updateSeekerProfilePictureForUser,
  updateSeekerResumeForUser,
} from '../services/seekerProfile.service.js';
import { validateUploadedImage, validateUploadedResume } from '../utils/fileValidation.js';

const sendFile = async (res, result, category) => {
  if (!result) return res.status(404).json({ message: `${category} not found` });

  const extension = result.objectKey.split('.').pop();
  const contentTypes = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  res.type(contentTypes[extension] ?? 'application/octet-stream');
  if (category === 'resume') res.setHeader('Content-Disposition', 'attachment');
  return res.send(result.buffer);
};

export const uploadProfilePicture = async (req, res, next) => {
  try {
    const { extension } = validateUploadedImage(req.file);
    const profile = await updateSeekerProfilePictureForUser(req.user.sub, req.file, extension);
    return res.status(200).json({
      success: true,
      data: {
        profilePictureUrl: profile.profilePictureUrl,
        profilePictureKey: profile.profilePictureKey,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteProfilePicture = async (req, res, next) => {
  try {
    const data = await deleteSeekerProfilePictureForUser(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getProfilePicture = async (req, res, next) => {
  try {
    return sendFile(res, await readSeekerFileForUser(req.user.sub, 'profilePictureKey'), 'profile picture');
  } catch (error) {
    return next(error);
  }
};

export const uploadResume = async (req, res, next) => {
  try {
    const { extension } = validateUploadedResume(req.file);
    const profile = await updateSeekerResumeForUser(req.user.sub, req.file, extension);
    return res.status(200).json({
      success: true,
      data: {
        resumeUrl: profile.resumeUrl,
        resumeObjectKey: profile.resumeObjectKey,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteResume = async (req, res, next) => {
  try {
    const data = await deleteSeekerResumeForUser(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getResume = async (req, res, next) => {
  try {
    return sendFile(res, await readSeekerFileForUser(req.user.sub, 'resumeObjectKey'), 'resume');
  } catch (error) {
    return next(error);
  }
};
