import { Router } from 'express';
import { getPublicJob } from '../controllers/seekerJobs.controller.js';

const publicJobsRouter = Router();

publicJobsRouter.get('/:jobId', getPublicJob);

export default publicJobsRouter;