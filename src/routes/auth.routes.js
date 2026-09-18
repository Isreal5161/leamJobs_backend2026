import { Router } from 'express';
import { forgotPassword, login, me, register, resendEmailVerificationController, resetPasswordController, verifyEmailController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateLogin, validateRegistration, validateResendEmailVerification, validateVerifyEmail } from '../validators/auth.validation.js';
import { validateForgotPassword, validateResetPassword } from '../validators/passwordReset.validation.js';
import { getPreferences, unsubscribe, updatePreferences } from '../controllers/emailPreference.controller.js';
import { validateEmailPreferenceUpdate } from '../validators/emailPreference.validation.js';

const authRouter = Router();

authRouter.post('/register', validateRegistration, register);
authRouter.post('/verify-email', validateVerifyEmail, verifyEmailController);
authRouter.post('/verify-email/resend', validateResendEmailVerification, resendEmailVerificationController);
authRouter.post('/login', validateLogin, login);
authRouter.post('/forgot-password', validateForgotPassword, forgotPassword);
authRouter.post('/reset-password', validateResetPassword, resetPasswordController);
authRouter.get('/email-preferences', authenticate, getPreferences);
authRouter.patch('/email-preferences', authenticate, validateEmailPreferenceUpdate, updatePreferences);
authRouter.get('/unsubscribe', unsubscribe);
authRouter.get('/me', authenticate, me);

export default authRouter;
