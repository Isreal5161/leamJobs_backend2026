import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-staff-test-secret';
process.env.JWT_ISSUER = 'admin-staff-test-issuer';
process.env.JWT_AUDIENCE = 'admin-staff-test-audience';
process.env.FRONTEND_URL = 'https://leamjobs.example';

const mockSendAdminInvitationEmail = jest.fn();
const mockResolveAdminAccount = jest.fn();
const mockBcryptHash = jest.fn();

const mockPrisma = {
  adminInvitation: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/adminPermission.service.js', () => ({
  resolveAdminAccount: mockResolveAdminAccount,
}));
jest.unstable_mockModule('../src/services/email.service.js', () => ({
  normalizeEmail: (value) => String(value ?? '').trim().toLowerCase(),
  sendAdminInvitationEmail: mockSendAdminInvitationEmail,
}));
jest.unstable_mockModule('bcrypt', () => ({
  default: { hash: mockBcryptHash },
}));

const staffService = await import('../src/services/adminStaff.service.js');
const {
  acceptAdminInvitation,
  createAdminInvitation,
  reactivateStaff,
  resendAdminInvitation,
  revokeAdminInvitation,
  suspendStaff,
  updateStaffPermissions,
  InvalidAdminInvitationError,
} = staffService;

const invitation = (overrides = {}) => ({
  id: 'invitation-1',
  email: 'staff@example.com',
  tokenHash: 'old-token-hash',
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  createdById: 'super-admin',
  permissions: [{ permissionKey: 'jobs.view' }],
  ...overrides,
});

const createTransaction = () => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  adminPermission: { findMany: jest.fn().mockResolvedValue([{ key: 'jobs.view' }]) },
  adminInvitation: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  adminAccount: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  adminPermissionGrant: {
    create: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  adminPermissionGrantEvent: { create: jest.fn(), createMany: jest.fn() },
  adminAuditEvent: { create: jest.fn() },
  authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  user: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  },
});

let transaction;

beforeEach(() => {
  jest.resetAllMocks();
  transaction = createTransaction();
  mockResolveAdminAccount.mockResolvedValue({ userId: 'super-admin', tier: 'SUPER_ADMIN' });
  mockBcryptHash.mockResolvedValue('bcrypt-hash');
  mockSendAdminInvitationEmail.mockResolvedValue(undefined);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));
});

test('creates a normalized 48-hour invitation with only a token hash persisted', async () => {
  transaction.adminInvitation.create.mockImplementation(async ({ data }) => ({
    ...invitation({
      email: data.email,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      createdById: data.createdById,
      permissions: data.permissions.create.map(({ permission }) => ({ permissionKey: permission.connect.key })),
    }),
  }));
  const startedAt = Date.now();

  const result = await createAdminInvitation('super-admin', {
    email: '  Staff@Example.com ',
    permissionKeys: ['jobs.view'],
  });

  const createData = transaction.adminInvitation.create.mock.calls[0][0].data;
  const emailCall = mockSendAdminInvitationEmail.mock.calls[0][0];
  const rawToken = new URLSearchParams(new URL(emailCall.link).hash.slice(1)).get('token');
  const expectedHash = (await import('node:crypto')).createHash('sha256').update(rawToken).digest('hex');
  expect(createData.email).toBe('staff@example.com');
  expect(createData.tokenHash).toBe(expectedHash);
  expect(createData.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 48 * 60 * 60 * 1000);
  expect(createData.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 48 * 60 * 60 * 1000 + 100);
  expect(emailCall.link).toMatch(/^https:\/\/leamjobs\.example\/admin\/accept-invitation#token=/);
  expect(JSON.stringify({ createData, result })).not.toContain(rawToken);
  expect(result).toMatchObject({ email: 'staff@example.com', permissionKeys: ['jobs.view'], emailSent: true });
  expect(transaction.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: 'ADMIN_INVITATION_CREATED' }),
  }));
});

test('rejects duplicate active invitations and disabled permissions', async () => {
  transaction.adminInvitation.findFirst.mockResolvedValueOnce({ id: 'existing-invitation' });
  await expect(createAdminInvitation('super-admin', {
    email: 'staff@example.com',
    permissionKeys: ['jobs.view'],
  })).rejects.toMatchObject({ status: 409 });
  expect(mockSendAdminInvitationEmail).not.toHaveBeenCalled();

  transaction.adminInvitation.findFirst.mockResolvedValue(null);
  transaction.adminPermission.findMany.mockResolvedValue([]);
  await expect(createAdminInvitation('super-admin', {
    email: 'other@example.com',
    permissionKeys: ['unknown.permission'],
  })).rejects.toMatchObject({ status: 400 });
  expect(transaction.adminInvitation.create).not.toHaveBeenCalled();
});

