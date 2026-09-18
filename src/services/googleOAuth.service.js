import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { discovery } from 'openid-client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { registerEmailVerificationOnUser } from './emailVerification.service.js';

const GOOGLE_PROVIDER = 'GOOGLE';
const PENDING_LINK_TTL_MINUTES = 15;
const GOOGLE_OAUTH_SCOPE = 'openid email profile';

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const ensureGoogleConfig = () => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    const error = new Error('Google OAuth is not configured.');
    error.status = 500;
    error.publicMessage = 'Google sign-in is not configured for this environment.';
    throw error;
  }
};

const signPendingContinuation = ({ pendingId, userId, email, role, providerSubject }) => jwt.sign(
  {
    sub: providerSubject,
    pendingId,
    userId,
    email,
    role,
    provider: GOOGLE_PROVIDER,
  },
  env.JWT_SECRET,
  {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: '15m',
  },
);

const assertPendingContinuationMatchesRecord = (pending, payload, normalizedEmail) => {
  if (!pending) {
    throw Object.assign(new Error('Google registration session not found.'), { status: 400, publicMessage: 'Your Google sign-up session expired or was already used. Please start again.' });
  }

  if (pending.status !== 'VERIFICATION_PENDING') {
    throw Object.assign(new Error('Google registration session is not active.'), { status: 409, publicMessage: 'Your Google sign-up session is no longer active. Please start again.' });
  }

  if (pending.consumedAt || pending.expiresAt < new Date()) {
    throw Object.assign(new Error('Google registration session expired or already used.'), { status: 400, publicMessage: 'Your Google sign-up session expired or was already used. Please start again.' });
  }

  if (pending.id !== payload.pendingId) {
    throw Object.assign(new Error('Google registration continuation mismatch.'), { status: 400, publicMessage: 'Your Google sign-up session is invalid. Please start again.' });
  }

  if (pending.userId !== payload.userId) {
    throw Object.assign(new Error('Google registration user mismatch.'), { status: 400, publicMessage: 'Your Google sign-up session is invalid. Please start again.' });
  }

  if (pending.provider !== GOOGLE_PROVIDER) {
    throw Object.assign(new Error('Google registration provider mismatch.'), { status: 400, publicMessage: 'Your Google sign-up session is invalid. Please start again.' });
  }

  if (pending.providerSubject && payload.sub && pending.providerSubject !== payload.sub) {
    throw Object.assign(new Error('Google registration subject mismatch.'), { status: 400, publicMessage: 'Your Google sign-up session is invalid. Please start again.' });
  }

  if (pending.intendedRole !== payload.role) {
    throw Object.assign(new Error('Google registration role mismatch.'), { status: 409, publicMessage: 'Google signup role mismatch. Please start again.' });
  }

  if (String(normalizedEmail || '').toLowerCase() !== String(pending.email || '').toLowerCase()) {
    throw Object.assign(new Error('Google registration email mismatch.'), { status: 400, publicMessage: 'Google sign-up email mismatch. Please start again.' });
  }
};

const verifyPendingContinuation = (token) => {
  if (!token) {
    const error = new Error('Google sign-up continuation token is missing.');
    error.status = 400;
    error.publicMessage = 'Your Google sign-up session expired. Please start again.';
    throw error;
  }

  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  } catch {
    const error = new Error('Google sign-up continuation token is invalid.');
    error.status = 400;
    error.publicMessage = 'Your Google sign-up session is invalid. Please start again.';
    throw error;
  }
};

const getGoogleClient = async () => {
  ensureGoogleConfig();

  const issuer = await discovery(env.GOOGLE_ISSUER || 'https://accounts.google.com');
  return new issuer.Client({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [env.GOOGLE_REDIRECT_URI],
    response_types: ['code'],
  });
};

const normalizeRole = (requestedRole) => {
  if (requestedRole === 'EMPLOYER' || requestedRole === 'SEEKER') return requestedRole;

  const error = new Error('Unsupported Google signup role.');
  error.status = 400;
  error.publicMessage = 'Google signup role is invalid. Please choose a valid account type.';
  throw error;
};

