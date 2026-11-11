import crypto from 'node:crypto';

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export const hashJobUpdatesToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const legacyJobUpdatesTokenHash = (email) => hashJobUpdatesToken(`job-updates:${normalizeEmail(email)}`);
