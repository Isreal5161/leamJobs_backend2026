import { Router } from 'express';
import { dashboard } from '../controllers/seekerDashboard.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/authorization.middleware.js';

const seekerRouter = Router();

seekerRouter.get('/dashboard', authenticate, requireRole('SEEKER'), dashboard);

export default seekerRouter;
