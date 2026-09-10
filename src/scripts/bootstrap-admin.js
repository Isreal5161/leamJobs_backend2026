import bcrypt from 'bcrypt';
import { z } from 'zod';
import { disconnectDatabase, prisma } from '../config/database.js';

const BCRYPT_ROUNDS = 12;
const emailSchema = z.string().trim().email('ADMIN_EMAIL must be a valid email address.');
const passwordSchema = z
  .string()
  .min(8, 'ADMIN_PASSWORD must be at least 8 characters long.')
  .regex(/[a-z]/, 'ADMIN_PASSWORD must contain at least one lowercase letter.')
  .regex(/[A-Z]/, 'ADMIN_PASSWORD must contain at least one uppercase letter.')
  .regex(/[0-9]/, 'ADMIN_PASSWORD must contain at least one number.')
  .regex(/[^A-Za-z0-9]/, 'ADMIN_PASSWORD must contain at least one special character.');

const normalizeEnvironmentValue = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toSafeError = (message) => {
  const error = new Error(message);
  error.name = 'BootstrapAdminError';
  return error;
};

export const parseBootstrapConfig = (env = process.env) => {
  const email = normalizeEnvironmentValue(env.ADMIN_EMAIL);
  const password = normalizeEnvironmentValue(env.ADMIN_PASSWORD);
  const resetPassword = normalizeEnvironmentValue(env.ADMIN_RESET_PASSWORD).toLowerCase() === 'true';
  const firstName = normalizeEnvironmentValue(env.ADMIN_FIRST_NAME) || 'Admin';
  const lastName = normalizeEnvironmentValue(env.ADMIN_LAST_NAME) || 'User';

  const missing = [];

  if (!email) {
    missing.push('ADMIN_EMAIL');
  }

  if (!password) {
    missing.push('ADMIN_PASSWORD');
  }

  if (missing.length > 0) {
    throw toSafeError(`Missing required environment variable(s): ${missing.join(', ')}.`);
  }

  const emailResult = emailSchema.safeParse(email);
  if (!emailResult.success) {
    throw toSafeError(emailResult.error.issues[0]?.message ?? 'ADMIN_EMAIL must be a valid email address.');
  }

  const passwordResult = passwordSchema.safeParse(password);
  if (!passwordResult.success) {
    throw toSafeError(passwordResult.error.issues[0]?.message ?? 'ADMIN_PASSWORD does not meet the required password policy.');
  }

  return {
    email,
    password,
    firstName,
    lastName,
    resetPassword,
  };
};

export const bootstrapAdmin = async (env = process.env) => {
  const config = parseBootstrapConfig(env);

  const existingUser = await prisma.user.findUnique({
    where: { email: config.email },
  });

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(config.password, BCRYPT_ROUNDS);

    const createdUser = await prisma.user.create({
      data: {
        email: config.email,
        passwordHash,
        firstName: config.firstName,
        lastName: config.lastName,
        role: 'ADMIN',
        isActive: true,
        isVerified: true,
      },
    });

    return {
      action: 'created',
      email: createdUser.email,
      role: createdUser.role,
      passwordHashStored: true,
    };
  }

  if (existingUser.role === 'ADMIN') {
    if (!config.resetPassword) {
      return {
        action: 'existing-admin',
        email: existingUser.email,
        role: existingUser.role,
        passwordHashStored: false,
      };
    }

    const passwordHash = await bcrypt.hash(config.password, BCRYPT_ROUNDS);

    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash,
      },
    });

    return {
      action: 'updated-admin-password',
      email: updatedUser.email,
      role: updatedUser.role,
      passwordHashStored: true,
    };
  }

  if (existingUser.role === 'SEEKER') {
    throw toSafeError('Refusing to change existing SEEKER account to ADMIN.');
  }

  if (existingUser.role === 'EMPLOYER') {
    throw toSafeError('Refusing to change existing EMPLOYER account to ADMIN.');
  }

  throw toSafeError(`Refusing to change existing ${existingUser.role} account to ADMIN.`);
};

const isDirectScriptExecution = () => {
  const argv = process.argv[1] ? process.argv[1].toLowerCase() : '';
  return argv.endsWith('bootstrap-admin.js');
};

const main = async () => {
  try {
    const result = await bootstrapAdmin();

    if (result.action === 'created') {
      console.log(`Created ADMIN account for ${result.email}.`);
      return;
    }

    if (result.action === 'updated-admin-password') {
      console.log(`Updated password hash for existing ADMIN account ${result.email}.`);
      return;
    }

    console.log(`Existing ADMIN account found for ${result.email}; no password change applied. Set ADMIN_RESET_PASSWORD=true to update the password hash.`);
  } catch (error) {
    console.error(`Admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
};

if (isDirectScriptExecution()) {
  void main();
}
