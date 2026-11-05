import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { resolveAdminAccount } from './adminPermission.service.js';
import { normalizeEmail, sendAdminInvitationEmail } from './email.service.js';

const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const INVALID_INVITATION_MESSAGE = 'This invitation is invalid, expired, revoked, or has already been used.';

export class AdminStaffError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AdminStaffError';
    this.status = status;
    this.publicMessage = message;
  }
}

export class InvalidAdminInvitationError extends AdminStaffError {
  constructor() {
    super(INVALID_INVITATION_MESSAGE, 400);
    this.name = 'InvalidAdminInvitationError';
  }
}

export class AdminInvitationEmailError extends AdminStaffError {
  constructor() {
    super('The invitation was saved, but its email could not be delivered. Resend the invitation to try again.', 503);
    this.name = 'AdminInvitationEmailError';
  }
}

const conflict = (message) => new AdminStaffError(message, 409);
const forbidden = () => new AdminStaffError('Forbidden', 403);
const notFound = () => new AdminStaffError('Staff record not found', 404);
const invalidInvitation = () => new InvalidAdminInvitationError();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const createToken = () => crypto.randomBytes(32).toString('base64url');
const expiresIn48Hours = (now = new Date()) => new Date(now.getTime() + INVITATION_LIFETIME_MS);

const assertSuperAdmin = async (actorId, client) => {
  const account = await resolveAdminAccount(actorId, client);
  if (!account || account.tier !== 'SUPER_ADMIN') throw forbidden();
  return account;
};

const validatePermissionKeys = async (permissionKeys, client, allowEmpty = false) => {
  if (!Array.isArray(permissionKeys)
    || (!allowEmpty && permissionKeys.length === 0)
    || permissionKeys.some((key) => typeof key !== 'string' || !key.trim())
    || new Set(permissionKeys).size !== permissionKeys.length) {
    throw new AdminStaffError('Select one or more valid permissions.');
  }

  const permissions = await client.adminPermission.findMany({
    where: { key: { in: permissionKeys }, isEnabled: true },
    select: { key: true },
  });
  if (permissions.length !== permissionKeys.length) {
    throw new AdminStaffError('One or more selected permissions are unavailable.');
  }
  return permissionKeys;
};

const lockEmail = async (transaction, email) => {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
};

const lockInvitation = async (transaction, invitationId) => {
  await transaction.$queryRaw`SELECT "id" FROM "AdminInvitation" WHERE "id" = ${invitationId} FOR UPDATE`;
};

const writeAudit = (transaction, {
  actorId,
  subjectId,
  action,
  entityType,
  entityId,
  before = undefined,
  after = undefined,
  requestId = undefined,
}) => transaction.adminAuditEvent.create({
  data: {
    actorId,
    subjectId,
    action,
    entityType,
    entityId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(requestId ? { requestId } : {}),
  },
});

const invitationSelect = {
  id: true,
  email: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  createdById: true,
  permissions: { select: { permissionKey: true } },
};

const mapInvitation = (invitation) => ({
  id: invitation.id,
  email: invitation.email,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
  createdAt: invitation.createdAt,
  createdById: invitation.createdById,
  permissionKeys: invitation.permissions.map(({ permissionKey }) => permissionKey),
});

const buildInvitationLink = (rawToken) => {
  const configuredOrigin = env.FRONTEND_URL || env.FRONTEND_URL_PROD;
  if (!configuredOrigin) throw new AdminInvitationEmailError();

  let url;
  try {
    const origin = new URL(configuredOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      throw new Error('Invalid configured frontend origin');
    }
    url = new URL('/admin/accept-invitation', origin.origin);
  } catch {
    throw new AdminInvitationEmailError();
  }

  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
};

const deliverInvitation = async (email, invitationId, rawToken) => {
  try {
    await sendAdminInvitationEmail({
      recipientEmail: email,
      invitationId,
      link: buildInvitationLink(rawToken),
    });
  } catch {
    throw new AdminInvitationEmailError();
  }
};

