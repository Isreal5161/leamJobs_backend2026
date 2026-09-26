import { hasEntitlement, resolveEffectiveEntitlements } from '../services/subscriptionEntitlement.service.js';

export const requireEntitlement = (entitlementKey) => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const entitlementState = await resolveEffectiveEntitlements(req.user.sub);
  const hasAccess = await hasEntitlement(req.user.sub, entitlementKey, undefined, entitlementState);

  if (!hasAccess) {
    return res.status(403).json({
      message: 'This feature requires an active subscription entitlement.',
      entitlement: entitlementKey,
    });
  }

  req.entitlementState = entitlementState;
  return next();
};
