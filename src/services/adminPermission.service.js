import { prisma } from '../config/database.js';

export const resolveAdminAccount = async (userId, database = prisma) => {
  if (typeof userId !== 'string' || userId.trim() === '') return null;

  const adminAccount = await database.adminAccount.findUnique({
    where: { userId },
    select: {
      userId: true,
      tier: true,
      suspendedAt: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });

  if (adminAccount?.userId !== userId
    || adminAccount.user?.id !== userId
    || adminAccount.user?.role !== 'ADMIN'
    || adminAccount.user?.isActive !== true
    || adminAccount.suspendedAt != null
    || !['SUPER_ADMIN', 'STAFF_ADMIN'].includes(adminAccount.tier)) {
    return null;
  }

  return {
    userId: adminAccount.userId,
    tier: adminAccount.tier,
  };
};

export const hasAdminPermission = async (adminContext, permissionKey, database = prisma) => {
  if (!adminContext
    || typeof permissionKey !== 'string'
    || permissionKey.trim() === ''
    || !['SUPER_ADMIN', 'STAFF_ADMIN'].includes(adminContext.tier)) {
    return false;
  }

  const permission = await database.adminPermission.findUnique({
    where: { key: permissionKey },
    select: { key: true, isEnabled: true },
  });
  if (!permission || !permission.isEnabled) return false;
  if (adminContext.tier === 'SUPER_ADMIN') return true;

  const grant = await database.adminPermissionGrant.findUnique({
    where: {
      adminUserId_permissionKey: {
        adminUserId: adminContext.userId,
        permissionKey,
      },
    },
    select: { adminUserId: true },
  });

  return grant?.adminUserId === adminContext.userId;
};

export const getEffectiveAdminPermissions = async (adminContext, database = prisma) => {
  if (!adminContext
    || typeof adminContext.userId !== 'string'
    || adminContext.userId.trim() === '') {
    return null;
  }

  if (adminContext.tier === 'SUPER_ADMIN') {
    return {
      tier: 'SUPER_ADMIN',
      isSuperAdmin: true,
      permissions: [],
    };
  }

  if (adminContext.tier !== 'STAFF_ADMIN') return null;

  const grants = await database.adminPermissionGrant.findMany({
    where: { adminUserId: adminContext.userId },
    select: {
      permissionKey: true,
      permission: {
        select: {
          key: true,
          isEnabled: true,
        },
      },
    },
    orderBy: { permissionKey: 'asc' },
  });

  return {
    tier: 'STAFF_ADMIN',
    isSuperAdmin: false,
    permissions: grants.flatMap(({ permissionKey, permission }) => (
      typeof permissionKey === 'string'
        && permission?.key === permissionKey
        && permission.isEnabled === true
        ? [permissionKey]
        : []
    )).sort(),
  };
};
