import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

const BCRYPT_ROUNDS = 12;

export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'DuplicateEmailError';
    this.status = 409;
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'AuthenticationError';
    this.status = 401;
  }
}

export class InactiveAccountError extends Error {
  constructor() {
    super('Your account is inactive');
    this.name = 'InactiveAccountError';
    this.status = 403;
  }
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthenticationRequiredError';
    this.status = 401;
  }
}

export const registerUser = async ({ firstName, lastName, email, password, phone, role }) => {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await prisma.user.create({
      data: {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        email: normalizedEmail,
        passwordHash,
        phone,
        role,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002' && error.meta?.target?.includes('email')) {
      throw new DuplicateEmailError();
    }

    throw error;
  }
};

export const loginUser = async ({ email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new AuthenticationError();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new AuthenticationError();
  }

  if (!user.isActive) {
    throw new InactiveAccountError();
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const token = jwt.sign(
    { sub: updatedUser.id, role: updatedUser.role },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_EXPIRE,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );

  return { token, user: updatedUser };
};

export const getCurrentUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      isVerified: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  if (!user.isActive) {
    throw new InactiveAccountError();
  }

  return user;
};
