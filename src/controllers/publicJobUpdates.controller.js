import { confirmJobUpdatesSubscription, subscribeToJobUpdates, unsubscribeFromJobUpdates } from '../services/publicJobUpdates.service.js';

export const subscribe = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await subscribeToJobUpdates(req.body.email) }); } catch (error) { return next(error); }
};

export const unsubscribe = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await unsubscribeFromJobUpdates(req.query.token) }); } catch (error) { return next(error); }
};

export const confirmSubscription = async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await confirmJobUpdatesSubscription(req.body.token) }); } catch (error) { return next(error); }
};