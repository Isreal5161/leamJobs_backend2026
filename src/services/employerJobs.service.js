import { prisma } from '../config/database.js';

const employerProfileSelect = {
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  location: true,
  companyLogoUrl: true,
};

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
  reviewedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  employer: { select: { employerProfile: { select: employerProfileSelect } } },
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

const decimalToString = (value) => (value === null || value === undefined ? null : value.toString());

const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items;
  return value ?? null;
};

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

export const mapEmployerJob = (job) => ({
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
  reviewedAt: job.reviewedAt,
  closedAt: job.closedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  company: mapCompany(job.employer),
  compensation: mapCompensation(job),
  applicantCount: job._count?.applications ?? 0,
});

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

export class EmployerJobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'EmployerJobNotFoundError';
    this.status = 404;
  }
}

const findOwnedJob = (employerId, jobId) => prisma.job.findFirst({
  where: { id: jobId, employerId },
  select: jobSelect,
});

export const listEmployerJobs = async (employerId) => {
  const jobs = await prisma.job.findMany({
    where: { employerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: jobSelect,
  });

  return { jobs: jobs.map(mapEmployerJob) };
};

export const createEmployerJob = async (employerId, payload) => {
  const job = await prisma.job.create({
    data: {
      ...jobData(employerId, payload),
      status: 'PENDING',
      ...compensationData(payload),
    },
    select: jobSelect,
  });

  return mapEmployerJob(job);
};

export const getEmployerJob = async (employerId, jobId) => {
  const job = await findOwnedJob(employerId, jobId);
  if (!job) throw new EmployerJobNotFoundError();
  return mapEmployerJob(job);
};

export const updateEmployerJob = async (employerId, jobId, payload) => {
  const existing = await findOwnedJob(employerId, jobId);
  if (!existing) throw new EmployerJobNotFoundError();

  const job = await prisma.$transaction(async (transaction) => {
    await transaction.employmentCompensation.deleteMany({ where: { jobId } });
    await transaction.contractCompensation.deleteMany({ where: { jobId } });
    await transaction.freelanceCompensation.deleteMany({ where: { jobId } });

    return transaction.job.update({
      where: { id: jobId },
      data: {
        ...jobData(employerId, payload),
        status: existing.status === 'APPROVED' ? 'PENDING' : existing.status,
        reviewedAt: existing.status === 'APPROVED' ? null : existing.reviewedAt,
        reviewedById: existing.status === 'APPROVED' ? null : undefined,
        rejectionReason: existing.status === 'REJECTED' ? null : undefined,
        closedAt: existing.status === 'CLOSED' ? null : undefined,
        ...compensationData(payload),
      },
      select: jobSelect,
    });
  });

  return mapEmployerJob(job);
};

export const closeEmployerJob = async (employerId, jobId) => {
  const result = await prisma.job.updateMany({
    where: { id: jobId, employerId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  if (result.count === 0) throw new EmployerJobNotFoundError();
  return getEmployerJob(employerId, jobId);
};
