import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const DEFAULT_FEE_PERCENTAGE = new Prisma.Decimal('5.00');
const DEFAULT_WITHDRAWAL_FEE_PERCENTAGE = new Prisma.Decimal('0.00');

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

export const getActiveWithdrawalFeeConfiguration = async (transaction) => {
  const configuration = await transaction.platformFeeConfiguration.findUnique({
    where: { key: 'default' },
    select: { withdrawalPercentage: true, isActive: true, updatedAt: true },
  });
  if (!configuration?.isActive) {
    throw new PlatformFeeConfigurationError('Active platform fee configuration is unavailable');
  }
  let percentage;
  try {
    percentage = new Prisma.Decimal(configuration.withdrawalPercentage);
  } catch {
    throw new PlatformFeeConfigurationError('Active withdrawal fee configuration is invalid');
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100)) {
    throw new PlatformFeeConfigurationError('Active withdrawal fee configuration is invalid');
  }
  if (!(configuration.updatedAt instanceof Date) || Number.isNaN(configuration.updatedAt.getTime())) {
    throw new PlatformFeeConfigurationError('Active withdrawal fee configuration version is invalid');
  }
  return { percentage, version: configuration.updatedAt.toISOString() };
};

export const getActiveWithdrawalFeePercentage = async (transaction) => (
  (await getActiveWithdrawalFeeConfiguration(transaction)).percentage
);

export const getPlatformFeeConfiguration = async () => {
  const configuration = await prisma.platformFeeConfiguration.findUnique({
    where: { key: 'default' },
    select: { key: true, percentage: true, withdrawalPercentage: true, isActive: true, updatedAt: true },
  });
  if (!configuration) throw new PlatformFeeConfigurationError('Platform fee configuration is unavailable');
  let percentage;
  let withdrawalPercentage;
  try {
    percentage = new Prisma.Decimal(configuration.percentage);
    withdrawalPercentage = new Prisma.Decimal(configuration.withdrawalPercentage);
  } catch {
    throw new PlatformFeeConfigurationError('Platform fee configuration is invalid');
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100)
    || !withdrawalPercentage.isFinite() || withdrawalPercentage.lt(0) || withdrawalPercentage.gt(100)) {
    throw new PlatformFeeConfigurationError('Platform fee configuration is invalid');
  }
  return {
    key: configuration.key,
    percentage: percentage.toFixed(2),
    withdrawalPercentage: withdrawalPercentage.toFixed(2),
    isActive: configuration.isActive,
    updatedAt: configuration.updatedAt,
  };
};

const validatedPercentage = (value, label) => {
  let percentage;
  try {
    percentage = new Prisma.Decimal(value);
  } catch {
    throw new PlatformFeeConfigurationError(`${label} must be between 0 and 100`);
  }
  if (!percentage.isFinite() || percentage.lt(0) || percentage.gt(100) || !percentage.toDecimalPlaces(2).eq(percentage)) {
    throw new PlatformFeeConfigurationError(`${label} must be between 0 and 100 with at most 2 decimal places`);
  }
  return percentage;
};

export const updatePlatformFeeConfiguration = async (values) => {
  const percentage = values.percentage === undefined ? undefined : validatedPercentage(values.percentage, 'Funding charge percentage');
  const withdrawalPercentage = values.withdrawalPercentage === undefined
    ? undefined
    : validatedPercentage(values.withdrawalPercentage, 'Withdrawal charge percentage');
  const update = {
    ...(percentage ? { percentage } : {}),
    ...(withdrawalPercentage ? { withdrawalPercentage } : {}),
    isActive: true,
  };
  const configuration = await prisma.platformFeeConfiguration.upsert({
    where: { key: 'default' },
    create: {
      key: 'default',
      percentage: percentage ?? DEFAULT_FEE_PERCENTAGE,
      withdrawalPercentage: withdrawalPercentage ?? DEFAULT_WITHDRAWAL_FEE_PERCENTAGE,
      isActive: true,
    },
    update,
    select: { key: true, percentage: true, withdrawalPercentage: true, isActive: true, updatedAt: true },
  });
  return {
    key: configuration.key,
    percentage: new Prisma.Decimal(configuration.percentage).toFixed(2),
    withdrawalPercentage: new Prisma.Decimal(configuration.withdrawalPercentage).toFixed(2),
    isActive: configuration.isActive,
    updatedAt: configuration.updatedAt,
  };
};

export const updatePlatformFeePercentage = async (percentageValue) => updatePlatformFeeConfiguration({ percentage: percentageValue });

export { DEFAULT_FEE_PERCENTAGE, DEFAULT_WITHDRAWAL_FEE_PERCENTAGE };
