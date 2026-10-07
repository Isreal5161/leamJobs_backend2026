import { z } from 'zod';

const percentage = z.union([
  z.number().finite().transform(String),
  z.string().trim(),
]).pipe(
  z.string().regex(/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/, 'Percentage must be between 0 and 100 with at most 2 decimal places'),
);

export const validatePlatformFeeUpdate = (req, res, next) => {
  const result = z.object({
    percentage: percentage.optional(),
    withdrawalPercentage: percentage.optional(),
  }).strict().refine((value) => value.percentage !== undefined || value.withdrawalPercentage !== undefined).safeParse(req.body ?? {});
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  req.validatedPlatformFee = result.data;
  return next();
};
