import { z } from 'zod';

const adminAccountIdSchema = z.object({
  userId: z.string().uuid(),
}).strict();

export const validateAdminAccountId = (req, res, next) => {
  const result = adminAccountIdSchema.safeParse(req.params);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.params = result.data;
  return next();
};
