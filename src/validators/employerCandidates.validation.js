import { z } from 'zod';

const employerCandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_-]+$/).optional(),
  search: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
  skill: z.string().trim().max(100).optional(),
}).strict();

export const validateEmployerCandidatesQuery = (req, res, next) => {
  const result = employerCandidatesQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};