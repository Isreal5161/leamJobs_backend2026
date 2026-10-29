import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum([
    'BLOCKED',
    'QUOTED',
    'SUBMITTED',
    'UNCERTAIN',
    'CONFIRMED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
  ]).optional(),
  currency: z.enum(['NGN', 'USD']).optional(),
  staleMinutes: z.coerce.number().int().min(1).max(43200).optional(),
}).strict();

export const validateAdminConversionOperationsQuery = (req, res, next) => {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.validatedConversionQuery = result.data;
  return next();
};
