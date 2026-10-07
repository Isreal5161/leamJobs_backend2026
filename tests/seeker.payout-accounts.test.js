import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.PAYOUT_ENCRYPTION_KEY = 'test-payout-encryption-key';
process.env.FLW_SECRET_KEY = 'test-flutterwave-secret';

const mockPrisma = {
  payoutAccount: { findMany: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn(),
};
const fetchMock = jest.fn();
global.fetch = fetchMock;

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');
const { encryptPayoutIdentifier } = await import('../src/utils/payoutEncryption.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const defaultAccountId = '33333333-3333-4333-8333-333333333333';
const secondAccountId = '44444444-4444-4444-8444-444444444444';
const createdAt = new Date('2026-09-05T12:00:00.000Z');

const token = (role = 'SEEKER', subject = seekerId) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const account = (overrides = {}) => ({
  id: secondAccountId,
  provider: 'FLUTTERWAVE',
  payoutMethod: 'BANK_ACCOUNT',
  country: 'Nigeria',
  currency: 'NGN',
  bankCode: '044',
  accountName: 'Jane Doe',
  accountNumberLast4: '1234',
  isDefault: false,
  verifiedAt: createdAt,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.payoutAccount.findMany.mockResolvedValue([]);
  mockPrisma.payoutAccount.findFirst.mockResolvedValue(null);
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('/banks/NG')) {
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ code: '058', name: 'GTBank PLC' }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { account_name: 'Verified Jane Doe' } }) };
  });
});

