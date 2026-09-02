import { Router } from 'express';
import { login, me, register } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateLogin, validateRegistration } from '../validators/auth.validation.js';

const authRouter = Router();

authRouter.post('/register', validateRegistration, register);
authRouter.post('/login', validateLogin, login);
authRouter.get('/me', authenticate, me);

export default authRouter;
