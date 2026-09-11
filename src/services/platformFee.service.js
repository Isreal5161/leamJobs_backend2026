import { Prisma } from '@prisma/client';

const DEFAULT_FEE_PERCENTAGE = new Prisma.Decimal('5.00');

export class PlatformFeeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlatformFeeConfigurationError';
    this.status = 500;
  }
}

export const getActivePlatformFeePercentage = async (transaction) => {
  const configuration = await transaction.platformFeeConfiguration.findUnique({
    where: { key: 'default' },
    select: { percentage: true, isActive: true },
  });

  if (!configuration?.isActive) {
    throw new PlatformFeeConfigurationError('Active platform fee configuration is unavailable');
  }

  const percentage = new Prisma.Decimal(configuration.percentage);
  if (percentage.lt(0) || percentage.gt(100)) {
    throw new PlatformFeeConfigurationError('Active platform fee configuration is invalid');
  }

  return percentage;
};

export { DEFAULT_FEE_PERCENTAGE };
