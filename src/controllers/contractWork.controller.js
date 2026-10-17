import {
  createContractProgressUpdate,
  listContractActivities,
  readContractWorkAttachment,
  reviewContractSubmission,
  submitContractWork,
} from '../services/contractWork.service.js';

const listForRole = (role) => async (req, res, next) => {
  try {
    const activities = await listContractActivities({ contractId: req.params.contractId, userId: req.user.sub, role });
    return res.status(200).json({ success: true, data: { activities } });
  } catch (error) {
    return next(error);
  }
};

const updateProgressForRole = (role) => async (req, res, next) => {
  try {
    const activity = await createContractProgressUpdate({
      contractId: req.params.contractId,
      userId: req.user.sub,
      role,
      description: req.body.description,
      status: req.body.status,
    });
    return res.status(201).json({ success: true, data: { activity } });
  } catch (error) {
    return next(error);
  }
};

const downloadForRole = (role) => async (req, res, next) => {
  try {
    const attachment = await readContractWorkAttachment({
      contractId: req.params.contractId,
      activityId: req.params.activityId,
      attachmentId: req.params.attachmentId,
      userId: req.user.sub,
      role,
    });
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.type(attachment.contentType);
    res.attachment(attachment.fileName);
    return res.send(attachment.buffer);
  } catch (error) {
    return next(error);
  }
};

export const listSeekerContractActivities = listForRole('SEEKER');
export const listEmployerContractActivities = listForRole('EMPLOYER');
export const updateSeekerContractProgress = updateProgressForRole('SEEKER');
export const downloadSeekerContractWorkAttachment = downloadForRole('SEEKER');
export const downloadEmployerContractWorkAttachment = downloadForRole('EMPLOYER');

export const createSeekerContractSubmission = async (req, res, next) => {
  try {
    const activity = await submitContractWork({
      contractId: req.params.contractId,
      userId: req.user.sub,
      description: req.body.description,
      links: req.body.links,
      files: req.files ?? [],
    });
    return res.status(201).json({ success: true, data: { activity } });
  } catch (error) {
    return next(error);
  }
};

export const reviewEmployerContractSubmission = async (req, res, next) => {
  try {
    const activity = await reviewContractSubmission({
      contractId: req.params.contractId,
      submissionId: req.params.activityId,
      userId: req.user.sub,
      action: req.body.action,
      description: req.body.description,
    });
    return res.status(201).json({ success: true, data: { activity } });
  } catch (error) {
    return next(error);
  }
};
