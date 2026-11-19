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
import { getCandidateDetails, getCandidateProfilePicture, listCandidates } from '../controllers/employerCandidates.controller.js';
import { validateEmployerCandidateId } from '../validators/employerCandidate.validation.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { validateEmployerApplicationStatus } from '../validators/employerApplications.validation.js';
import { validateCreateEmployerJob, validateUpdateEmployerJob } from '../validators/employerJobs.validation.js';
import { validateMessagePagination, validateSendMessage } from '../validators/messaging.validation.js';
import { validateEmployerProfileCompletion, validateEmployerProfileUpdate } from '../validators/employerProfile.validation.js';
import { requireEmployerProfileComplete } from '../middleware/requireEmployerProfileComplete.middleware.js';
import { singleUpload } from '../middleware/upload.middleware.js';
import {
	confirmCompletion,
	cancelEmployerContract,
	confirmEmployerContract,
	deleteEmployerContract,
	getEmployerContract,
	getEmployerContracts,
	initializeEmployerContractPayment,
	verifyEmployerContractPayment,
} from '../controllers/contract.controller.js';
import { validateContractId, validateContractPayment, validateContractPaymentVerification } from '../validators/contract.validation.js';
import {
  downloadEmployerContractWorkAttachment,
  listEmployerContractActivities,
  reviewEmployerContractSubmission,
} from '../controllers/contractWork.controller.js';
import {
  validateContractActivityId,
  validateContractSubmissionReview,
} from '../validators/contractWork.validation.js';
import { submitDispute } from '../controllers/contractDispute.controller.js';
import { validateDisputeSubmission } from '../validators/contractDispute.validation.js';
import { validateEmployerCandidatesQuery } from '../validators/employerCandidates.validation.js';
import { createInvitation } from '../controllers/jobInvitation.controller.js';
import { validateCreateJobInvitation } from '../validators/jobInvitation.validation.js';
import { listNotifications, readAllNotifications, readNotification } from '../controllers/notification.controller.js';
import { validateNotificationPagination } from '../validators/notification.validation.js';
import { createPageLimitValidator } from '../validators/collectionPagination.validation.js';
import { validateEmployerContractsQuery } from '../validators/employerContracts.validation.js';
import { validateSubmitEmployerVerification } from '../validators/employerVerification.validation.js';
import {
  deleteVerificationDocument,
  fetchVerificationDocument,
  getEmployerVerification,
  submitVerification,
  uploadVerificationDocument,
} from '../controllers/employerVerification.controller.js';
import {
  cancelEmployerInterview,
  createEmployerInterview,
  getEmployerInterview,
  listEmployerInterviewsController,
  updateEmployerInterview,
} from '../controllers/interviews.controller.js';
import {
  validateCreateInterview,
  validateCancelInterview,
  validateInterviewList,
  validateUpdateInterview,
} from '../validators/interviews.validation.js';

const employerRouter = Router();

employerRouter.get('/profile', authenticate, requireRole('EMPLOYER'), getProfile);
employerRouter.patch('/profile', authenticate, requireRole('EMPLOYER'), validateEmployerProfileUpdate, updateProfile);
employerRouter.put('/profile/complete', authenticate, requireRole('EMPLOYER'), validateEmployerProfileCompletion, updateProfile);

employerRouter.use(authenticate, requireRole('EMPLOYER'), requireEmployerProfileComplete);

