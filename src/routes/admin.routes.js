import { Router } from 'express';
import {
  approveJob,
  createJob,
  decideJob,
  getJob,
  listJobs,
  removeJob,
  rejectJob,
  updateJob,
} from '../controllers/adminJobs.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';
import { listReleaseCandidates, releaseContract } from '../controllers/adminRelease.controller.js';
import { listUsers } from '../controllers/adminUsers.controller.js';
import { validateAdminUsersQuery } from '../validators/adminUsers.validation.js';
import { getCompanyLogo, getLeamJobsEmployer, listCompanies } from '../controllers/adminCompanies.controller.js';
import { validateAdminCompaniesQuery } from '../validators/adminCompanies.validation.js';
import { listSeekers } from '../controllers/adminSeekers.controller.js';
import { validateAdminSeekersQuery } from '../validators/adminSeekers.validation.js';
import { writeSiteContent } from '../controllers/siteContent.controller.js';
import { validateSiteContentUpdate } from '../validators/siteContent.validation.js';
import { analytics } from '../controllers/adminAnalytics.controller.js';
import { validateAdminAnalyticsQuery } from '../validators/adminAnalytics.validation.js';
import {
  getAdminApplicationController,
  getAdminApplicationResumeController,
  getAdminApplicationProfilePictureController,
  listAdminApplicationController,
  selectAdminContractApplicationController,
  updateAdminApplicationStatusController,
} from '../controllers/adminApplications.controller.js';
import {
  confirmAdminCompletion,
  confirmAdminContract,
  getAdminContract,
  initializeAdminContractPayment,
  verifyAdminContractPayment,
} from '../controllers/contract.controller.js';
import { validateEmployerApplicationStatus } from '../validators/employerApplications.validation.js';
import { validateContractPayment, validateContractPaymentVerification } from '../validators/contract.validation.js';
import { validateAdminPaymentsQuery } from '../validators/adminPayments.validation.js';
import { listAdminPaymentsController } from '../controllers/adminPayments.controller.js';
import { createPlan, listPlans, updatePlan, subscriptionSummary, subscriptions, subscription } from '../controllers/adminSubscriptions.controller.js';
import { validateAdminSubscriptionPlanCreate, validateAdminSubscriptionPlanUpdate, validateAdminSubscriptionsQuery, validateAdminSubscriptionId } from '../validators/adminSubscriptions.validation.js';
import { executeWithdrawalController, reconcileWithdrawalController } from '../controllers/withdrawal.controller.js';
import { listNotifications, readAllNotifications, readNotification } from '../controllers/notification.controller.js';
import { validateNotificationPagination } from '../validators/notification.validation.js';
import { campaignDeliveries, campaignPreview, campaignRecipients, campaignRecords, campaignReport, createCampaign, previewTemplate, sendCampaign, templates, updateCampaign, updateTemplate } from '../controllers/adminCommunications.controller.js';
import { validateCampaignCreate, validateCampaignDeliveriesQuery, validateCampaignRecordsQuery, validateCampaignRecipientQuery, validateCampaignUpdate, validateTemplateKey, validateTemplateUpdate } from '../validators/adminCommunications.validation.js';
import {
  approveEmployerVerification,
  fetchVerificationDocumentForAdmin,
  listEmployerVerifications,
  rejectEmployerVerification,
  viewEmployerVerification,
} from '../controllers/adminEmployerVerification.controller.js';
import { createPageLimitValidator } from '../validators/collectionPagination.validation.js';

const adminRouter = Router();

