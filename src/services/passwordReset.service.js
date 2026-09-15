import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';

const BCRYPT_ROUNDS = 12;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const genericResponse = { message: 'If an account exists for that email, a password reset link has been sent.' };

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super('This password reset link is invalid or has expired');
    this.name = 'InvalidPasswordResetTokenError';
    this.status = 400;
  }
}

export const requestPasswordReset = async (email) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, email: true, firstName: true, isActive: true } });
  if (!user || !user.isActive) return genericResponse;

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + Math.max(5, env.PASSWORD_RESET_EXPIRE_MINUTES) * 60 * 1000);
  const token = await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
    select: { id: true },
  });
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
  void queueEmail({
    recipientUserId: user.id,
    emailType: EMAIL_TYPES.PASSWORD_RESET,
    eventKey: `password-reset:${token.id}`,
    recipientEmail: user.email,
    context: {
      title: 'Reset your LeamJobs password',
      message: `Hi ${user.firstName}, use this secure link to choose a new password. It expires in ${Math.max(5, env.PASSWORD_RESET_EXPIRE_MINUTES)} minutes.`,
      link: resetUrl,
      linkLabel: 'Reset password',
    },
  }).catch((error) => console.error('Password reset email queue failed:', { message: error.message }));
  return genericResponse;
};

export const resetPassword = async ({ token: rawToken, password }) => {
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const token = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!token) throw new InvalidPasswordResetTokenError();

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvalidPasswordResetTokenError();
    const user = await transaction.user.update({ where: { id: token.userId }, data: { passwordHash }, select: { id: true, email: true, firstName: true } });
    return user;
  });

  void queueEmail({
    recipientUserId: result.id,
    emailType: EMAIL_TYPES.PASSWORD_CHANGED,
    eventKey: `password-changed:${token.id}`,
    recipientEmail: result.email,
    context: { title: 'Your LeamJobs password was changed', message: `Hi ${result.firstName}, your password was successfully changed. If you did not make this change, contact LeamJobs support immediately.` },
  }).catch((error) => console.error('Password changed email queue failed:', { message: error.message }));

  return { message: 'Your password has been reset successfully.' };
};
