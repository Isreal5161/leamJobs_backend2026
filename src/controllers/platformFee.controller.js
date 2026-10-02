import { getPlatformFeeConfiguration, updatePlatformFeePercentage } from '../services/platformFee.service.js';

export const getAdminPlatformFee = async (_req, res, next) => {
  try {
    const configuration = await getPlatformFeeConfiguration();
    return res.status(200).json({ success: true, data: { configuration } });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminPlatformFee = async (req, res, next) => {
  try {
    const configuration = await updatePlatformFeePercentage(req.validatedPlatformFee.percentage);
    return res.status(200).json({ success: true, data: { configuration } });
  } catch (error) {
    return next(error);
  }
};
