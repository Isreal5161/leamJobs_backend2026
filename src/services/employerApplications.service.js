import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { readObject } from './storage/storage.service.js';
import { getActivePlatformFeePercentage } from './platformFee.service.js';

const applicationStatuses = ['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'REJECTED', 'ACCEPTED', 'WITHDRAWN'];

export class EmployerApplicationNotFoundError extends Error {
  constructor() {
    super('Application not found');
    this.name = 'EmployerApplicationNotFoundError';
    this.status = 404;
  }
}

export class EmployerApplicationResumeUnavailableError extends Error {
  constructor() {
    super('CV not available for this application');
    this.name = 'EmployerApplicationResumeUnavailableError';
    this.status = 404;
  }
}

export class FreelanceContractCreationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FreelanceContractCreationError';
    this.status = 422;
  }
}

const applicantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  seekerProfile: {
    select: {
      professionalTitle: true,
      profilePictureUrl: true,
      country: true,
      state: true,
      city: true,
      location: true,
      bio: true,
      skills: true,
      education: true,
      experience: true,
      certifications: true,
      languages: true,
      projects: true,
      linkedinUrl: true,
      resumeObjectKey: true,
      cvTemplate: true,
    },
  },
};

const listSelect = {
  id: true,
  jobId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  contract: { select: { id: true } },
  seeker: { select: applicantSelect },
  job: { select: { id: true, title: true, employerId: true } },
};

const detailSelect = {
  id: true,
  jobId: true,
  status: true,
  coverLetter: true,
  resumeUrl: true,
  resumeObjectKey: true,
  resumeVersion: true,
  resumeSubmittedAt: true,
  createdAt: true,
  updatedAt: true,
  contract: { select: { id: true } },
  seeker: { select: applicantSelect },
  job: { select: { id: true, title: true, employerId: true } },
};

const assertStatus = (status) => {
  if (!applicationStatuses.includes(status)) {
    const error = new Error('Invalid application status');
    error.status = 400;
    throw error;
  }
};

const mapApplicant = (seeker) => {
  const profile = seeker.seekerProfile;
  return {
    id: seeker.id,
    firstName: seeker.firstName,
    lastName: seeker.lastName,
    email: seeker.email,
    phone: seeker.phone ?? null,
    fullName: `${seeker.firstName} ${seeker.lastName}`.trim(),
    professionalTitle: profile?.professionalTitle ?? null,
    profilePictureUrl: profile?.profilePictureUrl ?? null,
    location: profile?.location ?? null,
    country: profile?.country ?? null,
    state: profile?.state ?? null,
    city: profile?.city ?? null,
    bio: profile?.bio ?? null,
    skills: profile?.skills ?? [],
    education: profile?.education ?? null,
    experience: profile?.experience ?? null,
    certifications: profile?.certifications ?? null,
    languages: profile?.languages ?? null,
    projects: profile?.projects ?? null,
    linkedinUrl: profile?.linkedinUrl ?? null,
    cvTemplate: profile?.cvTemplate ?? null,
  };
};

const mapApplicationListItem = (application) => {
  const { id, ...applicant } = mapApplicant(application.seeker);
  return {
    id: application.id,
    jobId: application.jobId,
    jobTitle: application.job.title,
    applicant,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    contractId: application.contract?.id ?? null,
  };
};

const mapApplicationDetail = (application) => ({
  id: application.id,
  jobId: application.jobId,
  status: application.status,
  coverLetter: application.coverLetter,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
  contractId: application.contract?.id ?? null,
  resume: (() => {
    const source = application.resumeObjectKey
      ? 'application'
      : application.seeker.seekerProfile?.resumeObjectKey
        ? 'profile'
        : application.seeker.seekerProfile?.cvTemplate
          ? 'template'
          : null;
    return {
    available: Boolean(source),
    source,
    submittedAt: application.resumeSubmittedAt,
    version: application.resumeVersion,
    };
  })(),
  job: {
    id: application.job.id,
    title: application.job.title,
  },
  applicant: mapApplicant(application.seeker),
});

const ownedApplicationWhere = (employerId, jobId, applicationId) => ({
  id: applicationId,
  jobId,
  job: { employerId },
});

