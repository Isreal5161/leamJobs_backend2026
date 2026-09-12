import { prisma } from '../config/database.js';

const adminUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  isVerified: true,
  lastLogin: true,
  createdAt: true,
  seekerProfile: {
    select: {
      location: true,
      professionalTitle: true,
    },
  },
  employerProfile: {
    select: {
      location: true,
      companyName: true,
    },
  },
};

const buildStatusWhere = (status) => {
  if (status === 'ACTIVE') return { isActive: true };
  if (status === 'INACTIVE') return { isActive: false };
  if (status === 'VERIFIED') return { isVerified: true };
  if (status === 'UNVERIFIED') return { isVerified: false };
  return {};
};

const buildOrderBy = (sortBy, sortOrder) => {
  if (sortBy === 'name') {
    return [{ firstName: sortOrder }, { lastName: sortOrder }, { id: 'asc' }];
  }

  return [{ [sortBy]: sortOrder }, { id: 'asc' }];
};

const mapAdminUser = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isActive: user.isActive,
  isVerified: user.isVerified,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  profile: user.role === 'SEEKER'
    ? {
      location: user.seekerProfile?.location ?? null,
      professionalTitle: user.seekerProfile?.professionalTitle ?? null,
      companyName: null,
    }
    : user.role === 'EMPLOYER'
      ? {
        location: user.employerProfile?.location ?? null,
        professionalTitle: null,
        companyName: user.employerProfile?.companyName ?? null,
      }
      : null,
});

export const listAdminUsers = async ({ page, limit, search, role, status, sortBy, sortOrder }) => {
  const trimmedSearch = search?.trim();
  const where = {
    ...(role ? { role } : {}),
    ...buildStatusWhere(status),
    ...(trimmedSearch
      ? {
        OR: [
          { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
          { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
          { email: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: buildOrderBy(sortBy, sortOrder),
      skip: (page - 1) * limit,
      take: limit,
      select: adminUserSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map(mapAdminUser),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};