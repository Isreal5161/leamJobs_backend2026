import { z } from 'zod';

const nigeriaNgnPayoutSchema = z.object({
  country: z.literal('Nigeria'),
  bankCode: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Bank code is invalid'),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits'),
  isDefault: z.boolean().optional(),
}).strict();

const usUsdPayoutSchema = z.object({
  country: z.literal('United States'),
  currency: z.literal('USD'),
  accountNumber: z.string().trim().regex(/^\d{4,17}$/, 'US account number must be 4-17 digits'),
  routingNumber: z.string().trim().regex(/^\d{9}$/, 'US routing number must be 9 digits'),
  swiftCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/, 'SWIFT/BIC code must be 8 or 11 characters'),
  bankName: z.string().trim().min(2).max(120),
  accountType: z.enum(['checking', 'depository']),
  beneficiaryName: z.string().trim().min(2).max(160),
  beneficiaryAddress: z.string().trim().min(5).max(255),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, 'US postal code must be ZIP or ZIP+4'),
  streetNumber: z.string().trim().min(1).max(32),
  streetName: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).optional(),
  mobileNumber: z.string().trim().min(7).max(32).optional(),
  isDefault: z.boolean().optional(),
}).strict().refine(({ routingNumber }) => {
  const weights = [3, 7, 1];
  return Array.from(routingNumber, Number).reduce((sum, digit, index) => (
    sum + digit * weights[index % weights.length]
  ), 0) % 10 === 0;
}, { path: ['routingNumber'], message: 'US routing number checksum is invalid' });

const nigeriaUsdDomiciliaryPayoutSchema = z.object({
  country: z.literal('Nigeria'),
  currency: z.literal('USD'),
  bankCode: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Bank code is invalid'),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits'),
  beneficiaryFirstName: z.string().trim().min(1).max(80),
  beneficiaryLastName: z.string().trim().min(1).max(80),
  beneficiaryEmail: z.string().trim().email().max(254),
  beneficiaryMobileNumber: z.string().trim().min(7).max(32),
  beneficiaryAddress: z.string().trim().min(5).max(255),
  beneficiaryOccupation: z.string().trim().min(2).max(100),
  isDefault: z.boolean().optional(),
}).strict();

const detailsSchema = z.union([
  nigeriaNgnPayoutSchema,
  usUsdPayoutSchema,
  nigeriaUsdDomiciliaryPayoutSchema,
]);

const defaultOnlySchema = z.object({ isDefault: z.boolean() }).strict();
const getDetailsSchema = (body) => {
  if (body?.country === 'United States') return usUsdPayoutSchema;
  if (body?.country === 'Nigeria' && body?.currency === 'USD') return nigeriaUsdDomiciliaryPayoutSchema;
  if (body?.country === 'Nigeria') return nigeriaNgnPayoutSchema;
  return detailsSchema;
};

const formatIssues = (error) => error.issues.map(({ path, message }) => ({ field: path.join('.'), message }));

export const validateCreatePayoutAccount = (req, res, next) => {
  const result = getDetailsSchema(req.body).safeParse(req.body);

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

  const result = getDetailsSchema(req.body).safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({ message: 'Validation failed', errors: formatIssues(result.error) });
  }

  req.validatedPayoutAccount = result.data;
  return next();
};
