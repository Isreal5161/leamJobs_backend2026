import { createJobInvitation, respondToJobInvitation } from '../services/jobInvitation.service.js';

export const createInvitation = async (req, res, next) => {
  try {
    const invitation = await createJobInvitation(req.user.sub, req.body);
    return res.status(201).json({ success: true, data: { invitation } });
  } catch (error) {
    return next(error);
  }
};

export const respondToInvitation = async (req, res, next) => {
  try {
    const invitation = await respondToJobInvitation(req.user.sub, req.params.invitationId, req.body.response);
    return res.status(200).json({ success: true, data: { invitation } });
  } catch (error) {
    return next(error);
  }
};
