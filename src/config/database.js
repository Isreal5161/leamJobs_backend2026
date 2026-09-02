import { PrismaClient } from '@prisma/client';

/**
 * Singleton PrismaClient instance
 * Ensures only one client instance is created across the application
 */
let prismaInstance = null;

/**
 * Get or create the PrismaClient instance
 * @returns {PrismaClient} The Prisma client instance
 */
export const getPrismaClient = () => {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
};

/**
 * Connect to the database
 * Called during server startup
 * @throws {Error} If database connection fails
 */
export const connectDatabase = async () => {
  try {
    const prisma = getPrismaClient();
    await prisma.$connect();
    console.log('✓ Database connected successfully');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    process.exit(1);
  }
};

/**
 * Check database health
 * Executes a lightweight query to verify database connectivity
 * @returns {Promise<{success: boolean, database: string, error?: string}>}
 */
export const checkDatabaseHealth = async () => {
  try {
    const prisma = getPrismaClient();
    
    // Execute a lightweight query to verify connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    return {
      success: true,
      database: 'connected',
    };
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return {
      success: false,
      database: 'disconnected',
      error: 'Unable to connect to database',
    };
  }
};

/**
 * Disconnect from the database
 * Called during graceful shutdown
 */
export const disconnectDatabase = async () => {
  if (prismaInstance) {
    try {
      await prismaInstance.$disconnect();
      console.log('✓ Database disconnected');
    } catch (error) {
      console.error('Error disconnecting from database:', error.message);
    }
  }
};

// Export the singleton instance for direct use
export const prisma = getPrismaClient();

