import { z } from 'zod';

const progressStatuses = ['IN_PROGRESS', 'BLOCKED', 'WAITING', 'SUBMITTED_FOR_REVIEW', 'REVISION_IN_PROGRESS'];

export const validateContractProgress = (req, res, next) => {
  const result = z.object({
    description: z.string().trim().min(1).max(5000),
    status: z.enum(progressStatuses),
  }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateContractSubmission = (req, res, next) => {
  let links = req.body?.links ?? [];
  if (typeof links === 'string') {
    try {
      links = JSON.parse(links);
    } catch {
      return res.status(400).json({ message: 'Deliverable links must be a JSON array' });
    }
  }
  const result = z.object({
    description: z.string().trim().max(5000).optional().default(''),
    links: z.array(z.string().trim().min(1).max(2048)).max(10).optional().default([]),
  }).strict().safeParse({ ...req.body, links });
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateContractSubmissionReview = (req, res, next) => {
  const result = z.object({
    action: z.enum(['REQUEST_REVISION', 'FEEDBACK', 'APPROVE']),
    description: z.string().trim().max(5000).optional().default(''),
  }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  if (result.data.action !== 'APPROVE' && !result.data.description) {
    return res.status(400).json({ message: 'Feedback is required for this review action' });
  }
  req.body = result.data;
  return next();
};

export const validateContractActivityId = (req, res, next) => {
  const uuid = z.string().uuid();
  if (!uuid.safeParse(req.params.activityId).success
    || (req.params.attachmentId && !uuid.safeParse(req.params.attachmentId).success)) {
    return res.status(400).json({ message: 'Activity and attachment ids must be valid UUIDs' });
  }
  return next();
};
