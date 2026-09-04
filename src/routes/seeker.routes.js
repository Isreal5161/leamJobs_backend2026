import { Router } from 'express';
import { dashboard } from '../controllers/seekerDashboard.controller.js';
import { createApplication, listApplications } from '../controllers/seekerApplications.controller.js';
import { getJob } from '../controllers/seekerJobs.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateCreateApplication } from '../validators/seekerApplications.validation.js';

const seekerRouter = Router();

seekerRouter.get('/dashboard', authenticate, requireRole('SEEKER'), dashboard);
seekerRouter.get('/jobs/:jobId', authenticate, requireRole('SEEKER'), getJob);
seekerRouter.get('/applications', authenticate, requireRole('SEEKER'), listApplications);
seekerRouter.post('/applications', authenticate, requireRole('SEEKER'), validateCreateApplication, createApplication);

export default seekerRouter;
