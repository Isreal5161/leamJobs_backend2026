import { z } from 'zod';

const employerContractsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['PENDING', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'ENDED', 'DISPUTED', 'CANCELLED']).optional(),
}).strict();

export const validateEmployerContractsQuery = (req, res, next) => {
  const result = employerContractsQuerySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.validatedContractQuery = result.data;
  return next();
};
