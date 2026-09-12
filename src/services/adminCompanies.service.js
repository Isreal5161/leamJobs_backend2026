import { prisma } from '../config/database.js';

const adminCompanySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  isActive: true,
  isVerified: true,
  createdAt: true,
  employerProfile: {
    select: {
      id: true,
      companyName: true,
      companyDescription: true,
      website: true,
      industry: true,
      companySize: true,
      location: true,
      companyLogoUrl: true,
    },
  },
  _count: { select: { jobs: true } },
};

const buildOrderBy = (sortBy, sortOrder) => {
  if (sortBy === 'companyName') {
    return [{ employerProfile: { companyName: sortOrder } }, { id: 'asc' }];
  }

  if (sortBy === 'jobCount') {
    return [{ jobs: { _count: sortOrder } }, { id: 'asc' }];
  }

  return [{ createdAt: sortOrder }, { id: 'asc' }];
};

const mapAdminCompany = (user) => ({
  id: user.employerProfile.id,
  userId: user.id,
  companyName: user.employerProfile.companyName,
  companyDescription: user.employerProfile.companyDescription,
  website: user.employerProfile.website,
  industry: user.employerProfile.industry,
  companySize: user.employerProfile.companySize,
  location: user.employerProfile.location,
  companyLogoUrl: user.employerProfile.companyLogoUrl,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  isActive: user.isActive,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
  jobCount: user._count.jobs,
});

export const listAdminCompanies = async ({ page, limit, search, industry, companySize, sortBy, sortOrder }) => {
  const trimmedSearch = search?.trim();
  const profileWhere = {
    ...(industry?.trim() ? { industry: { equals: industry.trim(), mode: 'insensitive' } } : {}),
    ...(companySize?.trim() ? { companySize: { equals: companySize.trim(), mode: 'insensitive' } } : {}),
  };
  const where = {
    role: 'EMPLOYER',
    employerProfile: { is: profileWhere },
    ...(trimmedSearch
      ? {
        OR: [
          { email: { contains: trimmedSearch, mode: 'insensitive' } },
          { employerProfile: { is: { companyName: { contains: trimmedSearch, mode: 'insensitive' } } } },
        ],
      }
      : {}),
  };

  const [companies, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: buildOrderBy(sortBy, sortOrder),
      skip: (page - 1) * limit,
      take: limit,
      select: adminCompanySelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    companies: companies.map(mapAdminCompany),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};