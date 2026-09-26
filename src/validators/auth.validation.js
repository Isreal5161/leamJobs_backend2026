import { z } from 'zod';

const publicRegistrationRoleSchema = z.enum(['SEEKER', 'EMPLOYER'], {
  required_error: 'Role is required',
  invalid_type_error: 'Role must be SEEKER or EMPLOYER',
});

const registrationSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().email('A valid email is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
  phone: z.string().trim().min(1, 'Phone must not be empty').optional(),
  role: publicRegistrationRoleSchema,
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
  role: z.enum(['SEEKER', 'EMPLOYER']).optional(),
}).strict();

const verifyEmailSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  code: z.string().trim().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
}).strict();

const resendEmailVerificationSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
}).strict();

const googleStartSchema = z.object({
  role: z.enum(['SEEKER', 'EMPLOYER']).default('SEEKER'),
}).strict();

const googleCompleteSchema = z.object({
  pendingId: z.string().trim().min(1, 'Pending registration is required'),
  continuationToken: z.string().trim().min(1, 'Google registration session is required'),
  email: z.string().trim().email('A valid email is required'),
  companyName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
}).strict();

export const validateRegistration = (req, res, next) => {
  const result = registrationSchema.safeParse(req.body);

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

export const validateLogin = (req, res, next) => {
  const result = loginSchema.safeParse(req.body);

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

export const validateVerifyEmail = (req, res, next) => {
  const result = verifyEmailSchema.safeParse(req.body);

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

export const validateResendEmailVerification = (req, res, next) => {
  const result = resendEmailVerificationSchema.safeParse(req.body);

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

export const validateGoogleStart = (req, res, next) => {
  const result = googleStartSchema.safeParse({
    role: req.query?.role ?? 'SEEKER',
  });

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({
        field: path.join('.'),
        message,
      })),
    });
  }

  req.query.role = result.data.role;
  return next();
};

export const validateGoogleComplete = (req, res, next) => {
  const result = googleCompleteSchema.safeParse(req.body);

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
