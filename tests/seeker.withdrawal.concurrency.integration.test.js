import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.WITHDRAWAL_TEST_DATABASE_URL
  || process.env.PHASE4_TEST_DATABASE_URL
  || process.env.TEST_DATABASE_URL;

process.env.NODE_ENV = 'test';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_SECRET ||= 'withdrawal-concurrency-test-secret';
process.env.JWT_ISSUER ||= 'withdrawal-concurrency-test-issuer';
process.env.JWT_AUDIENCE ||= 'withdrawal-concurrency-test-audience';

const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('seeker withdrawal PostgreSQL concurrency', () => {
  const database = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  const ids = {
    seeker: randomUUID(),
    wallet: randomUUID(),
    payoutAccount: randomUUID(),
  };
  let originalFeeConfiguration;
  let createSeekerWithdrawal;
  let getSeekerWithdrawalQuote;

  beforeAll(async () => {
    const service = await import('../src/services/seekerWithdrawal.service.js');
    createSeekerWithdrawal = service.createSeekerWithdrawal;
    getSeekerWithdrawalQuote = service.getSeekerWithdrawalQuote;
    await database.$connect();
    originalFeeConfiguration = await database.platformFeeConfiguration.findUnique({ where: { key: 'default' } });
    await database.platformFeeConfiguration.upsert({
      where: { key: 'default' },
      create: { key: 'default', percentage: '5.00', withdrawalPercentage: '5.00', isActive: true },
      update: { withdrawalPercentage: '5.00', isActive: true },
    });
    await database.user.create({
      data: {
        id: ids.seeker,
        email: `withdrawal-concurrency-${ids.seeker}@example.test`,
        passwordHash: 'test-password-hash',
        firstName: 'Withdrawal',
        lastName: 'Concurrency',
        role: 'SEEKER',
      },
    });
    await database.wallet.create({
      data: { id: ids.wallet, userId: ids.seeker, currency: 'NGN', availableBalance: '100000.00' },
    });
    await database.payoutAccount.create({
      data: {
        id: ids.payoutAccount,
        userId: ids.seeker,
        provider: 'FLUTTERWAVE',
        payoutMethod: 'BANK_ACCOUNT',
        country: 'Nigeria',
        currency: 'NGN',
        bankCode: '058',
        encryptedAccountNumber: 'integration-test-only',
        accountNumberLast4: '0000',
        accountName: 'Withdrawal Concurrency',
        verifiedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (originalFeeConfiguration) {
      await database.platformFeeConfiguration.update({
        where: { key: 'default' },
        data: {
          percentage: originalFeeConfiguration.percentage,
          withdrawalPercentage: originalFeeConfiguration.withdrawalPercentage,
          isActive: originalFeeConfiguration.isActive,
        },
      });
    } else {
      await database.platformFeeConfiguration.deleteMany({ where: { key: 'default' } });
    }
    await database.financialLedgerEntry.deleteMany({ where: { walletId: ids.wallet } });
    await database.withdrawal.deleteMany({ where: { walletId: ids.wallet } });
    await database.payoutAccount.deleteMany({ where: { id: ids.payoutAccount } });
    await database.wallet.deleteMany({ where: { id: ids.wallet } });
    await database.user.deleteMany({ where: { id: ids.seeker } });
    await database.$disconnect();
  });

  test('simultaneous gross withdrawals cannot overspend and identical retry is idempotent', async () => {
    const [firstQuote, secondQuote] = await Promise.all([
      getSeekerWithdrawalQuote(ids.seeker, { amount: '80000.00', currency: 'NGN', payoutAccountId: ids.payoutAccount }),
      getSeekerWithdrawalQuote(ids.seeker, { amount: '80000.00', currency: 'NGN', payoutAccountId: ids.payoutAccount }),
    ]);
    const requests = [
      { quoteReference: firstQuote.quoteReference, idempotencyKey: `concurrent-${randomUUID()}` },
      { quoteReference: secondQuote.quoteReference, idempotencyKey: `concurrent-${randomUUID()}` },
    ];

    const results = await Promise.allSettled(requests.map(({ quoteReference, idempotencyKey }) => (
      createSeekerWithdrawal(ids.seeker, { quoteReference, idempotencyKey })
    )));
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/Insufficient available balance/);

    const successfulIndex = results.findIndex((result) => result.status === 'fulfilled');
    const successfulRequest = requests[successfulIndex];
    const repeated = await createSeekerWithdrawal(ids.seeker, successfulRequest);
    expect(repeated.id).toBe(succeeded[0].value.id);

    const [wallet, withdrawals, reservations] = await Promise.all([
      database.wallet.findUnique({ where: { id: ids.wallet } }),
      database.withdrawal.findMany({ where: { walletId: ids.wallet } }),
      database.financialLedgerEntry.findMany({ where: { walletId: ids.wallet, entryType: 'WITHDRAWAL_RESERVED' } }),
    ]);

    expect(wallet.availableBalance.toFixed(2)).toBe('20000.00');
    expect(wallet.pendingWithdrawalBalance.toFixed(2)).toBe('80000.00');
    expect(wallet.availableBalance.gte(0)).toBe(true);
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0].amount.toFixed(2)).toBe('80000.00');
    expect(withdrawals[0].withdrawalFeePercentage.toFixed(2)).toBe('5.00');
    expect(withdrawals[0].withdrawalFeeAmount.toFixed(2)).toBe('4000.00');
    expect(withdrawals[0].payoutAmount.toFixed(2)).toBe('76000.00');
    expect(reservations).toHaveLength(1);
  });
});

if (!testDatabaseUrl) {
  test('requires WITHDRAWAL_TEST_DATABASE_URL, PHASE4_TEST_DATABASE_URL, or TEST_DATABASE_URL for PostgreSQL withdrawal concurrency coverage', () => {
    expect(testDatabaseUrl).toBeFalsy();
  });
}
