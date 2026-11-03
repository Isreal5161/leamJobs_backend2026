import { Router } from 'express';
import { acceptCurrentLegalDocuments, forgotPassword, googleCallbackController, googleCompleteController, googleStartController, legalAcceptanceStatus, login, logout, me, register, resendEmailVerificationController, resetPasswordController, verifyEmailController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateGoogleComplete, validateGoogleStart, validateLegalAcceptance, validateLogin, validateRegistration, validateResendEmailVerification, validateVerifyEmail } from '../validators/auth.validation.js';
import { validateForgotPassword, validateResetPassword } from '../validators/passwordReset.validation.js';
import { getPreferences, unsubscribe, updatePreferences } from '../controllers/emailPreference.controller.js';
import { validateEmailPreferenceUpdate } from '../validators/emailPreference.validation.js';
import { authRateLimiters } from '../middleware/authRateLimit.middleware.js';

const authRouter = Router();

authRouter.post('/register', authRateLimiters.register, validateRegistration, register);
authRouter.get('/legal-acceptances', authenticate, legalAcceptanceStatus);
authRouter.post('/legal-acceptances', authenticate, validateLegalAcceptance, acceptCurrentLegalDocuments);
authRouter.get('/google/start', authRateLimiters.googleStart, validateGoogleStart, googleStartController);
authRouter.get('/google/callback', authRateLimiters.googleCallback, googleCallbackController);
authRouter.post('/google/complete', authRateLimiters.googleComplete, validateGoogleComplete, googleCompleteController);
authRouter.post('/verify-email', authRateLimiters.verifyEmail, validateVerifyEmail, verifyEmailController);
authRouter.post('/verify-email/resend', authRateLimiters.resendEmailVerification, validateResendEmailVerification, resendEmailVerificationController);
authRouter.post('/login', authRateLimiters.login, validateLogin, login);
authRouter.post('/logout', authenticate, logout);
authRouter.post('/forgot-password', authRateLimiters.forgotPassword, validateForgotPassword, forgotPassword);
authRouter.post('/reset-password', authRateLimiters.resetPassword, validateResetPassword, resetPasswordController);
authRouter.get('/email-preferences', authenticate, getPreferences);
authRouter.patch('/email-preferences', authenticate, validateEmailPreferenceUpdate, updatePreferences);
authRouter.get('/unsubscribe', unsubscribe);
authRouter.get('/me', authenticate, me);

export default authRouter;
