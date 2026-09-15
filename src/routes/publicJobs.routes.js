import { Router } from 'express';
import { subscribe, unsubscribe } from '../controllers/publicJobUpdates.controller.js';
import { validateJobUpdatesSubscription } from '../validators/publicJobUpdates.validation.js';
import { getPublicJob, listJobs } from '../controllers/seekerJobs.controller.js';
import { validateSeekerJobsQuery } from '../validators/seekerJobs.validation.js';

const publicJobsRouter = Router();

publicJobsRouter.post('/job-updates/subscribe', validateJobUpdatesSubscription, subscribe);
publicJobsRouter.get('/job-updates/unsubscribe', unsubscribe);

publicJobsRouter.get('/', validateSeekerJobsQuery, listJobs);
publicJobsRouter.get('/:jobId', getPublicJob);

export default publicJobsRouter;