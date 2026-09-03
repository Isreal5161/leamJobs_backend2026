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

  // Email
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@leamjobs.com',

  // Frontend URLs
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  FRONTEND_URL_PROD: process.env.FRONTEND_URL_PROD || '',
};

// Validate environment
if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test') {
  throw new Error(`Invalid NODE_ENV: ${env.NODE_ENV}`);
}
