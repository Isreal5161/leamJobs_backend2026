import { Router } from 'express';
import { getPublicCompanyLogo } from '../controllers/publicCompanyLogo.controller.js';

const publicRouter = Router();

publicRouter.get('/companies/:employerId/logo', getPublicCompanyLogo);

export default publicRouter;