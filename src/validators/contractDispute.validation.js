import { z } from 'zod';

export const validateAdminDisputeId = (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.disputeId).success) {
    return res.status(400).json({ message: 'Dispute id must be a valid UUID' });
  }
  return next();
};

export const validateDisputeSubmission = (req, res, next) => {
  const result = z.object({
    reason: z.string().trim().min(10).max(5000),
  }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateDisputeResolution = (req, res, next) => {
  const result = z.object({
    status: z.enum(['UNDER_REVIEW', 'RESOLVED_FOR_EMPLOYER', 'RESOLVED_FOR_SEEKER', 'PARTIALLY_RESOLVED']),
    resolutionNote: z.string().trim().min(1).max(5000).optional(),
  }).strict().superRefine((value, context) => {
    if (value.status !== 'UNDER_REVIEW' && !value.resolutionNote) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionNote'],
        message: 'A resolution note is required to resolve a dispute.',
      });
    }
  }).safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};
