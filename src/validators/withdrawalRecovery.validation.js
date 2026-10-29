import { z } from 'zod';

const transferIdSchema = z.string().trim().regex(/^\d{1,32}$/, 'A valid Flutterwave transfer ID is required');

export const validateFlutterwaveWithdrawalRecovery = (req, res, next) => {
  const result = transferIdSchema.safeParse(req.body?.transferId);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: [{ field: 'transferId', message: result.error.issues[0]?.message ?? 'A valid transfer ID is required' }],
    });
  }
  req.validatedTransferId = result.data;
  return next();
};
