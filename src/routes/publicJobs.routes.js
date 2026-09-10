import { Router } from 'express';
import { getPublicJob, listJobs } from '../controllers/seekerJobs.controller.js';
import { validateSeekerJobsQuery } from '../validators/seekerJobs.validation.js';

const publicJobsRouter = Router();

publicJobsRouter.get('/', validateSeekerJobsQuery, listJobs);
publicJobsRouter.get('/:jobId', getPublicJob);

export default publicJobsRouter;