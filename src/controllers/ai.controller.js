import { assistApplication, getProfileAssistantSuggestions, optimizeCv } from '../services/aiFeatures.service.js';

const run = (service, input) => async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await service(req.user.sub, input(req)) }); } catch (error) { return next(error); }
};

export const profileAssistant = run(getProfileAssistantSuggestions, (req) => req.validatedAi);
export const cvOptimizer = run(optimizeCv, (req) => req.validatedAi);
export const applicationAssistance = run(assistApplication, (req) => req.validatedAi);
