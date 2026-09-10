import { prisma } from '../config/database.js';
import { readObject } from './storage/storage.service.js';

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

const applicantSelect = {
  id: true,
  firstName: true,
  lastName: true,
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
    },
  },
};

const listSelect = {
  id: true,
  jobId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
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
    fullName: `${seeker.firstName} ${seeker.lastName}`.trim(),
    professionalTitle: profile?.professionalTitle ?? null,
    profilePictureUrl: null,
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
  };
};

const mapApplicationDetail = (application) => ({
  id: application.id,
  jobId: application.jobId,
  status: application.status,
  coverLetter: application.coverLetter,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
  resume: {
    available: Boolean(application.resumeObjectKey),
    submittedAt: application.resumeSubmittedAt,
    version: application.resumeVersion,
  },
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

  const updated = await prisma.application.update({
    where: { id: application.id },
    data: { status },
    select: detailSelect,
  });

  return mapApplicationDetail(updated);
};

export const getEmployerApplicationResume = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId, {
    id: true,
    resumeObjectKey: true,
  });

  if (!application || !application.resumeObjectKey) {
    throw new EmployerApplicationResumeUnavailableError();
  }

  return {
    buffer: await readObject(application.resumeObjectKey),
    objectKey: application.resumeObjectKey,
  };
};
