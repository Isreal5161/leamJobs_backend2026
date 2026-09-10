import {
  closeEmployerJob,
  createEmployerJob,
  getEmployerJob,
  listEmployerJobs,
  updateEmployerJob,
} from '../services/employerJobs.service.js';

export const listJobs = async (req, res, next) => {
  try {
    const data = await listEmployerJobs(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const createJob = async (req, res, next) => {
  try {
    const job = await createEmployerJob(req.user.sub, req.validatedJob);
    return res.status(201).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const job = await getEmployerJob(req.user.sub, req.params.jobId);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const updateJob = async (req, res, next) => {
  try {
    const job = await updateEmployerJob(req.user.sub, req.params.jobId, req.validatedJob);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const closeJob = async (req, res, next) => {
  try {
    const job = await closeEmployerJob(req.user.sub, req.params.jobId);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};
