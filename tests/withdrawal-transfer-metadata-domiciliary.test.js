import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.JWT_SECRET = 'test-withdrawal-metadata-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.PAYOUT_ENCRYPTION_KEY = 'test-withdrawal-metadata-key';

const remitter = {
  sender: 'Merchant KYC Name',
  sender_address: 'Merchant KYC Address',
  sender_city: 'Lagos',
  sender_country: 'NG',
  sender_id_number: 'KYC-123',
  sender_id_type: 'PASSPORT',
  sender_id_expiry: '2030-01-01',
  sender_mobile_number: '+2348000000000',
  sender_email_address: 'merchant@example.com',
  sender_occupation: 'Company',
  sender_beneficiary_relationship: 'Customer',
};

jest.unstable_mockModule('../src/config/payoutCountries.js', () => ({
  FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE: true,
  getFlutterwaveDomRemitterMetadata: jest.fn(() => ({ missing: [], metadata: remitter })),
}));

const {
  buildWithdrawalTransferMetadata,
  decryptWithdrawalTransferMetadataSnapshot,
} = await import('../src/services/withdrawalTransferMetadata.js');
const { encryptPayoutIdentifier, decryptPayoutIdentifier } = await import('../src/utils/payoutEncryption.js');

const beneficiary = {
  first_name: 'Tobi',
  last_name: 'Example',
  email: 'tobi@example.com',
  mobile_number: '+2348012345678',
  recipient_address: '1 Lagos Street, Lagos',
  beneficiary_occupation: 'Consultant',
};

test('Nigerian USD snapshots record the domiciliary route and decrypt without it in provider metadata', () => {
  const metadata = buildWithdrawalTransferMetadata({
    country: 'Nigeria',
    currency: 'USD',
    encryptedPayoutMetadata: encryptPayoutIdentifier(JSON.stringify(beneficiary)),
  });
  const encryptedSnapshot = encryptPayoutIdentifier(JSON.stringify(metadata));

  expect(JSON.parse(decryptPayoutIdentifier(encryptedSnapshot))).toEqual([{
    ...remitter,
    ...beneficiary,
    beneficiary_country: 'NG',
    transfer_purpose: 'Wallet withdrawal',
    route: 'NG_DOMICILIARY_USD',
  }]);
  expect(decryptWithdrawalTransferMetadataSnapshot(encryptedSnapshot)).toEqual([{
    ...remitter,
    ...beneficiary,
    beneficiary_country: 'NG',
    transfer_purpose: 'Wallet withdrawal',
  }]);
  expect(decryptWithdrawalTransferMetadataSnapshot(encryptedSnapshot)[0]).not.toHaveProperty('route');
});

test('incomplete Nigerian beneficiary or snapshot metadata fails closed', () => {
  const incompleteBeneficiary = { ...beneficiary, email: '' };
  expect(() => buildWithdrawalTransferMetadata({
    country: 'Nigeria',
    currency: 'USD',
    encryptedPayoutMetadata: encryptPayoutIdentifier(JSON.stringify(incompleteBeneficiary)),
  })).toThrow(/Nigerian USD destination is incomplete/i);

  const incompleteSnapshot = encryptPayoutIdentifier(JSON.stringify([{
    ...remitter,
    ...beneficiary,
    beneficiary_country: 'NG',
    transfer_purpose: 'Wallet withdrawal',
    route: 'NG_DOMICILIARY_USD',
    sender_id_number: '',
  }]));
  expect(() => decryptWithdrawalTransferMetadataSnapshot(incompleteSnapshot))
    .toThrow(/Nigerian USD destination snapshot is incomplete/i);
});
