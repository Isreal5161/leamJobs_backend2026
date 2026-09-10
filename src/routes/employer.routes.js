import { Router } from 'express';
import { dashboard, getEmployerMe } from '../controllers/employer.controller.js';
import {
	getConversation,
	listConversations,
	listMessages,
	markConversationRead,
	postMessage,
} from '../controllers/employerMessaging.controller.js';
import {
	createApplicationConversation,
	getApplication,
	getApplicationResume,
	listApplications,
	updateApplicationStatus,
} from '../controllers/employerApplications.controller.js';
import { closeJob, createJob, getJob, listJobs, updateJob } from '../controllers/employerJobs.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateEmployerApplicationStatus } from '../validators/employerApplications.validation.js';
import { validateCreateEmployerJob, validateUpdateEmployerJob } from '../validators/employerJobs.validation.js';
import { validateMessagePagination, validateSendMessage } from '../validators/messaging.validation.js';

const employerRouter = Router();

employerRouter.get('/me', authenticate, requireRole('EMPLOYER'), getEmployerMe);
employerRouter.get('/dashboard', authenticate, requireRole('EMPLOYER'), dashboard);
employerRouter.get('/jobs', authenticate, requireRole('EMPLOYER'), listJobs);
employerRouter.post('/jobs', authenticate, requireRole('EMPLOYER'), validateCreateEmployerJob, createJob);
employerRouter.get('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), getJob);
employerRouter.patch('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), validateUpdateEmployerJob, updateJob);
employerRouter.patch('/jobs/:jobId/close', authenticate, requireRole('EMPLOYER'), closeJob);
employerRouter.get('/jobs/:jobId/applications', authenticate, requireRole('EMPLOYER'), listApplications);
employerRouter.get('/jobs/:jobId/applications/:applicationId', authenticate, requireRole('EMPLOYER'), getApplication);
employerRouter.patch('/jobs/:jobId/applications/:applicationId/status', authenticate, requireRole('EMPLOYER'), validateEmployerApplicationStatus, updateApplicationStatus);
employerRouter.get('/jobs/:jobId/applications/:applicationId/resume', authenticate, requireRole('EMPLOYER'), getApplicationResume);
employerRouter.post('/jobs/:jobId/applications/:applicationId/conversation', authenticate, requireRole('EMPLOYER'), createApplicationConversation);
employerRouter.get('/conversations', authenticate, requireRole('EMPLOYER'), listConversations);
employerRouter.get('/conversations/:conversationId', authenticate, requireRole('EMPLOYER'), getConversation);
employerRouter.get('/conversations/:conversationId/messages', authenticate, requireRole('EMPLOYER'), validateMessagePagination, listMessages);
employerRouter.post('/conversations/:conversationId/messages', authenticate, requireRole('EMPLOYER'), validateSendMessage, postMessage);
employerRouter.patch('/conversations/:conversationId/read', authenticate, requireRole('EMPLOYER'), markConversationRead);

export default employerRouter;