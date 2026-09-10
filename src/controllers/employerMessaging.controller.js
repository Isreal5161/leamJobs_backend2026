import {
  getEmployerConversation,
  getEmployerConversations,
  markEmployerConversationRead,
} from '../services/conversation.service.js';
import { getEmployerMessages, sendEmployerMessage } from '../services/message.service.js';

export const listConversations = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: { conversations: await getEmployerConversations(req.user.sub) } });
  } catch (error) {
    return next(error);
  }
};

export const getConversation = async (req, res, next) => {
  try {
    const conversation = await getEmployerConversation(req.user.sub, req.params.conversationId);
    return res.status(200).json({ success: true, data: { conversation } });
  } catch (error) {
    return next(error);
  }
};

export const listMessages = async (req, res, next) => {
  try {
    const data = await getEmployerMessages(req.user.sub, req.params.conversationId, req.validatedQuery);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const postMessage = async (req, res, next) => {
  try {
    const message = await sendEmployerMessage(req.user.sub, req.params.conversationId, req.body);
    return res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    return next(error);
  }
};

export const markConversationRead = async (req, res, next) => {
  try {
    const data = await markEmployerConversationRead(req.user.sub, req.params.conversationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
