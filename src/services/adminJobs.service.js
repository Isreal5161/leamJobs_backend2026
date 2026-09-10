import { prisma } from '../config/database.js';

const jobSelect = {
  id: true,
  employerId: true,
  title: true,
  description: true,
  location: true,
  department: true,
  workArrangement: true,
  engagementType: true,
  jobType: true,
  skills: true,
  requirements: true,
  responsibilities: true,
  benefits: true,
  status: true,
  applicationDeadline: true,
  rejectionReason: true,
  reviewedById: true,
  reviewedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  employer: { select: { employerProfile: { select: { companyName: true, companyDescription: true, website: true, industry: true, location: true, companyLogoUrl: true } } } },
  employmentCompensation: {
    select: { salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true },
  },
  contractCompensation: {
    select: { amount: true, currency: true, duration: true },
  },
  freelanceCompensation: {
    select: { projectAmount: true, currency: true },
  },
  _count: { select: { applications: true } },
};

const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items;
  return value ?? null;
};

const decimalToString = (value) => (value === null || value === undefined ? null : value.toString());

const mapCompany = (employer) => {
  const profile = employer?.employerProfile;
  if (!profile) return null;

  return {
    name: profile.companyName,
    description: profile.companyDescription,
    website: profile.website,
    industry: profile.industry,
    location: profile.location,
    logoUrl: profile.companyLogoUrl,
  };
};

const mapCompensation = (job) => {
  if (job.engagementType === 'MONTHLY') {
    return job.employmentCompensation ? {
      type: 'MONTHLY',
      salaryMin: decimalToString(job.employmentCompensation.salaryMin),
      salaryMax: decimalToString(job.employmentCompensation.salaryMax),
      currency: job.employmentCompensation.currency,
      salaryPeriod: job.employmentCompensation.salaryPeriod,
    } : null;
  }

  if (job.engagementType === 'CONTRACT') {
    return job.contractCompensation ? {
      type: 'CONTRACT',
      amount: decimalToString(job.contractCompensation.amount),
      currency: job.contractCompensation.currency,
      duration: job.contractCompensation.duration,
    } : null;
  }

  return job.freelanceCompensation ? {
    type: 'FREELANCE',
    projectAmount: decimalToString(job.freelanceCompensation.projectAmount),
    currency: job.freelanceCompensation.currency,
  } : null;
};

const mapAdminJob = (job) => ({
  id: job.id,
  employerId: job.employerId,
  title: job.title,
  description: job.description,
  location: job.location,
  department: job.department,
  workArrangement: job.workArrangement,
  engagementType: job.engagementType,
  jobType: job.jobType,
  skills: job.skills ?? [],
  requirements: toList(job.requirements),
  responsibilities: job.responsibilities ?? [],
  benefits: job.benefits ?? [],
  status: job.status,
  applicationDeadline: job.applicationDeadline,
  rejectionReason: job.rejectionReason,
  reviewedById: job.reviewedById,
  reviewedAt: job.reviewedAt,
  closedAt: job.closedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  company: mapCompany(job.employer),
  compensation: mapCompensation(job),
  applicantCount: job._count?.applications ?? 0,
});

export class AdminJobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'AdminJobNotFoundError';
    this.status = 404;
  }
}

export class AdminInvalidTransitionError extends Error {
  constructor(currentStatus, requestedStatus) {
    super(`Cannot transition a job from ${currentStatus} to ${requestedStatus}`);
    this.name = 'AdminInvalidTransitionError';
    this.status = 409;
  }
}

const loadJobForAdmin = async (jobId) => {
  const job = await prisma.job.findFirst({
    where: { id: jobId },
    select: jobSelect,
  });

  if (!job) {
    throw new AdminJobNotFoundError();
  }

  return job;
};

const assertAllowedTransition = (currentStatus, requestedStatus) => {
  if (currentStatus === 'PENDING' && (requestedStatus === 'APPROVED' || requestedStatus === 'REJECTED')) {
    return;
  }

  throw new AdminInvalidTransitionError(currentStatus, requestedStatus);
};

export const listAdminJobs = async ({ status } = {}) => {
  const jobs = await prisma.job.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: jobSelect,
  });

  return { jobs: jobs.map(mapAdminJob) };
};

export const getAdminJob = async (jobId) => {
  const existing = await loadJobForAdmin(jobId);
  return mapAdminJob(existing);
};

export const approveAdminJob = async (adminId, jobId) => {
  const existing = await loadJobForAdmin(jobId);
  assertAllowedTransition(existing.status, 'APPROVED');

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: null,
    },
    select: jobSelect,
  });

  return mapAdminJob(updated);
};

export const rejectAdminJob = async (adminId, jobId, rejectionReason) => {
  const existing = await loadJobForAdmin(jobId);
  assertAllowedTransition(existing.status, 'REJECTED');

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'REJECTED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason,
    },
    select: jobSelect,
  });

  return mapAdminJob(updated);
};

export const approveOrRejectJob = async (adminId, jobId, { status, rejectionReason }) => {
  if (status === 'APPROVED') {
    return approveAdminJob(adminId, jobId);
  }

  if (status === 'REJECTED') {
    return rejectAdminJob(adminId, jobId, String(rejectionReason ?? '').trim());
  }

  throw new AdminInvalidTransitionError('UNKNOWN', status);
};
