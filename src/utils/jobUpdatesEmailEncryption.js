import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
export const ENCRYPTED_JOB_UPDATES_EMAIL_PREFIX = 'leamjobs:job-updates-email:v1:';

const getKey = () => {
  const secret = env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JOB_UPDATES_EMAIL_ENCRYPTION_KEY must be configured with at least 32 bytes');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
};

export const encryptJobUpdatesEmailContent = (content) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()]);
  return `${ENCRYPTED_JOB_UPDATES_EMAIL_PREFIX}${[
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':')}`;
};

export const decryptJobUpdatesEmailContent = (payload) => {
  if (!String(payload).startsWith(ENCRYPTED_JOB_UPDATES_EMAIL_PREFIX)) {
    throw new Error('Invalid encrypted job updates email content');
  }

  const [ivB64, tagB64, dataB64, ...extra] = String(payload)
    .slice(ENCRYPTED_JOB_UPDATES_EMAIL_PREFIX.length)
    .split(':');
  if (!ivB64 || !tagB64 || !dataB64 || extra.length > 0) {
    throw new Error('Invalid encrypted job updates email content');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const content = JSON.parse(plaintext);
    if (typeof content?.html !== 'string' || typeof content?.text !== 'string') {
      throw new Error('Invalid email content');
    }
    return content;
  } catch {
    throw new Error('Unable to decrypt job updates email content');
  }
};
