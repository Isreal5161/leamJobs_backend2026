import { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.PHASE4_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test.skip('Set PHASE4_TEST_DATABASE_URL to run the PostgreSQL concurrency integration test', () => {});
} else {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = 'test';

  const { releaseContractFunds } = await import('../src/services/adminRelease.service.js');
  const database = new PrismaClient({ datasourceUrl: testDatabaseUrl });

  const ids = {
    employer: 'e1000000-0000-4000-8000-000000000001',
    seeker: 'e1000000-0000-4000-8000-000000000002',
    job: 'e1000000-0000-4000-8000-000000000003',
    application: 'e1000000-0000-4000-8000-000000000004',
    contract: 'e1000000-0000-4000-8000-000000000005',
    freelance: 'e1000000-0000-4000-8000-000000000006',
    escrow: 'e1000000-0000-4000-8000-000000000007',
    wallet: 'e1000000-0000-4000-8000-000000000008',
  };

  beforeAll(async () => {
    await database.financialLedgerEntry.deleteMany({ where: { escrowId: ids.escrow } });
    await database.escrow.deleteMany({ where: { id: ids.escrow } });
    await database.freelanceContract.deleteMany({ where: { id: ids.freelance } });
    await database.contract.deleteMany({ where: { id: ids.contract } });
    await database.application.deleteMany({ where: { id: ids.application } });
    await database.wallet.deleteMany({ where: { id: ids.wallet } });
    await database.job.deleteMany({ where: { id: ids.job } });
    await database.user.deleteMany({ where: { id: { in: [ids.employer, ids.seeker] } } });

    await database.user.createMany({
      data: [
        { id: ids.employer, email: 'phase4-integration-employer@example.test', passwordHash: 'not-used', firstName: 'Phase4', lastName: 'Employer', role: 'EMPLOYER' },
        { id: ids.seeker, email: 'phase4-integration-seeker@example.test', passwordHash: 'not-used', firstName: 'Phase4', lastName: 'Seeker', role: 'SEEKER' },
      ],
    });
    await database.job.create({
      data: {
        id: ids.job, employerId: ids.employer, title: 'Phase 4 integration job', description: 'Integration fixture', location: 'Remote',
        jobType: 'FREELANCE_PROJECT', engagementType: 'FREELANCE', status: 'APPROVED',
      },
    });
    await database.application.create({
      data: { id: ids.application, seekerId: ids.seeker, jobId: ids.job, status: 'ACCEPTED' },
    });
    await database.contract.create({
      data: {
        id: ids.contract, applicationId: ids.application, jobId: ids.job, employerId: ids.employer, seekerId: ids.seeker,
        type: 'FREELANCE_PROJECT', status: 'ACTIVE',
        freelanceDetails: {
          create: {
            id: ids.freelance, agreedAmount: '100000.00', currency: 'NGN', platformFeePercentage: '5.00',
            platformFeeAmount: '5000.00', seekerNetAmount: '95000.00', workStatus: 'RELEASE_ELIGIBLE',
            completionSubmittedAt: new Date(), employerCompletionConfirmedAt: new Date(),
          },
        },
      },
    });
    await database.escrow.create({
      data: {
        id: ids.escrow, freelanceContractId: ids.contract, grossAmount: '100000.00', platformFeeAmount: '5000.00',
        seekerNetAmount: '95000.00', currency: 'NGN', fundedAmount: '100000.00', status: 'RELEASE_ELIGIBLE',
        releaseEligibleAt: new Date(),
      },
    });
    await database.wallet.create({ data: { id: ids.wallet, userId: ids.seeker, currency: 'NGN', availableBalance: '1000.00' } });
  });

  afterAll(async () => {
    await database.financialLedgerEntry.deleteMany({ where: { escrowId: ids.escrow } });
    await database.escrow.deleteMany({ where: { id: ids.escrow } });
    await database.freelanceContract.deleteMany({ where: { id: ids.freelance } });
    await database.contract.deleteMany({ where: { id: ids.contract } });
    await database.application.deleteMany({ where: { id: ids.application } });
    await database.wallet.deleteMany({ where: { id: ids.wallet } });
    await database.job.deleteMany({ where: { id: ids.job } });
    await database.user.deleteMany({ where: { id: { in: [ids.employer, ids.seeker] } } });
    await database.$disconnect();
  });

  test('two simultaneous admin releases produce one wallet credit and one release', async () => {
    const results = await Promise.all([
      releaseContractFunds(ids.contract),
      releaseContractFunds(ids.contract),
    ]);

    expect(results.filter((result) => !result.alreadyReleased)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyReleased)).toHaveLength(1);

    const [wallet, escrow, ledgerEntries] = await Promise.all([
      database.wallet.findUnique({ where: { id: ids.wallet } }),
      database.escrow.findUnique({ where: { id: ids.escrow } }),
      database.financialLedgerEntry.findMany({ where: { escrowId: ids.escrow, entryType: 'WALLET_CREDIT' } }),
    ]);

    expect(wallet.availableBalance.toFixed(2)).toBe('96000.00');
    expect(escrow.status).toBe('RELEASED');
    expect(escrow.releasedAmount.toFixed(2)).toBe('95000.00');
    expect(ledgerEntries).toHaveLength(1);
  });
}
