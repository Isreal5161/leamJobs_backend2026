import crypto from 'node:crypto';
import { DuplicateEmailError, getCurrentUser, getLegalAcceptanceStatus, loginUser, recordAccountLegalAcceptance, registerUser } from '../services/auth.service.js';
import { requestPasswordReset, resetPassword } from '../services/passwordReset.service.js';
import { resendEmailVerification, verifyEmailWithCode } from '../services/emailVerification.service.js';
import { completeGoogleRegistration, getGoogleRegistrationStatus, googleContinuationCookieName, googleStateCookieName, handleGoogleCallback, startGoogleOAuth } from '../services/googleOAuth.service.js';
import { buildGoogleCallbackUrl } from '../utils/googleOAuthCallbackUrl.js';
import { toUserResponse } from '../utils/userResponse.js';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { acceptAdminInvitation } from '../services/adminStaff.service.js';

const googleCookieOptions = (path) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path,
});

const readCookie = (req, name) => {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return '';

  const prefix = `${name}=`;
  const cookie = cookieHeader.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : '';
};

const AUTH_ENUMERATION_MIN_MS = 500;
const AUTH_ENUMERATION_JITTER_MS = 100;
const neutralRegistrationResponse = {
  success: true,
  message: 'If registration can be completed for this email, we will send the next steps.',
};

const padAuthResponseTime = async (startedAt) => {
  const targetDuration = AUTH_ENUMERATION_MIN_MS + crypto.randomInt(0, AUTH_ENUMERATION_JITTER_MS + 1);
  // This common floor and jitter reduce timing signals but cannot equalize slow downstream work.
  const remaining = targetDuration - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
};

export const register = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    await registerUser(req.body);
    await padAuthResponseTime(startedAt);
    return res.status(202).json(neutralRegistrationResponse);
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      await padAuthResponseTime(startedAt);
      return res.status(202).json(neutralRegistrationResponse);
    }
    await padAuthResponseTime(startedAt);
    return next(error);
  }
};

export const googleRegistrationStatusController = async (req, res, next) => {
  try {
    const pendingId = req.googlePendingId;
    const continuationToken = readCookie(req, googleContinuationCookieName(pendingId));
    const status = await getGoogleRegistrationStatus({ pendingId, continuationToken });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return next(error);
  }
};

export const login = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { token, user } = await loginUser(req.body);
    await padAuthResponseTime(startedAt);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: toUserResponse(user),
    });
  } catch (error) {
    await padAuthResponseTime(startedAt);
    return next(error);
  }
};

export const acceptAdminInvitationController = async (req, res, next) => {
  try {
    const user = await acceptAdminInvitation(req.body);
    return res.status(201).json({ success: true, data: user });
  } catch (error) {
    return next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    await prisma.authSession.updateMany({
      where: {
        id: req.user.sid,
        userId: req.user.sub,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
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

export const legalAcceptanceStatus = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await getLegalAcceptanceStatus(req.user.sub) });
  } catch (error) {
    return next(error);
  }
};

export const acceptCurrentLegalDocuments = async (req, res, next) => {
  try {
    const data = await recordAccountLegalAcceptance(req.user.sub, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const result = await requestPasswordReset(req.body.email);
    await padAuthResponseTime(startedAt);
    return res.status(200).json(result);
  } catch (error) {
    await padAuthResponseTime(startedAt);
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
  const startedAt = Date.now();
  try {
    const result = await verifyEmailWithCode(req.body);
    await padAuthResponseTime(startedAt);
    return res.status(200).json(result);
  } catch (error) {
    await padAuthResponseTime(startedAt);
    return next(error);
  }
};

export const googleVerifyEmailController = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { pendingId, email, code } = req.body;
    const continuationToken = readCookie(req, googleContinuationCookieName(pendingId));
    const status = await getGoogleRegistrationStatus({ pendingId, continuationToken });
    if (status.email.toLowerCase() !== email.trim().toLowerCase()) {
      throw Object.assign(new Error('Google registration email mismatch.'), {
        status: 400,
        publicMessage: 'The verification request could not be completed. Check the code or request a new one.',
      });
    }

    const verified = await verifyEmailWithCode({ email, code }, { createSession: false });
    const completion = await completeGoogleRegistration({ pendingId, continuationToken, email });
    res.clearCookie(googleContinuationCookieName(pendingId), googleCookieOptions('/api/auth/google/complete'));
    await padAuthResponseTime(startedAt);
    return res.status(200).json({ ...verified, token: completion.token, user: completion.user });
  } catch (error) {
    await padAuthResponseTime(startedAt);
    return next(error);
  }
};

export const resendEmailVerificationController = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const result = await resendEmailVerification(req.body);
    await padAuthResponseTime(startedAt);
    return res.status(200).json(result);
  } catch (error) {
    await padAuthResponseTime(startedAt);
    return next(error);
  }
};

