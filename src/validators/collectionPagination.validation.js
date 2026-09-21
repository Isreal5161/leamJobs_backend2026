import { z } from 'zod';

export const createPageLimitValidator = ({ defaultLimit = 20, maxLimit = 50 } = {}) => (req, res, next) => {
  const result = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  }).safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedPagination = result.data;
  return next();
};
