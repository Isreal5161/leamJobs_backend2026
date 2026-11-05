import { z } from 'zod';

const permissionKeysSchema = (minimum = 0) => z.array(
  z.string().trim().min(1).max(128),
).min(minimum).max(100).superRefine((keys, context) => {
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', message: 'Permission keys must be unique.' });
  }
});

const createInvitationSchema = z.object({
  email: z.string().trim().email().max(320).transform((email) => email.toLowerCase()),
  permissionKeys: permissionKeysSchema(1),
}).strict();

const updatePermissionsSchema = z.object({
  permissionKeys: permissionKeysSchema(),
}).strict();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();

const identifierSchema = z.string().trim().min(1).max(128);

const respondValidation = (result, req, res, next, assign) => {
  if (!result.success) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: result.error.issues.map(({ path, message }) => ({
        field: path.join('.'),
        message,
      })),
    });
  }
  assign(req, result.data);
  return next();
};

export const validateCreateAdminInvitation = (req, res, next) => respondValidation(
  createInvitationSchema.safeParse(req.body),
  req,
  res,
  next,
  (request, data) => { request.body = data; },
);

export const validateUpdateStaffPermissions = (req, res, next) => respondValidation(
  updatePermissionsSchema.safeParse(req.body),
  req,
  res,
  next,
  (request, data) => { request.body = data; },
);

export const validateStaffPagination = (req, res, next) => respondValidation(
  paginationSchema.safeParse(req.query),
  req,
  res,
  next,
  (request, data) => { request.pagination = data; },
);

export const validateStaffUserId = (req, res, next) => respondValidation(
  identifierSchema.safeParse(req.params.userId),
  req,
  res,
  next,
  (request, data) => { request.params.userId = data; },
);

export const validateStaffInvitationId = (req, res, next) => respondValidation(
  identifierSchema.safeParse(req.params.invitationId),
  req,
  res,
  next,
  (request, data) => { request.params.invitationId = data; },
);
