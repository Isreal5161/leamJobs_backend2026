import { getCurrentUser, loginUser, registerUser } from '../services/auth.service.js';
import { requestPasswordReset, resetPassword } from '../services/passwordReset.service.js';
import { resendEmailVerification, verifyEmailWithCode } from '../services/emailVerification.service.js';
import { completeGoogleRegistration, handleGoogleCallback, startGoogleOAuth } from '../services/googleOAuth.service.js';
import { toUserResponse } from '../utils/userResponse.js';
import { env } from '../config/env.js';

export const register = async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    return res.status(201).json(toUserResponse(user));
  } catch (error) {
    return next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { token, user } = await loginUser(req.body);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: toUserResponse(user),
    });
  } catch (error) {
    return next(error);
  }
};

export const me = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.user.sub);
    return res.status(200).json(toUserResponse(user));
  } catch (error) {
    return next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    return res.status(200).json(await requestPasswordReset(req.body.email));
  } catch (error) {
    return next(error);
  }
};

export const resetPasswordController = async (req, res, next) => {
  try {
    return res.status(200).json(await resetPassword(req.body));
  } catch (error) {
    return next(error);
  }
};

export const verifyEmailController = async (req, res, next) => {
  try {
    const result = await verifyEmailWithCode(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const resendEmailVerificationController = async (req, res, next) => {
  try {
    const result = await resendEmailVerification(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const googleStartController = async (req, res, next) => {
  try {
    const { redirectUrl } = await startGoogleOAuth(req.query.role || 'SEEKER');
    return res.redirect(302, redirectUrl);
  } catch (error) {
    return next(error);
  }
};

export const googleCallbackController = async (req, res, next) => {
  try {
    const result = await handleGoogleCallback({
      code: req.query.code,
      state: req.query.state,
      nonce: req.query.nonce,
      error: req.query.error,
      errorDescription: req.query.error_description,
    });

    const frontendBase = (env.FRONTEND_URL || 'http://localhost:4173').replace(/\/$/, '');
    const target = new URL('/verify-email', frontendBase);
    target.searchParams.set('email', result.email);
    target.searchParams.set('pendingId', result.pendingId);
    target.searchParams.set('continuationToken', result.continuationToken);
    target.searchParams.set('role', result.role);

    return res.redirect(302, target.toString());
  } catch (error) {
    return next(error);
  }
};

export const googleCompleteController = async (req, res, next) => {
  try {
    const result = await completeGoogleRegistration(req.body);
    return res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
};
