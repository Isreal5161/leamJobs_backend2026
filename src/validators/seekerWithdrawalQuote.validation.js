import { z } from 'zod';

const quoteQuerySchema = z.object({
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Amount must be a positive decimal with no more than 2 decimal places'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code'),
  payoutAccountId: z.string().uuid('A valid payout account is required'),
}).strict();

export const validateSeekerWithdrawalQuote = (req, res, next) => {
  const result = quoteQuerySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.validatedWithdrawalQuote = { ...result.data, seekerId: req.user.sub };
  return next();
};
