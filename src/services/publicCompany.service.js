import { prisma } from '../config/database.js';
import { publicCompanyLogoUrl } from '../utils/publicImageUrls.js';
import { mapSeekerJob, publicJobSelect } from './seekerJobs.service.js';

export class PublicCompanyNotFoundError extends Error {
  constructor() {
    super('Company not found');
    this.name = 'PublicCompanyNotFoundError';
    this.status = 404;
  }
}

const publicProfileSelect = {
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  companySize: true,
  location: true,
  address: true,
  state: true,
  country: true,
  linkedinUrl: true,
  twitterUrl: true,
  facebookUrl: true,
  companyLogoUrl: true,
};

const mapCompanyProfile = (profile, employerId, verified) => ({
  id: employerId,
  name: profile.companyName,
  logoUrl: publicCompanyLogoUrl(employerId, profile.companyLogoUrl),
  verified,
  description: profile.companyDescription,
  industry: profile.industry,
  companySize: profile.companySize,
  website: profile.website,
  location: profile.location,
  address: profile.address,
  state: profile.state,
  country: profile.country,
  linkedinUrl: profile.linkedinUrl,
  twitterUrl: profile.twitterUrl,
  facebookUrl: profile.facebookUrl,
});

export const getPublicCompany = async (employerId, { page = 1, limit = 12 } = {}) => {
  const pageNumber = Number(page) || 1;
  const pageSize = Number(limit) || 12;
  const safePage = Math.max(1, pageNumber);
  const safeLimit = Math.min(Math.max(1, pageSize), 24);
  const skip = (safePage - 1) * safeLimit;

  const [employer, verification, jobsPosted, applicants, candidatesSelected] = await Promise.all([
    prisma.user.findUnique({
      where: { id: employerId, role: 'EMPLOYER' },
      select: { employerProfile: { select: publicProfileSelect } },
    }),
    prisma.employerVerification.findUnique({
      where: { userId: employerId },
      select: { status: true },
    }),
    prisma.job.count({ where: { employerId, status: 'APPROVED' } }),
    prisma.application.count({ where: { job: { employerId, status: 'APPROVED' } } }),
    prisma.contract.count({ where: { employerId, status: { not: 'CANCELLED' }, job: { status: 'APPROVED' } } }),
  ]);

  if (!employer?.employerProfile) throw new PublicCompanyNotFoundError();

  const [jobs, jobsTotal] = await Promise.all([
    prisma.job.findMany({
      where: { employerId, status: 'APPROVED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: safeLimit,
      select: publicJobSelect,
    }),
    prisma.job.count({ where: { employerId, status: 'APPROVED' } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(jobsTotal / safeLimit));

  return {
    company: mapCompanyProfile(employer.employerProfile, employerId, verification?.status === 'APPROVED'),
    statistics: {
      jobsPosted,
      applicants,
      candidatesSelected,
    },
    jobs: jobs.map(mapSeekerJob),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: jobsTotal,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
};