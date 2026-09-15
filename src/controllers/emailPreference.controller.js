import { getEmailPreferences, unsubscribeMarketingEmail, updateEmailPreferences } from '../services/emailPreference.service.js';

export const getPreferences = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getEmailPreferences(req.user.sub) });
  } catch (error) {
    return next(error);
  }
};

export const updatePreferences = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await updateEmailPreferences(req.user.sub, req.body.marketingEmailsEnabled) });
  } catch (error) {
    return next(error);
  }
};

export const unsubscribe = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await unsubscribeMarketingEmail(req.query.token) });
  } catch (error) {
    return next(error);
  }
};
