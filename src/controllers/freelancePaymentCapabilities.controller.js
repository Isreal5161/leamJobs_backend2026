import { resolveFreelancePaymentFeatures } from '../config/freelancePaymentFeatures.js';
import { FLUTTERWAVE_USD_CAPABILITIES } from '../config/flutterwaveUsdCapabilities.js';

export const getFreelancePaymentCapabilities = (req, res) => (
  res.status(200).json({
    success: true,
    data: {
      ...resolveFreelancePaymentFeatures(),
      usdWalletProvisioningEnabled: true,
      usdCollectionEnabled: FLUTTERWAVE_USD_CAPABILITIES.collectionEnabled,
      usdCollectionUnavailableReason: FLUTTERWAVE_USD_CAPABILITIES.collectionUnavailableReason,
      usdWithdrawalRoutes: FLUTTERWAVE_USD_CAPABILITIES.withdrawalRoutes,
      usdWithdrawalUnavailableReason: FLUTTERWAVE_USD_CAPABILITIES.withdrawalUnavailableReason,
      crossCurrencySettlementRoutes: FLUTTERWAVE_USD_CAPABILITIES.conversionRoutes,
      crossCurrencySettlementUnavailableReason: FLUTTERWAVE_USD_CAPABILITIES.conversionUnavailableReason,
    },
  })
);
