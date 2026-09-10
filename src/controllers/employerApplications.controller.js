import {
  getEmployerApplication,
  getEmployerApplicationResume,
  listEmployerApplications,
  updateEmployerApplicationStatus,
} from '../services/employerApplications.service.js';
import { getOrCreateEmployerConversationForApplication } from '../services/conversation.service.js';

export const listApplications = async (req, res, next) => {
  try {
    const data = await listEmployerApplications(req.user.sub, req.params.jobId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getApplication = async (req, res, next) => {
  try {
    const application = await getEmployerApplication(req.user.sub, req.params.jobId, req.params.applicationId);
    return res.status(200).json({ success: true, data: { application } });
  } catch (error) {
    return next(error);
  }
};

export const updateApplicationStatus = async (req, res, next) => {
  try {
    const application = await updateEmployerApplicationStatus(req.user.sub, req.params.jobId, req.params.applicationId, req.body.status);
    return res.status(200).json({ success: true, data: { application } });
  } catch (error) {
    return next(error);
  }
};

export const getApplicationResume = async (req, res, next) => {
  try {
    const result = await getEmployerApplicationResume(req.user.sub, req.params.jobId, req.params.applicationId);
    const extension = result.objectKey.split('.').pop()?.toLowerCase();
    const contentTypes = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    res.type(contentTypes[extension] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
};

export const createApplicationConversation = async (req, res, next) => {
  try {
    const conversation = await getOrCreateEmployerConversationForApplication(
      req.user.sub,
      req.params.jobId,
      req.params.applicationId,
    );
    return res.status(200).json({ success: true, data: { conversation } });
  } catch (error) {
    return next(error);
  }
};
