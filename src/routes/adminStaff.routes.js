import { Router } from 'express';
import {
  createStaffInvitationController,
  getStaffDetailsController,
  listAdminInvitationsController,
  listEnabledAdminPermissionsController,
  listStaffAuditController,
  listStaffController,
  reactivateStaffController,
  resendStaffInvitationController,
  revokeStaffInvitationController,
  suspendStaffController,
  updateStaffPermissionsController,
} from '../controllers/adminStaff.controller.js';
import { requireSuperAdmin } from '../middleware/authorization.middleware.js';
import {
  validateCreateAdminInvitation,
  validateStaffInvitationId,
  validateStaffPagination,
  validateStaffUserId,
  validateUpdateStaffPermissions,
} from '../validators/adminStaff.validation.js';

const adminStaffRouter = Router();

adminStaffRouter.post('/invitations', requireSuperAdmin(), validateCreateAdminInvitation, createStaffInvitationController);
adminStaffRouter.get('/', requireSuperAdmin(), validateStaffPagination, listStaffController);
adminStaffRouter.get('/invitations', requireSuperAdmin(), validateStaffPagination, listAdminInvitationsController);
adminStaffRouter.get('/permissions', requireSuperAdmin(), listEnabledAdminPermissionsController);
adminStaffRouter.get('/:userId', requireSuperAdmin(), validateStaffUserId, getStaffDetailsController);
adminStaffRouter.post('/invitations/:invitationId/resend', requireSuperAdmin(), validateStaffInvitationId, resendStaffInvitationController);
adminStaffRouter.post('/invitations/:invitationId/revoke', requireSuperAdmin(), validateStaffInvitationId, revokeStaffInvitationController);
adminStaffRouter.patch('/:userId/permissions', requireSuperAdmin(), validateStaffUserId, validateUpdateStaffPermissions, updateStaffPermissionsController);
adminStaffRouter.post('/:userId/suspend', requireSuperAdmin(), validateStaffUserId, suspendStaffController);
adminStaffRouter.post('/:userId/reactivate', requireSuperAdmin(), validateStaffUserId, reactivateStaffController);
adminStaffRouter.get('/:userId/audit', requireSuperAdmin(), validateStaffUserId, validateStaffPagination, listStaffAuditController);

export { adminStaffRouter };
export default adminStaffRouter;
