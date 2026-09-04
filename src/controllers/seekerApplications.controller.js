import { createSeekerApplication, getSeekerApplications } from '../services/seekerApplications.service.js';

export const listApplications = async (req, res, next) => {
  try {
    const data = await getSeekerApplications(req.user.sub);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const createApplication = async (req, res, next) => {
  try {
    const application = await createSeekerApplication(req.user.sub, req.body);
    return res.status(201).json({ success: true, data: { application } });
  } catch (error) {
    return next(error);
  }
};
