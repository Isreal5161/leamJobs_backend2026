import { prisma } from '../config/database.js';
import { AuthenticationRequiredError } from './auth.service.js';

const PROFILE_COMPLETION_FIELDS = 9;
const RECENT_APPLICATION_LIMIT = 5;
const APPROVED_JOB_LIMIT = 10;

const profileSelect = {
  id: true,
  professionalTitle: true,
  bio: true,
  location: true,
  skills: true,
  education: true,
  experience: true,
  resumeUrl: true,
  resumeObjectKey: true,
  profilePictureUrl: true,
  profilePictureKey: true,
};

const companySelect = {
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  companySize: true,
  location: true,
  companyLogoUrl: true,
};

const hasValue = (value) => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
};

const calculateProfileCompletion = (user) => {
  const profile = user.seekerProfile;

  if (!profile) return 0;

  const completedFields = [
    user.phone,
    profile.professionalTitle,
    profile.bio,
    profile.location,
    profile.skills,
    profile.education,
    profile.experience,
    profile.resumeUrl || profile.resumeObjectKey,
    profile.profilePictureUrl || profile.profilePictureKey,
  ].filter(hasValue).length;

  return Math.round((completedFields / PROFILE_COMPLETION_FIELDS) * 100);
};

const mapProfile = (user) => {
  if (!user.seekerProfile) return null;

  const profile = user.seekerProfile;

  return {
    id: profile.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    phone: user.phone,
    professionalTitle: profile.professionalTitle,
    location: profile.location,
    bio: profile.bio,
    skills: profile.skills,
    resume: profile.resumeUrl ? { url: profile.resumeUrl } : null,
    profileCompletion: calculateProfileCompletion(user),
  };
};

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

const decimalToString = (value) => (value === null || value === undefined ? value : value.toString());

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

const mapRecentApplication = (application) => ({
  id: application.id,
  jobTitle: application.job.title,
  companyName: application.job.employer.employerProfile?.companyName ?? null,
  status: application.status,
  appliedAt: application.createdAt,
});

const mapApprovedJob = (job) => ({
  id: job.id,
  title: job.title,
  description: job.description,
  location: job.location,
  jobType: job.jobType,
  company: mapCompany(job.employer),
  compensation: mapCompensation(job),
  createdAt: job.createdAt,
});

export const getSeekerDashboard = async (seekerId) => {
  const [user, appliedJobs, interviews, recentApplications, approvedJobs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: seekerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        seekerProfile: { select: profileSelect },
      },
    }),
    prisma.application.count({
      where: { seekerId },
    }),
    prisma.application.count({
      where: { seekerId, status: 'INTERVIEW' },
    }),
    prisma.application.findMany({
      where: { seekerId },
      orderBy: { createdAt: 'desc' },
      take: RECENT_APPLICATION_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
        job: {
          select: {
            title: true,
            employer: {
              select: {
                employerProfile: { select: { companyName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.job.findMany({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: APPROVED_JOB_LIMIT,
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        jobType: true,
        createdAt: true,
        employer: { select: { employerProfile: { select: companySelect } } },
        employmentCompensation: {
          select: { salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true },
        },
        freelanceCompensation: {
          select: { projectAmount: true, currency: true },
        },
      },
    }),
  ]);

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return {
    profile: mapProfile(user),
    stats: { appliedJobs, interviews },
    recentApplications: recentApplications.map(mapRecentApplication),
    approvedJobs: approvedJobs.map(mapApprovedJob),
  };
};
