import { prisma } from '../config/database.js';
import { getLeamJobsEmployerIdentity } from './leamjobsEmployer.service.js';

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
    select: { amount: true, currency: true, duration: true, startMode: true, scheduledStartDate: true, expectedCompletionDate: true },
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
      startMode: job.contractCompensation.startMode,
      scheduledStartDate: job.contractCompensation.scheduledStartDate,
      expectedCompletionDate: job.contractCompensation.expectedCompletionDate,
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

export class AdminInvalidEmployerError extends Error {
  constructor() {
    super('Employer does not exist or is not eligible to own jobs');
    this.name = 'AdminInvalidEmployerError';
    this.status = 400;
  }
}

const compensationData = (payload) => {
  if (payload.engagementType === 'MONTHLY') {
    return {
      employmentCompensation: {
        create: {
          salaryMin: payload.monthlyCompensation.salaryMin ?? null,
          salaryMax: payload.monthlyCompensation.salaryMax ?? null,
          currency: payload.monthlyCompensation.currency,
          salaryPeriod: 'MONTHLY',
        },
      },
    };
  }

  if (payload.engagementType === 'CONTRACT') {
    const contract = payload.contractCompensation;
    return {
      contractCompensation: {
        create: {
          amount: contract.amount,
          currency: contract.currency,
          duration: contract.duration,
          ...(contract.startMode ? { startMode: contract.startMode } : {}),
          ...(contract.scheduledStartDate !== undefined ? { scheduledStartDate: contract.scheduledStartDate } : {}),
          ...(contract.expectedCompletionDate !== undefined ? { expectedCompletionDate: contract.expectedCompletionDate } : {}),
        },
      },
    };
  }

  return {
    freelanceCompensation: {
      create: {
        projectAmount: payload.freelanceCompensation.projectAmount,
        currency: payload.freelanceCompensation.currency,
      },
    },
  };
};

const jobData = (employerId, payload) => ({
  employerId,
  title: payload.title,
  description: payload.description,
  location: payload.location,
  department: payload.department || null,
  workArrangement: payload.workArrangement || null,
  engagementType: payload.engagementType,
  jobType: payload.jobType,
  skills: payload.skills,
  requirements: payload.requirements,
  responsibilities: payload.responsibilities,
  benefits: payload.benefits,
  applicationDeadline: payload.applicationDeadline || null,
});

const resolveRequestedEmployerId = async (employerId) => {
  if (!employerId || typeof employerId !== 'string') {
    return null;
  }

  const normalized = employerId.trim();
  const sentinelValues = new Set(['', 'leamjobs', 'LEAMJOBS', '__LEAMJOBS__', 'leamjobs-employer', 'LEAMJOBS-EMPLOYER']);

  if (sentinelValues.has(normalized)) {
    const leamJobsEmployer = await getLeamJobsEmployerIdentity();
    return leamJobsEmployer.userId;
  }

  return normalized;
};

const loadEmployerForAdminJob = async (employerId) => prisma.user.findUnique({
  where: { id: employerId },
  select: {
    id: true,
    role: true,
    employerProfile: { select: { id: true } },
  },
});

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

export const createAdminJob = async (adminId, employerId, payload) => {
  const resolvedEmployerId = await resolveRequestedEmployerId(employerId);

  if (!resolvedEmployerId) {
    throw new AdminInvalidEmployerError();
  }

  const employer = await loadEmployerForAdminJob(resolvedEmployerId);

  if (!employer || employer.role !== 'EMPLOYER' || !employer.employerProfile) {
    throw new AdminInvalidEmployerError();
  }

  const created = await prisma.job.create({
    data: {
      ...jobData(resolvedEmployerId, payload),
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: null,
      ...compensationData(payload),
    },
    select: jobSelect,
  });

  return mapAdminJob(created);
};

export const updateAdminJob = async (adminId, jobId, payload) => {
  const existing = await loadJobForAdmin(jobId);

  const employer = await loadEmployerForAdminJob(existing.employerId);
  if (!employer || employer.role !== 'EMPLOYER' || !employer.employerProfile) {
    throw new AdminInvalidEmployerError();
  }

  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.employmentCompensation.deleteMany({ where: { jobId } });
    await transaction.contractCompensation.deleteMany({ where: { jobId } });
    await transaction.freelanceCompensation.deleteMany({ where: { jobId } });

    return transaction.job.update({
      where: { id: jobId },
      data: {
        ...jobData(existing.employerId, payload),
        status: 'APPROVED',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
        closedAt: null,
        ...compensationData(payload),
      },
      select: jobSelect,
    });
  });

  return mapAdminJob(updated);
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
