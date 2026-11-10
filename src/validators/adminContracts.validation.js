import { z } from 'zod';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'ENDED', 'DISPUTED', 'CANCELLED']).optional(),
  escrowStatus: z.enum(['UNFUNDED', 'FUNDING', 'FUNDED', 'RELEASE_ELIGIBLE', 'RELEASED', 'DISPUTED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED']).optional(),
  workStatus: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETION_SUBMITTED', 'COMPLETED', 'DISPUTED', 'RELEASE_ELIGIBLE', 'RELEASED', 'REFUNDED', 'CANCELLED']).optional(),
}).strict();

export const validateAdminContractsQuery = (req, res, next) => {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.validatedAdminContractsQuery = result.data;
  return next();
};
