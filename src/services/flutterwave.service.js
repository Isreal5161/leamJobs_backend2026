import crypto from 'node:crypto';
import { env } from '../config/env.js';

export class FlutterwaveConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlutterwaveConfigurationError';
    this.status = 503;
  }
}

export class FlutterwaveRequestError extends Error {
  constructor(message, { outcomeUnknown = false } = {}) {
    super(message);
    this.name = 'FlutterwaveRequestError';
    this.status = 502;
    this.outcomeUnknown = outcomeUnknown;
  }
}

const requireSecretKey = () => {
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new FlutterwaveConfigurationError('Flutterwave payment configuration is unavailable');
  }
};

const requestFlutterwave = async (path, options = {}) => {
  requireSecretKey();
  let response;
  try {
    response = await fetch(`${env.FLUTTERWAVE_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    throw new FlutterwaveRequestError(error instanceof Error ? error.message : 'Flutterwave request failed', { outcomeUnknown: true });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new FlutterwaveRequestError('Flutterwave returned an invalid response', { outcomeUnknown: true });
    payload = null;
  }
  if (!response.ok || payload?.status === 'error') {
    throw new FlutterwaveRequestError(payload?.message || 'Flutterwave request failed', { outcomeUnknown: response.status >= 500 });
  }
  return payload;
};

export const initializeFlutterwavePayment = async ({ amount, currency, email, customerName, txRef, meta, redirectUrl, title = 'LeamJobs contract funding' }) => {
  const payload = await requestFlutterwave('/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: txRef,
      amount,
      currency,
      redirect_url: redirectUrl || env.FLUTTERWAVE_REDIRECT_URL || undefined,
      payment_options: 'card,banktransfer,ussd',
      customer: { email, ...(customerName ? { name: customerName } : {}) },
      meta,
      customizations: { title },
    }),
  });

  if (!payload?.data?.link) {
    throw new FlutterwaveRequestError('Flutterwave did not return a checkout link', { outcomeUnknown: true });
  }
  return { checkoutUrl: payload.data.link, providerReference: payload.data.tx_ref || txRef };
};

export const verifyFlutterwaveTransaction = async (transactionId) => {
  if (!transactionId || !/^\d+$/.test(String(transactionId))) {
    throw new FlutterwaveRequestError('A valid Flutterwave transaction ID is required');
  }
  const payload = await requestFlutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: 'GET' });
  if (!payload?.data) throw new FlutterwaveRequestError('Flutterwave returned no transaction data');
  return payload.data;
};

export const assertFlutterwaveWebhookSignature = (signature) => {
  if (!env.FLUTTERWAVE_SECRET_HASH || !signature) {
    throw new FlutterwaveConfigurationError('Flutterwave webhook verification is unavailable');
  }
  const expected = Buffer.from(env.FLUTTERWAVE_SECRET_HASH);
  const received = Buffer.from(String(signature));
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const error = new Error('Invalid Flutterwave webhook signature');
    error.status = 401;
    throw error;
  }
};