import {
  cancelInterview,
  createInterview,
  getInterviewForUser,
  listEmployerInterviews,
  listSeekerInterviews,
  updateInterview,
} from '../services/interviews.service.js';

export const createEmployerInterview = async (req, res, next) => {
  try {
    const interview = await createInterview(req.user.sub, req.params.jobId, req.params.applicationId, req.body);
    return res.status(201).json({ success: true, data: { interview } });
  } catch (error) {
    return next(error);
  }
};

export const listEmployerInterviewsController = async (req, res, next) => {
  try {
    const data = await listEmployerInterviews(req.user.sub, req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getEmployerInterview = async (req, res, next) => {
  try {
    const interview = await getInterviewForUser(req.user.sub, 'EMPLOYER', req.params.interviewId);
    return res.status(200).json({ success: true, data: { interview } });
  } catch (error) {
    return next(error);
  }
};

export const updateEmployerInterview = async (req, res, next) => {
  try {
    const interview = await updateInterview(req.user.sub, req.params.interviewId, req.body);
    return res.status(200).json({ success: true, data: { interview } });
  } catch (error) {
    return next(error);
  }
};

export const cancelEmployerInterview = async (req, res, next) => {
  try {
    const interview = await cancelInterview(req.user.sub, req.params.interviewId, req.body.reason);
    return res.status(200).json({ success: true, data: { interview } });
  } catch (error) {
    return next(error);
  }
};

export const listSeekerInterviewsController = async (req, res, next) => {
  try {
    const data = await listSeekerInterviews(req.user.sub, req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getSeekerInterview = async (req, res, next) => {
  try {
    const interview = await getInterviewForUser(req.user.sub, 'SEEKER', req.params.interviewId);
    return res.status(200).json({ success: true, data: { interview } });
  } catch (error) {
    return next(error);
  }
};
