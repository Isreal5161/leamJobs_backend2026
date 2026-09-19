import { Router } from 'express';
import { getPublicCompanyProfile } from '../controllers/publicCompany.controller.js';
import { getPublicCompanyLogo } from '../controllers/publicCompanyLogo.controller.js';
import { validatePublicCompanyParams, validatePublicCompanyQuery } from '../validators/publicCompany.validation.js';

const publicRouter = Router();

publicRouter.get('/companies/:employerId/logo', getPublicCompanyLogo);
publicRouter.get('/companies/:employerId', validatePublicCompanyParams, validatePublicCompanyQuery, getPublicCompanyProfile);

export default publicRouter;