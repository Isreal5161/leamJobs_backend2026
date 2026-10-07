import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.FLW_SECRET_KEY = 'flutterwave-test-secret';

const fetchMock = jest.fn();
global.fetch = fetchMock;
const {
  createFlutterwaveTransfer,
  getFlutterwaveBanks,
  getFlutterwaveTransferById,
  normalizeFlutterwaveTransferStatus,
  resolveFlutterwaveBankAccount,
} = await import('../src/services/flutterwave.service.js');

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(data),
});

afterEach(() => jest.clearAllMocks());

test('loads bank codes from Flutterwave for the requested country', async () => {
  fetchMock.mockResolvedValue(response({ status: 'success', data: [{ code: '058', name: 'GTBank PLC' }] }));

  await expect(getFlutterwaveBanks('NG')).resolves.toEqual([{ code: '058', name: 'GTBank PLC' }]);
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.flutterwave.com/v3/banks/NG');
});

test('resolves Nigerian bank account details without trusting a client account name', async () => {
  fetchMock.mockResolvedValue(response({ status: 'success', data: { account_number: '0123456789', account_name: 'Jane Doe' } }));

  await expect(resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })).resolves.toEqual({ accountName: 'Jane Doe' });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.flutterwave.com/v3/accounts/resolve');
  expect(JSON.parse(options.body)).toEqual({ account_number: '0123456789', account_bank: '058' });
});

test('retains expected provider status and symbolic diagnostic code without retaining the payload', async () => {
  fetchMock.mockResolvedValue(response({
    status: 'error',
    message: 'Invalid account',
    code: 'INVALID_ACCOUNT',
    data: { account_number: 'must-not-be-retained' },
  }, 422));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).toMatchObject({
    status: 422,
    originalHttpStatus: 422,
    providerStatus: 'error',
    providerCode: 'INVALID_ACCOUNT',
    message: 'Invalid account',
  });
  expect(error).not.toHaveProperty('data');
  expect(error).not.toHaveProperty('payload');
  expect(JSON.stringify(error)).not.toContain('must-not-be-retained');
  expect(JSON.stringify(error)).not.toContain('0123456789');
});

test('retains success as an expected provider status in an HTTP error response', async () => {
  fetchMock.mockResolvedValue(response({ status: 'success', code: 'INVALID_ACCOUNT' }, 400));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).toMatchObject({ status: 422, originalHttpStatus: 400, providerStatus: 'success' });
});

test.each([
  ['numeric provider code', 1395568038],
  ['digit-only provider code', '1395568038'],
  ['bank-code-shaped provider code', '044'],
  ['account-number-shaped provider code', '0123456789'],
  ['arbitrary long provider code', 'INVALID_ACCOUNT_CODE_THAT_IS_LONGER_THAN_SIXTY_FOUR_CHARACTERS_AND_MUST_NOT_BE_RETAINED'],
])('discards %s', async (_label, code) => {
  fetchMock.mockResolvedValue(response({ status: 'error', code }, 422));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).not.toHaveProperty('providerCode');
});

test('discards unexpected provider status values', async () => {
  fetchMock.mockResolvedValue(response({ status: 'account 0123456789', code: 'INVALID_ACCOUNT' }, 422));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).not.toHaveProperty('providerStatus');
  expect(error).toHaveProperty('providerCode', 'INVALID_ACCOUNT');
});

test.each([401, 403])('normalizes Flutterwave HTTP %s to 503 and retains its original status', async (httpStatus) => {
  fetchMock.mockResolvedValue(response({ status: 'error', code: 'AUTH_REJECTED' }, httpStatus));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).toMatchObject({
    status: 503,
    originalHttpStatus: httpStatus,
    providerStatus: 'error',
    providerCode: 'AUTH_REJECTED',
  });
});

test('normalizes Flutterwave 5xx to 502 and retains its original status', async () => {
  fetchMock.mockResolvedValue(response({ status: 'error', code: 'PROVIDER_FAILURE' }, 503));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).toMatchObject({
    status: 502,
    originalHttpStatus: 503,
    providerStatus: 'error',
    providerCode: 'PROVIDER_FAILURE',
  });
});

test('normalizes other Flutterwave 4xx errors to 422', async () => {
  fetchMock.mockResolvedValue(response({ status: 'error', code: 'INVALID_ACCOUNT' }, 400));

  const error = await resolveFlutterwaveBankAccount({ accountNumber: '0123456789', bankCode: '058' })
    .catch((caught) => caught);

  expect(error).toMatchObject({ status: 422, originalHttpStatus: 400 });
});

test('creates a deterministic NGN transfer with the saved net amount', async () => {
  fetchMock.mockResolvedValue(response({ status: 'success', data: { id: 12345, status: 'NEW', amount: 95000, currency: 'NGN', reference: 'lj_wd_test' } }));

  await createFlutterwaveTransfer({
    amount: '95000.00',
    accountNumber: '0123456789',
    bankCode: '058',
    beneficiaryName: 'Jane Doe',
    reference: 'lj_wd_test',
    narration: 'LeamJobs wallet withdrawal',
  });

  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.flutterwave.com/v3/transfers');
  expect(JSON.parse(options.body)).toEqual({
    amount: 95000,
    account_bank: '058',
    account_number: '0123456789',
    beneficiary_name: 'Jane Doe',
    currency: 'NGN',
    debit_currency: 'NGN',
    reference: 'lj_wd_test',
    narration: 'LeamJobs wallet withdrawal',
  });
  expect(options.headers.Authorization).toContain(process.env.FLW_SECRET_KEY);
});

test('rejects non-NGN withdrawal transfers before contacting Flutterwave', async () => {
  await expect(createFlutterwaveTransfer({
    amount: '95.00',
    accountNumber: '210868791872',
    beneficiaryName: 'Jane Doe',
    reference: 'lj_wd_usd',
    narration: 'LeamJobs wallet withdrawal',
    currency: 'USD',
    debitCurrency: 'USD',
  })).rejects.toMatchObject({ status: 422 });

  expect(fetchMock).not.toHaveBeenCalled();
});

test('fetches transfer status by provider transfer ID and normalizes lifecycle states', async () => {
  fetchMock.mockResolvedValue(response({ status: 'success', data: { id: 12345, status: 'SUCCESSFUL' } }));

  await expect(getFlutterwaveTransferById('12345')).resolves.toMatchObject({ status: 'SUCCESSFUL' });
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.flutterwave.com/v3/transfers/12345');
  expect(normalizeFlutterwaveTransferStatus('NEW')).toBe('PROCESSING');
  expect(normalizeFlutterwaveTransferStatus('FAILED')).toBe('FAILED');
  expect(normalizeFlutterwaveTransferStatus('REVERSED')).toBe('REVERSED');
  await expect(getFlutterwaveTransferById('not-an-id')).rejects.toThrow(/valid Flutterwave transfer ID/);
});
