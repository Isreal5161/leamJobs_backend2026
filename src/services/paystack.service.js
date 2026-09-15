import crypto from 'node:crypto';
import { env } from '../config/env.js';

export class PaystackConfigurationError extends Error {
  constructor(message = 'Paystack payout configuration is unavailable') {
    super(message);
    this.name = 'PaystackConfigurationError';
    this.status = 503;
    this.retryable = false;
  }
}

export class PaystackRequestError extends Error {
  constructor(message, { status = 502, retryable = true } = {}) {
    super(message);
    this.name = 'PaystackRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

const requireSecretKey = () => {
  if (!env.PAYSTACK_SECRET_KEY) throw new PaystackConfigurationError();
};

export const isPaystackConfigured = () => Boolean(env.PAYSTACK_SECRET_KEY);

const requestPaystack = async (path, options = {}) => {
  requireSecretKey();
  let response;
  try {
    response = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new PaystackRequestError('Paystack payout request could not be completed', { retryable: true });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== true) {
    const retryable = response.status >= 500 || response.status === 429;
    throw new PaystackRequestError('Paystack payout request was rejected', { status: retryable ? 502 : 422, retryable });
  }
  return payload.data;
};

export const createPaystackTransferRecipient = async ({ name, accountNumber, bankCode }) => requestPaystack('/transferrecipient', {
  method: 'POST',
  body: JSON.stringify({ type: 'nuban', name, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }),
});

export const createPaystackTransfer = async ({ amount, recipientCode, reference, reason }) => {
  const [whole, fraction = ''] = String(amount).split('.');
  const amountInKobo = Number(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
  return requestPaystack('/transfer', {
    method: 'POST',
    body: JSON.stringify({ source: 'balance', amount: amountInKobo, recipient: recipientCode, reference, reason }),
  });
};

export const getPaystackTransferByReference = async (reference) => {
  const transfers = await requestPaystack(`/transfer?reference=${encodeURIComponent(reference)}`, { method: 'GET' });
  return Array.isArray(transfers) ? transfers.find((transfer) => transfer.reference === reference) ?? null : null;
};

export const getPaystackTransferByCode = async (transferCode) => requestPaystack(`/transfer/${encodeURIComponent(transferCode)}`, { method: 'GET' });

export const assertPaystackWebhookSignature = (signature, rawBody) => {
  requireSecretKey();
  const expected = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const received = String(signature ?? '');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (!received || expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    const error = new Error('Invalid Paystack webhook signature');
    error.status = 401;
    throw error;
  }
};

export const normalizePaystackTransferStatus = (status) => {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'success' || normalized === 'successful') return 'SUCCESSFUL';
  if (normalized === 'reversed') return 'REVERSED';
  if (normalized === 'failed') return 'FAILED';
  return 'PROCESSING';
};
