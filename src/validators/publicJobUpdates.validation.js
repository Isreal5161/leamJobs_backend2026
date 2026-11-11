import { z } from 'zod';

export const validateJobUpdatesSubscription = (req, res, next) => {
  const result = z.object({ email: z.string().trim().email('A valid email is required') }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'A valid email is required' });
  req.body = result.data;
  return next();
};

export const validateJobUpdatesConfirmation = (req, res, next) => {
  const result = z.object({ token: z.string().min(1) }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'A valid confirmation token is required' });
  req.body = result.data;
  return next();
};