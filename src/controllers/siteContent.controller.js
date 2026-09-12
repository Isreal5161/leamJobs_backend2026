import { getSiteContent, updateSiteContent } from '../services/siteContent.service.js';

export const readSiteContent = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: { content: await getSiteContent() } }); } catch (error) { return next(error); }
};

export const writeSiteContent = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: { page: await updateSiteContent(req.validatedContent) } }); } catch (error) { return next(error); }
};