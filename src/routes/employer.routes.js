import { Router } from 'express';
import { dashboard, getEmployerMe } from '../controllers/employer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';

const employerRouter = Router();

employerRouter.get('/me', authenticate, requireRole('EMPLOYER'), getEmployerMe);
employerRouter.get('/dashboard', authenticate, requireRole('EMPLOYER'), dashboard);

export default employerRouter;