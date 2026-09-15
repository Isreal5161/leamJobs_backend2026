import { z } from 'zod';

export const validateSeekerSubscriptionCheckout = (req, res, next) => {
  const result = z.object({
    planId: z.string().trim().uuid(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
  }).passthrough().safeParse(req.body ?? {});

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  }

  req.validatedBody = result.data;
  return next();
};

export const validateSeekerSubscriptionVerification = (req, res, next) => {
  const result = z.object({
    providerReference: z.string().trim().min(1).optional(),
    transactionId: z.union([z.string().trim().min(1), z.number().int().positive()]).optional(),
  }).passthrough().refine((value) => Boolean(value.providerReference || value.transactionId), {
    message: 'providerReference or transactionId is required',
    path: ['providerReference'],
  }).safeParse(req.body ?? {});

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  }

  req.validatedBody = {
    providerReference: result.data.providerReference,
    transactionId: result.data.transactionId ? String(result.data.transactionId) : undefined,
  };
  return next();
};
