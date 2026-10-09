import {
  getAdminContractDispute,
  listAdminContractDisputes,
  resolveContractDispute,
  submitContractDispute,
} from '../services/contractDispute.service.js';

export const listAdminDisputes = async (req, res, next) => {
  try {
    const result = await listAdminContractDisputes(req.validatedPagination);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const getAdminDispute = async (req, res, next) => {
  try {
    const dispute = await getAdminContractDispute(req.params.disputeId);
    return res.status(200).json({ success: true, data: { dispute } });
  } catch (error) {
    return next(error);
  }
};

export const submitDispute = async (req, res, next) => {
  try {
    const dispute = await submitContractDispute({
      contractId: req.params.contractId,
      userId: req.user.sub,
      role: req.user.role,
      reason: req.body.reason,
    });
    return res.status(201).json({ success: true, data: { dispute } });
  } catch (error) {
    return next(error);
  }
};

export const resolveDispute = async (req, res, next) => {
  try {
    const result = await resolveContractDispute({
      contractId: req.params.contractId,
      disputeId: req.params.disputeId,
      adminId: req.user.sub,
      status: req.body.status,
      resolutionNote: req.body.resolutionNote,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};
