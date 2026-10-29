import { listReleaseEligibleContracts, releaseContractFunds } from '../services/adminRelease.service.js';

export const listReleaseCandidates = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await listReleaseEligibleContracts(req.validatedPagination) });
  } catch (error) {
    return next(error);
  }
};

export const releaseContract = async (req, res, next) => {
  try {
    const result = await releaseContractFunds(req.params.contractId, req.user.sub);
    if (result.conversionBlocked) {
      return res.status(409).json({
        success: false,
        message: 'Cross-currency release is unavailable; escrow remains unreleased.',
        data: result,
      });
    }
    return res.status(200).json({
      success: true,
      message: result.alreadyReleased ? 'Contract funds were already released' : 'Contract funds released successfully',
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};