import { Router } from 'express';
import {
  approveJob,
  decideJob,
  getJob,
  listJobs,
  rejectJob,
} from '../controllers/adminJobs.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { listReleaseCandidates, releaseContract } from '../controllers/adminRelease.controller.js';

const adminRouter = Router();

adminRouter.get('/jobs', authenticate, requireRole('ADMIN'), listJobs);
adminRouter.get('/jobs/:jobId', authenticate, requireRole('ADMIN'), getJob);
adminRouter.patch('/jobs/:jobId/approve', authenticate, requireRole('ADMIN'), approveJob);
adminRouter.patch('/jobs/:jobId/reject', authenticate, requireRole('ADMIN'), rejectJob);
adminRouter.patch('/jobs/:jobId/decision', authenticate, requireRole('ADMIN'), decideJob);
adminRouter.get('/contracts/release-eligible', authenticate, requireRole('ADMIN'), listReleaseCandidates);
adminRouter.post('/contracts/:contractId/release', authenticate, requireRole('ADMIN'), releaseContract);

export default adminRouter;
