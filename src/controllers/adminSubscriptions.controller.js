import {
  createAdminSubscriptionPlan,
  getAdminSubscription,
  getAdminSubscriptionSummary,
  listAdminSubscriptionPlans,
  listAdminSubscriptions,
  updateAdminSubscriptionPlan,
} from '../services/adminSubscriptions.service.js';

export const listPlans = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await listAdminSubscriptionPlans() }); } catch (error) { return next(error); } };
export const createPlan = async (req, res, next) => { try { return res.status(201).json({ success: true, data: { plan: await createAdminSubscriptionPlan(req.validatedPlan) } }); } catch (error) { return next(error); } };
export const updatePlan = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { plan: await updateAdminSubscriptionPlan(req.params.id, req.validatedPlan) } }); } catch (error) { return next(error); } };
export const subscriptionSummary = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await getAdminSubscriptionSummary() }); } catch (error) { return next(error); } };
export const subscriptions = async (req, res, next) => { try { return res.status(200).json({ success: true, data: await listAdminSubscriptions(req.validatedQuery) }); } catch (error) { return next(error); } };
export const subscription = async (req, res, next) => { try { return res.status(200).json({ success: true, data: { subscription: await getAdminSubscription(req.params.id) } }); } catch (error) { return next(error); } };
