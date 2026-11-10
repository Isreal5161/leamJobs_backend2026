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
import {
  loadAdminContext,
  requireAdminPermission,
  requireAdminPermissions,
  requireRole,
} from '../middleware/authorization.middleware.js';
import { getAdminSupportRequests, patchAdminSupportRequest } from '../controllers/premiumSeeker.controller.js';
import { validateSupportUpdate } from '../validators/premiumSeeker.validation.js';
import { listReleaseCandidates, releaseContract } from '../controllers/adminRelease.controller.js';
import {
  archiveAdminContract,
  cancelAdminContract,
  getAdminContract,
  listAdminContracts,
} from '../controllers/adminContracts.controller.js';
import { getAdminDispute, listAdminDisputes, resolveDispute } from '../controllers/contractDispute.controller.js';
import { validateAdminDisputeId, validateDisputeResolution } from '../validators/contractDispute.validation.js';
import { listUsers } from '../controllers/adminUsers.controller.js';
import { validateAdminUsersQuery } from '../validators/adminUsers.validation.js';
import { anonymizeAdminAccount } from '../controllers/adminAccount.controller.js';
import { validateAdminAccountId } from '../validators/adminAccount.validation.js';
import { getCompanyLogo, getLeamJobsEmployer, listCompanies } from '../controllers/adminCompanies.controller.js';
import { validateAdminCompaniesQuery } from '../validators/adminCompanies.validation.js';
import { listSeekers } from '../controllers/adminSeekers.controller.js';
import { validateAdminSeekersQuery } from '../validators/adminSeekers.validation.js';
import { uploadAboutTeamImageController, writeSiteContent } from '../controllers/siteContent.controller.js';
import { validateSiteContentUpdate } from '../validators/siteContent.validation.js';
import { singleUpload } from '../middleware/upload.middleware.js';
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
  initializeAdminContractPayment,
  verifyAdminContractPayment,
} from '../controllers/contract.controller.js';
import { validateEmployerApplicationStatus } from '../validators/employerApplications.validation.js';
import { validateContractPayment, validateContractPaymentVerification } from '../validators/contract.validation.js';
import { validateAdminPaymentsQuery } from '../validators/adminPayments.validation.js';
import {
  listAdminConversionOperationsController,
  listAdminPaymentsController,
} from '../controllers/adminPayments.controller.js';
import { validateAdminConversionOperationsQuery } from '../validators/adminConversionOperations.validation.js';
import { validateAdminContractsQuery } from '../validators/adminContracts.validation.js';
import { validateContractId } from '../validators/contract.validation.js';
import { createPlan, listPlans, updatePlan, subscriptionSummary, subscriptions, subscription, trialSettings, updateTrialSettings } from '../controllers/adminSubscriptions.controller.js';
import { validateAdminSubscriptionPlanCreate, validateAdminSubscriptionPlanUpdate, validateAdminSubscriptionsQuery, validateAdminSubscriptionId, validateAdminSubscriptionTrialSettings } from '../validators/adminSubscriptions.validation.js';
import { executeWithdrawalController, reconcileWithdrawalController, recoverFlutterwaveTransferController } from '../controllers/withdrawal.controller.js';
import { getAdminWithdrawalController, listAdminWithdrawalsController } from '../controllers/adminWithdrawals.controller.js';
import { validateFlutterwaveWithdrawalRecovery } from '../validators/withdrawalRecovery.validation.js';
import { validateAdminWithdrawalId, validateAdminWithdrawalsQuery } from '../validators/adminWithdrawals.validation.js';
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
import { getAdminPlatformFee, updateAdminPlatformFee } from '../controllers/platformFee.controller.js';
import { validatePlatformFeeUpdate } from '../validators/platformFee.validation.js';
import adminStaffRouter from './adminStaff.routes.js';
import { getCurrentAdminPermissionsController } from '../controllers/adminPermission.controller.js';

const adminRouter = Router();

adminRouter.use(authenticate, requireRole('ADMIN'), loadAdminContext);
adminRouter.use('/staff', adminStaffRouter);

