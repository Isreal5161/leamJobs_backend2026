import { Router } from 'express';
import {
  approveJob,
  createJob,
  decideJob,
  getJob,
  listJobs,
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

const adminRouter = Router();

adminRouter.get('/companies', authenticate, requireRole('ADMIN'), validateAdminCompaniesQuery, listCompanies);
adminRouter.get('/companies/leamjobs', authenticate, requireRole('ADMIN'), getLeamJobsEmployer);
adminRouter.get('/companies/:userId/logo', authenticate, requireRole('ADMIN'), getCompanyLogo);
adminRouter.get('/users', authenticate, requireRole('ADMIN'), validateAdminUsersQuery, listUsers);
adminRouter.get('/seekers', authenticate, requireRole('ADMIN'), validateAdminSeekersQuery, listSeekers);
adminRouter.get('/analytics', authenticate, requireRole('ADMIN'), validateAdminAnalyticsQuery, analytics);
adminRouter.get('/payments', authenticate, requireRole('ADMIN'), validateAdminPaymentsQuery, listAdminPaymentsController);
adminRouter.put('/content', authenticate, requireRole('ADMIN'), validateSiteContentUpdate, writeSiteContent);
adminRouter.post('/jobs', authenticate, requireRole('ADMIN'), createJob);
adminRouter.get('/jobs', authenticate, requireRole('ADMIN'), listJobs);
adminRouter.get('/jobs/:jobId', authenticate, requireRole('ADMIN'), getJob);
adminRouter.get('/jobs/:jobId/applications', authenticate, requireRole('ADMIN'), listAdminApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId', authenticate, requireRole('ADMIN'), getAdminApplicationController);
adminRouter.patch('/jobs/:jobId/applications/:applicationId/status', authenticate, requireRole('ADMIN'), validateEmployerApplicationStatus, updateAdminApplicationStatusController);
adminRouter.post('/jobs/:jobId/applications/:applicationId/select-contract', authenticate, requireRole('ADMIN'), selectAdminContractApplicationController);
adminRouter.get('/jobs/:jobId/applications/:applicationId/resume', authenticate, requireRole('ADMIN'), getAdminApplicationResumeController);
adminRouter.get('/contracts/release-eligible', authenticate, requireRole('ADMIN'), listReleaseCandidates);
adminRouter.get('/contracts/:contractId', authenticate, requireRole('ADMIN'), getAdminContract);
adminRouter.post('/contracts/:contractId/confirm', authenticate, requireRole('ADMIN'), confirmAdminContract);
adminRouter.post('/contracts/:contractId/payment', authenticate, requireRole('ADMIN'), validateContractPayment, initializeAdminContractPayment);
adminRouter.post('/contracts/:contractId/payment/verify', authenticate, requireRole('ADMIN'), validateContractPaymentVerification, verifyAdminContractPayment);
adminRouter.post('/contracts/:contractId/confirm-completion', authenticate, requireRole('ADMIN'), confirmAdminCompletion);
adminRouter.patch('/jobs/:jobId', authenticate, requireRole('ADMIN'), updateJob);
adminRouter.patch('/jobs/:jobId/approve', authenticate, requireRole('ADMIN'), approveJob);
adminRouter.patch('/jobs/:jobId/reject', authenticate, requireRole('ADMIN'), rejectJob);
adminRouter.patch('/jobs/:jobId/decision', authenticate, requireRole('ADMIN'), decideJob);
adminRouter.post('/contracts/:contractId/release', authenticate, requireRole('ADMIN'), releaseContract);

export default adminRouter;
