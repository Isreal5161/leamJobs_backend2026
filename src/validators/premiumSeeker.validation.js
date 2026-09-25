import { z } from 'zod';

const validate = (schema) => (req, res, next) => { const result = schema.safeParse(req.body); if (!result.success) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: result.error.issues[0]?.message ?? 'Invalid request.' } }); req.body = result.data; return next(); };
const jobAlertFields = z.object({ name: z.string().trim().min(1).max(80), keywords: z.string().trim().max(120).optional().nullable(), skills: z.array(z.string().trim().min(1).max(80)).max(30).default([]), location: z.string().trim().max(120).optional().nullable(), jobType: z.enum(['NORMAL_EMPLOYMENT', 'FREELANCE_PROJECT']).optional().nullable(), workArrangement: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).optional().nullable(), salaryMin: z.number().nonnegative().optional().nullable(), salaryMax: z.number().nonnegative().optional().nullable(), isActive: z.boolean().optional() });
const validateSalaryRange = (value) => value.salaryMin == null || value.salaryMax == null || value.salaryMin <= value.salaryMax;
const jobAlertSchema = jobAlertFields.refine(validateSalaryRange, { message: 'Minimum salary cannot exceed maximum salary.', path: ['salaryMax'] });
export const validateJobAlert = validate(jobAlertSchema);
export const validateJobAlertUpdate = validate(jobAlertFields.partial().refine(validateSalaryRange, { message: 'Minimum salary cannot exceed maximum salary.', path: ['salaryMax'] }));
export const validateAssistant = validate(z.object({ question: z.string().trim().min(3).max(1500) }));
export const validateJobInput = validate(z.object({ jobId: z.string().uuid() }));
export const validateSupportRequest = validate(z.object({ subject: z.string().trim().min(3).max(120), category: z.string().trim().min(2).max(60), message: z.string().trim().min(10).max(5000) }));
export const validateSupportUpdate = validate(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), response: z.string().trim().max(5000).optional().nullable() }));