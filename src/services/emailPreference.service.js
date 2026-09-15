import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { createMarketingUnsubscribeToken, verifyUnsubscribeToken } from './email.service.js';

export class InvalidUnsubscribeTokenError extends Error {
  constructor() {
    super('This unsubscribe link is invalid or has expired');
    this.name = 'InvalidUnsubscribeTokenError';
    this.status = 400;
  }
}

const tokenForUser = (userId) => createMarketingUnsubscribeToken(userId);

const userFromToken = (token) => {
  const [encodedUserId, signature] = String(token ?? '').split('.');
  const userId = encodedUserId ? Buffer.from(encodedUserId, 'base64url').toString('utf8') : '';
  if (!userId || !signature || !verifyUnsubscribeToken(userId, signature)) throw new InvalidUnsubscribeTokenError();
  return userId;
};

export const getEmailPreferences = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { marketingEmailsEnabled: true } });
  if (!user) throw new InvalidUnsubscribeTokenError();
  return { marketingEmailsEnabled: user.marketingEmailsEnabled, transactionalEmailsEnabled: true };
};

export const updateEmailPreferences = async (userId, marketingEmailsEnabled) => {
  const user = await prisma.user.update({ where: { id: userId }, data: { marketingEmailsEnabled }, select: { marketingEmailsEnabled: true } });
  return { marketingEmailsEnabled: user.marketingEmailsEnabled, transactionalEmailsEnabled: true };
};

export const unsubscribeMarketingEmail = async (token) => {
  const userId = userFromToken(token);
  await prisma.user.update({ where: { id: userId }, data: { marketingEmailsEnabled: false } });
  return { message: 'Marketing emails have been turned off.' };
};

export const getMarketingUnsubscribeToken = (userId) => tokenForUser(userId);
