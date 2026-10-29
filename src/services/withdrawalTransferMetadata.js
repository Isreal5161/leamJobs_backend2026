import { env } from '../config/env.js';
import { FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE, getFlutterwaveDomRemitterMetadata } from '../config/payoutCountries.js';
import { decryptPayoutIdentifier } from '../utils/payoutEncryption.js';

export class WithdrawalTransferMetadataError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'WithdrawalTransferMetadataError';
    this.status = status;
  }
}

const decryptJson = (value) => {
  try {
    return JSON.parse(decryptPayoutIdentifier(value));
  } catch {
    throw new WithdrawalTransferMetadataError('Saved payout metadata is unavailable. Contact support before requesting a withdrawal.', 409);
  }
};

export const buildWithdrawalTransferMetadata = (payoutAccount) => {
  if (payoutAccount.country === 'United States' && payoutAccount.currency === 'USD') {
    const metadata = decryptJson(payoutAccount.encryptedPayoutMetadata);
    const required = ['routing_number', 'swift_code', 'bank_name', 'account_type', 'beneficiary_address', 'postal_code', 'street_number', 'street_name'];
    if (required.some((key) => !String(metadata?.[key] ?? '').trim())) {
      throw new WithdrawalTransferMetadataError('The saved US bank destination is incomplete. Update the payout details before requesting a withdrawal.');
    }
    return [metadata];
  }

  if (payoutAccount.country === 'Nigeria' && payoutAccount.currency === 'USD') {
    if (!FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE) {
      throw new WithdrawalTransferMetadataError(
        'Flutterwave currently reports Nigerian USD domiciliary IMTO transfers as unavailable. This withdrawal route is disabled.',
        503,
      );
    }
    const beneficiary = decryptJson(payoutAccount.encryptedPayoutMetadata);
    const { missing, metadata: remitter } = getFlutterwaveDomRemitterMetadata(env);
    if (missing.length) {
      throw new WithdrawalTransferMetadataError(
        `Nigerian USD domiciliary withdrawals are unavailable. Configure verified merchant remitter details: ${missing.join(', ')}.`,
        503,
      );
    }
    return [{
      ...remitter,
      first_name: beneficiary.first_name,
      last_name: beneficiary.last_name,
      email: beneficiary.email,
      beneficiary_country: 'NG',
      mobile_number: beneficiary.mobile_number,
      recipient_address: beneficiary.recipient_address,
      beneficiary_occupation: beneficiary.beneficiary_occupation,
      transfer_purpose: 'Wallet withdrawal',
    }];
  }

  if (payoutAccount.country === 'Nigeria' && payoutAccount.currency === 'NGN') return null;
  throw new WithdrawalTransferMetadataError('The payout destination is not supported for this withdrawal currency.');
};

export const decryptWithdrawalTransferMetadataSnapshot = (encryptedSnapshot) => {
  if (!encryptedSnapshot) {
    throw new WithdrawalTransferMetadataError('This withdrawal has no immutable transfer metadata snapshot and requires manual review.', 409);
  }
  const metadata = decryptJson(encryptedSnapshot);
  if (!Array.isArray(metadata) || metadata.length !== 1 || typeof metadata[0] !== 'object' || metadata[0] === null) {
    throw new WithdrawalTransferMetadataError('The saved transfer metadata snapshot is invalid. Contact support before payout.', 409);
  }
  const [snapshot] = metadata;
  const { route, ...transferFields } = snapshot;
  const allowedFields = route === 'INTERNATIONAL_USD'
    ? new Set(['routing_number', 'swift_code', 'bank_name', 'account_type', 'beneficiary_address', 'postal_code', 'street_number', 'street_name', 'city', 'email', 'mobile_number'])
    : route === 'NG_DOMICILIARY_USD'
      ? new Set(['sender', 'sender_address', 'sender_city', 'sender_country', 'sender_id_number', 'sender_id_type', 'sender_id_expiry', 'sender_mobile_number', 'sender_email_address', 'sender_occupation', 'sender_beneficiary_relationship', 'first_name', 'last_name', 'email', 'beneficiary_country', 'mobile_number', 'recipient_address', 'beneficiary_occupation', 'transfer_purpose'])
      : null;
  if (!allowedFields) throw new WithdrawalTransferMetadataError('The saved transfer route is not supported.', 409);
  const filteredFields = Object.fromEntries(Object.entries(transferFields).filter(([key]) => allowedFields.has(key)));
  if (route === 'INTERNATIONAL_USD') {
    const required = ['routing_number', 'swift_code', 'bank_name', 'account_type', 'beneficiary_address', 'postal_code', 'street_number', 'street_name'];
    if (required.some((key) => !String(filteredFields[key] ?? '').trim())
      || !['checking', 'depository'].includes(String(filteredFields.account_type).toLowerCase())) {
      throw new WithdrawalTransferMetadataError('The saved US bank destination snapshot is incomplete. Contact support before payout.', 409);
    }
  }
  return [filteredFields];
};
