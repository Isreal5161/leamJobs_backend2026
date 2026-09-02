import { Router } from 'express';
import { register } from '../controllers/auth.controller.js';
import { validateRegistration } from '../validators/auth.validation.js';

const authRouter = Router();

authRouter.post('/register', validateRegistration, register);

export default authRouter;
