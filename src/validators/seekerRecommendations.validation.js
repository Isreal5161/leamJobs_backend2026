import { z } from 'zod';

const recommendationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
}).strict();

export const validateSeekerRecommendationsQuery = (req, res, next) => {
  const result = recommendationQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};