const assertEmailUnused = async (client, email) => {
  const existingUser = await client.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existingUser) throw conflict('An account already exists for this email.');
};

export const createAdminInvitation = async (actorId, { email, permissionKeys }, requestId) => {
  await assertSuperAdmin(actorId, prisma);
  const normalizedEmail = normalizeEmail(email);
  const rawToken = createToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiresIn48Hours();

  const invitation = await prisma.$transaction(async (transaction) => {
    await lockEmail(transaction, normalizedEmail);
    await assertEmailUnused(transaction, normalizedEmail);
    await validatePermissionKeys(permissionKeys, transaction);

    const existing = await transaction.adminInvitation.findFirst({
      where: {
        email: normalizedEmail,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existing) throw conflict('A pending invitation already exists for this email.');

    const created = await transaction.adminInvitation.create({
      data: {
        email: normalizedEmail,
        tokenHash,
        expiresAt,
        createdById: actorId,
        permissions: {
          create: permissionKeys.map((permissionKey) => ({
            permission: { connect: { key: permissionKey } },
          })),
        },
      },
      select: invitationSelect,
    });
    await writeAudit(transaction, {
      actorId,
      subjectId: actorId,
      action: 'ADMIN_INVITATION_CREATED',
      entityType: 'ADMIN_INVITATION',
      entityId: created.id,
      after: { email: normalizedEmail, permissionKeys, expiresAt: expiresAt.toISOString() },
      requestId,
    });
    return created;
  });

  await deliverInvitation(normalizedEmail, invitation.id, rawToken);
  return { ...mapInvitation(invitation), emailSent: true };
};

export const resendAdminInvitation = async (actorId, invitationId, requestId) => {
  await assertSuperAdmin(actorId, prisma);
  const rawToken = createToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = expiresIn48Hours(now);

  const invitation = await prisma.$transaction(async (transaction) => {
    await lockInvitation(transaction, invitationId);
    const current = await transaction.adminInvitation.findUnique({
      where: { id: invitationId },
      select: invitationSelect,
    });
    if (!current || current.acceptedAt || current.revokedAt) throw invalidInvitation();

    await lockEmail(transaction, current.email);
    const duplicate = await transaction.adminInvitation.findFirst({
      where: {
        id: { not: invitationId },
        email: current.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (duplicate) throw conflict('Another pending invitation already exists for this email.');

    const updated = await transaction.adminInvitation.update({
      where: { id: invitationId },
      data: { tokenHash, expiresAt },
      select: invitationSelect,
    });
    await writeAudit(transaction, {
      actorId,
      subjectId: actorId,
      action: 'ADMIN_INVITATION_RESENT',
      entityType: 'ADMIN_INVITATION',
      entityId: invitationId,
      before: { expiresAt: current.expiresAt.toISOString() },
      after: { email: current.email, expiresAt: expiresAt.toISOString() },
      requestId,
    });
    return updated;
  });

  await deliverInvitation(invitation.email, invitation.id, rawToken);
  return { ...mapInvitation(invitation), emailSent: true };
};

export const revokeAdminInvitation = async (actorId, invitationId, requestId) => {
  await assertSuperAdmin(actorId, prisma);

  return prisma.$transaction(async (transaction) => {
    await lockInvitation(transaction, invitationId);
    const current = await transaction.adminInvitation.findUnique({
      where: { id: invitationId },
      select: invitationSelect,
    });
    if (!current || current.acceptedAt || current.revokedAt) throw invalidInvitation();

    const revokedAt = new Date();
    const updated = await transaction.adminInvitation.update({
      where: { id: invitationId },
      data: { revokedAt },
      select: invitationSelect,
    });
    await writeAudit(transaction, {
      actorId,
      subjectId: actorId,
      action: 'ADMIN_INVITATION_REVOKED',
      entityType: 'ADMIN_INVITATION',
      entityId: invitationId,
      before: { expiresAt: current.expiresAt.toISOString() },
      after: { email: current.email, revokedAt: revokedAt.toISOString() },
      requestId,
    });
    return mapInvitation(updated);
  });
};

export const acceptAdminInvitation = async ({ token, firstName, lastName, password }) => {
  const tokenHash = hashToken(token);
  const candidate = await prisma.adminInvitation.findUnique({
    where: { tokenHash },
    select: { id: true },
  });
  if (!candidate) throw invalidInvitation();

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockInvitation(transaction, candidate.id);
      const invitation = await transaction.adminInvitation.findFirst({
        where: { id: candidate.id, tokenHash },
        select: {
          ...invitationSelect,
          permissions: {
            select: {
              permissionKey: true,
              permission: { select: { isEnabled: true } },
            },
          },
        },
      });
      const now = new Date();
      if (!invitation
        || invitation.acceptedAt
        || invitation.revokedAt
        || invitation.expiresAt <= now
        || invitation.permissions.length === 0
        || invitation.permissions.some(({ permission }) => !permission?.isEnabled)) {
        throw invalidInvitation();
      }

      await lockEmail(transaction, invitation.email);
      const claimed = await transaction.adminInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw invalidInvitation();

      try {
        await assertEmailUnused(transaction, invitation.email);
      } catch (error) {
        if (error instanceof AdminStaffError && error.status === 409) throw invalidInvitation();
        throw error;
      }

      const user = await transaction.user.create({
        data: {
          firstName,
          lastName,
          email: invitation.email,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
          isVerified: true,
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, isVerified: true },
      });
      await transaction.adminAccount.create({
        data: { userId: user.id, tier: 'STAFF_ADMIN' },
      });

      const permissionKeys = invitation.permissions.map(({ permissionKey }) => permissionKey);
      await transaction.adminPermissionGrant.createMany({
        data: permissionKeys.map((permissionKey) => ({
          adminUserId: user.id,
          permissionKey,
          grantedById: invitation.createdById,
        })),
      });
      await transaction.adminPermissionGrantEvent.createMany({
        data: permissionKeys.map((permissionKey) => ({
          actorId: invitation.createdById,
          subjectId: user.id,
          permissionKey,
          action: 'GRANTED',
        })),
      });
      await writeAudit(transaction, {
        actorId: user.id,
        subjectId: user.id,
        action: 'ADMIN_INVITATION_ACCEPTED',
        entityType: 'ADMIN_INVITATION',
        entityId: invitation.id,
        after: { email: invitation.email, permissionKeys },
      });
      return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
    });
  } catch (error) {
    if (error?.code === 'P2002') throw invalidInvitation();
    throw error;
  }
};

const pagination = ({ page = 1, limit = 20 } = {}) => ({
  page: Number(page),
  limit: Number(limit),
  skip: (Number(page) - 1) * Number(limit),
});

const pageResult = (items, total, page, limit) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
});

