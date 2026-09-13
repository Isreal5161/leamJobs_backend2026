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

export const assertAdminCanAccessLeamJobsJob = async (jobId) => {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, employerId: true },
  });

  if (!job) {
    throw createNotFoundError('Job not found');
  }

  const canonicalEmployer = await getLeamJobsEmployerIdentity();

  if (job.employerId !== canonicalEmployer.userId) {
    throw createForbiddenError('Admin can only manage applicants for LeamJobs-owned jobs');
  }

  return canonicalEmployer.userId;
};

export const listAdminApplications = async (jobId) => {
  const employerId = await assertAdminCanAccessLeamJobsJob(jobId);
  return listEmployerApplications(employerId, jobId);
};

export const getAdminApplication = async (jobId, applicationId) => {
  const employerId = await assertAdminCanAccessLeamJobsJob(jobId);
  return getEmployerApplication(employerId, jobId, applicationId);
};

export const getAdminApplicationResume = async (jobId, applicationId) => {
  const employerId = await assertAdminCanAccessLeamJobsJob(jobId);
  return getEmployerApplicationResume(employerId, jobId, applicationId);
};

export const updateAdminApplicationStatus = async (jobId, applicationId, status) => {
  const employerId = await assertAdminCanAccessLeamJobsJob(jobId);
  return updateEmployerApplicationStatus(employerId, jobId, applicationId, status);
};

export const selectAdminContractApplication = async (jobId, applicationId) => {
  const employerId = await assertAdminCanAccessLeamJobsJob(jobId);
  return selectContractJobApplication(employerId, jobId, applicationId);
};
