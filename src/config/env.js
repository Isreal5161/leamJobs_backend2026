/**
 * Environment configuration
 * Validates and exports all environment variables
 */

const requiredEnvVars = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
];

// Check for missing required variables
const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missing.length > 0) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  console.warn(`⚠ Missing environment variables: ${missing.join(', ')}`);
}

export const env = {
  // Application
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  HOST: process.env.HOST || 'localhost',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRE: process.env.JWT_EXPIRE || '24h',
  JWT_ISSUER: process.env.JWT_ISSUER || 'leamjobs-development',
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || 'leamjobs-api',

  // Payout accounts (seeker payout details are encrypted at rest with this key; required before
  // payout account create/update will succeed - not added to requiredEnvVars to avoid blocking
  // startup for unrelated deployments until this feature is rolled out)
  PAYOUT_ENCRYPTION_KEY: process.env.PAYOUT_ENCRYPTION_KEY || '',

  // Email
  EMAIL_ENABLED: process.env.EMAIL_ENABLED === 'true',
  EMAIL_HOST: process.env.EMAIL_HOST || process.env.SMTP_HOST || '',
  EMAIL_PORT: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '465', 10),
  EMAIL_SECURE: process.env.EMAIL_SECURE !== 'false',
  EMAIL_USER: process.env.EMAIL_USER || process.env.SMTP_USER || '',
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD || process.env.SMTP_PASSWORD || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@leamjobs.com',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'LeamJobs',
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || '',

  // Frontend URLs
  FRONTEND_URL: process.env.FRONTEND_URL || '',
  FRONTEND_URL_PROD: process.env.FRONTEND_URL_PROD || '',
  PASSWORD_RESET_EXPIRE_MINUTES: parseInt(process.env.PASSWORD_RESET_EXPIRE_MINUTES || '30', 10),

  // Flutterwave contract funding (kept server-side; never expose these to clients)
  FLUTTERWAVE_SECRET_KEY: process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '',
  FLUTTERWAVE_SECRET_HASH: process.env.FLW_SECRET_HASH || process.env.FLUTTERWAVE_SECRET_HASH || '',
  FLUTTERWAVE_BASE_URL: process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3',
  FLUTTERWAVE_REDIRECT_URL: process.env.FLUTTERWAVE_REDIRECT_URL || '',

  // Paystack transfers (kept server-side; never expose this value to clients)
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PAYSTACK_BASE_URL: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
};

// Validate environment
if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test') {
  throw new Error(`Invalid NODE_ENV: ${env.NODE_ENV}`);
}
