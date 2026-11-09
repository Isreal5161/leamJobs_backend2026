import { jest } from '@jest/globals';

const mockPrisma = {
  adminAccount: { findUnique: jest.fn() },
  adminPermission: { findUnique: jest.fn() },
  adminPermissionGrant: { findUnique: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const {
  loadAdminContext,
  requireAdminPermission,
  requireAdminPermissions,
  requireSuperAdmin,
} = await import('../src/middleware/authorization.middleware.js');

const createResponse = () => {
  const response = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
};

const adminRecord = (tier = 'STAFF_ADMIN', role = 'ADMIN') => ({
  userId: 'staff-1',
  tier,
  suspendedAt: null,
  user: { id: 'staff-1', role, isActive: true },
});

describe('admin authorization middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('loadAdminContext rejects unauthenticated, non-admin, and missing accounts', async () => {
    const res = createResponse();
    const next = jest.fn();

    await loadAdminContext({}, res, next);
    expect(res.status).toHaveBeenLastCalledWith(401);

    await loadAdminContext({ user: { sub: 'staff-1', role: 'SEEKER' } }, res, next);
    expect(res.status).toHaveBeenLastCalledWith(403);

    mockPrisma.adminAccount.findUnique.mockResolvedValue(null);
    await loadAdminContext({ user: { sub: 'staff-1', role: 'ADMIN' } }, res, next);
    expect(res.status).toHaveBeenLastCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('loads database tier and allows Super Admin without a grant', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord('SUPER_ADMIN'));
    mockPrisma.adminPermission.findUnique.mockResolvedValue({ key: 'jobs.view', isEnabled: true });
    const req = { user: { sub: 'staff-1', role: 'ADMIN', tier: 'STAFF_ADMIN' } };
    const res = createResponse();
    const next = jest.fn();

    await loadAdminContext(req, res, next);
    await requireAdminPermission('jobs.view')(req, res, next);

    expect(req.adminContext).toEqual({ userId: 'staff-1', tier: 'SUPER_ADMIN' });
    expect(next).toHaveBeenCalledTimes(2);
    expect(mockPrisma.adminPermissionGrant.findUnique).not.toHaveBeenCalled();
  });

  test('staff with a current grant is allowed; missing grant is forbidden', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord());
    mockPrisma.adminPermission.findUnique.mockResolvedValue({ key: 'jobs.view', isEnabled: true });
    mockPrisma.adminPermissionGrant.findUnique
      .mockResolvedValueOnce({ adminUserId: 'staff-1' })
      .mockResolvedValueOnce(null);
    const res = createResponse();
    const next = jest.fn();

    await requireAdminPermission('jobs.view')(
      { user: { sub: 'staff-1', role: 'ADMIN' } }, res, next,
    );
    await requireAdminPermission('jobs.view')(
      { user: { sub: 'staff-1', role: 'ADMIN' } }, res, next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
  });

  test('suspended staff cannot load admin context or perform protected actions', async () => {
    mockPrisma.adminAccount.findUnique
      .mockResolvedValueOnce({ ...adminRecord(), suspendedAt: new Date() })
      .mockResolvedValueOnce({ ...adminRecord(), suspendedAt: new Date() });
    const req = { user: { sub: 'staff-1', role: 'ADMIN' } };
    const res = createResponse();
    const next = jest.fn();

    await loadAdminContext(req, res, next);
    await requireAdminPermission('jobs.view')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPrisma.adminPermission.findUnique).not.toHaveBeenCalled();
  });

  test('JWT and request-body permission claims cannot elevate staff access', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord());
    mockPrisma.adminPermission.findUnique.mockResolvedValue({ key: 'jobs.view', isEnabled: true });
    mockPrisma.adminPermissionGrant.findUnique.mockResolvedValue(null);
    const req = {
      user: { sub: 'staff-1', role: 'ADMIN', permissions: ['jobs.view'] },
      body: { permissions: ['jobs.view'], tier: 'SUPER_ADMIN' },
    };
    const res = createResponse();
    const next = jest.fn();

    await requireAdminPermission('jobs.view')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('financial read grants do not authorize financial execution', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord());
    mockPrisma.adminPermission.findUnique.mockImplementation(async ({ where }) => ({
      key: where.key,
      isEnabled: true,
    }));
    mockPrisma.adminPermissionGrant.findUnique.mockImplementation(async ({ where }) => (
      where.adminUserId_permissionKey.permissionKey === 'finance.payments.view'
        ? { adminUserId: 'staff-1' }
        : null
    ));
    const res = createResponse();
    const next = jest.fn();

    await requireAdminPermission('finance.payments.view')(
      { user: { sub: 'staff-1', role: 'ADMIN' } }, res, next,
    );
    await requireAdminPermission('finance.contractFunding.execute')(
      { user: { sub: 'staff-1', role: 'ADMIN' } }, res, next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('all listed permissions are required', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord());
    mockPrisma.adminPermission.findUnique
      .mockResolvedValueOnce({ key: 'analytics.view', isEnabled: true })
      .mockResolvedValueOnce({ key: 'fees.view', isEnabled: true });
    mockPrisma.adminPermissionGrant.findUnique
      .mockResolvedValueOnce({ adminUserId: 'staff-1' })
      .mockResolvedValueOnce(null);
    const res = createResponse();
    const next = jest.fn();

    await requireAdminPermissions(['analytics.view', 'fees.view'])(
      { user: { sub: 'staff-1', role: 'ADMIN' } }, res, next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('staff cannot pass the Super Admin guard, regardless of JWT or body claims', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(adminRecord());
    const req = {
      user: {
        sub: 'staff-1',
        role: 'ADMIN',
        tier: 'SUPER_ADMIN',
        permissions: ['staff.invite'],
      },
      body: { tier: 'SUPER_ADMIN', permissions: ['staff.invite'] },
    };
    const res = createResponse();
    const next = jest.fn();

    await requireSuperAdmin()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('database errors flow to Express error handling without leaking details', async () => {
    const databaseError = new Error('database connection details');
    mockPrisma.adminAccount.findUnique.mockRejectedValue(databaseError);
    const req = { user: { sub: 'staff-1', role: 'ADMIN' } };
    const res = createResponse();
    const next = jest.fn();

    await requireSuperAdmin()(req, res, next);

    expect(next).toHaveBeenCalledWith(databaseError);
    expect(res.json).not.toHaveBeenCalled();
  });
});
