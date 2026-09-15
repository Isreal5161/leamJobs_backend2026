import {
  initializeSeekerSubscriptionCheckout,
  listSeekerPlanOptions,
  listSeekerSubscriptions,
  verifySeekerSubscriptionPayment,
} from '../services/seekerSubscription.service.js';

export const listSeekerPlanOptionsController = async (req, res, next) => {
  try {
    const result = await listSeekerPlanOptions();
    return res.status(200).json({ success: true, data: { plans: result } });
  } catch (error) {
    return next(error);
  }
};

export const listSubscriptions = async (req, res, next) => {
  try {
    const result = await listSeekerSubscriptions(req.user.sub);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const checkoutSubscription = async (req, res, next) => {
  try {
    const result = await initializeSeekerSubscriptionCheckout({
      userId: req.user.sub,
      planId: req.validatedBody.planId,
      idempotencyKey: req.validatedBody.idempotencyKey,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const verifySubscriptionPayment = async (req, res, next) => {
  try {
    const result = await verifySeekerSubscriptionPayment({
      userId: req.user.sub,
      providerReference: req.validatedBody.providerReference,
      transactionId: req.validatedBody.transactionId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};
