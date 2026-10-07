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
  constructor(message, {
    outcomeUnknown = false,
    status = 502,
    originalHttpStatus,
    providerStatus,
    providerCode,
  } = {}) {
    super(message);
    this.name = 'FlutterwaveRequestError';
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
    if (originalHttpStatus !== undefined) this.originalHttpStatus = originalHttpStatus;
    if (providerStatus !== undefined) this.providerStatus = providerStatus;
    if (providerCode !== undefined) this.providerCode = providerCode;
  }
}

const safeProviderStatus = (value) => (
  value === 'error' || value === 'success' ? value : undefined
);

const safeProviderCode = (value) => (
  typeof value === 'string' && /^[A-Z][A-Z_]{0,63}$/.test(value) ? value : undefined
);

const requireSecretKey = () => {
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new FlutterwaveConfigurationError('Flutterwave payment configuration is unavailable');
  }
};

export const isFlutterwaveConfigured = () => Boolean(env.FLUTTERWAVE_SECRET_KEY);

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
    const providerRejected = payload?.status === 'error';
    const unknownOutcome = response.status >= 500;
    const status = unknownOutcome
      ? 502
      : response.status === 401 || response.status === 403
        ? 503
        : providerRejected || (response.status >= 400 && response.status < 500)
          ? 422
          : 502;
    throw new FlutterwaveRequestError(payload?.message || 'Flutterwave request failed', {
      outcomeUnknown: unknownOutcome,
      status,
      originalHttpStatus: response.status,
      providerStatus: safeProviderStatus(payload?.status),
      providerCode: safeProviderCode(payload?.code),
    });
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

export const getFlutterwaveBanks = async (countryCode = 'NG') => {
  const payload = await requestFlutterwave(`/banks/${encodeURIComponent(countryCode)}`, { method: 'GET' });
  if (!Array.isArray(payload?.data)) {
    throw new FlutterwaveRequestError('Flutterwave returned an invalid bank list');
  }
  return payload.data
    .filter((bank) => bank && bank.code !== undefined && typeof bank.name === 'string')
    .map((bank) => ({ code: String(bank.code), name: bank.name }));
};

export const resolveFlutterwaveBankAccount = async ({ accountNumber, bankCode }) => {
  const payload = await requestFlutterwave('/accounts/resolve', {
    method: 'POST',
    body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
  });
  const accountName = payload?.data?.account_name;
  if (typeof accountName !== 'string' || !accountName.trim()) {
    throw new FlutterwaveRequestError('Flutterwave could not verify the bank account', { outcomeUnknown: false });
  }
  return { accountName: accountName.trim() };
};

export const createFlutterwaveTransfer = async ({
  amount,
  accountNumber,
  bankCode,
  beneficiaryName,
  reference,
  narration,
  currency = 'NGN',
  debitCurrency = currency,
}) => {
  if (currency !== 'NGN' || debitCurrency !== 'NGN') {
    throw new FlutterwaveRequestError('Flutterwave withdrawals currently support NGN only', { status: 422 });
  }
  const payload = await requestFlutterwave('/transfers', {
    method: 'POST',
    body: JSON.stringify({
      amount: Number(amount),
      ...(bankCode ? { account_bank: bankCode } : {}),
      account_number: accountNumber,
      beneficiary_name: beneficiaryName,
      currency,
      debit_currency: debitCurrency,
      reference,
      narration,
    }),
  });
  if (!payload?.data || payload.data.id === undefined || payload.data.id === null || !payload.data.reference) {
    throw new FlutterwaveRequestError('Flutterwave did not return a transfer result', { outcomeUnknown: true });
  }
  return payload.data;
};

export const getFlutterwaveTransferById = async (transferId) => {
  if (!transferId || !/^\d+$/.test(String(transferId))) {
    throw new FlutterwaveRequestError('A valid Flutterwave transfer ID is required');
  }
  const payload = await requestFlutterwave(`/transfers/${encodeURIComponent(transferId)}`, { method: 'GET' });
  if (!payload?.data) throw new FlutterwaveRequestError('Flutterwave returned no transfer data');
  return payload.data;
};

export const normalizeFlutterwaveTransferStatus = (status) => {
  switch (String(status ?? '').trim().toUpperCase()) {
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return 'SUCCESSFUL';
    case 'FAILED':
    case 'CANCELLED':
      return 'FAILED';
    case 'REVERSED':
      return 'REVERSED';
    case 'NEW':
    case 'PENDING':
    case 'QUEUED':
    case 'PROCESSING':
    case 'RETRYING':
    default:
      return 'PROCESSING';
  }
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