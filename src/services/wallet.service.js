export const initializeSeekerWallet = async (database, seekerId) => database.wallet.upsert({
  where: { userId: seekerId },
  create: { userId: seekerId },
  update: {},
});
