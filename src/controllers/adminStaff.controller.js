import {
  createAdminInvitation,
  getStaffDetails,
  listAdminInvitations,
  listEnabledAdminPermissions,
  listStaff,
  listStaffAuditHistory,
  reactivateStaff,
  resendAdminInvitation,
  revokeAdminInvitation,
  suspendStaff,
  updateStaffPermissions,
} from '../services/adminStaff.service.js';

const controller = (handler, status = 200) => async (req, res, next) => {
  try {
    const result = await handler(req);
    return res.status(status).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const createStaffInvitationController = controller((req) => (
  createAdminInvitation(req.user.sub, req.body, req.id)
), 201);

export const listStaffController = controller((req) => (
  listStaff(req.user.sub, req.pagination)
));

export const listAdminInvitationsController = controller((req) => (
  listAdminInvitations(req.user.sub, req.pagination)
));

export const listEnabledAdminPermissionsController = controller((req) => (
  listEnabledAdminPermissions(req.user.sub)
));

export const getStaffDetailsController = controller((req) => (
  getStaffDetails(req.user.sub, req.params.userId)
));

export const resendStaffInvitationController = controller((req) => (
  resendAdminInvitation(req.user.sub, req.params.invitationId, req.id)
));

export const revokeStaffInvitationController = controller((req) => (
  revokeAdminInvitation(req.user.sub, req.params.invitationId, req.id)
));

export const updateStaffPermissionsController = controller((req) => (
  updateStaffPermissions(req.user.sub, req.params.userId, req.body.permissionKeys, req.id)
));

export const suspendStaffController = controller((req) => (
  suspendStaff(req.user.sub, req.params.userId, req.id)
));

export const reactivateStaffController = controller((req) => (
  reactivateStaff(req.user.sub, req.params.userId, req.id)
));

export const listStaffAuditController = controller((req) => (
  listStaffAuditHistory(req.user.sub, req.params.userId, req.pagination)
));
