import { Router } from 'express';
import { dashboard } from '../controllers/seekerDashboard.controller.js';
import { createApplication, listApplications } from '../controllers/seekerApplications.controller.js';
import { getProfile, updateProfile, updateCVProfile } from '../controllers/seekerProfile.controller.js';
import { getJob, listJobs } from '../controllers/seekerJobs.controller.js';
import {
	deleteProfilePicture,
	deleteResume,
	getProfilePicture,
	getResume,
	uploadProfilePicture,
	uploadResume,
} from '../controllers/seekerProfileFiles.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateCreateApplication } from '../validators/seekerApplications.validation.js';
import { validateSeekerProfileUpdate, validateSeekerCVUpdate } from '../validators/seekerProfile.validation.js';
import { singleUpload } from '../middleware/upload.middleware.js';
import {
	createConversationFromApplication,
	getConversation,
	listConversations,
	listMessages,
	markConversationRead,
	postMessage,
} from '../controllers/seekerMessaging.controller.js';
import { validateMessagePagination, validateSendMessage } from '../validators/messaging.validation.js';
import {
	createWithdrawal,
	getPaymentSummary,
	listPayments,
	listTransactions,
	listWithdrawals,
} from '../controllers/seekerPayments.controller.js';
import { validateSeekerPaymentPagination } from '../validators/seekerPayments.validation.js';
import { validateSeekerWithdrawal } from '../validators/seekerWithdrawal.validation.js';
import { listSeekerPayoutAccounts } from '../controllers/seekerPayoutAccount.controller.js';
import { validateSeekerJobsQuery } from '../validators/seekerJobs.validation.js';
import { listSeekerRecommendations } from '../controllers/seekerRecommendations.controller.js';
import { validateSeekerRecommendationsQuery } from '../validators/seekerRecommendations.validation.js';

const seekerRouter = Router();

seekerRouter.get('/profile', authenticate, requireRole('SEEKER'), getProfile);
seekerRouter.patch('/profile', authenticate, requireRole('SEEKER'), validateSeekerProfileUpdate, updateProfile);
seekerRouter.patch('/profile/cv', authenticate, requireRole('SEEKER'), validateSeekerCVUpdate, updateCVProfile);
seekerRouter.post('/profile/picture', authenticate, requireRole('SEEKER'), singleUpload('file'), uploadProfilePicture);
seekerRouter.delete('/profile/picture', authenticate, requireRole('SEEKER'), deleteProfilePicture);
seekerRouter.get('/profile/picture', authenticate, requireRole('SEEKER'), getProfilePicture);
seekerRouter.post('/profile/resume', authenticate, requireRole('SEEKER'), singleUpload('file'), uploadResume);
seekerRouter.delete('/profile/resume', authenticate, requireRole('SEEKER'), deleteResume);
seekerRouter.get('/profile/resume', authenticate, requireRole('SEEKER'), getResume);
seekerRouter.get('/dashboard', authenticate, requireRole('SEEKER'), dashboard);
seekerRouter.get('/jobs', authenticate, requireRole('SEEKER'), validateSeekerJobsQuery, listJobs);
seekerRouter.get('/recommendations', authenticate, requireRole('SEEKER'), validateSeekerRecommendationsQuery, listSeekerRecommendations);
seekerRouter.get('/jobs/:jobId', authenticate, requireRole('SEEKER'), getJob);
seekerRouter.get('/applications', authenticate, requireRole('SEEKER'), listApplications);
seekerRouter.post('/applications', authenticate, requireRole('SEEKER'), validateCreateApplication, createApplication);
seekerRouter.get('/conversations', authenticate, requireRole('SEEKER'), listConversations);
seekerRouter.post('/conversations/from-application/:applicationId', authenticate, requireRole('SEEKER'), createConversationFromApplication);
seekerRouter.get('/conversations/:conversationId', authenticate, requireRole('SEEKER'), getConversation);
seekerRouter.get('/conversations/:conversationId/messages', authenticate, requireRole('SEEKER'), validateMessagePagination, listMessages);
seekerRouter.post('/conversations/:conversationId/messages', authenticate, requireRole('SEEKER'), validateSendMessage, postMessage);
seekerRouter.patch('/conversations/:conversationId/read', authenticate, requireRole('SEEKER'), markConversationRead);
seekerRouter.get('/payments/summary', authenticate, requireRole('SEEKER'), getPaymentSummary);
seekerRouter.get('/payments', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listPayments);
seekerRouter.get('/payments/transactions', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listTransactions);
seekerRouter.get('/payments/withdrawals', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listWithdrawals);
seekerRouter.post('/payments/withdrawals', authenticate, requireRole('SEEKER'), validateSeekerWithdrawal, createWithdrawal);
seekerRouter.get('/payout-accounts', authenticate, requireRole('SEEKER'), listSeekerPayoutAccounts);

export default seekerRouter;
