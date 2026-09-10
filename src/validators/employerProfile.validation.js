import { z } from 'zod';

const nullableText = (label, max) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).nullable().optional(),
);

const employerProfileSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(160, 'Company name must be 160 characters or fewer').optional(),
  companyDescription: nullableText('Company description', 5000),
  website: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().url('Website must be a valid URL').max(500, 'Website must be 500 characters or fewer').nullable().optional(),
  ),
  industry: nullableText('Industry', 120),
  companySize: nullableText('Company size', 100),
  location: nullableText('Location', 160),
}).strict();

export const validateEmployerProfileUpdate = (req, res, next) => {
  const result = employerProfileSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.body = result.data;
  return next();
};