adminRouter.get('/companies', authenticate, requireRole('ADMIN'), validateAdminCompaniesQuery, listCompanies);
adminRouter.get('/companies/leamjobs', authenticate, requireRole('ADMIN'), getLeamJobsEmployer);
adminRouter.get('/companies/:userId/logo', authenticate, requireRole('ADMIN'), getCompanyLogo);
adminRouter.get('/verification-submissions', authenticate, requireRole('ADMIN'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 100 }), listEmployerVerifications);
adminRouter.get('/verification-submissions/:verificationId', authenticate, requireRole('ADMIN'), viewEmployerVerification);
adminRouter.get('/verification-documents/:documentId', authenticate, requireRole('ADMIN'), fetchVerificationDocumentForAdmin);
adminRouter.patch('/verification-submissions/:verificationId/approve', authenticate, requireRole('ADMIN'), approveEmployerVerification);
adminRouter.patch('/verification-submissions/:verificationId/reject', authenticate, requireRole('ADMIN'), rejectEmployerVerification);
adminRouter.get('/users', authenticate, requireRole('ADMIN'), validateAdminUsersQuery, listUsers);
adminRouter.get('/seekers', authenticate, requireRole('ADMIN'), validateAdminSeekersQuery, listSeekers);
adminRouter.get('/analytics', authenticate, requireRole('ADMIN'), validateAdminAnalyticsQuery, analytics);
adminRouter.get('/payments', authenticate, requireRole('ADMIN'), validateAdminPaymentsQuery, listAdminPaymentsController);
adminRouter.post('/withdrawals/:id/execute', authenticate, requireRole('ADMIN'), executeWithdrawalController);
adminRouter.post('/withdrawals/:id/reconcile', authenticate, requireRole('ADMIN'), reconcileWithdrawalController);
adminRouter.get('/subscription-plans', authenticate, requireRole('ADMIN'), listPlans);
adminRouter.post('/subscription-plans', authenticate, requireRole('ADMIN'), validateAdminSubscriptionPlanCreate, createPlan);
adminRouter.patch('/subscription-plans/:id', authenticate, requireRole('ADMIN'), validateAdminSubscriptionId, validateAdminSubscriptionPlanUpdate, updatePlan);
adminRouter.get('/subscriptions/summary', authenticate, requireRole('ADMIN'), subscriptionSummary);
adminRouter.get('/subscriptions', authenticate, requireRole('ADMIN'), validateAdminSubscriptionsQuery, subscriptions);
adminRouter.get('/subscriptions/:id', authenticate, requireRole('ADMIN'), validateAdminSubscriptionId, subscription);
adminRouter.put('/content', authenticate, requireRole('ADMIN'), validateSiteContentUpdate, writeSiteContent);
adminRouter.post('/jobs', authenticate, requireRole('ADMIN'), createJob);
adminRouter.get('/jobs', authenticate, requireRole('ADMIN'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 100 }), listJobs);
adminRouter.get('/jobs/:jobId', authenticate, requireRole('ADMIN'), getJob);
adminRouter.get('/jobs/:jobId/applications', authenticate, requireRole('ADMIN'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listAdminApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId', authenticate, requireRole('ADMIN'), getAdminApplicationController);
adminRouter.patch('/jobs/:jobId/applications/:applicationId/status', authenticate, requireRole('ADMIN'), validateEmployerApplicationStatus, updateAdminApplicationStatusController);
adminRouter.post('/jobs/:jobId/applications/:applicationId/select-contract', authenticate, requireRole('ADMIN'), selectAdminContractApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId/resume', authenticate, requireRole('ADMIN'), getAdminApplicationResumeController);
adminRouter.get('/jobs/:jobId/applications/:applicationId/profile-picture', authenticate, requireRole('ADMIN'), getAdminApplicationProfilePictureController);
adminRouter.get('/contracts/release-eligible', authenticate, requireRole('ADMIN'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listReleaseCandidates);
adminRouter.get('/contracts/:contractId', authenticate, requireRole('ADMIN'), getAdminContract);
adminRouter.post('/contracts/:contractId/confirm', authenticate, requireRole('ADMIN'), confirmAdminContract);
adminRouter.post('/contracts/:contractId/payment', authenticate, requireRole('ADMIN'), validateContractPayment, initializeAdminContractPayment);
adminRouter.post('/contracts/:contractId/payment/verify', authenticate, requireRole('ADMIN'), validateContractPaymentVerification, verifyAdminContractPayment);
adminRouter.post('/contracts/:contractId/confirm-completion', authenticate, requireRole('ADMIN'), confirmAdminCompletion);
adminRouter.patch('/jobs/:jobId', authenticate, requireRole('ADMIN'), updateJob);
adminRouter.patch('/jobs/:jobId/approve', authenticate, requireRole('ADMIN'), approveJob);
adminRouter.patch('/jobs/:jobId/reject', authenticate, requireRole('ADMIN'), rejectJob);
adminRouter.patch('/jobs/:jobId/remove', authenticate, requireRole('ADMIN'), removeJob);
adminRouter.patch('/jobs/:jobId/decision', authenticate, requireRole('ADMIN'), decideJob);
adminRouter.get('/notifications', authenticate, requireRole('ADMIN'), validateNotificationPagination, listNotifications);
adminRouter.patch('/notifications/read-all', authenticate, requireRole('ADMIN'), readAllNotifications);
adminRouter.patch('/notifications/:notificationId/read', authenticate, requireRole('ADMIN'), readNotification);
adminRouter.get('/communications/templates', authenticate, requireRole('ADMIN'), templates);
adminRouter.patch('/communications/templates/:key', authenticate, requireRole('ADMIN'), validateTemplateKey, validateTemplateUpdate, updateTemplate);
adminRouter.post('/communications/templates/:key/preview', authenticate, requireRole('ADMIN'), validateTemplateKey, previewTemplate);
adminRouter.post('/communications/campaigns', authenticate, requireRole('ADMIN'), validateCampaignCreate, createCampaign);
adminRouter.get('/communications/campaigns', authenticate, requireRole('ADMIN'), validateCampaignRecordsQuery, campaignRecords);
adminRouter.patch('/communications/campaigns/:id', authenticate, requireRole('ADMIN'), validateCampaignUpdate, updateCampaign);
adminRouter.get('/communications/campaigns/:id/preview', authenticate, requireRole('ADMIN'), campaignPreview);
adminRouter.get('/communications/campaigns/:id/report', authenticate, requireRole('ADMIN'), campaignReport);
adminRouter.get('/communications/campaigns/:id/deliveries', authenticate, requireRole('ADMIN'), validateCampaignDeliveriesQuery, campaignDeliveries);
adminRouter.get('/communications/recipients/count', authenticate, requireRole('ADMIN'), validateCampaignRecipientQuery, campaignRecipients);
adminRouter.post('/communications/campaigns/:id/send', authenticate, requireRole('ADMIN'), sendCampaign);
adminRouter.post('/contracts/:contractId/release', authenticate, requireRole('ADMIN'), releaseContract);

export default adminRouter;
