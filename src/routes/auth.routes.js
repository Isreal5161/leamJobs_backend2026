import { Router } from 'express';
import { login, register } from '../controllers/auth.controller.js';
import { validateLogin, validateRegistration } from '../validators/auth.validation.js';

const authRouter = Router();

authRouter.post('/register', validateRegistration, register);
authRouter.post('/login', validateLogin, login);

export default authRouter;
