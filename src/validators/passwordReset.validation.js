import { z } from 'zod';

const emailSchema = z.object({ email: z.string().trim().email('A valid email is required') }).strict();
const resetSchema = z.object({ token: z.string().min(32).max(256), password: z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character') }).strict();

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.body = result.data;
  return next();
};

export const validateForgotPassword = validate(emailSchema);
export const validateResetPassword = validate(resetSchema);
