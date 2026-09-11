import { z } from 'zod';

const idempotencyKey = z.string().trim().min(1).max(100).optional();

export const validateContractPayment = (req, res, next) => {
  const result = z.object({ idempotencyKey }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateContractPaymentVerification = (req, res, next) => {
  const result = z.object({
    providerReference: z.string().trim().min(1).optional(),
    transactionId: z.union([z.string().trim().min(1), z.number().int().positive()]),
  }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateCompletionSubmission = (req, res, next) => {
  const result = z.object({ completionNote: z.string().trim().max(5000).optional() }).strict().safeParse(req.body ?? {});
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};