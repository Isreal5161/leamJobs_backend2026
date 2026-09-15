import crypto from 'node:crypto';
import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'paystack-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_provider_secret';

const fetchMock = jest.fn();
global.fetch = fetchMock;
const { createPaystackTransferRecipient, createPaystackTransfer, getPaystackTransferByReference, getPaystackTransferByCode, assertPaystackWebhookSignature } = await import('../src/services/paystack.service.js');

afterEach(() => jest.clearAllMocks());

const response = (data, ok = true, status = 200) => ({ ok, status, json: jest.fn().mockResolvedValue({ status: ok, data }) });

test('creates a Paystack NUBAN recipient without exposing credentials', async () => {
  fetchMock.mockResolvedValue(response({ recipient_code: 'RCP_test' }));
  await expect(createPaystackTransferRecipient({ name: 'Jane Doe', accountNumber: '0123456789', bankCode: '058' })).resolves.toEqual({ recipient_code: 'RCP_test' });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.paystack.co/transferrecipient');
  expect(options.headers.Authorization).toBe('Bearer sk_test_provider_secret');
  expect(options.body).toContain('"bank_code":"058"');
});

test('creates an idempotent transfer reference in kobo', async () => {
  fetchMock.mockResolvedValue(response({ transfer_code: 'TRF_test', status: 'pending', reference: 'leamjobs_withdrawal_1' }));
  await createPaystackTransfer({ amount: '80000.00', recipientCode: 'RCP_test', reference: 'leamjobs_withdrawal_1', reason: 'LeamJobs wallet withdrawal' });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ amount: 8000000, reference: 'leamjobs_withdrawal_1', recipient: 'RCP_test' });
});

test('looks up transfer status by trusted deterministic reference', async () => {
  fetchMock.mockResolvedValue(response([{ reference: 'leamjobs_withdrawal_1', status: 'success' }]));
  await expect(getPaystackTransferByReference('leamjobs_withdrawal_1')).resolves.toMatchObject({ status: 'success' });
  expect(fetchMock.mock.calls[0][0]).toContain('/transfer?reference=leamjobs_withdrawal_1');
});

test('looks up transfer status by the Paystack transfer code', async () => {
  fetchMock.mockResolvedValue(response({ transfer_code: 'TRF_test', status: 'success' }));
  await expect(getPaystackTransferByCode('TRF_test')).resolves.toMatchObject({ status: 'success' });
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/transfer/TRF_test');
});

test('verifies Paystack webhook signatures with the server-side secret', () => {
  const body = Buffer.from('{"event":"transfer.success"}');
  const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');
  expect(() => assertPaystackWebhookSignature(signature, body)).not.toThrow();
  expect(() => assertPaystackWebhookSignature('tampered', body)).toThrow(/Invalid Paystack webhook signature/);
});
