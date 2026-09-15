import { hasEntitlement } from '../services/subscriptionEntitlement.service.js';

export const requireEntitlement = (entitlementKey) => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const hasAccess = await hasEntitlement(req.user.sub, entitlementKey);
  if (!hasAccess) {
    return res.status(403).json({
      message: 'This feature requires an active subscription entitlement.',
      entitlement: entitlementKey,
    });
  }

  return next();
};
