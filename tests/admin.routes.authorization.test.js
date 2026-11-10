import { readFileSync } from 'node:fs';
import adminRouter from '../src/routes/admin.routes.js';
import adminStaffRouter from '../src/routes/adminStaff.routes.js';

const migration = readFileSync(
  new URL('../prisma/migrations/20261104130000_add_multi_admin_foundation/migration.sql', import.meta.url),
  'utf8',
);
const contractManagementMigration = readFileSync(
  new URL('../prisma/migrations/20261110100000_add_admin_contract_management_permissions/migration.sql', import.meta.url),
  'utf8',
);
const seededPermissions = new Set(
  [
    ...[...migration.matchAll(/\('([^']+)', '[^']+', '[^']+'\)/g)].map((match) => match[1]),
    ...[...contractManagementMigration.matchAll(/\('([^']+)', '[^']+', '[^']+', TRUE,/g)].map((match) => match[1]),
  ],
);

const routeLayers = adminRouter.stack.filter((layer) => layer.route);
const registeredMethods = (route) => Object.keys(route.methods)
  .filter((method) => route.methods[method])
  .map((method) => method.toUpperCase());
const routeKey = (method, path) => `${method} ${path}`;

const expectedPermissionsByRoute = new Map([
  ['GET /companies', ['companies.view']],
  ['GET /companies/leamjobs', ['companies.view']],
  ['GET /companies/:userId/logo', ['companies.view']],
  ['GET /verification-submissions', ['verification.view']],
  ['GET /verification-submissions/:verificationId', ['verification.view']],
  ['GET /verification-documents/:documentId', ['verification.documents.view']],
  ['PATCH /verification-submissions/:verificationId/approve', ['verification.approve']],
  ['PATCH /verification-submissions/:verificationId/reject', ['verification.reject']],
  ['GET /users', ['users.view']],
  ['DELETE /users/:userId', ['users.anonymize']],
  ['GET /seekers', ['users.view']],
  ['GET /analytics', ['analytics.view', 'finance.payments.view', 'finance.contractFunding.view', 'fees.view']],
  ['GET /platform-fee', ['fees.view']],
  ['PATCH /platform-fee', ['fees.manage']],
  ['GET /payments', ['finance.payments.view']],
  ['GET /conversion-operations', ['finance.conversions.view']],
  ['GET /withdrawals', ['finance.withdrawals.view']],
  ['GET /withdrawals/:id', ['finance.withdrawals.view']],
  ['POST /withdrawals/:id/execute', ['finance.withdrawals.execute']],
  ['POST /withdrawals/:id/reconcile', ['finance.withdrawals.reconcile']],
  ['POST /withdrawals/:id/recover-flutterwave-transfer', ['finance.providerRecovery.execute']],
  ['GET /subscription-plans', ['subscriptions.view']],
  ['POST /subscription-plans', ['subscriptions.plans.manage']],
  ['PATCH /subscription-plans/:id', ['subscriptions.plans.manage']],
  ['GET /subscription-trial-settings', ['subscriptions.view']],
  ['PATCH /subscription-trial-settings', ['subscriptions.trials.manage']],
  ['GET /subscriptions/summary', ['subscriptions.view']],
  ['GET /subscriptions', ['subscriptions.view']],
  ['GET /subscriptions/:id', ['subscriptions.view']],
  ['PUT /content', ['content.edit', 'content.publish']],
  ['POST /content/about/team-images', ['content.media.upload']],
  ['POST /jobs', ['jobs.create']],
  ['GET /jobs', ['jobs.view']],
  ['GET /jobs/:jobId', ['jobs.view']],
  ['GET /jobs/:jobId/applications', ['applications.view']],
  ['GET /jobs/:jobId/applications/:applicationId', ['applications.view']],
  ['PATCH /jobs/:jobId/applications/:applicationId/status', ['applications.update']],
  ['POST /jobs/:jobId/applications/:applicationId/select-contract', ['applications.select']],
  ['GET /jobs/:jobId/applications/:applicationId/resume', ['applicants.documents.view']],
  ['GET /jobs/:jobId/applications/:applicationId/profile-picture', ['applicants.documents.view']],
  ['GET /contracts', ['contracts.view', 'finance.contractFunding.view']],
  ['GET /contracts/release-eligible', ['contracts.view', 'finance.contractFunding.view']],
  ['GET /disputes', ['disputes.view']],
  ['GET /disputes/:disputeId', ['disputes.view']],
  ['PATCH /contracts/:contractId/disputes/:disputeId', ['disputes.resolve']],
  ['GET /contracts/:contractId', ['contracts.view', 'finance.contractFunding.view']],
  ['POST /contracts/:contractId/cancel', ['contracts.cancel']],
  ['POST /contracts/:contractId/archive', ['contracts.archive']],
  ['POST /contracts/:contractId/confirm', ['contracts.confirm']],
  ['POST /contracts/:contractId/payment', ['finance.contractFunding.execute']],
  ['POST /contracts/:contractId/payment/verify', ['finance.contractFunding.execute']],
  ['POST /contracts/:contractId/confirm-completion', ['contracts.complete']],
  ['PATCH /jobs/:jobId', ['jobs.edit']],
  ['PATCH /jobs/:jobId/approve', ['jobs.moderate']],
  ['PATCH /jobs/:jobId/reject', ['jobs.moderate']],
  ['PATCH /jobs/:jobId/remove', ['jobs.delete']],
  ['PATCH /jobs/:jobId/decision', ['jobs.moderate']],
  ['GET /notifications', ['notifications.view']],
  ['PATCH /notifications/read-all', ['notifications.view']],
  ['PATCH /notifications/:notificationId/read', ['notifications.view']],
  ['GET /communications/templates', ['communications.templates.view']],
  ['PATCH /communications/templates/:key', ['communications.templates.edit']],
  ['POST /communications/templates/:key/preview', ['communications.templates.view']],
  ['POST /communications/campaigns', ['communications.campaigns.manage']],
  ['GET /communications/campaigns', ['communications.campaigns.view']],
  ['PATCH /communications/campaigns/:id', ['communications.campaigns.manage']],
  ['GET /communications/campaigns/:id/preview', ['communications.campaigns.view']],
  ['GET /communications/campaigns/:id/report', ['communications.campaigns.view']],
  ['GET /communications/campaigns/:id/deliveries', ['communications.campaigns.view']],
  ['GET /communications/recipients/count', ['communications.campaigns.view']],
  ['GET /support/premium', ['support.view']],
  ['PATCH /support/premium/:requestId', ['support.update']],
  ['POST /communications/campaigns/:id/send', ['communications.campaigns.send']],
  ['POST /contracts/:contractId/release', ['finance.escrowRelease.execute']],
]);

describe('admin route authorization coverage', () => {
  test('every registered route has its exact expected permission guard', () => {
    expect(routeLayers.length).toBeGreaterThan(0);
    const permissionRoutes = routeLayers.filter((layer) => layer.route.path !== '/me/permissions');
    expect(expectedPermissionsByRoute.size).toBe(permissionRoutes.length);

    const registeredRouteKeys = [];
    for (const layer of permissionRoutes) {
      const methods = registeredMethods(layer.route);
      expect(methods).toHaveLength(1);
      const registeredRouteKey = routeKey(methods[0], layer.route.path);
      registeredRouteKeys.push(registeredRouteKey);

      const guards = layer.route.stack
        .map(({ handle }) => handle.adminAuthorization)
        .filter(Boolean);

      expect(expectedPermissionsByRoute.has(registeredRouteKey)).toBe(true);
      expect(guards).toHaveLength(1);
      expect(guards[0].kind).toBe('permissions');
      expect(guards[0].permissionKeys.length).toBeGreaterThan(0);
      expect(guards[0].permissionKeys).toEqual(expectedPermissionsByRoute.get(registeredRouteKey));

      for (const permissionKey of guards[0].permissionKeys) {
        expect(seededPermissions.has(permissionKey)).toBe(true);
      }
    }

    expect(new Set(registeredRouteKeys).size).toBe(permissionRoutes.length);
    expect(new Set(registeredRouteKeys)).toEqual(new Set(expectedPermissionsByRoute.keys()));
  });

  test('current administrator permission discovery uses inherited admin context, not a permission grant', () => {
    const route = routeLayers.find((layer) => layer.route.path === '/me/permissions');
    expect(route).toBeDefined();
    expect(registeredMethods(route.route)).toEqual(['GET']);
    expect(route.route.stack.map(({ handle }) => handle.adminAuthorization).filter(Boolean)).toHaveLength(0);
    expect(adminRouter.stack.some((layer) => !layer.route && layer.handle.name === 'authenticate')).toBe(true);
    expect(adminRouter.stack.some((layer) => !layer.route && layer.handle.name === 'loadAdminContext')).toBe(true);
  });

  test('admin router verifies authenticated ADMIN identity and database context before route guards', () => {
    const middleware = adminRouter.stack
      .filter((layer) => !layer.route)
      .map((layer) => layer.handle);

    expect(middleware.some((handler) => handler.name === 'authenticate')).toBe(true);
    expect(middleware.some((handler) => handler.name === 'loadAdminContext')).toBe(true);
    expect(middleware.some((handler) => handler.allowedRoles?.includes('ADMIN'))).toBe(true);
  });

  test('every staff management endpoint explicitly requires a Super Admin', () => {
    const expectedRoutes = new Set([
      'POST /invitations',
      'GET /',
      'GET /invitations',
      'GET /permissions',
      'GET /:userId',
      'POST /invitations/:invitationId/resend',
      'POST /invitations/:invitationId/revoke',
      'PATCH /:userId/permissions',
      'POST /:userId/suspend',
      'POST /:userId/reactivate',
      'GET /:userId/audit',
    ]);
    const mountedStaffRouter = adminRouter.stack.some((layer) => layer.handle === adminStaffRouter);
    const staffRoutes = adminStaffRouter.stack.filter((layer) => layer.route);
    const registeredRoutes = [];

    expect(mountedStaffRouter).toBe(true);
    expect(staffRoutes).toHaveLength(expectedRoutes.size);

    for (const layer of staffRoutes) {
      const methods = registeredMethods(layer.route);
      expect(methods).toHaveLength(1);
      const route = routeKey(methods[0], layer.route.path);
      registeredRoutes.push(route);
      const guards = layer.route.stack
        .map(({ handle }) => handle.adminAuthorization)
        .filter(Boolean);

      expect(expectedRoutes.has(route)).toBe(true);
      expect(guards).toHaveLength(1);
      expect(guards[0]).toEqual({ kind: 'super-admin', permissionKeys: [] });
    }

    expect(new Set(registeredRoutes)).toEqual(expectedRoutes);
  });
});
