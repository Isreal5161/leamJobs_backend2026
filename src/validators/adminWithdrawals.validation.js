import { z } from 'zod';

const dateQuery = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format').optional();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REVERSED', 'CANCELLED']).optional(),
  provider: z.enum(['FLUTTERWAVE', 'PAYSTACK']).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code').optional(),
  from: dateQuery,
  to: dateQuery,
  search: z.string().trim().max(120).optional(),
  seeker: z.string().trim().max(120).optional(),
}).strict();

const startOfUtcDay = (value) => new Date(`${value}T00:00:00.000Z`);

export const validateAdminWithdrawalsQuery = (req, res, next) => {
  const result = querySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  const { from, to, ...filters } = result.data;
  const fromDate = from ? startOfUtcDay(from) : undefined;
  const toDate = to ? new Date(startOfUtcDay(to).getTime() + (24 * 60 * 60 * 1000)) : undefined;
  if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate >= toDate)) {
    return res.status(400).json({ message: 'from must be before to' });
  }
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ message: 'Date range cannot exceed 366 days' });
  }

  req.validatedQuery = { ...filters, ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}) };
  return next();
};

export const validateAdminWithdrawalId = (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    return res.status(400).json({ message: 'Withdrawal id must be a valid UUID' });
  }
  return next();
};
