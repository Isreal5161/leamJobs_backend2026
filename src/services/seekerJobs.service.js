import { prisma } from '../config/database.js';

export class SeekerJobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'SeekerJobNotFoundError';
    this.status = 404;
  }
}

const companySelect = {
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  companySize: true,
  location: true,
  companyLogoUrl: true,
};

const jobSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  jobType: true,
  createdAt: true,
  applicationDeadline: true,
  employer: { select: { employerProfile: { select: companySelect } } },
  employmentCompensation: {
    select: { salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true },
  },
  freelanceCompensation: {
    select: { projectAmount: true, currency: true },
  },
};

const decimalToString = (value) => (value === null || value === undefined ? value : value.toString());

const mapCompany = (employer) => {
  const company = employer?.employerProfile;

  if (!company) return null;

  return {
    name: company.companyName,
    description: company.companyDescription,
    website: company.website,
    industry: company.industry,
    size: company.companySize,
    location: company.location,
    logoUrl: company.companyLogoUrl,
  };
};

const mapCompensation = (job) => {
  if (job.jobType === 'NORMAL_EMPLOYMENT') {
    const compensation = job.employmentCompensation;

    if (!compensation) return null;

    return {
      type: 'EMPLOYMENT',
      salaryMin: decimalToString(compensation.salaryMin),
      salaryMax: decimalToString(compensation.salaryMax),
      currency: compensation.currency,
      salaryPeriod: compensation.salaryPeriod,
    };
  }

  if (job.jobType === 'FREELANCE_PROJECT') {
    const compensation = job.freelanceCompensation;

    if (!compensation) return null;

    return {
      type: 'FREELANCE',
      projectAmount: decimalToString(compensation.projectAmount),
      currency: compensation.currency,
    };
  }

  return null;
};

export const mapSeekerJob = (job) => ({
  id: job.id,
  title: job.title,
  description: job.description,
  location: job.location,
  jobType: job.jobType,
  company: mapCompany(job.employer),
  compensation: mapCompensation(job),
  createdAt: job.createdAt,
});

export const findApprovedJob = async (jobId, seekerId) => {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'APPROVED' },
    select: jobSelect,
  });

  if (!job) {
    throw new SeekerJobNotFoundError();
  }

  const existingApplication = await prisma.application.findUnique({
    where: { seekerId_jobId: { seekerId, jobId } },
    select: { id: true },
  });

  return {
    job: mapSeekerJob(job),
    alreadyApplied: Boolean(existingApplication),
  };
};