export const listStaff = async (actorId, options) => {
  await assertSuperAdmin(actorId, prisma);
  const { page, limit, skip } = pagination(options);
  const where = {
    role: 'ADMIN',
    adminAccount: { is: { tier: 'STAFF_ADMIN' } },
  };
  const [accounts, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        adminAccount: {
          select: {
            tier: true,
            suspendedAt: true,
            grants: { select: { permissionKey: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return pageResult(accounts.map((account) => ({
    ...account,
    permissionKeys: account.adminAccount.grants.map(({ permissionKey }) => permissionKey),
  })), total, page, limit);
};

export const listAdminInvitations = async (actorId, options) => {
  await assertSuperAdmin(actorId, prisma);
  const { page, limit, skip } = pagination(options);
  const where = {};
  const [invitations, total] = await Promise.all([
    prisma.adminInvitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: invitationSelect,
    }),
    prisma.adminInvitation.count({ where }),
  ]);
  return pageResult(invitations.map(mapInvitation), total, page, limit);
};

export const listEnabledAdminPermissions = async (actorId) => {
  await assertSuperAdmin(actorId, prisma);
  return prisma.adminPermission.findMany({
    where: { isEnabled: true },
    orderBy: [{ module: 'asc' }, { key: 'asc' }],
    select: { key: true, module: true, description: true },
  });
};

const findStaff = async (client, userId) => {
  const user = await client.user.findFirst({
    where: {
      id: userId,
      role: 'ADMIN',
      adminAccount: { is: { tier: 'STAFF_ADMIN' } },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      isVerified: true,
      createdAt: true,
      lastLogin: true,
      adminAccount: {
        select: {
          tier: true,
          suspendedAt: true,
          grants: {
            select: {
              permissionKey: true,
              grantedAt: true,
              grantedById: true,
              permission: { select: { isEnabled: true, module: true, description: true } },
            },
          },
        },
      },
    },
  });
  if (!user) throw notFound();
  return {
    ...user,
    permissions: user.adminAccount.grants.map((grant) => ({
      key: grant.permissionKey,
      enabled: grant.permission.isEnabled,
      module: grant.permission.module,
      description: grant.permission.description,
      grantedAt: grant.grantedAt,
      grantedById: grant.grantedById,
    })),
  };
};

export const getStaffDetails = async (actorId, userId) => {
  await assertSuperAdmin(actorId, prisma);
  return findStaff(prisma, userId);
};

export const updateStaffPermissions = async (actorId, userId, permissionKeys, requestId) => {
  await assertSuperAdmin(actorId, prisma);
  if (actorId === userId) throw forbidden();

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "userId" FROM "AdminAccount" WHERE "userId" = ${userId} FOR UPDATE`;
    const staff = await transaction.adminAccount.findUnique({
      where: { userId },
      select: {
        userId: true,
        tier: true,
        user: { select: { id: true, role: true } },
        grants: { select: { permissionKey: true } },
      },
    });
    if (!staff || staff.user?.id !== userId || staff.user.role !== 'ADMIN' || staff.tier !== 'STAFF_ADMIN') {
      throw notFound();
    }

    await validatePermissionKeys(permissionKeys, transaction, true);
    const currentKeys = new Set(staff.grants.map(({ permissionKey }) => permissionKey));
    const requestedKeys = new Set(permissionKeys);
    const toRevoke = [...currentKeys].filter((key) => !requestedKeys.has(key));
    const toGrant = [...requestedKeys].filter((key) => !currentKeys.has(key));

    for (const permissionKey of toRevoke) {
      const removed = await transaction.adminPermissionGrant.deleteMany({
        where: { adminUserId: userId, permissionKey },
      });
      if (removed.count !== 1) throw conflict('Staff permissions changed concurrently. Retry the request.');
      await transaction.adminPermissionGrantEvent.create({
        data: { actorId, subjectId: userId, permissionKey, action: 'REVOKED' },
      });
      await writeAudit(transaction, {
        actorId,
        subjectId: userId,
        action: 'STAFF_PERMISSION_REVOKED',
        entityType: 'ADMIN_PERMISSION',
        entityId: permissionKey,
        before: { granted: true },
        after: { granted: false },
        requestId,
      });
    }

    for (const permissionKey of toGrant) {
      await transaction.adminPermissionGrant.create({
        data: { adminUserId: userId, permissionKey, grantedById: actorId },
      });
      await transaction.adminPermissionGrantEvent.create({
        data: { actorId, subjectId: userId, permissionKey, action: 'GRANTED' },
      });
      await writeAudit(transaction, {
        actorId,
        subjectId: userId,
        action: 'STAFF_PERMISSION_GRANTED',
        entityType: 'ADMIN_PERMISSION',
        entityId: permissionKey,
        before: { granted: false },
        after: { granted: true },
        requestId,
      });
    }

    return { userId, permissionKeys: [...requestedKeys].sort() };
  });
};

export const suspendStaff = async (actorId, userId, requestId) => {
  await assertSuperAdmin(actorId, prisma);
  if (actorId === userId) throw forbidden();

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "userId" FROM "AdminAccount" WHERE "userId" = ${userId} FOR UPDATE`;
    const account = await transaction.adminAccount.findUnique({
      where: { userId },
      select: {
        userId: true,
        tier: true,
        suspendedAt: true,
        user: { select: { id: true, role: true, isActive: true } },
      },
    });
    if (!account || account.user?.id !== userId || account.user.role !== 'ADMIN' || account.tier !== 'STAFF_ADMIN') {
      throw notFound();
    }
    if (account.suspendedAt || !account.user.isActive) throw conflict('Staff account is already inactive.');

    const suspendedAt = new Date();
    await transaction.user.update({ where: { id: userId }, data: { isActive: false } });
    await transaction.adminAccount.update({ where: { userId }, data: { suspendedAt } });
    await transaction.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: suspendedAt },
    });
    await writeAudit(transaction, {
      actorId,
      subjectId: userId,
      action: 'STAFF_SUSPENDED',
      entityType: 'ADMIN_ACCOUNT',
      entityId: userId,
      before: { isActive: true, suspendedAt: null },
      after: { isActive: false, suspendedAt: suspendedAt.toISOString() },
      requestId,
    });
    return { userId, isActive: false, suspendedAt };
  });
};

