import { findApprovedJob, listApprovedJobs } from '../services/seekerJobs.service.js';
import { getPublicJobSitemapXml } from '../services/publicJobSitemap.service.js';

export const getPublicJobSitemap = async (req, res, next) => {
  try {
    const xml = await getPublicJobSitemapXml();
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600');
    res.type('application/xml');
    return res.status(200).send(xml);
  } catch (error) {
    return next(error);
  }
};

export const listJobs = async (req, res, next) => {
  try {
    const data = await listApprovedJobs(req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const data = await findApprovedJob(req.params.jobId, req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getPublicJob = async (req, res, next) => {
  try {
    const data = await findApprovedJob(req.params.jobId, null);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