test('only a database-resolved Super Admin can create invitations', async () => {
  mockResolveAdminAccount.mockResolvedValue({ userId: 'staff-user', tier: 'STAFF_ADMIN' });

  await expect(createAdminInvitation('staff-user', {
    email: 'another@example.com',
    permissionKeys: ['jobs.view'],
  })).rejects.toMatchObject({ status: 403 });
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('concurrent invitation creation is serialized by normalized email', async () => {
  let activeInvitation = false;
  let transactionQueue = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const result = transactionQueue.then(() => callback(transaction));
    transactionQueue = result.catch(() => undefined);
    return result;
  });
  transaction.adminInvitation.findFirst.mockImplementation(async () => (
    activeInvitation ? { id: 'existing-invitation' } : null
  ));
  transaction.adminInvitation.create.mockImplementation(async ({ data }) => {
    activeInvitation = true;
    return invitation({
      email: data.email,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      permissions: [{ permissionKey: 'jobs.view' }],
    });
  });

  const results = await Promise.allSettled([
    createAdminInvitation('super-admin', { email: 'STAFF@example.com', permissionKeys: ['jobs.view'] }),
    createAdminInvitation('super-admin', { email: 'staff@example.com', permissionKeys: ['jobs.view'] }),
  ]);

  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  expect(mockSendAdminInvitationEmail).toHaveBeenCalledTimes(1);
});

test('does not expose a generated token when email delivery fails', async () => {
  transaction.adminInvitation.create.mockImplementation(async ({ data }) => invitation({
    email: data.email,
    tokenHash: data.tokenHash,
    expiresAt: data.expiresAt,
    permissions: [{ permissionKey: 'jobs.view' }],
  }));
  mockSendAdminInvitationEmail.mockRejectedValue(new Error('smtp failed'));

  await expect(createAdminInvitation('super-admin', {
    email: 'staff@example.com',
    permissionKeys: ['jobs.view'],
  })).rejects.toMatchObject({
    status: 503,
    message: expect.not.stringContaining('smtp failed'),
  });
  const publicError = mockSendAdminInvitationEmail.mock.calls[0][0];
  expect(publicError.link).toContain('#token=');
});

test('resend rotates the token and expiry; revoke makes the invitation unusable', async () => {
  transaction.adminInvitation.findUnique.mockResolvedValue(invitation());
  transaction.adminInvitation.update.mockImplementation(async ({ data }) => invitation(data));

  const resent = await resendAdminInvitation('super-admin', 'invitation-1');
  const oldTokenHash = 'old-token-hash';
  const newTokenHash = transaction.adminInvitation.update.mock.calls[0][0].data.tokenHash;
  expect(newTokenHash).not.toBe(oldTokenHash);
  expect(resent.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);
  expect(transaction.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: 'ADMIN_INVITATION_RESENT' }),
  }));

  transaction.adminInvitation.findUnique.mockResolvedValue(invitation());
  transaction.adminInvitation.update.mockResolvedValue(invitation({ revokedAt: new Date() }));
  await revokeAdminInvitation('super-admin', 'invitation-1');
  expect(transaction.adminInvitation.update).toHaveBeenLastCalledWith(expect.objectContaining({
    data: { revokedAt: expect.any(Date) },
  }));
  expect(transaction.adminAuditEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: 'ADMIN_INVITATION_REVOKED' }),
  }));
});

test('acceptance creates an ADMIN staff account and exactly the invited grants atomically', async () => {
  mockPrisma.adminInvitation.findUnique.mockResolvedValue({ id: 'invitation-1' });
  transaction.adminInvitation.findFirst.mockResolvedValue(invitation({
    tokenHash: 'ignored-by-mock',
    permissions: [{ permissionKey: 'jobs.view', permission: { isEnabled: true } }],
  }));
  transaction.user.create.mockResolvedValue({
    id: 'staff-user',
    email: 'staff@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'ADMIN',
    isActive: true,
    isVerified: true,
  });

  const result = await acceptAdminInvitation({
    token: 'invitation-token',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  });

  expect(result).toEqual({ id: 'staff-user', email: 'staff@example.com', firstName: 'Ada', lastName: 'Lovelace' });
  expect(transaction.user.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      email: 'staff@example.com',
      role: 'ADMIN',
      isActive: true,
      isVerified: true,
      passwordHash: 'bcrypt-hash',
    }),
  }));
  expect(transaction.adminAccount.create).toHaveBeenCalledWith({
    data: { userId: 'staff-user', tier: 'STAFF_ADMIN' },
  });
  expect(transaction.adminPermissionGrant.createMany).toHaveBeenCalledWith({
    data: [{ adminUserId: 'staff-user', permissionKey: 'jobs.view', grantedById: 'super-admin' }],
  });
  expect(transaction.adminPermissionGrantEvent.createMany).toHaveBeenCalledWith({
    data: [{ actorId: 'super-admin', subjectId: 'staff-user', permissionKey: 'jobs.view', action: 'GRANTED' }],
  });
  expect(transaction.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      actorId: 'staff-user',
      action: 'ADMIN_INVITATION_ACCEPTED',
      subjectId: 'staff-user',
    }),
  }));
});

