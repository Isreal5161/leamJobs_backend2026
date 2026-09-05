import { prisma } from '../config/database.js';

const payoutAccountSelect = {
  id: true,
  provider: true,
  bankCode: true,
  accountName: true,
  accountNumberLast4: true,
  isDefault: true,
  verifiedAt: true,
};

const mapPayoutAccount = (account) => ({
  id: account.id,
  provider: account.provider,
  bankCode: account.bankCode,
  accountName: account.accountName,
  accountNumberLast4: account.accountNumberLast4,
  isDefault: account.isDefault,
  verifiedAt: account.verifiedAt,
});

export const getEligibleSeekerPayoutAccounts = async (seekerId) => {
  const accounts = await prisma.payoutAccount.findMany({
    where: {
      userId: seekerId,
      disabledAt: null,
      verifiedAt: { not: null },
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: payoutAccountSelect,
  });

  return accounts.map(mapPayoutAccount);
};
