import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.DISPUTE_RELEASE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test.skip('Set DISPUTE_RELEASE_TEST_DATABASE_URL to a dedicated local, migrated PostgreSQL test database', () => {});
} else {
  const parsedUrl = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const disposableDatabaseName = /(?:test|testing|integration|disposable)/i.test(databaseName);

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)
    || !localHosts.has(parsedUrl.hostname)
    || !disposableDatabaseName) {
    throw new Error(
      'DISPUTE_RELEASE_TEST_DATABASE_URL must use localhost and a database name containing test, integration, or disposable.',
    );
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;

  const database = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  const fixtureIds = new Set();
  let serviceDatabase;
  let submitContractDispute;
  let releaseContractFunds;

  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const fixture = () => {
    const suffix = randomUUID();
    return {
      employer: randomUUID(),
      seeker: randomUUID(),
      job: randomUUID(),
      application: randomUUID(),
      contract: randomUUID(),
      freelance: randomUUID(),
      escrow: randomUUID(),
      wallet: randomUUID(),
      emailSuffix: suffix,
    };
  };

  const createFixture = async () => {
    const ids = fixture();
    fixtureIds.add(ids);
    await database.$transaction(async (transaction) => {
      await transaction.user.createMany({
        data: [
          {
            id: ids.employer,
            email: `dispute-release-employer-${ids.emailSuffix}@example.test`,
            passwordHash: 'integration-test-only',
            firstName: 'Concurrency',
            lastName: 'Employer',
            role: 'EMPLOYER',
          },
          {
            id: ids.seeker,
            email: `dispute-release-seeker-${ids.emailSuffix}@example.test`,
            passwordHash: 'integration-test-only',
            firstName: 'Concurrency',
            lastName: 'Seeker',
            role: 'SEEKER',
          },
        ],
      });
      await transaction.job.create({
        data: {
          id: ids.job,
          employerId: ids.employer,
          title: 'Dispute/release concurrency fixture',
          description: 'Disposable integration-test record.',
          location: 'Remote',
          jobType: 'FREELANCE_PROJECT',
          engagementType: 'FREELANCE',
          status: 'APPROVED',
        },
      });
      await transaction.application.create({
        data: {
          id: ids.application,
          seekerId: ids.seeker,
          jobId: ids.job,
          status: 'ACCEPTED',
        },
      });
      await transaction.contract.create({
        data: {
          id: ids.contract,
          applicationId: ids.application,
          jobId: ids.job,
          employerId: ids.employer,
          seekerId: ids.seeker,
          type: 'FREELANCE_PROJECT',
          status: 'ACTIVE',
          freelanceDetails: {
            create: {
              id: ids.freelance,
              agreedAmount: '100000.00',
              currency: 'NGN',
              platformFeePercentage: '5.00',
              platformFeeAmount: '5000.00',
              seekerNetAmount: '95000.00',
              workStatus: 'RELEASE_ELIGIBLE',
              completionSubmittedAt: new Date(),
              employerCompletionConfirmedAt: new Date(),
            },
          },
        },
      });
      await transaction.escrow.create({
        data: {
          id: ids.escrow,
          freelanceContractId: ids.contract,
          grossAmount: '100000.00',
          platformFeeAmount: '5000.00',
          seekerNetAmount: '95000.00',
          currency: 'NGN',
          fundedAmount: '100000.00',
          status: 'RELEASE_ELIGIBLE',
          releaseEligibleAt: new Date(),
        },
      });
      await transaction.wallet.create({
        data: {
          id: ids.wallet,
          userId: ids.seeker,
          currency: 'NGN',
          availableBalance: '1000.00',
        },
      });
    });
    return ids;
  };

  const cleanupFixture = async (ids) => {
    await database.$transaction(async (transaction) => {
      await transaction.dispute.deleteMany({ where: { contractId: ids.contract } });
      await transaction.financialLedgerEntry.deleteMany({ where: { escrowId: ids.escrow } });
      await transaction.escrow.deleteMany({ where: { id: ids.escrow } });
      await transaction.freelanceContract.deleteMany({ where: { id: ids.freelance } });
      await transaction.contract.deleteMany({ where: { id: ids.contract } });
      await transaction.application.deleteMany({ where: { id: ids.application } });
      await transaction.wallet.deleteMany({ where: { id: ids.wallet } });
      await transaction.job.deleteMany({ where: { id: ids.job } });
      await transaction.user.deleteMany({ where: { id: { in: [ids.employer, ids.seeker] } } });
    });
  };

  const waitForEscrowLockWaiters = async (expectedCount) => {
    const deadline = Date.now() + 10000;
    let waiters = [];
    while (Date.now() < deadline) {
      waiters = await database.$queryRaw`
        SELECT "pid", "wait_event_type", "query"
        FROM "pg_stat_activity"
        WHERE "datname" = current_database()
          AND "pid" <> pg_backend_pid()
          AND "state" = 'active'
          AND "wait_event_type" = 'Lock'
          AND "query" ILIKE ${'%FROM "Escrow"%'}
      `;
      if (waiters.length >= expectedCount) return waiters;
      await pause(25);
    }
    throw new Error(`Timed out waiting for ${expectedCount} concurrent escrow-lock waiter(s); observed ${waiters.length}.`);
  };

  const runOrderedRace = async (ids, firstOperation) => {
    const acquiredEscrowLock = deferred();
    const releaseEscrowLock = deferred();
    let gatePid;
    let firstPromise;
    let secondPromise;
    const gateTransaction = database.$transaction(async (transaction) => {
      const [{ pid }] = await transaction.$queryRaw`SELECT pg_backend_pid() AS "pid"`;
      gatePid = String(pid);
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Escrow"
        WHERE "freelanceContractId" = ${ids.contract}
        FOR UPDATE
      `;
      acquiredEscrowLock.resolve();
      await releaseEscrowLock.promise;
    }, { maxWait: 5000, timeout: 20000 });

    try {
      await acquiredEscrowLock.promise;
      const operations = {
        dispute: () => submitContractDispute({
          contractId: ids.contract,
          userId: ids.employer,
          role: 'EMPLOYER',
          reason: 'Integration test dispute for concurrency verification.',
        }),
        release: () => releaseContractFunds(ids.contract),
      };
      const secondOperation = firstOperation === 'dispute' ? 'release' : 'dispute';

      firstPromise = operations[firstOperation]();
      const firstWaiters = await waitForEscrowLockWaiters(1);
      expect(new Set(firstWaiters.map(({ pid }) => String(pid))).size).toBe(1);

      secondPromise = operations[secondOperation]();
      const concurrentWaiters = await waitForEscrowLockWaiters(2);
      const waiterPids = new Set(concurrentWaiters.map(({ pid }) => String(pid)));
      expect(waiterPids.size).toBe(2);
      expect(waiterPids.has(gatePid)).toBe(false);

      releaseEscrowLock.resolve();
      await gateTransaction;
      const [firstResult, secondResult] = await Promise.allSettled([firstPromise, secondPromise]);
      return {
        dispute: firstOperation === 'dispute' ? firstResult : secondResult,
        release: firstOperation === 'release' ? firstResult : secondResult,
      };
    } finally {
      releaseEscrowLock.resolve();
      await gateTransaction.catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    }
  };

  beforeAll(async () => {
    await database.$connect();
    const [{ database: connectedDatabase }] = await database.$queryRaw`
      SELECT current_database() AS "database"
    `;
    if (connectedDatabase !== databaseName) {
      throw new Error('Connected database does not match DISPUTE_RELEASE_TEST_DATABASE_URL.');
    }

    const config = await import('../src/config/database.js');
    serviceDatabase = config.prisma;
    await serviceDatabase.$connect();
    const disputeService = await import('../src/services/contractDispute.service.js');
    const releaseService = await import('../src/services/adminRelease.service.js');
    submitContractDispute = disputeService.submitContractDispute;
    releaseContractFunds = releaseService.releaseContractFunds;
  });

  afterEach(async () => {
    for (const ids of fixtureIds) {
      await cleanupFixture(ids);
      fixtureIds.delete(ids);
    }
  });

  afterAll(async () => {
    await Promise.all([
      serviceDatabase?.$disconnect(),
      database.$disconnect(),
    ]);
  });

  test('a queued release rejects after dispute submission commits, with no wallet credit', async () => {
    const ids = await createFixture();

    const results = await runOrderedRace(ids, 'dispute');

    expect(results.dispute.status).toBe('fulfilled');
    expect(results.release.status).toBe('rejected');
    expect(results.release.reason).toMatchObject({ status: 409 });
    const [escrow, wallet, disputes, releaseLedger] = await Promise.all([
      database.escrow.findUnique({ where: { id: ids.escrow } }),
      database.wallet.findUnique({ where: { id: ids.wallet } }),
      database.dispute.findMany({ where: { contractId: ids.contract } }),
      database.financialLedgerEntry.findMany({
        where: { escrowId: ids.escrow, entryType: 'WALLET_CREDIT' },
      }),
    ]);

    expect(escrow.status).toBe('DISPUTED');
    expect(escrow.releasedAmount.toFixed(2)).toBe('0.00');
    expect(wallet.availableBalance.toFixed(2)).toBe('1000.00');
    expect(disputes).toHaveLength(1);
    expect(releaseLedger).toHaveLength(0);
  });

  test('a queued dispute rejects after release commits, with exactly one wallet credit and ledger entry', async () => {
    const ids = await createFixture();

    const results = await runOrderedRace(ids, 'release');

    expect(results.release.status).toBe('fulfilled');
    expect(results.dispute.status).toBe('rejected');
    expect(results.dispute.reason).toMatchObject({ status: 409 });
    const [escrow, wallet, disputes, releaseLedger, escrowLedger] = await Promise.all([
      database.escrow.findUnique({ where: { id: ids.escrow } }),
      database.wallet.findUnique({ where: { id: ids.wallet } }),
      database.dispute.findMany({ where: { contractId: ids.contract } }),
      database.financialLedgerEntry.findMany({
        where: {
          escrowId: ids.escrow,
          idempotencyKey: `escrow:${ids.escrow}:release`,
          entryType: 'WALLET_CREDIT',
        },
      }),
      database.financialLedgerEntry.findMany({ where: { escrowId: ids.escrow } }),
    ]);

    expect(escrow.status).toBe('RELEASED');
    expect(escrow.releasedAmount.toFixed(2)).toBe('95000.00');
    expect(wallet.availableBalance.toFixed(2)).toBe('96000.00');
    expect(disputes).toHaveLength(0);
    expect(releaseLedger).toHaveLength(1);
    expect(escrowLedger).toHaveLength(1);
  });

  test('a duplicate release-ledger key rolls back the wallet update and leaves escrow held', async () => {
    const ids = await createFixture();
    await database.financialLedgerEntry.create({
      data: {
        entryType: 'WALLET_CREDIT',
        amount: '1.00',
        currency: 'NGN',
        balanceAfter: '1001.00',
        idempotencyKey: `escrow:${ids.escrow}:release`,
        description: 'Intentional rollback-test conflict.',
        walletId: ids.wallet,
        contractId: ids.contract,
        escrowId: ids.escrow,
      },
    });

    await expect(releaseContractFunds(ids.contract)).rejects.toMatchObject({ code: 'P2002' });

    const [escrow, wallet, ledger] = await Promise.all([
      database.escrow.findUnique({ where: { id: ids.escrow } }),
      database.wallet.findUnique({ where: { id: ids.wallet } }),
      database.financialLedgerEntry.findMany({ where: { escrowId: ids.escrow } }),
    ]);
    expect(escrow.status).toBe('RELEASE_ELIGIBLE');
    expect(escrow.releasedAmount.toFixed(2)).toBe('0.00');
    expect(wallet.availableBalance.toFixed(2)).toBe('1000.00');
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount.toFixed(2)).toBe('1.00');
  });
}
