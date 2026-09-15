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
	importResume,
	uploadProfilePicture,
	uploadResume,
} from '../controllers/seekerProfileFiles.controller.js';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
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
import { listSeekerPayoutAccounts, createPayoutAccount, updatePayoutAccount } from '../controllers/seekerPayoutAccount.controller.js';
import { validateCreatePayoutAccount, validateUpdatePayoutAccount } from '../validators/seekerPayoutAccount.validation.js';
import { validateSeekerJobsQuery } from '../validators/seekerJobs.validation.js';
import { listSeekerRecommendations } from '../controllers/seekerRecommendations.controller.js';
import { validateSeekerRecommendationsQuery } from '../validators/seekerRecommendations.validation.js';
import { confirmSeekerContract, getSeekerContract, submitCompletion } from '../controllers/contract.controller.js';
import { validateCompletionSubmission } from '../validators/contract.validation.js';
import { checkoutSubscription, listSeekerPlanOptionsController, listSubscriptions, verifySubscriptionPayment } from '../controllers/seekerSubscriptions.controller.js';
import { validateSeekerSubscriptionCheckout, validateSeekerSubscriptionVerification } from '../validators/seekerSubscriptions.validation.js';
import { respondToInvitation } from '../controllers/jobInvitation.controller.js';
import { validateInvitationResponse } from '../validators/jobInvitation.validation.js';
import { profileAssistant, cvOptimizer, applicationAssistance } from '../controllers/ai.controller.js';
import { validateProfileAssistant, validateCvOptimizer, validateApplicationAssistance } from '../validators/ai.validation.js';
import { requireEntitlement } from '../middleware/entitlement.middleware.js';
import { listNotifications, readAllNotifications, readNotification } from '../controllers/notification.controller.js';
import { validateNotificationPagination } from '../validators/notification.validation.js';

const seekerRouter = Router();

const resumeImportLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 5,
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
	handler: (req, res) => res.status(429).json({
		success: false,
		error: {
			code: 'RESUME_IMPORT_RATE_LIMITED',
			message: 'Too many CV import attempts. Please try again later.',
		},
	}),
});

const aiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
	handler: (req, res) => res.status(429).json({ message: 'Too many AI assistance requests. Please try again later.' }),
});

seekerRouter.get('/profile', authenticate, requireRole('SEEKER'), getProfile);
seekerRouter.patch('/profile', authenticate, requireRole('SEEKER'), validateSeekerProfileUpdate, updateProfile);
seekerRouter.patch('/profile/cv', authenticate, requireRole('SEEKER'), validateSeekerCVUpdate, updateCVProfile);
seekerRouter.post('/profile/picture', authenticate, requireRole('SEEKER'), singleUpload('file'), uploadProfilePicture);
seekerRouter.delete('/profile/picture', authenticate, requireRole('SEEKER'), deleteProfilePicture);
seekerRouter.get('/profile/picture', authenticate, requireRole('SEEKER'), getProfilePicture);
seekerRouter.post('/profile/resume', authenticate, requireRole('SEEKER'), singleUpload('file'), uploadResume);
seekerRouter.post('/profile/resume/import', authenticate, requireRole('SEEKER'), resumeImportLimiter, importResume);
seekerRouter.delete('/profile/resume', authenticate, requireRole('SEEKER'), deleteResume);
seekerRouter.get('/profile/resume', authenticate, requireRole('SEEKER'), getResume);
seekerRouter.get('/subscription-plans', authenticate, requireRole('SEEKER'), listSeekerPlanOptionsController);
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
seekerRouter.patch('/invitations/:invitationId', authenticate, requireRole('SEEKER'), validateInvitationResponse, respondToInvitation);
seekerRouter.patch('/conversations/:conversationId/read', authenticate, requireRole('SEEKER'), markConversationRead);
seekerRouter.get('/payments/summary', authenticate, requireRole('SEEKER'), getPaymentSummary);
seekerRouter.get('/payments', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listPayments);
seekerRouter.get('/payments/transactions', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listTransactions);
seekerRouter.get('/payments/withdrawals', authenticate, requireRole('SEEKER'), validateSeekerPaymentPagination, listWithdrawals);
seekerRouter.post('/payments/withdrawals', authenticate, requireRole('SEEKER'), validateSeekerWithdrawal, createWithdrawal);
seekerRouter.get('/notifications', authenticate, requireRole('SEEKER'), validateNotificationPagination, listNotifications);
seekerRouter.patch('/notifications/read-all', authenticate, requireRole('SEEKER'), readAllNotifications);
seekerRouter.patch('/notifications/:notificationId/read', authenticate, requireRole('SEEKER'), readNotification);
seekerRouter.get('/subscriptions', authenticate, requireRole('SEEKER'), listSubscriptions);
seekerRouter.post('/subscriptions/checkout', authenticate, requireRole('SEEKER'), validateSeekerSubscriptionCheckout, checkoutSubscription);
seekerRouter.post('/subscriptions/verify', authenticate, requireRole('SEEKER'), validateSeekerSubscriptionVerification, verifySubscriptionPayment);
seekerRouter.post('/ai/profile-assistant', authenticate, requireRole('SEEKER'), aiLimiter, requireEntitlement('AI_PROFILE_ASSISTANT'), validateProfileAssistant, profileAssistant);
seekerRouter.post('/ai/cv-optimizer', authenticate, requireRole('SEEKER'), aiLimiter, requireEntitlement('AI_CV_OPTIMIZER'), validateCvOptimizer, cvOptimizer);
seekerRouter.post('/ai/application-assistance', authenticate, requireRole('SEEKER'), aiLimiter, requireEntitlement('AI_APPLICATION_ASSISTANCE'), validateApplicationAssistance, applicationAssistance);
seekerRouter.get('/payout-accounts', authenticate, requireRole('SEEKER'), listSeekerPayoutAccounts);
seekerRouter.post('/payout-accounts', authenticate, requireRole('SEEKER'), validateCreatePayoutAccount, createPayoutAccount);
seekerRouter.patch('/payout-accounts/:id', authenticate, requireRole('SEEKER'), validateUpdatePayoutAccount, updatePayoutAccount);
seekerRouter.post('/contracts/:contractId/confirm', authenticate, requireRole('SEEKER'), confirmSeekerContract);
seekerRouter.get('/contracts/:contractId', authenticate, requireRole('SEEKER'), getSeekerContract);
seekerRouter.post('/contracts/:contractId/submit-completion', authenticate, requireRole('SEEKER'), validateCompletionSubmission, submitCompletion);

export default seekerRouter;
