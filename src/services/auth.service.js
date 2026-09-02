import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';

const BCRYPT_ROUNDS = 12;

export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'DuplicateEmailError';
    this.status = 409;
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
