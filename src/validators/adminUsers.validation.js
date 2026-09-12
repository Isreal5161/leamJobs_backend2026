import { z } from 'zod';

const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: z.enum(['SEEKER', 'EMPLOYER', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'VERIFIED', 'UNVERIFIED', 'ALL']).default('ALL'),
  sortBy: z.enum(['createdAt', 'lastLogin', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict();

export const validateAdminUsersQuery = (req, res, next) => {
  const result = adminUsersQuerySchema.safeParse(req.query);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.validatedQuery = result.data;
  return next();
};