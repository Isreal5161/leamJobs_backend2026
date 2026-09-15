import { z } from 'zod';

export const validateEmailPreferenceUpdate = (req, res, next) => {
  const result = z.object({ marketingEmailsEnabled: z.boolean() }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'marketingEmailsEnabled must be a boolean' });
  req.body = result.data;
  return next();
};
