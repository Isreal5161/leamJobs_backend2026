import { jest } from '@jest/globals';

const mockPrisma = {
  adminAccount: { findUnique: jest.fn() },
  adminPermission: { findUnique: jest.fn() },
  adminPermissionGrant: { findUnique: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { hasAdminPermission, resolveAdminAccount } = await import('../src/services/adminPermission.service.js');

describe('admin permission service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('resolves a database-backed Super Admin account', async () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue({
      userId: 'admin-1',
      tier: 'SUPER_ADMIN',
      suspendedAt: null,
      user: { id: 'admin-1', role: 'ADMIN', isActive: true },
    });

    await expect(resolveAdminAccount('admin-1')).resolves.toEqual({
      userId: 'admin-1',
      tier: 'SUPER_ADMIN',
    });
  });

  test.each([
    ['missing user', null],
    ['non-admin role', { userId: 'admin-1', tier: 'SUPER_ADMIN', suspendedAt: null, user: { id: 'admin-1', role: 'SEEKER', isActive: true } }],
    ['inactive account', { userId: 'admin-1', tier: 'STAFF_ADMIN', suspendedAt: null, user: { id: 'admin-1', role: 'ADMIN', isActive: false } }],
    ['suspended account', { userId: 'admin-1', tier: 'STAFF_ADMIN', suspendedAt: new Date(), user: { id: 'admin-1', role: 'ADMIN', isActive: true } }],
    ['mismatched account user', { userId: 'other-user', tier: 'STAFF_ADMIN', suspendedAt: null, user: { id: 'other-user', role: 'ADMIN', isActive: true } }],
    ['missing related user', { userId: 'admin-1', tier: 'STAFF_ADMIN', user: null }],
    ['unknown tier', { userId: 'admin-1', tier: 'OWNER', suspendedAt: null, user: { id: 'admin-1', role: 'ADMIN', isActive: true } }],
  ])('fails closed for %s', async (_label, user) => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue(user);
    await expect(resolveAdminAccount('admin-1')).resolves.toBeNull();
  });

  test('Super Admin bypasses grants for known enabled permissions', async () => {
    const adminContext = { userId: 'admin-1', tier: 'SUPER_ADMIN' };
    mockPrisma.adminPermission.findUnique
      .mockResolvedValueOnce({ key: 'jobs.view', isEnabled: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: 'jobs.view', isEnabled: false });

    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(true);
    await expect(hasAdminPermission(adminContext, 'missing.permission')).resolves.toBe(false);
    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(false);
    await expect(hasAdminPermission(adminContext, '')).resolves.toBe(false);
    expect(mockPrisma.adminPermission.findUnique).toHaveBeenCalledTimes(3);
    expect(mockPrisma.adminPermissionGrant.findUnique).not.toHaveBeenCalled();
  });

  test('Staff permission requires an enabled catalogue entry and active grant', async () => {
    const adminContext = { userId: 'staff-1', tier: 'STAFF_ADMIN' };
    mockPrisma.adminPermission.findUnique
      .mockResolvedValueOnce({ key: 'jobs.view', isEnabled: true })
      .mockResolvedValueOnce({ key: 'jobs.view', isEnabled: false })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: 'jobs.view', isEnabled: true });
    mockPrisma.adminPermissionGrant.findUnique
      .mockResolvedValueOnce({ adminUserId: 'staff-1' })
      .mockResolvedValueOnce(null);

    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(true);
    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(false);
    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(false);
    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(false);
  });

  test('rechecks the current grant so revocation applies to the next check', async () => {
    mockPrisma.adminPermission.findUnique.mockResolvedValue({ key: 'finance.withdrawals.view', isEnabled: true });
    mockPrisma.adminPermissionGrant.findUnique
      .mockResolvedValueOnce({ adminUserId: 'staff-1' })
      .mockResolvedValueOnce(null);
    const adminContext = { userId: 'staff-1', tier: 'STAFF_ADMIN' };

    await expect(hasAdminPermission(adminContext, 'finance.withdrawals.view')).resolves.toBe(true);
    await expect(hasAdminPermission(adminContext, 'finance.withdrawals.view')).resolves.toBe(false);
    expect(mockPrisma.adminPermissionGrant.findUnique).toHaveBeenCalledTimes(2);
  });

  test('does not authorize unknown or malformed permission keys', async () => {
    const adminContext = { userId: 'staff-1', tier: 'STAFF_ADMIN' };

    await expect(hasAdminPermission(adminContext, '')).resolves.toBe(false);
    await expect(hasAdminPermission(adminContext, 'jobs.view')).resolves.toBe(false);
    expect(mockPrisma.adminPermission.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.adminPermissionGrant.findUnique).not.toHaveBeenCalled();
  });
});
