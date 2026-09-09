import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// No encryption/tokenization mechanism exists elsewhere in the project for sensitive fields,
// so this derives a standard AES-256-GCM key from PAYOUT_ENCRYPTION_KEY rather than inventing a new scheme.
const getKey = () => {
  const secret = env.PAYOUT_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('PAYOUT_ENCRYPTION_KEY is not configured');
  }
  return crypto.createHash('sha256').update(secret).digest();
};

export const encryptPayoutIdentifier = (plainText) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
};

export const decryptPayoutIdentifier = (payload) => {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payout identifier');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
};