adminRouter.get('/me/permissions', getCurrentAdminPermissionsController);
adminRouter.get('/companies', requireAdminPermission('companies.view'), validateAdminCompaniesQuery, listCompanies);
adminRouter.get('/companies/leamjobs', requireAdminPermission('companies.view'), getLeamJobsEmployer);
adminRouter.get('/companies/:userId/logo', requireAdminPermission('companies.view'), getCompanyLogo);
adminRouter.get('/verification-submissions', requireAdminPermission('verification.view'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 100 }), listEmployerVerifications);
adminRouter.get('/verification-submissions/:verificationId', requireAdminPermission('verification.view'), viewEmployerVerification);
adminRouter.get('/verification-documents/:documentId', requireAdminPermission('verification.documents.view'), fetchVerificationDocumentForAdmin);
adminRouter.patch('/verification-submissions/:verificationId/approve', requireAdminPermission('verification.approve'), approveEmployerVerification);
adminRouter.patch('/verification-submissions/:verificationId/reject', requireAdminPermission('verification.reject'), rejectEmployerVerification);
adminRouter.get('/users', requireAdminPermission('users.view'), validateAdminUsersQuery, listUsers);
adminRouter.delete('/users/:userId', requireAdminPermission('users.anonymize'), validateAdminAccountId, anonymizeAdminAccount);
adminRouter.get('/seekers', requireAdminPermission('users.view'), validateAdminSeekersQuery, listSeekers);
adminRouter.get('/analytics', requireAdminPermissions(['analytics.view', 'finance.payments.view', 'finance.contractFunding.view', 'fees.view']), validateAdminAnalyticsQuery, analytics);
adminRouter.get('/platform-fee', requireAdminPermission('fees.view'), getAdminPlatformFee);
adminRouter.patch('/platform-fee', requireAdminPermission('fees.manage'), validatePlatformFeeUpdate, updateAdminPlatformFee);
adminRouter.get('/payments', requireAdminPermission('finance.payments.view'), validateAdminPaymentsQuery, listAdminPaymentsController);
adminRouter.get(
  '/conversion-operations',
  requireAdminPermission('finance.conversions.view'),
  validateAdminConversionOperationsQuery,
  listAdminConversionOperationsController,
);
adminRouter.post('/withdrawals/:id/execute', requireAdminPermission('finance.withdrawals.execute'), executeWithdrawalController);
adminRouter.post('/withdrawals/:id/reconcile', requireAdminPermission('finance.withdrawals.reconcile'), reconcileWithdrawalController);
adminRouter.post('/withdrawals/:id/recover-flutterwave-transfer', requireAdminPermission('finance.providerRecovery.execute'), validateFlutterwaveWithdrawalRecovery, recoverFlutterwaveTransferController);
adminRouter.get('/withdrawals', requireAdminPermission('finance.withdrawals.view'), validateAdminWithdrawalsQuery, listAdminWithdrawalsController);
adminRouter.get('/withdrawals/:id', requireAdminPermission('finance.withdrawals.view'), validateAdminWithdrawalId, getAdminWithdrawalController);
adminRouter.get('/subscription-plans', requireAdminPermission('subscriptions.view'), listPlans);
adminRouter.post('/subscription-plans', requireAdminPermission('subscriptions.plans.manage'), validateAdminSubscriptionPlanCreate, createPlan);
adminRouter.patch('/subscription-plans/:id', requireAdminPermission('subscriptions.plans.manage'), validateAdminSubscriptionId, validateAdminSubscriptionPlanUpdate, updatePlan);
adminRouter.get('/subscription-trial-settings', requireAdminPermission('subscriptions.view'), trialSettings);
adminRouter.patch('/subscription-trial-settings', requireAdminPermission('subscriptions.trials.manage'), validateAdminSubscriptionTrialSettings, updateTrialSettings);
adminRouter.get('/subscriptions/summary', requireAdminPermission('subscriptions.view'), subscriptionSummary);
adminRouter.get('/subscriptions', requireAdminPermission('subscriptions.view'), validateAdminSubscriptionsQuery, subscriptions);
adminRouter.get('/subscriptions/:id', requireAdminPermission('subscriptions.view'), validateAdminSubscriptionId, subscription);
adminRouter.put('/content', requireAdminPermissions(['content.edit', 'content.publish']), validateSiteContentUpdate, writeSiteContent);
adminRouter.post('/content/about/team-images', requireAdminPermission('content.media.upload'), singleUpload('image'), uploadAboutTeamImageController);
adminRouter.post('/jobs', requireAdminPermission('jobs.create'), createJob);
adminRouter.get('/jobs', requireAdminPermission('jobs.view'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 100 }), listJobs);
adminRouter.get('/jobs/:jobId', requireAdminPermission('jobs.view'), getJob);
adminRouter.get('/jobs/:jobId/applications', requireAdminPermission('applications.view'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listAdminApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId', requireAdminPermission('applications.view'), getAdminApplicationController);
adminRouter.patch('/jobs/:jobId/applications/:applicationId/status', requireAdminPermission('applications.update'), validateEmployerApplicationStatus, updateAdminApplicationStatusController);
adminRouter.post('/jobs/:jobId/applications/:applicationId/select-contract', requireAdminPermission('applications.select'), selectAdminContractApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId/resume', requireAdminPermission('applicants.documents.view'), getAdminApplicationResumeController);
adminRouter.get('/jobs/:jobId/applications/:applicationId/profile-picture', requireAdminPermission('applicants.documents.view'), getAdminApplicationProfilePictureController);
adminRouter.get('/contracts', requireAdminPermissions(['contracts.view', 'finance.contractFunding.view']), validateAdminContractsQuery, listAdminContracts);
adminRouter.get('/contracts/release-eligible', requireAdminPermissions(['contracts.view', 'finance.contractFunding.view']), createPageLimitValidator({ defaultLimit: 20, maxLimit: 50 }), listReleaseCandidates);
adminRouter.get('/disputes', requireAdminPermission('disputes.view'), createPageLimitValidator({ defaultLimit: 20, maxLimit: 100 }), listAdminDisputes);
adminRouter.get('/disputes/:disputeId', requireAdminPermission('disputes.view'), validateAdminDisputeId, getAdminDispute);
adminRouter.patch('/contracts/:contractId/disputes/:disputeId', requireAdminPermission('disputes.resolve'), validateDisputeResolution, resolveDispute);
adminRouter.get('/contracts/:contractId', requireAdminPermissions(['contracts.view', 'finance.contractFunding.view']), validateContractId, getAdminContract);
adminRouter.post('/contracts/:contractId/cancel', requireAdminPermission('contracts.cancel'), validateContractId, cancelAdminContract);
adminRouter.post('/contracts/:contractId/archive', requireAdminPermission('contracts.archive'), validateContractId, archiveAdminContract);
adminRouter.post('/contracts/:contractId/confirm', requireAdminPermission('contracts.confirm'), confirmAdminContract);
adminRouter.post('/contracts/:contractId/payment', requireAdminPermission('finance.contractFunding.execute'), validateContractPayment, initializeAdminContractPayment);
adminRouter.post('/contracts/:contractId/payment/verify', requireAdminPermission('finance.contractFunding.execute'), validateContractPaymentVerification, verifyAdminContractPayment);
adminRouter.post('/contracts/:contractId/confirm-completion', requireAdminPermission('contracts.complete'), confirmAdminCompletion);
adminRouter.patch('/jobs/:jobId', requireAdminPermission('jobs.edit'), updateJob);
adminRouter.patch('/jobs/:jobId/approve', requireAdminPermission('jobs.moderate'), approveJob);
adminRouter.patch('/jobs/:jobId/reject', requireAdminPermission('jobs.moderate'), rejectJob);
adminRouter.patch('/jobs/:jobId/remove', requireAdminPermission('jobs.delete'), removeJob);
adminRouter.patch('/jobs/:jobId/decision', requireAdminPermission('jobs.moderate'), decideJob);
adminRouter.get('/notifications', requireAdminPermission('notifications.view'), validateNotificationPagination, listNotifications);
adminRouter.patch('/notifications/read-all', requireAdminPermission('notifications.view'), readAllNotifications);
adminRouter.patch('/notifications/:notificationId/read', requireAdminPermission('notifications.view'), readNotification);
adminRouter.get('/communications/templates', requireAdminPermission('communications.templates.view'), templates);
adminRouter.patch('/communications/templates/:key', requireAdminPermission('communications.templates.edit'), validateTemplateKey, validateTemplateUpdate, updateTemplate);
adminRouter.post('/communications/templates/:key/preview', requireAdminPermission('communications.templates.view'), validateTemplateKey, previewTemplate);
adminRouter.post('/communications/campaigns', requireAdminPermission('communications.campaigns.manage'), validateCampaignCreate, createCampaign);
adminRouter.get('/communications/campaigns', requireAdminPermission('communications.campaigns.view'), validateCampaignRecordsQuery, campaignRecords);
adminRouter.patch('/communications/campaigns/:id', requireAdminPermission('communications.campaigns.manage'), validateCampaignUpdate, updateCampaign);
adminRouter.get('/communications/campaigns/:id/preview', requireAdminPermission('communications.campaigns.view'), campaignPreview);
adminRouter.get('/communications/campaigns/:id/report', requireAdminPermission('communications.campaigns.view'), campaignReport);
adminRouter.get('/communications/campaigns/:id/deliveries', requireAdminPermission('communications.campaigns.view'), validateCampaignDeliveriesQuery, campaignDeliveries);
adminRouter.get('/communications/recipients/count', requireAdminPermission('communications.campaigns.view'), validateCampaignRecipientQuery, campaignRecipients);
adminRouter.get('/support/premium', requireAdminPermission('support.view'), getAdminSupportRequests);
adminRouter.patch('/support/premium/:requestId', requireAdminPermission('support.update'), validateSupportUpdate, patchAdminSupportRequest);
adminRouter.post('/communications/campaigns/:id/send', requireAdminPermission('communications.campaigns.send'), sendCampaign);
adminRouter.post('/contracts/:contractId/release', requireAdminPermission('finance.escrowRelease.execute'), releaseContract);

export { adminRouter };
export default adminRouter;
