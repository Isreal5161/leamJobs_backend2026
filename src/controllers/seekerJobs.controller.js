import { findApprovedJob, listApprovedJobs } from '../services/seekerJobs.service.js';

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
