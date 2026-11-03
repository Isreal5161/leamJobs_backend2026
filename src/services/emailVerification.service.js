import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';

const CODE_LENGTH = 6;
const DEFAULT_CODE_EXPIRY_MINUTES = 15;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;
const GENERIC_RESEND_RESPONSE = {
  success: true,
  message: 'If this email needs verification, a code has been sent.',
};
const GENERIC_VERIFICATION_ERROR = 'The verification request could not be completed. Check the code or request a new one.';

const hashCode = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const verifyHash = (value, digest) => crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hashCode(value), 'hex'));

const getCodeExpiryMinutes = () => Number(process.env.EMAIL_VERIFICATION_EXPIRE_MINUTES || env.PASSWORD_RESET_EXPIRE_MINUTES || DEFAULT_CODE_EXPIRY_MINUTES);
const getMaxAttempts = () => Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
const getResendCooldownSeconds = () => Number(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS || DEFAULT_RESEND_COOLDOWN_SECONDS);

const buildVerificationCode = () => {
  const value = crypto.randomInt(0, 10 ** CODE_LENGTH);
  return value.toString().padStart(CODE_LENGTH, '0');
};

const buildVerificationEventKey = (userId) => `email-verification:${userId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;

const buildVerificationEmailContext = (code) => ({
  title: 'Verify your LeamJobs email',
  heading: 'Verify your email address',
  message: `Use the verification code below to confirm your email address. This code expires in ${getCodeExpiryMinutes()} minutes. Do not share it with anyone.`,
  code,
  link: null,
  linkLabel: null,
});

const getUserForVerification = async (email) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  return prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isVerified: true,
      isActive: true,
      role: true,
    },
  });
};

export const createEmailVerificationChallenge = async (userIdOrEmail, maybeEmail) => {
  const user = typeof userIdOrEmail === 'string' && maybeEmail
    ? await prisma.user.findUnique({ where: { email: String(maybeEmail).trim().toLowerCase() }, select: { id: true, email: true, firstName: true, isActive: true, isVerified: true, role: true } })
    : await prisma.user.findUnique({ where: { id: String(userIdOrEmail) }, select: { id: true, email: true, firstName: true, isActive: true, isVerified: true, role: true } });

  if (!user) {
    return { success: false, message: 'If an account exists for this email, a verification code has been sent.' };
  }

  const code = buildVerificationCode();
  const now = new Date();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + getCodeExpiryMinutes() * 60 * 1000);
  const cooldownMs = getResendCooldownSeconds() * 1000;
  const cooldownThreshold = new Date(now.getTime() - cooldownMs);

  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.emailVerificationCode.findUnique({
        where: { userId: user.id },
        select: { id: true, lastSentAt: true },
      });

      const updated = await transaction.emailVerificationCode.updateMany({
        where: {
          userId: user.id,
          OR: [
            { lastSentAt: null },
            { lastSentAt: { lte: cooldownThreshold } },
          ],
        },
        data: {
          codeHash,
          expiresAt,
          usedAt: null,
          attempts: 0,
          lastSentAt: now,
          maxAttempts: getMaxAttempts(),
        },
      });

      if (updated.count === 1) {
        await queueEmail({
          client: transaction,
          recipientUserId: user.id,
          emailType: EMAIL_TYPES.EMAIL_VERIFICATION_CODE,
          eventKey: buildVerificationEventKey(user.id),
          recipientEmail: user.email,
          context: buildVerificationEmailContext(code),
        });
        return { success: true, message: 'A verification code has been sent to your email address.' };
      }

      const current = await transaction.emailVerificationCode.findUnique({
        where: { userId: user.id },
        select: { id: true, lastSentAt: true },
      });

      if (current?.lastSentAt) {
        const elapsed = now.getTime() - new Date(current.lastSentAt).getTime();
        if (elapsed < cooldownMs) {
          return { success: false, message: `Please wait ${Math.ceil((cooldownMs - elapsed) / 1000)} seconds before requesting a new code.` };
        }
      }

      try {
        await transaction.emailVerificationCode.create({
          data: {
            userId: user.id,
            codeHash,
            expiresAt,
            usedAt: null,
            attempts: 0,
            lastSentAt: now,
            maxAttempts: getMaxAttempts(),
          },
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          return { success: false, message: `Please wait ${getResendCooldownSeconds()} seconds before requesting a new code.` };
        }
        throw error;
      }

      await queueEmail({
        client: transaction,
        recipientUserId: user.id,
        emailType: EMAIL_TYPES.EMAIL_VERIFICATION_CODE,
        eventKey: buildVerificationEventKey(user.id),
        recipientEmail: user.email,
        context: buildVerificationEmailContext(code),
      });

      return { success: true, message: 'A verification code has been sent to your email address.' };
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return { success: false, message: `Please wait ${getResendCooldownSeconds()} seconds before requesting a new code.` };
    }
    throw error;
  }
};

export const resendEmailVerification = async ({ email }) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) return GENERIC_RESEND_RESPONSE;

  const user = await getUserForVerification(normalizedEmail);
  if (!user || user.isVerified) return GENERIC_RESEND_RESPONSE;

  await createEmailVerificationChallenge(user.id, user.email);
  return GENERIC_RESEND_RESPONSE;
};

export const verifyEmailWithCode = async ({ email, code }) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedCode = String(code ?? '').trim();
  const user = await getUserForVerification(normalizedEmail);

  if (!user) {
    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  if (user.isVerified) {
    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  const challenge = await prisma.emailVerificationCode.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      expiresAt: true,
      usedAt: true,
      attempts: true,
      maxAttempts: true,
    },
  });

  if (!challenge) {
    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  if (challenge.usedAt) {
    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  const isMatch = verifyHash(normalizedCode, challenge.codeHash);
  if (!isMatch) {
    const nextAttempts = (challenge.attempts ?? 0) + 1;
    const maxAttempts = Number(challenge.maxAttempts ?? getMaxAttempts());
    const updated = await prisma.emailVerificationCode.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { attempts: nextAttempts, ...(nextAttempts >= maxAttempts ? { usedAt: new Date(), expiresAt: new Date(Date.now() - 1000) } : {}) },
    });

    if (updated.count !== 1) {
      throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
    }

    if (nextAttempts >= maxAttempts) {
      throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
    }

    throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
  }

  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.emailVerificationCode.updateMany({
      where: {
        id: challenge.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw Object.assign(new Error(GENERIC_VERIFICATION_ERROR), { status: 400, publicMessage: GENERIC_VERIFICATION_ERROR });
    }

    return transaction.user.update({
      where: { id: user.id, isVerified: false },
      data: { isVerified: true, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, isVerified: true, isActive: true },
    });
  });

  return {
    success: true,
    message: 'Your email address has been verified successfully.',
    user: result,
  };
};

export const registerEmailVerificationOnUser = async (user) => {
  return createEmailVerificationChallenge(user.id, user.email);
};

export const emailVerificationCodeExists = async (userId) => {
  const row = await prisma.emailVerificationCode.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(row);
};

export const clearVerificationCodeForUser = async (userId) => {
  await prisma.emailVerificationCode.deleteMany({ where: { userId } });
};
