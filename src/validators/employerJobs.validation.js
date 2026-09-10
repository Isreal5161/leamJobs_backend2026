import { z } from 'zod';

const listSchema = (label, max = 30) => z.array(
  z.string().trim().min(1, `${label} cannot contain empty items`).max(200, `${label} items must be 200 characters or fewer`),
).max(max, `${label} cannot contain more than ${max} items`).default([]);

const amountSchema = z.coerce.number().finite().positive('Amount must be greater than zero').max(999999999999, 'Amount is too large');
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code').transform((value) => value.toUpperCase());

const jobSchema = z.object({
  title: z.string().trim().min(1, 'Job title is required').max(160, 'Job title must be 160 characters or fewer'),
  description: z.string().trim().min(1, 'Job overview is required').max(10000, 'Job overview must be 10000 characters or fewer'),
  location: z.string().trim().min(1, 'Location is required').max(160, 'Location must be 160 characters or fewer'),
  department: z.string().trim().max(100, 'Department must be 100 characters or fewer').optional().nullable(),
  workArrangement: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).nullable().optional(),
  engagementType: z.enum(['MONTHLY', 'CONTRACT', 'FREELANCE']),
  jobType: z.enum(['NORMAL_EMPLOYMENT', 'FREELANCE_PROJECT']),
  requirements: listSchema('Requirements'),
  responsibilities: listSchema('Responsibilities'),
  skills: listSchema('Skills'),
  benefits: listSchema('Benefits'),
  applicationDeadline: z.coerce.date().nullable().optional(),
  monthlyCompensation: z.object({
    salaryMin: amountSchema.nullable().optional(),
    salaryMax: amountSchema.nullable().optional(),
    currency: currencySchema.default('NGN'),
  }).nullable().optional(),
  contractCompensation: z.object({
    amount: amountSchema,
    currency: currencySchema.default('NGN'),
    duration: z.string().trim().min(1, 'Contract duration is required').max(100, 'Contract duration must be 100 characters or fewer'),
  }).nullable().optional(),
  freelanceCompensation: z.object({
    projectAmount: amountSchema,
    currency: currencySchema.default('NGN'),
  }).nullable().optional(),
}).strict().superRefine((data, context) => {
  if (data.engagementType === 'FREELANCE' && data.jobType !== 'FREELANCE_PROJECT') {
    context.addIssue({ code: 'custom', path: ['jobType'], message: 'Freelance jobs must use FREELANCE_PROJECT' });
  }

  if (data.engagementType !== 'FREELANCE' && data.jobType !== 'NORMAL_EMPLOYMENT') {
    context.addIssue({ code: 'custom', path: ['jobType'], message: 'Monthly and contract jobs must use NORMAL_EMPLOYMENT' });
  }

  if (data.engagementType === 'MONTHLY') {
    if (data.contractCompensation || data.freelanceCompensation) {
      context.addIssue({ code: 'custom', path: ['engagementType'], message: 'Monthly jobs cannot include contract or freelance compensation' });
    }
    if (!data.monthlyCompensation) {
      context.addIssue({ code: 'custom', path: ['monthlyCompensation'], message: 'Monthly compensation is required' });
    } else if (!data.monthlyCompensation.salaryMin && !data.monthlyCompensation.salaryMax) {
      context.addIssue({ code: 'custom', path: ['monthlyCompensation'], message: 'At least one monthly salary value is required' });
    } else if (data.monthlyCompensation.salaryMin && data.monthlyCompensation.salaryMax
      && data.monthlyCompensation.salaryMin > data.monthlyCompensation.salaryMax) {
      context.addIssue({ code: 'custom', path: ['monthlyCompensation'], message: 'Minimum salary cannot exceed maximum salary' });
    }
  }

  if (data.engagementType === 'CONTRACT' && !data.contractCompensation) {
    context.addIssue({ code: 'custom', path: ['contractCompensation'], message: 'Contract compensation is required' });
  }

  if (data.engagementType === 'CONTRACT' && (data.monthlyCompensation || data.freelanceCompensation)) {
    context.addIssue({ code: 'custom', path: ['engagementType'], message: 'Contract jobs cannot include monthly or freelance compensation' });
  }

  if (data.engagementType === 'FREELANCE' && !data.freelanceCompensation) {
    context.addIssue({ code: 'custom', path: ['freelanceCompensation'], message: 'Freelance compensation is required' });
  }

  if (data.engagementType === 'FREELANCE' && (data.monthlyCompensation || data.contractCompensation)) {
    context.addIssue({ code: 'custom', path: ['engagementType'], message: 'Freelance jobs cannot include monthly or contract compensation' });
  }
});

export const validateCreateEmployerJob = (req, res, next) => {
  const result = jobSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedJob = result.data;
  return next();
};

export const validateUpdateEmployerJob = validateCreateEmployerJob;
