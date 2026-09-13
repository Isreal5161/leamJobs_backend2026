import {
  getAdminApplication,
  getAdminApplicationResume,
  listAdminApplications,
  selectAdminContractApplication,
  updateAdminApplicationStatus,
} from '../services/adminApplications.service.js';

export const listAdminApplicationController = async (req, res, next) => {
  try {
    const data = await listAdminApplications(req.params.jobId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getAdminApplicationController = async (req, res, next) => {
  try {
    const application = await getAdminApplication(req.params.jobId, req.params.applicationId);
    return res.status(200).json({ success: true, data: { application } });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminApplicationStatusController = async (req, res, next) => {
  try {
    const application = await updateAdminApplicationStatus(req.params.jobId, req.params.applicationId, req.body.status);
    return res.status(200).json({ success: true, data: { application } });
  } catch (error) {
    return next(error);
  }
};

export const selectAdminContractApplicationController = async (req, res, next) => {
  try {
    const selection = await selectAdminContractApplication(req.params.jobId, req.params.applicationId);
    return res.status(200).json({ success: true, data: { selection } });
  } catch (error) {
    return next(error);
  }
};

export const getAdminApplicationResumeController = async (req, res, next) => {
  try {
    const result = await getAdminApplicationResume(req.params.jobId, req.params.applicationId);
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
