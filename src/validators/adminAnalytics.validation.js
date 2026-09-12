import { z } from 'zod';

const dateQuery = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format').optional();

const querySchema = z.object({
  from: dateQuery,
  to: dateQuery,
  granularity: z.enum(['day', 'week', 'month']).optional(),
}).strict();

const startOfUtcDay = (value) => new Date(`${value}T00:00:00.000Z`);

export const validateAdminAnalyticsQuery = (req, res, next) => {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  const now = new Date();
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const defaultFrom = new Date(defaultTo.getTime() - (30 * 24 * 60 * 60 * 1000));
  const from = result.data.from ? startOfUtcDay(result.data.from) : defaultFrom;
  const to = result.data.to ? new Date(startOfUtcDay(result.data.to).getTime() + (24 * 60 * 60 * 1000)) : defaultTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return res.status(400).json({ message: 'from must be before to' });
  }

  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ message: 'Date range cannot exceed 366 days' });
  }

  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  const granularity = result.data.granularity ?? (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');
  req.validatedQuery = { from, to, granularity };
  return next();
};