describe('GET /api/seeker/payout-accounts', () => {
  test('requires authentication', async () => {
    const response = await request(app).get('/api/seeker/payout-accounts');

    expect(response.status).toBe(401);
    expect(mockPrisma.payoutAccount.findMany).not.toHaveBeenCalled();
  });

  test.each(['EMPLOYER', 'ADMIN'])('requires SEEKER role for %s', async (role) => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token(role)}`);

    expect(response.status).toBe(403);
    expect(mockPrisma.payoutAccount.findMany).not.toHaveBeenCalled();
  });

  test('returns only eligible accounts owned by the authenticated seeker', async () => {
    mockPrisma.payoutAccount.findMany.mockResolvedValue([
      account({ id: defaultAccountId, isDefault: true, accountNumberLast4: '4280' }),
      account({ id: secondAccountId, isDefault: false, accountNumberLast4: '1234' }),
    ]);

    const response = await request(app)
      .get(`/api/seeker/payout-accounts?userId=${otherSeekerId}&seekerId=${otherSeekerId}`)
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        payoutAccounts: [
          expect.objectContaining({ id: defaultAccountId, accountNumberLast4: '4280', isDefault: true }),
          expect.objectContaining({ id: secondAccountId, accountNumberLast4: '1234', isDefault: false }),
        ],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('encryptedAccountNumber');
    expect(JSON.stringify(response.body)).not.toContain('encrypted');
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith({
      where: {
        userId: seekerId,
        provider: 'FLUTTERWAVE',
        payoutMethod: 'BANK_ACCOUNT',
        country: 'Nigeria',
        currency: 'NGN',
        verifiedAt: { not: null },
        disabledAt: null,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: expect.objectContaining({ accountNumberLast4: true }),
    });
  });

  test('returns empty collection when no eligible accounts exist', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { payoutAccounts: [] } });
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: seekerId,
        provider: 'FLUTTERWAVE',
        payoutMethod: 'BANK_ACCOUNT',
        country: 'Nigeria',
        currency: 'NGN',
        verifiedAt: { not: null },
        disabledAt: null,
      },
    }));
  });

  test('does not expose stored US routing details or treat the account as payout-ready', async () => {
    mockPrisma.payoutAccount.findMany.mockResolvedValue([
      account({
        country: 'United States',
        currency: 'USD',
        bankCode: '101019644',
        encryptedPayoutMetadata: 'encrypted-us-metadata',
        verifiedAt: null,
      }),
    ]);

    const response = await request(app)
      .get('/api/seeker/payout-accounts?scope=all')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.payoutAccounts[0]).toMatchObject({
      country: 'United States',
      currency: 'USD',
      bankCode: null,
      verified: false,
      withdrawalSupported: false,
      status: 'UNSUPPORTED',
    });
    expect(JSON.stringify(response.body)).not.toContain('101019644');
    expect(JSON.stringify(response.body)).not.toContain('encrypted-us-metadata');
  });

  test('does not return disabled or unverified accounts', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.payoutAccounts).toEqual([]);
    expect(mockPrisma.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'FLUTTERWAVE',
        payoutMethod: 'BANK_ACCOUNT',
        country: 'Nigeria',
        currency: 'NGN',
        verifiedAt: { not: null },
        disabledAt: null,
      }),
    }));
  });
});

describe('GET /api/seeker/payout-accounts/banks', () => {
  test('returns Flutterwave bank codes for authenticated seekers', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts/banks?country=NG')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.banks).toEqual([{ code: '058', name: 'GTBank PLC' }]);
  });

  describe('GET /api/seeker/payout-accounts/capabilities', () => {
    test('returns only the currently supported Nigeria NGN destination', async () => {
      const response = await request(app)
        .get('/api/seeker/payout-accounts/capabilities')
        .set('Authorization', `Bearer ${token()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.capabilities).toEqual([
        {
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          provider: 'FLUTTERWAVE',
          payoutMethod: 'BANK_ACCOUNT',
          verificationMethod: 'FLUTTERWAVE_ACCOUNT_RESOLVE',
          verifiedBeforeWithdrawal: true,
          bankListAvailable: true,
          requiredFields: ['bankCode', 'accountNumber'],
        },
      ]);
    });
  });

  test('does not expose bank listings for unsupported country codes', async () => {
    const response = await request(app)
      .get('/api/seeker/payout-accounts/banks?country=US')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const buildTransaction = (overrides = {}) => ({
  payoutAccount: {
    findMany: jest.fn().mockResolvedValue(overrides.existingAccounts ?? []),
    findFirst: jest.fn().mockResolvedValue(overrides.existingAccount ?? null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockImplementation(({ data }) => ({ id: defaultAccountId, ...data })),
    update: jest.fn().mockImplementation(({ data }) => ({ id: overrides.existingAccount?.id ?? defaultAccountId, ...(overrides.existingAccount ?? {}), ...data })),
  },
  withdrawal: { findFirst: jest.fn().mockResolvedValue(null) },
});

describe('POST /api/seeker/payout-accounts', () => {
  test('requires authentication', async () => {
    const response = await request(app).post('/api/seeker/payout-accounts').send({});

    expect(response.status).toBe(401);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test.each(['EMPLOYER', 'ADMIN'])('requires SEEKER role for %s', async (role) => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token(role)}`)
      .send({});

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('verifies a Nigerian bank account with Flutterwave and masks the account number', async () => {
    const tx = buildTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '0123456789' });

    expect(response.status).toBe(201);
    expect(response.body.data.payoutAccount).toMatchObject({
      country: 'Nigeria',
      currency: 'NGN',
      payoutMethod: 'BANK_ACCOUNT',
      provider: 'FLUTTERWAVE',
      accountName: 'Verified Jane Doe',
      bankName: 'GTBank PLC',
      maskedAccountNumber: '****6789',
      isDefault: true,
      verified: true,
      withdrawalSupported: true,
      status: 'ACTIVE',
    });
    expect(JSON.stringify(response.body)).not.toContain('0123456789');
    expect(JSON.stringify(response.body)).not.toContain('encryptedAccountNumber');
    expect(tx.payoutAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: seekerId, currency: 'NGN', provider: 'FLUTTERWAVE', accountName: 'Verified Jane Doe', bankCode: '058', verifiedAt: expect.any(Date), isDefault: true }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ account_number: '0123456789', account_bank: '058' }));
  });

  test('does not save a Nigerian account when Flutterwave cannot resolve its details', async () => {
    const tx = buildTransaction();
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/banks/NG')
      ? { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ code: '058', name: 'GTBank PLC' }] }) }
      : { ok: true, status: 200, json: async () => ({ status: 'error', message: 'Invalid account' }) });

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '0123456789' });

    expect(response.status).toBe(422);
    expect(tx.payoutAccount.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('does not accept payout details for unsupported Ghana destination', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Ghana', accountHolderName: 'Jane Doe', payoutIdentifier: 'unverified-bank-details', currency: 'USD' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects new United States USD payout accounts', async () => {
    const details = {
      country: 'United States',
      accountHolderName: 'Jane Doe',
      accountNumber: '210868791872',
      routingNumber: '101019644',
      swiftCode: 'IRVTUS3N',
      bankName: 'BANK OF AMERICA, N.A.',
      accountType: 'checking',
      beneficiaryAddress: '4 Newton Street, San Francisco',
      postalCode: '94105',
      streetNumber: '4',
      streetName: 'Newton Street',
    };
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send(details);

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects incomplete and extra client-controlled fields for United States payout accounts', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        country: 'United States',
        accountHolderName: 'Jane Doe',
        accountNumber: '210868791872',
        routingNumber: '101019644',
        swiftCode: 'IRVTUS3N',
        bankName: 'BANK OF AMERICA',
        accountType: 'checking',
        beneficiaryAddress: '4 Newton Street',
        postalCode: '94105',
        streetNumber: '4',
        streetName: 'Newton Street',
        currency: 'EUR',
        provider: 'PAYSTACK',
        fee: '0',
      });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an unsupported country', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Wonderland', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a Nigeria submission missing bank account fields', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', accountHolderName: 'Jane Doe' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'bankCode' }),
      expect.objectContaining({ field: 'accountNumber' }),
    ]));
  });

  test('ignores/rejects a client-supplied ownership field', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userId: otherSeekerId, country: 'Nigeria', accountHolderName: 'Jane Doe', bankName: 'GTBank', accountNumber: '0123456789' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects client-supplied currency and account-name fields instead of accepting unverified payout details', async () => {
    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '0123456789', currency: 'USD', accountHolderName: 'Unverified Name' });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a duplicate account for the same seeker', async () => {
    const tx = buildTransaction({
      existingAccounts: [{
        id: secondAccountId,
        country: 'Nigeria',
        payoutMethod: 'BANK_ACCOUNT',
        encryptedAccountNumber: encryptPayoutIdentifier('0123456789'),
      }],
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '0123456789' });

    expect(response.status).toBe(409);
    expect(tx.payoutAccount.create).not.toHaveBeenCalled();
  });

  test('maps a database unique-constraint conflict to a clean 409 response', async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2002' }));

    const response = await request(app)
      .post('/api/seeker/payout-accounts')
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '0123456789' });

    expect(response.status).toBe(409);
    expect(response.body.message).not.toMatch(/P2002|prisma/i);
  });
});

describe('PATCH /api/seeker/payout-accounts/:id', () => {
  test('requires authentication', async () => {
    const response = await request(app).patch(`/api/seeker/payout-accounts/${defaultAccountId}`).send({ isDefault: true });

    expect(response.status).toBe(401);
  });

  test('returns 404 when the account does not belong to the authenticated seeker', async () => {
    const tx = buildTransaction({ existingAccount: null });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ isDefault: true });

    expect(response.status).toBe(404);
    expect(tx.payoutAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: defaultAccountId, userId: seekerId, disabledAt: null },
    }));
  });

  test('can toggle isDefault without resubmitting account details', async () => {
    const tx = buildTransaction({ existingAccount: { id: defaultAccountId, isDefault: false } });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ isDefault: true });

    expect(response.status).toBe(200);
    expect(tx.payoutAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: defaultAccountId },
      data: { isDefault: true },
    }));
  });

  test('updating account details re-verifies the bank account with Flutterwave', async () => {
    const tx = buildTransaction({ existingAccount: { id: defaultAccountId, isDefault: true, country: 'Nigeria' } });
    mockPrisma.payoutAccount.findFirst.mockResolvedValue({ id: defaultAccountId });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '9876543210' });

    expect(response.status).toBe(200);
    expect(tx.payoutAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provider: 'FLUTTERWAVE', bankName: 'GTBank PLC', accountName: 'Verified Jane Doe', verifiedAt: expect.any(Date) }),
    }));
  });

  test('does not change payout details while a withdrawal is pending or processing', async () => {
    const tx = buildTransaction({ existingAccount: { id: defaultAccountId, isDefault: true, country: 'Nigeria' } });
    tx.withdrawal.findFirst.mockResolvedValue({ id: 'active-withdrawal' });
    mockPrisma.payoutAccount.findFirst.mockResolvedValue({ id: defaultAccountId });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await request(app)
      .patch(`/api/seeker/payout-accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ country: 'Nigeria', bankCode: '058', accountNumber: '9876543210' });

    expect(response.status).toBe(409);
    expect(tx.payoutAccount.update).not.toHaveBeenCalled();
  });
});
