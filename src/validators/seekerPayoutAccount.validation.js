import { z } from 'zod';

const nigeriaPayoutSchema = z.object({
  country: z.literal('Nigeria'),
  bankCode: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Bank code is invalid'),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits'),
  isDefault: z.boolean().optional(),
}).strict();

const detailsSchema = nigeriaPayoutSchema;

const defaultOnlySchema = z.object({ isDefault: z.boolean() }).strict();

const formatIssues = (error) => error.issues.map(({ path, message }) => ({ field: path.join('.'), message }));

export const validateCreatePayoutAccount = (req, res, next) => {
  const result = detailsSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: formatIssues(result.error) });
  }

  req.validatedPayoutAccount = result.data;
  return next();
};

export const validateUpdatePayoutAccount = (req, res, next) => {
  const defaultOnlyResult = defaultOnlySchema.safeParse(req.body);

  if (defaultOnlyResult.success) {
    req.validatedPayoutAccount = defaultOnlyResult.data;
    return next();
  }

  const result = detailsSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: formatIssues(result.error) });
  }

  req.validatedPayoutAccount = result.data;
  return next();
};
