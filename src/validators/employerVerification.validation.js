import { z } from 'zod';

const submitVerificationSchema = z.object({
  registrationNumber: z.string().trim().min(1, 'CAC, BN, or business registration number is required').max(120, 'Registration number must be 120 characters or fewer'),
  registrationType: z.enum(['CAC', 'BN', 'OTHER']).default('CAC'),
}).strict();

export const validateSubmitEmployerVerification = (req, res, next) => {
  const result = submitVerificationSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  req.body = result.data;
  return next();
};
