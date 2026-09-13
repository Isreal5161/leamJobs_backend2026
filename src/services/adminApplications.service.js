import { prisma } from '../config/database.js';
import { getLeamJobsEmployerIdentity } from './leamjobsEmployer.service.js';
import {
  getEmployerApplication,
  getEmployerApplicationResume,
  listEmployerApplications,
  selectContractJobApplication,
  updateEmployerApplicationStatus,
} from './employerApplications.service.js';

const createForbiddenError = (message = 'Forbidden') => {
  const error = new Error(message);
  error.status = 403;
  return error;
};

const createNotFoundError = (message = 'Job not found') => {
  const error = new Error(message);
  error.status = 404;
  return error;
};

export const assertAdminCanReadJobApplicants = async (jobId) => {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, employerId: true },
  });

  if (!job) {
    throw createNotFoundError('Job not found');
  }

  const canonicalEmployer = await getLeamJobsEmployerIdentity();
  return {
    job,
    employerId: job.employerId,
    adminCanManageApplicants: job.employerId === canonicalEmployer.userId,
  };
};

export const assertAdminCanMutateLeamJobsApplicants = async (jobId) => {
  const { job, employerId, adminCanManageApplicants } = await assertAdminCanReadJobApplicants(jobId);

  if (!adminCanManageApplicants) {
    throw createForbiddenError('Admin can only manage applicants for LeamJobs-owned jobs');
  }

  return employerId;
};

export const listAdminApplications = async (jobId) => {
  const { employerId, adminCanManageApplicants } = await assertAdminCanReadJobApplicants(jobId);
  const data = await listEmployerApplications(employerId, jobId);
  return { ...data, adminCanManageApplicants };
};

export const getAdminApplication = async (jobId, applicationId) => {
  const { employerId, adminCanManageApplicants } = await assertAdminCanReadJobApplicants(jobId);
  const application = await getEmployerApplication(employerId, jobId, applicationId);
  return { application, adminCanManageApplicants };
};

export const getAdminApplicationResume = async (jobId, applicationId) => {
  const { employerId } = await assertAdminCanReadJobApplicants(jobId);
  return getEmployerApplicationResume(employerId, jobId, applicationId);
};

export const updateAdminApplicationStatus = async (jobId, applicationId, status) => {
  const employerId = await assertAdminCanMutateLeamJobsApplicants(jobId);
  return updateEmployerApplicationStatus(employerId, jobId, applicationId, status);
};

export const selectAdminContractApplication = async (jobId, applicationId) => {
  const employerId = await assertAdminCanMutateLeamJobsApplicants(jobId);
  return selectContractJobApplication(employerId, jobId, applicationId);
};