test('concurrent acceptance attempts activate the invitation exactly once', async () => {
  const currentInvitation = invitation({
    permissions: [{ permissionKey: 'jobs.view', permission: { isEnabled: true } }],
  });
  mockPrisma.adminInvitation.findUnique.mockResolvedValue({ id: currentInvitation.id });
  transaction.adminInvitation.findFirst.mockImplementation(async () => currentInvitation);
  transaction.adminInvitation.updateMany.mockImplementation(async () => {
    if (currentInvitation.acceptedAt) return { count: 0 };
    currentInvitation.acceptedAt = new Date();
    return { count: 1 };
  });
  transaction.user.create.mockResolvedValue({
    id: 'staff-user',
    email: currentInvitation.email,
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
  let transactionQueue = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const result = transactionQueue.then(() => callback(transaction));
    transactionQueue = result.catch(() => undefined);
    return result;
  });

  const attempts = [
    acceptAdminInvitation({ token: 'same-token', firstName: 'Ada', lastName: 'Lovelace', password: 'StrongPass1!' }),
    acceptAdminInvitation({ token: 'same-token', firstName: 'Ada', lastName: 'Lovelace', password: 'StrongPass1!' }),
  ];
  const results = await Promise.allSettled(attempts);

  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  expect(transaction.user.create).toHaveBeenCalledTimes(1);
});

test.each([
  ['expired', invitation({ expiresAt: new Date(Date.now() - 1) })],
  ['revoked', invitation({ revokedAt: new Date() })],
  ['already accepted', invitation({ acceptedAt: new Date() })],
  ['disabled permission', invitation({ permissions: [{ permissionKey: 'jobs.view', permission: { isEnabled: false } }] })],
])('rejects %s invitations without creating users', async (_label, currentInvitation) => {
  mockPrisma.adminInvitation.findUnique.mockResolvedValue({ id: 'invitation-1' });
  transaction.adminInvitation.findFirst.mockResolvedValue(currentInvitation);

  await expect(acceptAdminInvitation({
    token: 'invitation-token',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  })).rejects.toBeInstanceOf(InvalidAdminInvitationError);
  expect(transaction.user.create).not.toHaveBeenCalled();
});

test('rejects an invitation if the email already belongs to a user', async () => {
  mockPrisma.adminInvitation.findUnique.mockResolvedValue({ id: 'invitation-1' });
  transaction.adminInvitation.findFirst.mockResolvedValue(invitation({
    permissions: [{ permissionKey: 'jobs.view', permission: { isEnabled: true } }],
  }));
  transaction.user.findFirst.mockResolvedValue({ id: 'existing-user' });

  await expect(acceptAdminInvitation({
    token: 'invitation-token',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  })).rejects.toBeInstanceOf(InvalidAdminInvitationError);
  expect(transaction.user.create).not.toHaveBeenCalled();
});