employerRouter.get('/me', getEmployerMe);
employerRouter.get('/verification', getEmployerVerification);
employerRouter.post('/verification', validateSubmitEmployerVerification, submitVerification);
employerRouter.post('/verification/documents', singleUpload('file'), uploadVerificationDocument);
employerRouter.get('/verification/documents/:documentId', fetchVerificationDocument);
employerRouter.delete('/verification/documents/:documentId', deleteVerificationDocument);
employerRouter.post('/profile/logo', singleUpload('file'), uploadLogo);
employerRouter.delete('/profile/logo', deleteLogo);
employerRouter.get('/profile/logo', getLogo);
employerRouter.get('/contracts', validateEmployerContractsQuery, getEmployerContracts);
employerRouter.get('/contracts/:contractId/activities', validateContractId, listEmployerContractActivities);
employerRouter.post('/contracts/:contractId/submissions/:activityId/review', validateContractId, validateContractActivityId, validateContractSubmissionReview, reviewEmployerContractSubmission);
employerRouter.get('/contracts/:contractId/activities/:activityId/attachments/:attachmentId', validateContractId, validateContractActivityId, downloadEmployerContractWorkAttachment);
employerRouter.post('/contracts/:contractId/disputes', validateDisputeSubmission, submitDispute);
employerRouter.post('/contracts/:contractId/cancel', validateContractId, cancelEmployerContract);
employerRouter.delete('/contracts/:contractId', validateContractId, deleteEmployerContract);
employerRouter.post('/contracts/:contractId/confirm', confirmEmployerContract);
employerRouter.get('/contracts/:contractId', getEmployerContract);
employerRouter.post('/contracts/:contractId/payment', validateContractPayment, initializeEmployerContractPayment);
employerRouter.post('/contracts/:contractId/payment/verify', validateContractPaymentVerification, verifyEmployerContractPayment);
employerRouter.post('/contracts/:contractId/confirm-completion', confirmCompletion);
employerRouter.get('/dashboard', dashboard);
employerRouter.get('/interviews', validateInterviewList, listEmployerInterviewsController);
employerRouter.get('/interviews/:interviewId', getEmployerInterview);
employerRouter.patch('/interviews/:interviewId', validateUpdateInterview, updateEmployerInterview);
employerRouter.post('/interviews/:interviewId/cancel', validateCancelInterview, cancelEmployerInterview);
employerRouter.get('/candidates', validateEmployerCandidatesQuery, listCandidates);
employerRouter.get('/candidates/:candidateId/profile-picture', validateEmployerCandidateId, getCandidateProfilePicture);
employerRouter.get('/candidates/:candidateId', validateEmployerCandidateId, getCandidateDetails);
employerRouter.post('/invitations', validateCreateJobInvitation, createInvitation);
employerRouter.get('/jobs', createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listJobs);
employerRouter.post('/jobs', validateCreateEmployerJob, createJob);
employerRouter.get('/jobs/:jobId', getJob);
employerRouter.patch('/jobs/:jobId', validateUpdateEmployerJob, updateJob);
employerRouter.patch('/jobs/:jobId/close', closeJob);
employerRouter.get('/jobs/:jobId/applications', createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listApplications);
employerRouter.get('/jobs/:jobId/applications/:applicationId', getApplication);
employerRouter.post('/jobs/:jobId/applications/:applicationId/interviews', validateCreateInterview, createEmployerInterview);
employerRouter.patch('/jobs/:jobId/applications/:applicationId/status', validateEmployerApplicationStatus, updateApplicationStatus);
employerRouter.post('/jobs/:jobId/applications/:applicationId/select-contract', selectContractApplication);
employerRouter.get('/jobs/:jobId/applications/:applicationId/resume', getApplicationResume);
employerRouter.get('/jobs/:jobId/applications/:applicationId/profile-picture', getApplicationProfilePicture);
employerRouter.post('/jobs/:jobId/applications/:applicationId/conversation', createApplicationConversation);
employerRouter.get('/conversations', createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listConversations);
employerRouter.get('/conversations/:conversationId', getConversation);
employerRouter.get('/conversations/:conversationId/messages', validateMessagePagination, listMessages);
employerRouter.post('/conversations/:conversationId/messages', validateSendMessage, postMessage);
employerRouter.patch('/conversations/:conversationId/read', markConversationRead);
employerRouter.get('/notifications', validateNotificationPagination, listNotifications);
employerRouter.patch('/notifications/read-all', readAllNotifications);
employerRouter.patch('/notifications/:notificationId/read', readNotification);

export default employerRouter;