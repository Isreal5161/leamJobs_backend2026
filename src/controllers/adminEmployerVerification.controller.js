import {
  approveEmployerVerification as approveSubmission,
  getEmployerVerificationForAdmin,
  listEmployerVerifications as listVerificationSubmissions,
  readVerificationDocumentForAdmin,
  rejectEmployerVerification as rejectSubmission,
} from '../services/employerVerification.service.js';

export const listEmployerVerificationSubmissions = async (req, res, next) => {
  try {
    const data = await listVerificationSubmissions(req.validatedPagination);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const viewEmployerVerification = async (req, res, next) => {
  try {
    const data = await getEmployerVerificationForAdmin(req.params.verificationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const approveEmployerVerification = async (req, res, next) => {
  try {
    const data = await approveSubmission(req.user.sub, req.params.verificationId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const rejectEmployerVerification = async (req, res, next) => {
  try {
    const data = await rejectSubmission(req.user.sub, req.params.verificationId, req.body?.reason);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const fetchVerificationDocumentForAdmin = async (req, res, next) => {
  try {
    const result = await readVerificationDocumentForAdmin(req.params.documentId);
    res.type(result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.fileName)}"`);
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
};

export const listEmployerVerifications = listEmployerVerificationSubmissions;
