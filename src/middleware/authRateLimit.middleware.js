import crypto from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MESSAGE = 'Too many authentication attempts. Please try again later.';

// Count successes and failures; pair identity buckets with IP buckets to deter account targeting
// without allowing one source IP to lock an account for every other user.
const getIdentity = (req) => {
  const email = req.body?.email ?? req.query?.email;
  if (typeof email === 'string' && email.trim()) {
    return email.trim().toLowerCase();
  }

  const token = req.body?.token;
  if (typeof token === 'string' && token) {
    return token;
  }

  const pendingId = req.body?.pendingId;
  if (typeof pendingId === 'string' && pendingId.trim()) {
    return pendingId.trim();
  }

  return '';
};

const createLimiter = ({ max, keyGenerator }) => rateLimit({
  windowMs: WINDOW_MS,
  max,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfter = resetTime instanceof Date
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(WINDOW_MS / 1000);

    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: {
        code: 'AUTH_RATE_LIMITED',
        message: RATE_LIMIT_MESSAGE,
      },
    });
  },
});

const ipLimiter = (max) => createLimiter({ max });

const accountAndIpLimiter = (max) => createLimiter({
  max,
  keyGenerator: (req) => {
    const identity = getIdentity(req);
    const identityHash = identity
      ? crypto.createHash('sha256').update(identity).digest('hex')
      : 'missing-identity';
    return `${ipKeyGenerator(req.ip)}:${identityHash}`;
  },
});

const pair = (ipMax, accountAndIpMax) => [
  ipLimiter(ipMax),
  accountAndIpLimiter(accountAndIpMax),
];

export const authBodyIpLimiter = ipLimiter(100);

export const authRateLimiters = {
  register: pair(20, 5),
  login: pair(30, 8),
  forgotPassword: pair(20, 3),
  resetPassword: pair(30, 6),
  verifyEmail: pair(30, 8),
  resendEmailVerification: pair(20, 3),
  adminInvitationAccept: pair(30, 8),
  googleStart: ipLimiter(30),
  googleCallback: ipLimiter(30),
  googleComplete: pair(20, 5),
};
