import { resolveFreelancePaymentFeatures } from '../config/freelancePaymentFeatures.js';

export const getFreelancePaymentCapabilities = (req, res) => (
  res.status(200).json({ success: true, data: resolveFreelancePaymentFeatures() })
);
