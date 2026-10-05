import { z } from 'zod';

const methods = ['LEAMJOBS', 'WHATSAPP', 'VIDEO', 'PHONE', 'IN_PERSON', 'OTHER'];
const common = {
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  message: z.string().trim().max(2000).nullable().optional(),
  meetingUrl: z.string().trim().max(2048).nullable().optional(),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
};

const createSchema = z.object({
  ...common,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().trim().min(1).max(100),
  method: z.enum(methods),
}).strict();

const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(common).map(([key, schema]) => [key, schema.optional()])),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  localTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  method: z.enum(methods).optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided')
  .refine((value) => {
    const hasAnySchedulePart = ['localDate', 'localTime', 'timezone'].some((key) => Object.hasOwn(value, key));
    return !hasAnySchedulePart || ['localDate', 'localTime', 'timezone'].every((key) => Object.hasOwn(value, key));
  }, {
    message: 'localDate, localTime, and timezone must be provided together when changing the schedule',
    path: ['localDate'],
  });

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: '`from` must be earlier than or equal to `to`',
  path: ['from'],
});
const cancelSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional(),
}).strict();

const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  return next();
};

export const validateCreateInterview = validate(createSchema);
export const validateUpdateInterview = validate(updateSchema);
export const validateInterviewList = validate(listSchema, 'query');
export const validateCancelInterview = validate(cancelSchema);
