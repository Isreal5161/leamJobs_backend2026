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
  department: true,
  workArrangement: true,
  engagementType: true,
  jobType: true,
  skills: true,
  requirements: true,
  responsibilities: true,
  benefits: true,
  createdAt: true,
  applicationDeadline: true,
  employer: { select: { employerProfile: { select: companySelect } } },
  employmentCompensation: {
    select: { salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true },
  },
  freelanceCompensation: {
    select: { projectAmount: true, currency: true },
  },
  contractCompensation: {
    select: { amount: true, currency: true, duration: true, startMode: true, scheduledStartDate: true, expectedCompletionDate: true },
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
  const engagementType = job.engagementType ?? (job.jobType === 'FREELANCE_PROJECT' ? 'FREELANCE' : 'MONTHLY');

  if (engagementType === 'MONTHLY') {
    const compensation = job.employmentCompensation;

    if (!compensation) return null;

    return {
      type: 'EMPLOYMENT',
      engagementType,
      salaryMin: decimalToString(compensation.salaryMin),
      salaryMax: decimalToString(compensation.salaryMax),
      currency: compensation.currency,
      salaryPeriod: compensation.salaryPeriod,
    };
  }

  if (engagementType === 'CONTRACT') {
    const compensation = job.contractCompensation;

    if (!compensation) return null;

    return {
      type: 'CONTRACT',
      engagementType,
      amount: decimalToString(compensation.amount),
      salaryMin: decimalToString(compensation.amount),
      salaryMax: null,
      salaryPeriod: compensation.duration ?? 'contract',
      currency: compensation.currency,
      duration: compensation.duration,
      startMode: compensation.startMode,
      scheduledStartDate: compensation.scheduledStartDate,
      expectedCompletionDate: compensation.expectedCompletionDate,
    };
  }

  if (job.jobType === 'FREELANCE_PROJECT') {
    const compensation = job.freelanceCompensation;

    if (!compensation) return null;

    return {
      type: 'FREELANCE',
      engagementType,
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
  department: job.department,
  workArrangement: job.workArrangement,
  engagementType: job.engagementType ?? (job.jobType === 'FREELANCE_PROJECT' ? 'FREELANCE' : 'MONTHLY'),
  jobType: job.jobType,
  skills: job.skills ?? [],
  requirements: job.requirements ?? null,
  responsibilities: job.responsibilities ?? [],
  benefits: job.benefits ?? [],
  applicationDeadline: job.applicationDeadline ?? null,
  company: mapCompany(job.employer),
  compensation: mapCompensation(job),
  createdAt: job.createdAt,
});

const buildJobWhere = ({ search, location, jobType, skills }) => ({
  status: 'APPROVED',
  ...(search ? {
    OR: [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ],
  } : {}),
  ...(location ? { location: { contains: location, mode: 'insensitive' } } : {}),
  ...(jobType ? { jobType } : {}),
  ...(skills?.length ? { skills: { hasSome: skills } } : {}),
});

export const listApprovedJobs = async ({ search, location, jobType, skills, limit, cursor }) => {
  const jobs = await prisma.job.findMany({
    where: buildJobWhere({ search, location, jobType, skills }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: jobSelect,
  });

  const hasNextPage = jobs.length > limit;
  const page = hasNextPage ? jobs.slice(0, limit) : jobs;
  return {
    jobs: page.map(mapSeekerJob),
    nextCursor: hasNextPage ? page[page.length - 1].id : null,
  };
};

export const findApprovedJob = async (jobId, seekerId) => {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'APPROVED' },
    select: jobSelect,
  });

  if (!job) {
    throw new SeekerJobNotFoundError();
  }

  const existingApplication = seekerId
    ? await prisma.application.findUnique({
      where: { seekerId_jobId: { seekerId, jobId } },
      select: { id: true },
    })
    : null;

  return {
    job: mapSeekerJob(job),
    alreadyApplied: Boolean(existingApplication),
  };
};
