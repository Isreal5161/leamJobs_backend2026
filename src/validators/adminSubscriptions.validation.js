import { z } from 'zod';

const dateQuery = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format').optional();
const planKey = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,49}$/, 'Plan key must use uppercase letters, numbers, and underscores');
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code');
const benefits = z.array(z.string().trim().min(1).max(300)).max(50);
const entitlementKeys = z.array(z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,80}$/)).max(50);

const planFields = {
  key: planKey,
  displayName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.coerce.number().finite().min(0).nullable().optional(),
  currency: currency.nullable().optional(),
  billingInterval: z.enum(['MONTHLY']),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).max(100000),
  benefits,
  entitlementKeys,
};

export const validateAdminSubscriptionPlanCreate = (req, res, next) => {
  const result = z.object(planFields).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  req.validatedPlan = result.data;
  return next();
};

export const validateAdminSubscriptionPlanUpdate = (req, res, next) => {
  const result = z.object(planFields).partial().strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  req.validatedPlan = result.data;
  return next();
};

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'FAILED']).optional(),
  plan: planKey.optional(),
  currency: currency.optional(),
  from: dateQuery,
  to: dateQuery,
  search: z.string().trim().max(120).optional(),
}).strict();

const toDateRange = ({ from, to }) => {
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
  const toDate = to ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000) : undefined;
  if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate >= toDate)) throw new Error('from must be before to');
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > 366 * 86400000) throw new Error('Date range cannot exceed 366 days');
  return { ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}) };
};

export const validateAdminSubscriptionsQuery = (req, res, next) => {
  const result = listQuery.safeParse(req.query);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  try {
    const { from, to, ...filters } = result.data;
    req.validatedQuery = { ...filters, ...toDateRange({ from, to }) };
    return next();
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

export const validateAdminSubscriptionId = (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: 'Subscription id must be a valid UUID' });
  return next();
};
