import { Router } from 'express';
import { dashboard, getEmployerMe } from '../controllers/employer.controller.js';
import { closeJob, createJob, getJob, listJobs, updateJob } from '../controllers/employerJobs.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateCreateEmployerJob, validateUpdateEmployerJob } from '../validators/employerJobs.validation.js';

const employerRouter = Router();

employerRouter.get('/me', authenticate, requireRole('EMPLOYER'), getEmployerMe);
employerRouter.get('/dashboard', authenticate, requireRole('EMPLOYER'), dashboard);
employerRouter.get('/jobs', authenticate, requireRole('EMPLOYER'), listJobs);
employerRouter.post('/jobs', authenticate, requireRole('EMPLOYER'), validateCreateEmployerJob, createJob);
employerRouter.get('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), getJob);
employerRouter.patch('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), validateUpdateEmployerJob, updateJob);
employerRouter.patch('/jobs/:jobId/close', authenticate, requireRole('EMPLOYER'), closeJob);

export default employerRouter;