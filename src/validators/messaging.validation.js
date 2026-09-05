import { z } from 'zod';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().uuid().optional(),
}).strict();

const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message body is required').max(5000, 'Message body is too long'),
  clientMessageId: z.string().trim().min(1).max(200).optional(),
}).strict();

const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  if (source === 'query') {
    req.validatedQuery = result.data;
  } else {
    req[source] = result.data;
  }
  return next();
};

export const validateMessagePagination = validate(paginationSchema, 'query');
export const validateSendMessage = validate(sendMessageSchema);