export const googleStartController = async (req, res, next) => {
  try {
    const result = await startGoogleOAuth(
      req.legalAcceptance?.role || req.query.role || 'SEEKER',
      req.legalAcceptance,
    );
    res.cookie(result.stateCookieName, result.stateCookieValue, {
      ...googleCookieOptions('/api/auth/google/callback'),
      maxAge: 15 * 60 * 1000,
    });
    return res.redirect(302, result.redirectUrl);
  } catch (error) {
    return next(error);
  }
};

export const googleCallbackController = async (req, res, next) => {
  let stateCookieName = '';
  try {
    const callbackUrl = buildGoogleCallbackUrl(req.originalUrl, env.GOOGLE_REDIRECT_URI);
    const state = callbackUrl.searchParams.get('state') || '';
    stateCookieName = state ? googleStateCookieName(state) : '';
    const result = await handleGoogleCallback({
      callbackUrl,
      browserBinding: readCookie(req, stateCookieName),
    });

    if (stateCookieName) res.clearCookie(stateCookieName, googleCookieOptions('/api/auth/google/callback'));
    res.cookie(
      googleContinuationCookieName(result.pendingId),
      result.continuationToken,
      {
        ...googleCookieOptions('/api/auth/google/complete'),
        maxAge: 15 * 60 * 1000,
      },
    );
    const frontendBase = (env.FRONTEND_URL || 'http://localhost:4173').replace(/\/$/, '');
    const target = new URL('/verify-email', frontendBase);
    target.searchParams.set('email', result.email);
    target.searchParams.set('pendingId', result.pendingId);
    target.searchParams.set('role', result.role);

    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    return res.redirect(302, target.toString());
  } catch (error) {
    if (stateCookieName) res.clearCookie(stateCookieName, googleCookieOptions('/api/auth/google/callback'));
    if (error?.oauthErrorCode === 'GOOGLE_EMAIL_UNVERIFIED'
      || error?.oauthErrorCode === 'EMAIL_ALREADY_REGISTERED'
      || error?.oauthErrorCode === 'ROLE_MISMATCH') {
      const frontendBase = (env.FRONTEND_URL || 'http://localhost:4173').replace(/\/$/, '');
      const existingRole = error.existingRole;
      const emailUnverified = error.oauthErrorCode === 'GOOGLE_EMAIL_UNVERIFIED';
      const targetPath = emailUnverified
        ? '/choose-sign-in'
        : existingRole === 'EMPLOYER' ? '/employers/login' : '/login';
      const target = new URL(targetPath, frontendBase);
      if (emailUnverified) {
        target.searchParams.set('oauth_error', 'google_email_unverified');
      } else {
        target.searchParams.set('oauth_error', error.oauthErrorCode === 'ROLE_MISMATCH' ? 'role_mismatch' : 'account_exists');
      }
      if (!emailUnverified && (existingRole === 'SEEKER' || existingRole === 'EMPLOYER')) {
        target.searchParams.set('existing_role', existingRole);
      }
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      return res.redirect(302, target.toString());
    }
    return next(error);
  }
};

export const googleCompleteController = async (req, res, next) => {
  try {
    const result = await completeGoogleRegistration({
      ...req.body,
      continuationToken: readCookie(req, googleContinuationCookieName(req.body.pendingId)),
    });
    res.clearCookie(googleContinuationCookieName(req.body.pendingId), googleCookieOptions('/api/auth/google/complete'));
    return res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
};
