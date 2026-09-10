import { z } from 'zod';

const applicationStatusSchema = z.object({
  status: z.enum(['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'REJECTED', 'ACCEPTED', 'WITHDRAWN']),
}).strict();

export const validateEmployerApplicationStatus = (req, res, next) => {
  const result = applicationStatusSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.body = result.data;
  return next();
};
