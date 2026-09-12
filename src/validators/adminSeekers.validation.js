import { z } from 'zod';

const adminSeekersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  verification: z.enum(['VERIFIED', 'UNVERIFIED']).optional(),
  location: z.string().trim().max(100).optional(),
  sortBy: z.enum(['createdAt', 'lastLogin', 'applicationCount', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict();

export const validateAdminSeekersQuery = (req, res, next) => {
  const result = adminSeekersQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};