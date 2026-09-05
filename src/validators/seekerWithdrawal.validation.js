import { z } from 'zod';

const withdrawalBodySchema = z.object({
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Amount must be a positive decimal with no more than 2 decimal places'),
  currency: z.string().trim().toUpperCase().length(3, 'Currency must be a 3-letter code'),
  payoutAccountId: z.string().uuid('A valid payout account is required'),
}).strict();

export const validateSeekerWithdrawal = (req, res, next) => {
  const bodyResult = withdrawalBodySchema.safeParse(req.body);
  const idempotencyKey = req.get('Idempotency-Key')?.trim();

  if (!bodyResult.success || !idempotencyKey || idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    const errors = bodyResult.success ? [] : bodyResult.error.issues.map(({ path, message }) => ({ field: path.join('.'), message }));
    if (!idempotencyKey) errors.push({ field: 'Idempotency-Key', message: 'Idempotency-Key header is required' });
    else if (idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) errors.push({ field: 'Idempotency-Key', message: 'Idempotency-Key header is invalid' });

    return res.status(400).json({ message: 'Validation failed', errors });
  }

  req.validatedWithdrawal = { ...bodyResult.data, idempotencyKey };
  return next();
};
