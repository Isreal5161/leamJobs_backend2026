import { z } from 'zod';

const createInvitationSchema = z.object({
  seekerId: z.string().uuid(),
  jobId: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
}).strict();

export const validateCreateJobInvitation = (req, res, next) => {
  const result = createInvitationSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};

export const validateInvitationResponse = (req, res, next) => {
  const result = z.object({ response: z.enum(['ACCEPTED', 'DECLINED']) }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.body = result.data;
  return next();
};
