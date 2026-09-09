import { z } from 'zod';
import { PAYOUT_COUNTRIES, isNigeria } from '../config/payoutCountries.js';

// Country/currency/payout method are always re-derived server-side from `country` in the
// service layer - this schema only shapes and sanity-checks what the client is allowed to submit.
const detailsSchema = z.object({
  country: z.enum(PAYOUT_COUNTRIES, { errorMap: () => ({ message: 'This country is not currently supported for payouts.' }) }),
  accountHolderName: z.string().trim().min(2, 'Account holder name is required').max(200, 'Account holder name is too long'),
  bankName: z.string().trim().min(2, 'Bank name is required').max(150, 'Bank name is too long').optional(),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits').optional(),
  payoutIdentifier: z.string().trim().min(4, 'Payout details are required').max(200, 'Payout details are too long').optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code').optional(),
  isDefault: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
  if (isNigeria(data.country)) {
    if (!data.bankName) ctx.addIssue({ path: ['bankName'], code: z.ZodIssueCode.custom, message: 'Bank name is required' });
    if (!data.accountNumber) ctx.addIssue({ path: ['accountNumber'], code: z.ZodIssueCode.custom, message: 'Account number is required' });
    if (data.payoutIdentifier) ctx.addIssue({ path: ['payoutIdentifier'], code: z.ZodIssueCode.custom, message: 'payoutIdentifier is only used for non-Nigeria payout methods' });
    // currency is intentionally not validated here - Nigeria always resolves to NGN server-side, so any client-supplied value is ignored rather than trusted.
  } else {
    if (!data.payoutIdentifier) ctx.addIssue({ path: ['payoutIdentifier'], code: z.ZodIssueCode.custom, message: 'Payout details are required' });
    if (!data.currency) ctx.addIssue({ path: ['currency'], code: z.ZodIssueCode.custom, message: 'Currency is required' });
    if (data.bankName || data.accountNumber) ctx.addIssue({ path: ['bankName'], code: z.ZodIssueCode.custom, message: 'Bank fields are only used for Nigeria bank accounts' });
  }
});

const defaultOnlySchema = z.object({ isDefault: z.boolean() }).strict();

const formatIssues = (error) => error.issues.map(({ path, message }) => ({ field: path.join('.'), message }));

export const validateCreatePayoutAccount = (req, res, next) => {
  const result = detailsSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: formatIssues(result.error) });
  }

  req.validatedPayoutAccount = result.data;
  return next();
};

export const validateUpdatePayoutAccount = (req, res, next) => {
  const defaultOnlyResult = defaultOnlySchema.safeParse(req.body);

  if (defaultOnlyResult.success) {
    req.validatedPayoutAccount = defaultOnlyResult.data;
    return next();
  }

  const result = detailsSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: formatIssues(result.error) });
  }

  req.validatedPayoutAccount = result.data;
  return next();
};
