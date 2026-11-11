import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { confirmSubscription, subscribe, unsubscribe } from '../controllers/publicJobUpdates.controller.js';
import { validateJobUpdatesConfirmation, validateJobUpdatesSubscription } from '../validators/publicJobUpdates.validation.js';
import { getPublicJob, getPublicJobSitemap, listJobs } from '../controllers/seekerJobs.controller.js';
import { validateSeekerJobsQuery } from '../validators/seekerJobs.validation.js';

const publicJobsRouter = Router();
const jobUpdatesSubscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

publicJobsRouter.post('/job-updates/subscribe', jobUpdatesSubscriptionLimiter, validateJobUpdatesSubscription, subscribe);
publicJobsRouter.post('/job-updates/confirm', validateJobUpdatesConfirmation, confirmSubscription);
publicJobsRouter.get('/job-updates/unsubscribe', unsubscribe);

publicJobsRouter.get('/sitemap.xml', getPublicJobSitemap);
publicJobsRouter.get('/', validateSeekerJobsQuery, listJobs);
publicJobsRouter.get('/:jobId', getPublicJob);

export default publicJobsRouter;