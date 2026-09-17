import {
  deleteVerificationDocumentForUser,
  getEmployerVerification as getEmployerVerificationSummary,
  readVerificationDocumentForUser,
  submitEmployerVerification,
  uploadVerificationDocument as uploadEmployerVerificationDocument,
} from '../services/employerVerification.service.js';

export const getEmployerVerificationStatus = async (req, res, next) => {
  try {
    const data = await getEmployerVerificationSummary(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const submitVerification = async (req, res, next) => {
  try {
    const data = await submitEmployerVerification(req.user.sub, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const uploadVerificationDocument = async (req, res, next) => {
  try {
    const data = await uploadEmployerVerificationDocument(req.user.sub, req.file, req.body?.kind);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const fetchVerificationDocument = async (req, res, next) => {
  try {
    const result = await readVerificationDocumentForUser(req.user.sub, req.params.documentId);
    res.type(result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.fileName)}"`);
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
};

export const deleteVerificationDocument = async (req, res, next) => {
  try {
    const data = await deleteVerificationDocumentForUser(req.user.sub, req.params.documentId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const getEmployerVerification = getEmployerVerificationStatus;
