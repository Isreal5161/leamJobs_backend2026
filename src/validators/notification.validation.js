import { z } from 'zod';

export const validateNotificationPagination = (req, res, next) => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional().nullable(),
  });

  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};
