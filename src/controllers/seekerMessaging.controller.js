import {
  getOrCreateConversationForApplication,
  getSeekerConversation,
  getSeekerConversations,
  markSeekerConversationRead,
} from '../services/conversation.service.js';
import { getSeekerMessages, sendSeekerMessage } from '../services/message.service.js';

export const listConversations = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: { conversations: await getSeekerConversations(req.user.sub) } });
  } catch (error) {
    return next(error);
  }
};

export const createConversationFromApplication = async (req, res, next) => {
  try {
    const conversation = await getOrCreateConversationForApplication(req.user.sub, req.params.applicationId);
    return res.status(200).json({ success: true, data: { conversation } });
  } catch (error) {
    return next(error);
  }
};

export const getConversation = async (req, res, next) => {
  try {
    const conversation = await getSeekerConversation(req.user.sub, req.params.conversationId);
    return res.status(200).json({ success: true, data: { conversation } });
  } catch (error) {
    return next(error);
  }
};

export const listMessages = async (req, res, next) => {
  try {
    const data = await getSeekerMessages(req.user.sub, req.params.conversationId, req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const postMessage = async (req, res, next) => {
  try {
    const message = await sendSeekerMessage(req.user.sub, req.params.conversationId, req.body);
    return res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    return next(error);
  }
};

export const markConversationRead = async (req, res, next) => {
  try {
    const data = await markSeekerConversationRead(req.user.sub, req.params.conversationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
