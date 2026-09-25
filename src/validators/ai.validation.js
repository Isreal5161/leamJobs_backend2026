import { z } from 'zod';

const text = (max) => z.string().trim().max(max);
const profileContext = z.object({
  professionalTitle: text(200).optional(), bio: text(2000).optional(), skills: z.array(text(100)).max(50).optional(),
  experience: z.array(z.object({ id: text(100), jobTitle: text(200), company: text(200), startDate: text(50), endDate: text(50), currentlyWorking: z.boolean(), description: text(2000) }).strict()).max(20).optional(),
  education: z.array(z.object({ degree: text(200), school: text(200), year: text(50) }).strict()).max(20).optional(),
  request: text(500),
}).strict();

const cvData = z.object({
  personalInfo: z.object({ fullName: text(200), title: text(200), email: text(200).optional(), phone: text(100).optional(), location: text(200).optional(), linkedin: text(300).optional() }).strict(),
  summary: text(3000).optional(),
  experience: z.array(z.object({ jobTitle: text(200), company: text(200), startDate: text(50), endDate: text(50), currentlyWorking: z.boolean(), description: text(3000) }).strict()).max(20),
  education: z.array(z.object({ degree: text(200), school: text(200), year: text(50) }).strict()).max(20),
  skills: z.array(text(100)).max(80),
  certifications: z.array(z.object({ name: text(200), issuer: text(200) }).strict()).max(30),
  languages: z.array(z.object({ name: text(100), proficiency: text(100) }).strict()).max(30).optional(),
  projects: z.array(z.object({ name: text(200), description: text(2000), technologies: z.array(text(100)).max(30), projectUrl: text(300), githubUrl: text(300), startDate: text(50), endDate: text(50) }).strict()).max(30).optional(),
}).strict();

export const validateProfileAssistant = (req, res, next) => {
  const result = profileContext.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedAi = result.data; return next();
};

export const validateCvOptimizer = (req, res, next) => {
  const result = z.object({ cv: cvData, request: text(500), section: text(80).optional() }).strict().safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedAi = result.data; return next();
};

export const validateApplicationAssistance = (req, res, next) => {
  const result = z.object({ applicationId: z.string().uuid().optional(), jobId: z.string().uuid().optional(), request: text(500), coverLetter: text(5000).optional() }).strict().refine(({ applicationId, jobId }) => Boolean(applicationId || jobId), { message: 'Application ID or job ID is required', path: ['applicationId'] }).safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedAi = result.data; return next();
};

export const validateGenerateCoverLetter = (req, res, next) => {
  const result = z.object({ applicationId: z.string().uuid().optional(), jobId: z.string().uuid().optional(), request: text(500).optional(), coverLetter: text(5000).optional() }).strict().refine(({ applicationId, jobId }) => Boolean(applicationId || jobId), { message: 'Application ID or job ID is required', path: ['applicationId'] }).safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Validation failed', errors: result.error.issues });
  req.validatedAi = result.data; return next();
};
