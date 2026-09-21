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
	getApplicationProfilePicture,
	listApplications,
	selectContractApplication,
	updateApplicationStatus,
} from '../controllers/employerApplications.controller.js';
import { deleteLogo, getLogo, getProfile, updateProfile, uploadLogo } from '../controllers/employerProfile.controller.js';
import { closeJob, createJob, getJob, listJobs, updateJob } from '../controllers/employerJobs.controller.js';
import { listCandidates } from '../controllers/employerCandidates.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateEmployerApplicationStatus } from '../validators/employerApplications.validation.js';
import { validateCreateEmployerJob, validateUpdateEmployerJob } from '../validators/employerJobs.validation.js';
import { validateMessagePagination, validateSendMessage } from '../validators/messaging.validation.js';
import { validateEmployerProfileUpdate } from '../validators/employerProfile.validation.js';
import { singleUpload } from '../middleware/upload.middleware.js';
import {
	confirmCompletion,
	confirmEmployerContract,
	getEmployerContract,
	initializeEmployerContractPayment,
	verifyEmployerContractPayment,
} from '../controllers/contract.controller.js';
import { validateContractPayment, validateContractPaymentVerification } from '../validators/contract.validation.js';
import { validateEmployerCandidatesQuery } from '../validators/employerCandidates.validation.js';
import { createInvitation } from '../controllers/jobInvitation.controller.js';
import { validateCreateJobInvitation } from '../validators/jobInvitation.validation.js';
import { listNotifications, readAllNotifications, readNotification } from '../controllers/notification.controller.js';
import { validateNotificationPagination } from '../validators/notification.validation.js';
import { createPageLimitValidator } from '../validators/collectionPagination.validation.js';
import { validateSubmitEmployerVerification } from '../validators/employerVerification.validation.js';
import {
  deleteVerificationDocument,
  fetchVerificationDocument,
  getEmployerVerification,
  submitVerification,
  uploadVerificationDocument,
} from '../controllers/employerVerification.controller.js';

const employerRouter = Router();

employerRouter.get('/me', authenticate, requireRole('EMPLOYER'), getEmployerMe);
employerRouter.get('/profile', authenticate, requireRole('EMPLOYER'), getProfile);
employerRouter.patch('/profile', authenticate, requireRole('EMPLOYER'), validateEmployerProfileUpdate, updateProfile);
employerRouter.get('/verification', authenticate, requireRole('EMPLOYER'), getEmployerVerification);
employerRouter.post('/verification', authenticate, requireRole('EMPLOYER'), validateSubmitEmployerVerification, submitVerification);
employerRouter.post('/verification/documents', authenticate, requireRole('EMPLOYER'), singleUpload('file'), uploadVerificationDocument);
employerRouter.get('/verification/documents/:documentId', authenticate, requireRole('EMPLOYER'), fetchVerificationDocument);
employerRouter.delete('/verification/documents/:documentId', authenticate, requireRole('EMPLOYER'), deleteVerificationDocument);
employerRouter.post('/profile/logo', authenticate, requireRole('EMPLOYER'), singleUpload('file'), uploadLogo);
employerRouter.delete('/profile/logo', authenticate, requireRole('EMPLOYER'), deleteLogo);
employerRouter.get('/profile/logo', authenticate, requireRole('EMPLOYER'), getLogo);
employerRouter.post('/contracts/:contractId/confirm', authenticate, requireRole('EMPLOYER'), confirmEmployerContract);
employerRouter.get('/contracts/:contractId', authenticate, requireRole('EMPLOYER'), getEmployerContract);
employerRouter.post('/contracts/:contractId/payment', authenticate, requireRole('EMPLOYER'), validateContractPayment, initializeEmployerContractPayment);
employerRouter.post('/contracts/:contractId/payment/verify', authenticate, requireRole('EMPLOYER'), validateContractPaymentVerification, verifyEmployerContractPayment);
employerRouter.post('/contracts/:contractId/confirm-completion', authenticate, requireRole('EMPLOYER'), confirmCompletion);
employerRouter.get('/dashboard', authenticate, requireRole('EMPLOYER'), dashboard);
employerRouter.get('/candidates', authenticate, requireRole('EMPLOYER'), validateEmployerCandidatesQuery, listCandidates);
employerRouter.post('/invitations', authenticate, requireRole('EMPLOYER'), validateCreateJobInvitation, createInvitation);
employerRouter.get('/jobs', authenticate, requireRole('EMPLOYER'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listJobs);
employerRouter.post('/jobs', authenticate, requireRole('EMPLOYER'), validateCreateEmployerJob, createJob);
employerRouter.get('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), getJob);
employerRouter.patch('/jobs/:jobId', authenticate, requireRole('EMPLOYER'), validateUpdateEmployerJob, updateJob);
employerRouter.patch('/jobs/:jobId/close', authenticate, requireRole('EMPLOYER'), closeJob);
employerRouter.get('/jobs/:jobId/applications', authenticate, requireRole('EMPLOYER'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listApplications);
employerRouter.get('/jobs/:jobId/applications/:applicationId', authenticate, requireRole('EMPLOYER'), getApplication);
employerRouter.patch('/jobs/:jobId/applications/:applicationId/status', authenticate, requireRole('EMPLOYER'), validateEmployerApplicationStatus, updateApplicationStatus);
employerRouter.post('/jobs/:jobId/applications/:applicationId/select-contract', authenticate, requireRole('EMPLOYER'), selectContractApplication);
employerRouter.get('/jobs/:jobId/applications/:applicationId/resume', authenticate, requireRole('EMPLOYER'), getApplicationResume);
employerRouter.get('/jobs/:jobId/applications/:applicationId/profile-picture', authenticate, requireRole('EMPLOYER'), getApplicationProfilePicture);
employerRouter.post('/jobs/:jobId/applications/:applicationId/conversation', authenticate, requireRole('EMPLOYER'), createApplicationConversation);
employerRouter.get('/conversations', authenticate, requireRole('EMPLOYER'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listConversations);
employerRouter.get('/conversations/:conversationId', authenticate, requireRole('EMPLOYER'), getConversation);
employerRouter.get('/conversations/:conversationId/messages', authenticate, requireRole('EMPLOYER'), validateMessagePagination, listMessages);
employerRouter.post('/conversations/:conversationId/messages', authenticate, requireRole('EMPLOYER'), validateSendMessage, postMessage);
employerRouter.patch('/conversations/:conversationId/read', authenticate, requireRole('EMPLOYER'), markConversationRead);
employerRouter.get('/notifications', authenticate, requireRole('EMPLOYER'), validateNotificationPagination, listNotifications);
employerRouter.patch('/notifications/read-all', authenticate, requireRole('EMPLOYER'), readAllNotifications);
employerRouter.patch('/notifications/:notificationId/read', authenticate, requireRole('EMPLOYER'), readNotification);

export default employerRouter;