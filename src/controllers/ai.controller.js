import { assistApplication, generateCoverLetter, getProfileAssistantSuggestions, optimizeCv } from '../services/aiFeatures.service.js';

const run = (service, input) => async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await service(req.user.sub, input(req)) }); } catch (error) { return next(error); }
};

export const profileAssistant = run(getProfileAssistantSuggestions, (req) => req.validatedAi);
export const cvOptimizer = run(optimizeCv, (req) => req.validatedAi);
export const applicationAssistance = run(assistApplication, (req) => req.validatedAi);
export const generateApplicationCoverLetter = async (req, res, next) => {
  try {
    const data = await generateCoverLetter(req.user.sub, req.validatedAi);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};
