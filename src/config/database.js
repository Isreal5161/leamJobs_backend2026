import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Ensure Prisma connects
export const connectDatabase = async () => {
  try {
    await prisma.$connect();
    console.log('✓ Database connected');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    process.exit(1);
  }
};

export { prisma };
