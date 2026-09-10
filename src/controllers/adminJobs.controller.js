import {
  approveAdminJob,
  approveOrRejectJob,
  getAdminJob,
  listAdminJobs,
  rejectAdminJob,
} from '../services/adminJobs.service.js';

const ADMIN_JOB_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'CLOSED']);
const ADMIN_DECISION_STATUSES = new Set(['APPROVED', 'REJECTED']);
const REJECTION_REASON_MAX_LENGTH = 1000;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const validateApprovalBody = (body) => {
  if (!isPlainObject(body)) {
    return { valid: false, message: 'Request body must be an object' };
  }

  if (Object.keys(body).length > 0) {
    return { valid: false, message: 'Unexpected request body fields' };
  }

  return { valid: true };
};

const validateRejectBody = (body) => {
  if (!isPlainObject(body)) {
    return { valid: false, message: 'Request body must be an object' };
  }

  const extraKeys = Object.keys(body).filter((key) => key !== 'rejectionReason');

  if (extraKeys.length > 0) {
    return { valid: false, message: 'Unexpected request body fields' };
  }

  if (typeof body.rejectionReason !== 'string' || body.rejectionReason.trim() === '') {
    return { valid: false, message: 'rejectionReason is required and must be a non-empty string' };
  }

  if (body.rejectionReason.trim().length > REJECTION_REASON_MAX_LENGTH) {
    return { valid: false, message: `rejectionReason must be ${REJECTION_REASON_MAX_LENGTH} characters or fewer` };
  }

  return { valid: true, rejectionReason: body.rejectionReason.trim() };
};

export const listJobs = async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;

    if (status && !ADMIN_JOB_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Invalid status filter' });
    }

    const data = await listAdminJobs({ status });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const job = await getAdminJob(req.params.jobId);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const approveJob = async (req, res, next) => {
  try {
    const approvalBodyValidation = validateApprovalBody(req.body ?? {});

    if (!approvalBodyValidation.valid) {
      return res.status(400).json({ message: approvalBodyValidation.message });
    }

    const job = await approveAdminJob(req.user.sub, req.params.jobId);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const rejectJob = async (req, res, next) => {
  try {
    const rejectBodyValidation = validateRejectBody(req.body ?? {});

    if (!rejectBodyValidation.valid) {
      return res.status(400).json({ message: rejectBodyValidation.message });
    }

    const job = await rejectAdminJob(req.user.sub, req.params.jobId, rejectBodyValidation.rejectionReason);
    return res.status(200).json({ success: true, data: { job } });
  } catch (error) {
    return next(error);
  }
};

export const decideJob = async (req, res, next) => {
  try {
    const { status, rejectionReason } = req.body ?? {};

    if (!ADMIN_DECISION_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
    }

    if (status === 'REJECTED' && (!rejectionReason || !String(rejectionReason).trim())) {
      return res.status(400).json({ message: 'rejectionReason is required when rejecting a job' });
    }

    const data = await approveOrRejectJob(req.user.sub, req.params.jobId, { status, rejectionReason });
    return res.status(200).json({ success: true, data: { job: data } });
  } catch (error) {
    return next(error);
  }
};
