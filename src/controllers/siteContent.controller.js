import { getSiteContent, updateSiteContent } from '../services/siteContent.service.js';
import { readAboutTeamImage, uploadAboutTeamImage } from '../services/aboutTeamImage.service.js';
import { validateUploadedImage } from '../utils/fileValidation.js';

export const readSiteContent = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: { content: await getSiteContent() } }); } catch (error) { return next(error); }
};

export const writeSiteContent = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: { page: await updateSiteContent(req.validatedContent) } }); } catch (error) { return next(error); }
};

export const uploadAboutTeamImageController = async (req, res, next) => {
  try {
    const { extension } = validateUploadedImage(req.file);
    return res.status(201).json({ success: true, data: await uploadAboutTeamImage({ file: req.file, extension }) });
  } catch (error) {
    return next(error);
  }
};

export const readAboutTeamImageController = async (req, res, next) => {
  try {
    const image = await readAboutTeamImage(req.params.imageId);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(image.contentType);
    return res.send(image.buffer);
  } catch (error) {
    return next(error);
  }
};