import { z } from 'zod';

const nullableText = (label, max) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).nullable().optional(),
);
const nullableUrl = (label) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().url(`${label} must be a valid URL`).max(500, `${label} must be 500 characters or fewer`).nullable().optional(),
);

const submitVerificationSchema = z.object({
  registrationNumber: z.string().trim().min(1, 'CAC, BN, or business registration number is required').max(120, 'Registration number must be 120 characters or fewer'),
  registrationType: z.enum(['CAC', 'BN', 'OTHER']).default('CAC'),
  company: z.object({
    companyName: z.string().trim().min(1, 'Company name is required').max(160, 'Company name must be 160 characters or fewer'),
    companyDescription: nullableText('Company description', 5000),
    website: nullableUrl('Website'),
    industry: nullableText('Industry', 120),
    companySize: nullableText('Company size', 100),
    phoneNumber: nullableText('Phone number', 40),
    location: nullableText('Location', 160),
    address: nullableText('Company address', 240),
    state: nullableText('State', 120),
    country: nullableText('Country', 120),
    linkedinUrl: nullableUrl('LinkedIn URL'),
    twitterUrl: nullableUrl('X/Twitter URL'),
    facebookUrl: nullableUrl('Facebook URL'),
  }).strict(),
}).strict();

export const validateSubmitEmployerVerification = (req, res, next) => {
  const result = submitVerificationSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.body = result.data;
  return next();
};
