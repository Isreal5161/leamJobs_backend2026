import { z } from 'zod';

const publicCompanyParamsSchema = z.object({
  employerId: z.string().uuid(),
}).strict();

const publicCompanyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(24).default(12),
}).strict();

export const validatePublicCompanyParams = (req, res, next) => {
  const result = publicCompanyParamsSchema.safeParse(req.params);

  if (!result.success) {
    return res.status(400).json({
      message: 'Invalid company identifier',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedParams = result.data;
  return next();
};

export const validatePublicCompanyQuery = (req, res, next) => {
  const result = publicCompanyQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};