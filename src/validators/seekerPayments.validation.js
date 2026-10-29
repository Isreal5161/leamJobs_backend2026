import { z } from 'zod';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
  currency: z.enum(['NGN', 'USD']).default('NGN'),
}).strict();

export const validateSeekerPaymentPagination = (req, res, next) => {
  const result = paginationSchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};
