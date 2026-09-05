import { z } from 'zod';

const certificationItemSchema = z.object({
  id: z.string().trim().min(1, 'Certification id is required').max(200, 'Certification id is too long'),
  name: z.string().trim().min(1, 'Certification name is required').max(300, 'Certification name is too long'),
  issuer: z.string().trim().min(1, 'Certification issuer is required').max(300, 'Certification issuer is too long'),
}).strict();

const languageItemSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1, 'Language name is required').max(100, 'Language name is too long'),
  proficiency: z.enum(['Basic', 'Conversational', 'Professional', 'Fluent', 'Native']),
}).strict();

const projectItemSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1, 'Project name is required').max(200, 'Project name is too long'),
  description: z.string().trim().max(2000, 'Project description is too long').optional().or(z.literal('')),
  technologies: z.array(z.string().trim().min(1, 'Technology cannot be empty').max(100, 'Technology is too long')).max(50).optional(),
  projectUrl: z.string().trim().url('Invalid project URL').optional().or(z.literal('')),
  githubUrl: z.string().trim().url('Invalid GitHub URL').optional().or(z.literal('')),
  startDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Start date must use YYYY-MM').optional().or(z.literal('')),
  endDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'End date must use YYYY-MM').optional().or(z.literal('')),
}).strict().refine((project) => {
  const technologies = (project.technologies ?? []).map((technology) => technology.trim().toLocaleLowerCase());
  return technologies.length === new Set(technologies).size;
}, 'Duplicate technologies are not allowed');

const seekerProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200, 'Full name is too long').optional(),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long').optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long').optional(),
  country: z.string().trim().min(1, 'Country is required').optional(),
  state: z.string().trim().min(1, 'State is required').optional(),
  city: z.string().trim().min(1, 'City is required').optional(),
  professionalTitle: z.string().trim().min(1, 'Professional title is required').optional(),
  skills: z.array(z.string().trim().min(1, 'Skill cannot be empty')).min(1, 'At least one skill is required').optional().refine((skills) => {
    if (!skills) return true;
    const normalized = skills.map((skill) => skill.trim());
    return normalized.length === new Set(normalized).size;
  }, 'Duplicate skills are not allowed'),
}).strict();

export const validateSeekerProfileUpdate = (req, res, next) => {
  const result = seekerProfileUpdateSchema.safeParse(req.body);

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

const educationItemSchema = z.object({
  id: z.string(),
  degree: z.string().min(1, 'Degree is required'),
  school: z.string().min(1, 'School is required'),
  year: z.string().min(1, 'Year is required'),
});

const experienceItemSchema = z.object({
  id: z.string(),
  jobTitle: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  currentlyWorking: z.boolean(),
  description: z.string(),
});

const linkedinUrlSchema = z.string().trim().url('Invalid LinkedIn URL').optional().or(z.literal('').optional()).or(z.null());

const cvTemplateSchema = z.enum(['modern', 'professional', 'creative', 'minimalist']).optional().nullable();

const seekerCVUpdateSchema = z.object({
  bio: z.string().trim().max(1000, 'Bio must not exceed 1000 characters').optional().or(z.literal('').transform(() => null)).or(z.null()),
  education: z.array(educationItemSchema).optional().or(z.null()),
  experience: z.array(experienceItemSchema).optional().or(z.null()),
  certifications: z.array(certificationItemSchema).optional().or(z.null()),
  languages: z.array(languageItemSchema).max(50).refine((languages) => {
    const names = languages.map((language) => language.name.trim().toLocaleLowerCase());
    return names.length === new Set(names).size;
  }, 'Duplicate languages are not allowed').optional().or(z.null()),
  projects: z.array(projectItemSchema).max(50).optional().or(z.null()),
  linkedinUrl: linkedinUrlSchema,
  cvTemplate: cvTemplateSchema,
}).strict().partial();

export const validateSeekerCVUpdate = (req, res, next) => {
  const result = seekerCVUpdateSchema.safeParse(req.body);

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
