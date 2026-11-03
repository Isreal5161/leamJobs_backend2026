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
const purpose = z.enum(['ESSENTIAL_ANNOUNCEMENT', 'PROMOTIONAL_MARKETING']);
const segment = z.enum(['ALL_REGISTERED_USERS', 'ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS']);
const purposeSegments = {
  ESSENTIAL_ANNOUNCEMENT: ['ALL_REGISTERED_USERS', 'SEEKERS', 'EMPLOYERS'],
  PROMOTIONAL_MARKETING: ['ALL_MARKETING_USERS', 'SEEKERS', 'EMPLOYERS', 'PUBLIC_JOB_SUBSCRIBERS'],
};
const isCompatiblePurposeSegment = ({ purpose: selectedPurpose, segment: selectedSegment }) => (
  purposeSegments[selectedPurpose]?.includes(selectedSegment) ?? false
);
const campaignRecordsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const campaignDeliveriesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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
  const result = z.object({
    ...fields,
    purpose,
    segment,
    operationalContentConfirmed: z.boolean(),
  }).strict().refine(isCompatiblePurposeSegment, { message: 'Recipient segment is not valid for this communication purpose' })
    .refine((value) => value.purpose !== 'ESSENTIAL_ANNOUNCEMENT' || value.operationalContentConfirmed, { message: 'Essential announcements require operational-content confirmation' })
    .refine((value) => value.purpose !== 'PROMOTIONAL_MARKETING' || !value.operationalContentConfirmed, { message: 'Operational-content confirmation is only valid for essential announcements' })
    .safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedCommunication = result.data;
  return next();
};

export const validateCampaignUpdate = (req, res, next) => {
  const result = z.object({
    ...fields,
    purpose,
    segment,
    operationalContentConfirmed: z.boolean(),
  }).partial().strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedCommunication = result.data;
  return next();
};

export const validateCampaignRecipientQuery = (req, res, next) => {
  const result = z.object({ purpose, segment }).strict()
    .refine(isCompatiblePurposeSegment, { message: 'Recipient segment is not valid for this communication purpose' })
    .safeParse(req.query ?? {});
  if (!result.success) return res.status(400).json({ message: 'A valid recipient segment is required' });
  req.validatedPurpose = result.data.purpose;
  req.validatedSegment = result.data.segment;
  return next();
};

export const validateCampaignRecordsQuery = (req, res, next) => {
  const result = campaignRecordsQuery.safeParse(req.query);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedQuery = result.data;
  return next();
};

export const validateCampaignDeliveriesQuery = (req, res, next) => {
  const result = campaignDeliveriesQuery.safeParse(req.query);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedQuery = result.data;
  return next();
};