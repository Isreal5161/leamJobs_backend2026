import {
  archiveAdminContract as archiveAdminContractService,
  cancelAdminContract as cancelAdminContractService,
  getAdminContractById,
  listAdminContracts as listAdminContractsService,
} from '../services/contract.service.js';

export const listAdminContracts = async (req, res, next) => {
  try {
    const data = await listAdminContractsService(req.validatedAdminContractsQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getAdminContract = async (req, res, next) => {
  try {
    const contract = await getAdminContractById(req.params.contractId);
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) {
    return next(error);
  }
};

export const cancelAdminContract = async (req, res, next) => {
  try {
    const contract = await cancelAdminContractService({
      contractId: req.params.contractId,
      adminId: req.user.sub,
    });
    return res.status(200).json({ success: true, data: { contract } });
  } catch (error) {
    return next(error);
  }
};

export const archiveAdminContract = async (req, res, next) => {
  try {
    const result = await archiveAdminContractService({
      contractId: req.params.contractId,
      adminId: req.user.sub,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};