test('account or grant failure stops before audit completion', async () => {
  mockPrisma.adminInvitation.findUnique.mockResolvedValue({ id: 'invitation-1' });
  transaction.adminInvitation.findFirst.mockResolvedValue(invitation({
    permissions: [{ permissionKey: 'jobs.view', permission: { isEnabled: true } }],
  }));
  transaction.user.create.mockRejectedValueOnce(new Error('user insert failed'));
  await expect(acceptAdminInvitation({
    token: 'invitation-token',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  })).rejects.toThrow('user insert failed');
  expect(transaction.adminAccount.create).not.toHaveBeenCalled();
  expect(transaction.adminAuditEvent.create).not.toHaveBeenCalled();

  transaction.user.create.mockResolvedValueOnce({
    id: 'staff-user',
    email: 'staff@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
  transaction.adminPermissionGrant.createMany.mockRejectedValueOnce(new Error('grant insert failed'));
  await expect(acceptAdminInvitation({
    token: 'another-invitation-token',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'StrongPass1!',
  })).rejects.toThrow('grant insert failed');
  expect(transaction.adminAuditEvent.create).not.toHaveBeenCalled();
});

test('permission updates emit grant and revoke history only for actual changes', async () => {
  transaction.adminAccount.findUnique.mockResolvedValue({
    userId: 'staff-user',
    tier: 'STAFF_ADMIN',
    user: { id: 'staff-user', role: 'ADMIN' },
    grants: [{ permissionKey: 'jobs.view' }],
  });
  transaction.adminPermission.findMany.mockResolvedValue([{ key: 'jobs.edit' }]);

  await updateStaffPermissions('super-admin', 'staff-user', ['jobs.edit']);

  expect(transaction.adminPermissionGrant.deleteMany).toHaveBeenCalledWith({
    where: { adminUserId: 'staff-user', permissionKey: 'jobs.view' },
  });
  expect(transaction.adminPermissionGrant.create).toHaveBeenCalledWith({
    data: { adminUserId: 'staff-user', permissionKey: 'jobs.edit', grantedById: 'super-admin' },
  });
  expect(transaction.adminPermissionGrantEvent.create).toHaveBeenCalledTimes(2);
  expect(transaction.adminAuditEvent.create).toHaveBeenCalledTimes(2);
});

test('permission updates can revoke every grant without recording unchanged grants', async () => {
  transaction.adminAccount.findUnique.mockResolvedValue({
    userId: 'staff-user',
    tier: 'STAFF_ADMIN',
    user: { id: 'staff-user', role: 'ADMIN' },
    grants: [{ permissionKey: 'jobs.view' }],
  });
  transaction.adminPermission.findMany.mockResolvedValue([]);

  await updateStaffPermissions('super-admin', 'staff-user', []);

  expect(transaction.adminPermissionGrant.deleteMany).toHaveBeenCalledTimes(1);
  expect(transaction.adminPermissionGrant.create).not.toHaveBeenCalled();
  expect(transaction.adminPermissionGrantEvent.create).toHaveBeenCalledTimes(1);
  expect(transaction.adminPermissionGrantEvent.create).toHaveBeenCalledWith({
    data: { actorId: 'super-admin', subjectId: 'staff-user', permissionKey: 'jobs.view', action: 'REVOKED' },
  });
});

test('prevents self-permission modification and only suspends staff accounts', async () => {
  await expect(updateStaffPermissions('super-admin', 'super-admin', [])).rejects.toMatchObject({ status: 403 });

  transaction.adminAccount.findUnique.mockResolvedValue({
    userId: 'staff-user',
    tier: 'SUPER_ADMIN',
    suspendedAt: null,
    user: { id: 'staff-user', role: 'ADMIN', isActive: true },
  });
  await expect(suspendStaff('super-admin', 'staff-user')).rejects.toMatchObject({ status: 404 });
  expect(transaction.user.update).not.toHaveBeenCalled();
});

test('suspension revokes sessions and reactivation leaves them revoked', async () => {
  transaction.adminAccount.findUnique.mockResolvedValue({
    userId: 'staff-user',
    tier: 'STAFF_ADMIN',
    suspendedAt: null,
    user: { id: 'staff-user', role: 'ADMIN', isActive: true },
  });
  await suspendStaff('super-admin', 'staff-user');

  expect(transaction.user.update).toHaveBeenCalledWith({ where: { id: 'staff-user' }, data: { isActive: false } });
  expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
    where: { userId: 'staff-user', revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
  expect(transaction.adminAccount.update).toHaveBeenCalledWith({
    where: { userId: 'staff-user' },
    data: { suspendedAt: expect.any(Date) },
  });

  transaction.adminAccount.findUnique.mockResolvedValue({
    userId: 'staff-user',
    tier: 'STAFF_ADMIN',
    suspendedAt: new Date(),
    user: { id: 'staff-user', role: 'ADMIN', isActive: false },
  });
  await reactivateStaff('super-admin', 'staff-user');
  expect(transaction.user.update).toHaveBeenLastCalledWith({ where: { id: 'staff-user' }, data: { isActive: true } });
  expect(transaction.adminAccount.update).toHaveBeenLastCalledWith({
    where: { userId: 'staff-user' },
    data: { suspendedAt: null },
  });
  expect(transaction.authSession.updateMany).toHaveBeenCalledTimes(1);
});
