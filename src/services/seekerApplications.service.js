import { prisma } from '../config/database.js';

export class ApplicationDuplicateError extends Error {
  constructor() {
    super('You have already applied to this job');
    this.name = 'ApplicationDuplicateError';
    this.status = 409;
  }
}

export class ApplicationJobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'ApplicationJobNotFoundError';
    this.status = 404;
  }
}

export class ApplicationJobClosedError extends Error {
  constructor() {
    super('This job is no longer accepting applications');
    this.name = 'ApplicationJobClosedError';
    this.status = 404;
  }
}

const applicationSelect = {
  id: true,
  jobId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  job: {
    select: {
      id: true,
      title: true,
      jobType: true,
      location: true,
      employer: {
        select: {
          employerProfile: { select: { companyName: true } },
        },
      },
    },
  },
};

const applicationJobSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  jobType: true,
  createdAt: true,
  applicationDeadline: true,
  employer: { select: { employerProfile: { select: { companyName: true } } } },
};

const mapApplication = (application) => ({
  id: application.id,
  jobId: application.jobId,
  jobTitle: application.job.title,
  companyName: application.job.employer.employerProfile?.companyName ?? null,
  jobType: application.job.jobType,
  location: application.job.location,
  status: application.status,
  appliedAt: application.createdAt,
  updatedAt: application.updatedAt,
});

const findApplicationJob = async (jobId) => {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'APPROVED' },
    select: applicationJobSelect,
  });

  if (!job) {
    throw new ApplicationJobNotFoundError();
  }

  if (job.applicationDeadline && job.applicationDeadline < new Date()) {
    throw new ApplicationJobClosedError();
  }

  return job;
};

export const getSeekerApplications = async (seekerId) => {
  const [applications, interviews] = await Promise.all([
    prisma.application.findMany({
      where: { seekerId },
      orderBy: { createdAt: 'desc' },
      select: applicationSelect,
    }),
    prisma.application.count({
      where: { seekerId, status: 'INTERVIEW' },
    }),
  ]);

  return {
    applications: applications.map(mapApplication),
    summary: {
      total: applications.length,
      interviews,
    },
  };
};

export const createSeekerApplication = async (seekerId, { jobId, coverLetter, resumeUrl }) => {
  const job = await findApplicationJob(jobId);

  const existingApplication = await prisma.application.findUnique({
    where: { seekerId_jobId: { seekerId, jobId } },
    select: { id: true },
  });

  if (existingApplication) {
    throw new ApplicationDuplicateError();
  }

  try {
    const application = await prisma.application.create({
      data: {
        seekerId,
        jobId,
        coverLetter,
        resumeUrl,
      },
      select: applicationSelect,
    });

    return mapApplication(application);
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new ApplicationDuplicateError();
    }

    throw error;
  }
};
