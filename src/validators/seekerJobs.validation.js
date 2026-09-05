import { z } from 'zod';

const jobTypeSchema = z.enum(['NORMAL_EMPLOYMENT', 'FREELANCE_PROJECT']);

const seekerJobsQuerySchema = z.object({
  search: z.string().trim().max(100, 'Search must be 100 characters or fewer').optional(),
  location: z.string().trim().max(100, 'Location must be 100 characters or fewer').optional(),
  jobType: jobTypeSchema.optional(),
  skills: z.string().trim().max(500, 'Skills filter is too long').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
}).strict();

export const validateSeekerJobsQuery = (req, res, next) => {
  const result = seekerJobsQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = {
    ...result.data,
    skills: result.data.skills
      ? [...new Set(result.data.skills.split(',').map((skill) => skill.trim()).filter(Boolean))]
      : undefined,
  };
  return next();
};
