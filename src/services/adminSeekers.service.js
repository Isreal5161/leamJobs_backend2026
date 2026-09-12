import { prisma } from '../config/database.js';

const adminSeekerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  isActive: true,
  isVerified: true,
  lastLogin: true,
  createdAt: true,
  seekerProfile: {
    select: {
      professionalTitle: true,
      location: true,
      skills: true,
      resumeUrl: true,
      resumeObjectKey: true,
      profilePictureUrl: true,
    },
  },
  _count: { select: { applications: true } },
};

const buildOrderBy = (sortBy, sortOrder) => {
  if (sortBy === 'name') return [{ firstName: sortOrder }, { lastName: sortOrder }, { id: 'asc' }];
  if (sortBy === 'applicationCount') return [{ applications: { _count: sortOrder } }, { id: 'asc' }];
  return [{ [sortBy]: sortOrder }, { id: 'asc' }];
};

const mapAdminSeeker = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  isActive: user.isActive,
  isVerified: user.isVerified,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  profile: user.seekerProfile ? {
    professionalTitle: user.seekerProfile.professionalTitle,
    location: user.seekerProfile.location,
    skills: user.seekerProfile.skills ?? [],
    hasResume: Boolean(user.seekerProfile.resumeUrl || user.seekerProfile.resumeObjectKey),
    profilePictureUrl: user.seekerProfile.profilePictureUrl,
  } : null,
  applicationCount: user._count.applications,
});

export const listAdminSeekers = async ({ page, limit, search, status, verification, location, sortBy, sortOrder }) => {
  const trimmedSearch = search?.trim();
  const trimmedLocation = location?.trim();
  const where = {
    role: 'SEEKER',
    ...(status ? { isActive: status === 'ACTIVE' } : {}),
    ...(verification ? { isVerified: verification === 'VERIFIED' } : {}),
    ...(trimmedLocation ? { seekerProfile: { is: { location: { contains: trimmedLocation, mode: 'insensitive' } } } } : {}),
    ...(trimmedSearch ? {
      OR: [
        { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
        { email: { contains: trimmedSearch, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [seekers, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: buildOrderBy(sortBy, sortOrder),
      skip: (page - 1) * limit,
      take: limit,
      select: adminSeekerSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    seekers: seekers.map(mapAdminSeeker),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};