export const reactivateStaff = async (actorId, userId, requestId) => {
  await assertSuperAdmin(actorId, prisma);
  if (actorId === userId) throw forbidden();

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "userId" FROM "AdminAccount" WHERE "userId" = ${userId} FOR UPDATE`;
    const account = await transaction.adminAccount.findUnique({
      where: { userId },
      select: {
        userId: true,
        tier: true,
        suspendedAt: true,
        user: { select: { id: true, role: true, isActive: true } },
      },
    });
    if (!account || account.user?.id !== userId || account.user.role !== 'ADMIN' || account.tier !== 'STAFF_ADMIN') {
      throw notFound();
    }
    if (!account.suspendedAt || account.user.isActive) throw conflict('Staff account is not suspended.');

    await transaction.user.update({ where: { id: userId }, data: { isActive: true } });
    await transaction.adminAccount.update({ where: { userId }, data: { suspendedAt: null } });
    await writeAudit(transaction, {
      actorId,
      subjectId: userId,
      action: 'STAFF_REACTIVATED',
      entityType: 'ADMIN_ACCOUNT',
      entityId: userId,
      before: { isActive: false, suspendedAt: account.suspendedAt.toISOString() },
      after: { isActive: true, suspendedAt: null },
      requestId,
    });
    return { userId, isActive: true, suspendedAt: null };
  });
};

export const listStaffAuditHistory = async (actorId, userId, options) => {
  await assertSuperAdmin(actorId, prisma);
  const staff = await prisma.user.findFirst({
    where: { id: userId, role: 'ADMIN', adminAccount: { is: { tier: 'STAFF_ADMIN' } } },
    select: { id: true, email: true },
  });
  if (!staff) throw notFound();

  const invitationIds = await prisma.adminInvitation.findMany({
    where: { email: staff.email },
    select: { id: true },
  });
  const { page, limit, skip } = pagination(options);
  const where = {
    OR: [
      { subjectId: userId },
      ...(invitationIds.length ? [{ entityId: { in: invitationIds.map(({ id }) => id) } }] : []),
    ],
  };
  const [events, total] = await Promise.all([
    prisma.adminAuditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        actorId: true,
        subjectId: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        requestId: true,
        createdAt: true,
      },
    }),
    prisma.adminAuditEvent.count({ where }),
  ]);
  return pageResult(events, total, page, limit);
};
