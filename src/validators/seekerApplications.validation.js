import { z } from 'zod';

const createApplicationSchema = z.object({
  jobId: z.string().uuid('A valid job ID is required'),
  coverLetter: z.string().trim().max(5000, 'Cover letter must be 5000 characters or fewer').optional(),
  resumeUrl: z.string().url('Resume URL must be valid').optional(),
}).strict();

export const validateCreateApplication = (req, res, next) => {
  const result = createApplicationSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({
        field: path.join('.'),
        message,
      })),
    });
  }

  req.body = result.data;
  return next();
};
