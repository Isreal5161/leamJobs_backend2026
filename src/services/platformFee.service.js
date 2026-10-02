import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

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

  let percentage;
  try {
    percentage = new Prisma.Decimal(configuration.percentage);
  } catch {
    throw new PlatformFeeConfigurationError('Active platform fee configuration is invalid');
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100)) {
    throw new PlatformFeeConfigurationError('Active platform fee configuration is invalid');
  }

  return percentage;
};

export const getPlatformFeeConfiguration = async () => {
  const configuration = await prisma.platformFeeConfiguration.findUnique({
    where: { key: 'default' },
    select: { key: true, percentage: true, isActive: true, updatedAt: true },
  });
  if (!configuration) throw new PlatformFeeConfigurationError('Platform fee configuration is unavailable');
  let percentage;
  try {
    percentage = new Prisma.Decimal(configuration.percentage);
  } catch {
    throw new PlatformFeeConfigurationError('Platform fee configuration is invalid');
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100)) {
    throw new PlatformFeeConfigurationError('Platform fee configuration is invalid');
  }
  return {
    key: configuration.key,
    percentage: percentage.toFixed(2),
    isActive: configuration.isActive,
    updatedAt: configuration.updatedAt,
  };
};

export const updatePlatformFeePercentage = async (percentageValue) => {
  let percentage;
  try {
    percentage = new Prisma.Decimal(percentageValue);
  } catch {
    throw new PlatformFeeConfigurationError('Platform fee percentage must be between 0 and 100');
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100) || !percentage.toDecimalPlaces(2).eq(percentage)) {
    throw new PlatformFeeConfigurationError('Platform fee percentage must be between 0 and 100');
  }
  const configuration = await prisma.platformFeeConfiguration.upsert({
    where: { key: 'default' },
    create: { key: 'default', percentage, isActive: true },
    update: { percentage, isActive: true },
    select: { key: true, percentage: true, isActive: true, updatedAt: true },
  });
  return {
    key: configuration.key,
    percentage: new Prisma.Decimal(configuration.percentage).toFixed(2),
    isActive: configuration.isActive,
    updatedAt: configuration.updatedAt,
  };
};

export { DEFAULT_FEE_PERCENTAGE };
