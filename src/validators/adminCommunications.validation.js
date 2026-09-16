import { z } from 'zod';

const fields = {
  subject: z.string().trim().min(1).max(180),
  heading: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(5000),
  ctaLabel: z.string().trim().max(80).nullable().optional(),
  ctaUrl: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
};
const templateKey = z.enum(['WELCOME_SEEKER', 'WELCOME_EMPLOYER']);
const segment = z.enum(['ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS']);
const campaignRecordsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const validateTemplateKey = (req, res, next) => {
  const result = templateKey.safeParse(req.params.key);
  if (!result.success) return res.status(400).json({ message: 'Invalid template key' });
  req.params.key = result.data;
  return next();
};
export const validateTemplateUpdate = (req, res, next) => {
  const result = z.object(fields).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedCommunication = result.data;
  return next();
};
export const validateCampaignCreate = (req, res, next) => {
  const result = z.object({ ...fields, segment }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedCommunication = result.data;
  return next();
};

export const validateCampaignUpdate = (req, res, next) => {
  const result = z.object({ ...fields, segment }).partial().strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedCommunication = result.data;
  return next();
};

export const validateCampaignRecipientQuery = (req, res, next) => {
  const result = z.object({ segment }).strict().safeParse(req.query ?? {});
  if (!result.success) return res.status(400).json({ message: 'A valid recipient segment is required' });
  req.validatedSegment = result.data.segment;
  return next();
};

export const validateCampaignRecordsQuery = (req, res, next) => {
  const result = campaignRecordsQuery.safeParse(req.query);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedQuery = result.data;
  return next();
};