const findOwnedApplication = (employerId, jobId, applicationId, select = detailSelect) => prisma.application.findFirst({
  where: ownedApplicationWhere(employerId, jobId, applicationId),
  select,
});

export const listEmployerApplications = async (employerId, jobId) => {
  const applications = await prisma.application.findMany({
    where: { jobId, job: { employerId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: listSelect,
  });

  return { applications: applications.map(mapApplicationListItem) };
};

export const getEmployerApplication = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId);
  if (!application) throw new EmployerApplicationNotFoundError();
  return mapApplicationDetail(application);
};

export const updateEmployerApplicationStatus = async (employerId, jobId, applicationId, status) => {
  assertStatus(status);
  const application = await findOwnedApplication(employerId, jobId, applicationId, { id: true });
  if (!application) throw new EmployerApplicationNotFoundError();

  if (status !== 'ACCEPTED') {
    const updated = await prisma.application.update({
      where: { id: application.id },
      data: { status },
      select: detailSelect,
    });
    return mapApplicationDetail(updated);
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Application"
      WHERE "id" = ${applicationId}
      FOR UPDATE
    `;

    const application = await transaction.application.findFirst({
      where: ownedApplicationWhere(employerId, jobId, applicationId),
      select: {
        id: true,
        jobId: true,
        seekerId: true,
        status: true,
        contract: { select: { id: true } },
        seeker: { select: { id: true } },
        job: {
          select: {
            id: true,
            employerId: true,
            jobType: true,
            engagementType: true,
            freelanceCompensation: { select: { projectAmount: true, currency: true } },
          },
        },
      },
    });

    if (!application) throw new EmployerApplicationNotFoundError();

    if (application.job.jobType !== 'FREELANCE_PROJECT' || application.job.engagementType !== 'FREELANCE') {
      const updated = await transaction.application.update({
        where: { id: application.id },
        data: { status: 'ACCEPTED' },
        select: detailSelect,
      });
      return mapApplicationDetail(updated);
    }

    if (!application.job.freelanceCompensation) {
      throw new FreelanceContractCreationError('Freelance compensation is unavailable for this job');
    }

    if (application.contract) {
      const existing = await transaction.application.findFirst({
        where: { id: application.id },
        select: detailSelect,
      });
      return mapApplicationDetail(existing);
    }

    const agreedAmount = new Prisma.Decimal(application.job.freelanceCompensation.projectAmount);
    const currency = application.job.freelanceCompensation.currency;
    const platformFeePercentage = await getActivePlatformFeePercentage(transaction);
    const platformFeeAmount = agreedAmount.mul(platformFeePercentage).dividedBy(100).toDecimalPlaces(2);
    const seekerNetAmount = agreedAmount.minus(platformFeeAmount).toDecimalPlaces(2);

    await transaction.contract.create({
      data: {
        applicationId: application.id,
        jobId: application.job.id,
        employerId: application.job.employerId,
        seekerId: application.seeker.id,
        type: 'FREELANCE_PROJECT',
        status: 'PENDING',
        freelanceDetails: {
          create: {
            agreedAmount,
            currency,
            platformFeePercentage,
            platformFeeAmount,
            seekerNetAmount,
            employerConfirmedAt: null,
            seekerConfirmedAt: null,
            workStatus: 'PENDING',
          },
        },
      },
    });

    const updated = await transaction.application.update({
      where: { id: application.id },
      data: { status: 'ACCEPTED' },
      select: detailSelect,
    });

    return mapApplicationDetail(updated);
  }).catch(async (error) => {
    if (error?.code !== 'P2002') throw error;

    const existing = await findOwnedApplication(employerId, jobId, applicationId, detailSelect);
    if (!existing?.contract) throw error;
    return mapApplicationDetail(existing);
  });
};

export const getEmployerApplicationResume = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId, {
    id: true,
    resumeObjectKey: true,
    seeker: { select: { seekerProfile: { select: { resumeObjectKey: true } } } },
  });

  const objectKey = application?.resumeObjectKey ?? application?.seeker?.seekerProfile?.resumeObjectKey;
  if (!application || !objectKey) {
    throw new EmployerApplicationResumeUnavailableError();
  }

  return {
    buffer: await readObject(objectKey),
    objectKey,
  };
};