export const startGoogleOAuth = async (requestedRole) => {
  ensureGoogleConfig();
  const role = normalizeRole(requestedRole);
  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const pending = await prisma.pendingOAuthRegistration.create({
    data: {
      provider: GOOGLE_PROVIDER,
      intendedRole: role,
      nonce,
      stateHash: hashValue(state),
      codeVerifier,
      email: '',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + PENDING_LINK_TTL_MINUTES * 60 * 1000),
    },
  });

  const client = await getGoogleClient();

  const redirectUrl = client.authorizationUrl({
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    scope: GOOGLE_OAUTH_SCOPE,
    response_type: 'code',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    redirectUrl,
    pendingId: pending.id,
  };
};

export const handleGoogleCallback = async ({ code, state, nonce, error, errorDescription }) => {
  if (error) {
    const googleError = new Error(errorDescription || 'Google authentication failed.');
    googleError.status = 400;
    googleError.publicMessage = 'Google authentication failed. Please try again.';
    throw googleError;
  }

  if (!code || !state) {
    const invalidState = new Error('Missing Google OAuth state or authorization code.');
    invalidState.status = 400;
    invalidState.publicMessage = 'Google sign-in could not be completed. Please try again.';
    throw invalidState;
  }

  const pending = await prisma.pendingOAuthRegistration.findFirst({
    where: {
      stateHash: hashValue(state),
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
  });

  if (!pending) {
    const invalidState = new Error('Invalid or expired Google OAuth state.');
    invalidState.status = 400;
    invalidState.publicMessage = 'Your Google sign-in session expired. Please try again.';
    throw invalidState;
  }

  if (nonce && String(nonce).trim() !== pending.nonce) {
    const invalidNonce = new Error('Invalid Google OAuth nonce.');
    invalidNonce.status = 400;
    invalidNonce.publicMessage = 'Google identity verification failed.';
    throw invalidNonce;
  }

  const client = await getGoogleClient();

  let tokenSet;
  try {
    tokenSet = await client.callback(
      env.GOOGLE_REDIRECT_URI,
      { code, state },
      {
        state,
        nonce: pending.nonce,
        code_verifier: pending.codeVerifier,
      },
    );
  } catch (callbackError) {
    const codeExchangeError = new Error('Google authorization code exchange failed.');
    codeExchangeError.status = 400;
    codeExchangeError.publicMessage = 'Google identity verification failed. Please try again.';
    throw codeExchangeError;
  }

  const claims = tokenSet.claims();
  const providerSubject = String(claims.sub || '').trim();
  const normalizedEmail = String(claims.email || '').trim().toLowerCase();

  if (!providerSubject || !normalizedEmail) {
    const invalidIdentity = new Error('Google did not return a valid identity.');
    invalidIdentity.status = 400;
    invalidIdentity.publicMessage = 'Google account information could not be verified.';
    throw invalidIdentity;
  }

  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    const invalidIssuer = new Error('Unexpected Google issuer.');
    invalidIssuer.status = 400;
    invalidIssuer.publicMessage = 'Google identity verification failed.';
    throw invalidIssuer;
  }

  if (claims.aud !== env.GOOGLE_CLIENT_ID) {
    const invalidAudience = new Error('Unexpected Google audience.');
    invalidAudience.status = 400;
    invalidAudience.publicMessage = 'Google identity verification failed.';
    throw invalidAudience;
  }

  if (claims.exp && Number(claims.exp) * 1000 < Date.now()) {
    const expiredToken = new Error('Google token expired.');
    expiredToken.status = 400;
    expiredToken.publicMessage = 'Google identity verification expired. Please try again.';
    throw expiredToken;
  }

  if (claims.email_verified !== true) {
    const unverifiedEmail = new Error('Google email is not verified.');
    unverifiedEmail.status = 400;
    unverifiedEmail.publicMessage = 'Google email verification is required before continuing.';
    throw unverifiedEmail;
  }

  const callbackResult = await prisma.$transaction(async (transaction) => {
    const existingOAuthAccount = await transaction.oauthAccount.findUnique({
      where: {
        provider_providerSubject: {
          provider: GOOGLE_PROVIDER,
          providerSubject,
        },
      },
      include: { user: true },
    });

    if (existingOAuthAccount) {
      const existingUser = existingOAuthAccount.user;
      const storedEmail = String(existingOAuthAccount.email || existingUser?.email || '').trim().toLowerCase();
      const storedSubject = String(existingOAuthAccount.providerSubject || '').trim();

      if (!existingUser) {
        const identityMismatch = new Error('This Google account is linked to a missing LeamJobs user.');
        identityMismatch.status = 409;
        identityMismatch.publicMessage = 'This Google account is linked to an invalid LeamJobs identity. Please sign in with your existing account or start again.';
        throw identityMismatch;
      }

      if (existingOAuthAccount.provider !== GOOGLE_PROVIDER || storedSubject !== providerSubject) {
        const identityMismatch = new Error('This Google account identity does not match the stored LeamJobs identity.');
        identityMismatch.status = 409;
        identityMismatch.publicMessage = 'This Google account identity is invalid. Please start again.';
        throw identityMismatch;
      }

      if (storedEmail && storedEmail !== normalizedEmail) {
        const identityMismatch = new Error('This Google account email does not match the associated LeamJobs identity.');
        identityMismatch.status = 409;
        identityMismatch.publicMessage = 'This Google account is already linked to a different email address.';
        throw identityMismatch;
      }

      if (existingUser.email && String(existingUser.email).trim().toLowerCase() !== normalizedEmail) {
        const identityMismatch = new Error('This Google account is linked to a different LeamJobs email.');
        identityMismatch.status = 409;
        identityMismatch.publicMessage = 'This Google account is already linked to a different email address.';
        throw identityMismatch;
      }

      if (existingUser.role !== pending.intendedRole) {
        const roleMismatch = new Error('This Google account is already linked to a different LeamJobs role.');
        roleMismatch.status = 409;
        roleMismatch.publicMessage = 'This Google account is already linked to a different account role.';
        throw roleMismatch;
      }

      await transaction.pendingOAuthRegistration.update({
        where: { id: pending.id },
        data: {
          providerSubject,
          email: normalizedEmail,
          userId: existingUser.id,
          status: 'VERIFICATION_PENDING',
        },
      });

      return {
        pendingId: pending.id,
        email: normalizedEmail,
        role: existingUser.role,
        userId: existingUser.id,
        continuationToken: signPendingContinuation({
          pendingId: pending.id,
          userId: existingUser.id,
          email: normalizedEmail,
          role: existingUser.role,
          providerSubject,
        }),
      };
    }

    const existingUserByEmail = await transaction.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUserByEmail) {
      const emailConflict = new Error('This email is already associated with a LeamJobs account.');
      emailConflict.status = 409;
      emailConflict.publicMessage = 'This email is already associated with a LeamJobs account. Please sign in to link Google or use a different email.';
      throw emailConflict;
    }

    let createdUser;
    try {
      createdUser = await transaction.user.create({
        data: {
          email: normalizedEmail,
          firstName: String(claims.given_name || '').trim() || 'Google',
          lastName: String(claims.family_name || '').trim() || 'User',
          passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12),
          role: pending.intendedRole,
          isActive: false,
          isVerified: false,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        const canonicalUser = await transaction.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (canonicalUser) {
          const emailConflict = new Error('This email is already associated with a LeamJobs account.');
          emailConflict.status = 409;
          emailConflict.publicMessage = 'This email is already associated with a LeamJobs account. Please sign in to link Google or use a different email.';
          throw emailConflict;
        }
      }
      throw error;
    }

    try {
      await transaction.oauthAccount.create({
        data: {
          provider: GOOGLE_PROVIDER,
          providerSubject,
          email: normalizedEmail,
          userId: createdUser.id,
          firstName: String(claims.given_name || '').trim() || null,
          lastName: String(claims.family_name || '').trim() || null,
          pictureUrl: String(claims.picture || '').trim() || null,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        const canonicalAccount = await transaction.oauthAccount.findUnique({
          where: {
            provider_providerSubject: {
              provider: GOOGLE_PROVIDER,
              providerSubject,
            },
          },
          include: { user: true },
        });

        if (canonicalAccount) {
          if (canonicalAccount.user.role !== pending.intendedRole) {
            const roleMismatch = new Error('This Google account is already linked to a different LeamJobs role.');
            roleMismatch.status = 409;
            roleMismatch.publicMessage = 'This Google account is already linked to a different account role.';
            throw roleMismatch;
          }

          await transaction.pendingOAuthRegistration.update({
            where: { id: pending.id },
            data: {
              providerSubject,
              email: normalizedEmail,
              userId: canonicalAccount.userId,
              status: 'VERIFICATION_PENDING',
            },
          });

          return {
            pendingId: pending.id,
            email: normalizedEmail,
            role: canonicalAccount.user.role,
            userId: canonicalAccount.userId,
            continuationToken: signPendingContinuation({
              pendingId: pending.id,
              userId: canonicalAccount.userId,
              email: normalizedEmail,
              role: canonicalAccount.user.role,
              providerSubject,
            }),
          };
        }
      }
      throw error;
    }

    await registerEmailVerificationOnUser(createdUser);

    await transaction.pendingOAuthRegistration.update({
      where: { id: pending.id },
      data: {
        providerSubject,
        email: normalizedEmail,
        userId: createdUser.id,
        status: 'VERIFICATION_PENDING',
      },
    });

    return {
      pendingId: pending.id,
      email: normalizedEmail,
      role: createdUser.role,
      userId: createdUser.id,
      continuationToken: signPendingContinuation({
        pendingId: pending.id,
        userId: createdUser.id,
        email: normalizedEmail,
        role: createdUser.role,
        providerSubject,
      }),
    };
  });

  return callbackResult;
};

export const completeGoogleRegistration = async ({ pendingId, continuationToken, email, companyName, phone }) => {
  if (!pendingId || !continuationToken) {
    const error = new Error('Missing Google registration continuation data.');
    error.status = 400;
    error.publicMessage = 'Your Google sign-up session is incomplete. Please start again.';
    throw error;
  }

  const payload = verifyPendingContinuation(continuationToken);
  const normalizedEmail = String(email || payload.email || '').trim().toLowerCase();

  const pending = await prisma.pendingOAuthRegistration.findUnique({
    where: { id: pendingId },
    include: { user: true },
  });

  assertPendingContinuationMatchesRecord(pending, payload, normalizedEmail);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      isVerified: true,
      phone: true,
    },
  });

  if (!user) {
    const error = new Error('Google registration user is missing.');
    error.status = 400;
    error.publicMessage = 'Google sign-up could not be completed. Please start again.';
    throw error;
  }

  if (!user.isVerified || !user.isActive) {
    const error = new Error('Please verify your email address before completing Google signup.');
    error.status = 403;
    error.publicMessage = 'Please verify your email address before completing Google signup.';
    throw error;
  }

  if (pending.intendedRole !== user.role) {
    const error = new Error('Google registration role mismatch.');
    error.status = 409;
    error.publicMessage = 'Google signup role mismatch. Please start again.';
    throw error;
  }

  if (pending.intendedRole === 'EMPLOYER') {
    const trimmedCompanyName = String(companyName || '').trim();
    const trimmedPhone = String(phone || user.phone || '').trim();

    if (!trimmedCompanyName || !trimmedPhone) {
      const error = new Error('Company name and phone number are required.');
      error.status = 400;
      error.publicMessage = 'Company name and phone number are required to complete employer signup.';
      throw error;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { phone: trimmedPhone },
    });

    await prisma.employerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        companyName: trimmedCompanyName,
        companyLogoUrl: null,
      },
      update: {
        companyName: trimmedCompanyName,
      },
    });
  }

  const consumed = await prisma.pendingOAuthRegistration.updateMany({
    where: {
      id: pendingId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      userId: user.id,
      intendedRole: pending.intendedRole,
    },
    data: {
      consumedAt: new Date(),
      status: 'COMPLETED',
      userId: user.id,
    },
  });

  if (consumed.count !== 1) {
    const error = new Error('This Google registration has already been completed.');
    error.status = 409;
    error.publicMessage = 'This Google sign-up session has already been completed.';
    throw error;
  }

  const finalizedUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      isActive: true,
      isVerified: true,
      createdAt: true,
    },
  });

  const token = jwt.sign(
    { sub: finalizedUser.id, role: finalizedUser.role },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_EXPIRE,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );

  return {
    token,
    user: finalizedUser,
  };
};
