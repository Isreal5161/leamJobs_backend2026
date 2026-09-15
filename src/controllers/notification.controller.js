import { listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from '../services/notification.service.js';

export const listNotifications = async (req, res, next) => {
  try {
    const data = await listNotificationsForUser(req.user.sub, req.validatedQuery ?? {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const readNotification = async (req, res, next) => {
  try {
    const data = await markNotificationRead(req.user.sub, req.params.notificationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const readAllNotifications = async (req, res, next) => {
  try {
    const data = await markAllNotificationsRead(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
