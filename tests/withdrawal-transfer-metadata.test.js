process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.JWT_SECRET = 'test-withdrawal-metadata-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.PAYOUT_ENCRYPTION_KEY = 'test-withdrawal-metadata-key';

const {
  getFlutterwaveDomRemitterMetadata,
  getMissingFlutterwaveDomRemitterConfiguration,
} = await import('../src/config/payoutCountries.js');
const {
  buildWithdrawalTransferMetadata,
  decryptWithdrawalTransferMetadataSnapshot,
} = await import('../src/services/withdrawalTransferMetadata.js');
const { decryptPayoutIdentifier, encryptPayoutIdentifier } = await import('../src/utils/payoutEncryption.js');

const usMetadata = {
  routing_number: '101019644',
  swift_code: 'IRVTUS3N',
  bank_name: 'BANK OF AMERICA, N.A.',
  account_type: 'checking',
  beneficiary_address: '4 Newton Street, San Francisco',
  postal_code: '94105',
  street_number: '4',
  street_name: 'Newton Street',
  city: 'San Francisco',
};

test('US transfer metadata is decrypted, snapshotted encrypted, and mapped without the internal route marker', () => {
  const payoutAccount = {
    country: 'United States',
    currency: 'USD',
    encryptedPayoutMetadata: encryptPayoutIdentifier(JSON.stringify(usMetadata)),
  };
  const metadata = buildWithdrawalTransferMetadata(payoutAccount);
  const encryptedSnapshot = encryptPayoutIdentifier(JSON.stringify(metadata));

  expect(encryptedSnapshot).not.toContain('101019644');
  expect(JSON.parse(decryptPayoutIdentifier(encryptedSnapshot))).toEqual([{
    ...usMetadata,
    route: 'INTERNATIONAL_USD',
  }]);
  expect(decryptWithdrawalTransferMetadataSnapshot(encryptedSnapshot)).toEqual([{
    routing_number: '101019644',
    swift_code: 'IRVTUS3N',
    bank_name: 'BANK OF AMERICA, N.A.',
    account_type: 'checking',
    beneficiary_address: '4 Newton Street, San Francisco',
    postal_code: '94105',
    street_number: '4',
    street_name: 'Newton Street',
    city: 'San Francisco',
  }]);
});

test('invalid or absent immutable snapshots fail closed', () => {
  expect(() => decryptWithdrawalTransferMetadataSnapshot(null)).toThrow(/immutable transfer metadata snapshot/i);
  expect(() => decryptWithdrawalTransferMetadataSnapshot(encryptPayoutIdentifier('not-json'))).toThrow(/metadata is unavailable/i);
});

test('missing and unsupported snapshot routes fail closed', () => {
  expect(() => decryptWithdrawalTransferMetadataSnapshot(encryptPayoutIdentifier(JSON.stringify([usMetadata]))))
    .toThrow(/route is not supported/i);
  expect(() => decryptWithdrawalTransferMetadataSnapshot(encryptPayoutIdentifier(JSON.stringify([{
    ...usMetadata,
    route: 'UNSUPPORTED_ROUTE',
  }])))).toThrow(/route is not supported/i);
});

test('incomplete US snapshots fail closed', () => {
  const { routing_number: _routingNumber, ...incompleteMetadata } = usMetadata;
  expect(() => decryptWithdrawalTransferMetadataSnapshot(encryptPayoutIdentifier(JSON.stringify([{
    ...incompleteMetadata,
    route: 'INTERNATIONAL_USD',
  }])))).toThrow(/US bank destination snapshot is incomplete/i);
});

test('NGN metadata building remains unchanged', () => {
  expect(buildWithdrawalTransferMetadata({ country: 'Nigeria', currency: 'NGN' })).toBeNull();
});

test('Nigerian domiciliary transfer does not proceed when Flutterwave currently disables IMTO', () => {
  expect(() => buildWithdrawalTransferMetadata({
    country: 'Nigeria',
    currency: 'USD',
    encryptedPayoutMetadata: encryptPayoutIdentifier(JSON.stringify({ first_name: 'Tobi' })),
  })).toThrow(/IMTO transfers as unavailable/i);
});

test('remitter configuration helper identifies exact missing merchant/KYC values', () => {
  const configuration = {
    FLUTTERWAVE_DOM_REMITTER_NAME: '',
    FLUTTERWAVE_DOM_REMITTER_ADDRESS: '',
    FLUTTERWAVE_DOM_REMITTER_CITY: '',
    FLUTTERWAVE_DOM_REMITTER_COUNTRY: '',
    FLUTTERWAVE_DOM_REMITTER_ID_NUMBER: '',
    FLUTTERWAVE_DOM_REMITTER_ID_TYPE: '',
    FLUTTERWAVE_DOM_REMITTER_ID_EXPIRY: '',
    FLUTTERWAVE_DOM_REMITTER_MOBILE_NUMBER: '',
    FLUTTERWAVE_DOM_REMITTER_EMAIL: '',
    FLUTTERWAVE_DOM_REMITTER_OCCUPATION: '',
    FLUTTERWAVE_DOM_REMITTER_BENEFICIARY_RELATIONSHIP: '',
  };

  expect(getMissingFlutterwaveDomRemitterConfiguration(configuration)).toHaveLength(11);
  expect(getFlutterwaveDomRemitterMetadata(configuration).missing).toContain('FLUTTERWAVE_DOM_REMITTER_ID_NUMBER');
});

test('remitter information is read only from explicit merchant/KYC configuration, never the wallet user', () => {
  const configuration = {
    FLUTTERWAVE_DOM_REMITTER_NAME: 'Merchant KYC Name',
    FLUTTERWAVE_DOM_REMITTER_ADDRESS: 'Merchant KYC Address',
    FLUTTERWAVE_DOM_REMITTER_CITY: 'Lagos',
    FLUTTERWAVE_DOM_REMITTER_COUNTRY: 'NG',
    FLUTTERWAVE_DOM_REMITTER_ID_NUMBER: 'KYC-123',
    FLUTTERWAVE_DOM_REMITTER_ID_TYPE: 'PASSPORT',
    FLUTTERWAVE_DOM_REMITTER_ID_EXPIRY: '2030-01-01',
    FLUTTERWAVE_DOM_REMITTER_MOBILE_NUMBER: '+2348000000000',
    FLUTTERWAVE_DOM_REMITTER_EMAIL: 'merchant@example.com',
    FLUTTERWAVE_DOM_REMITTER_OCCUPATION: 'Company',
    FLUTTERWAVE_DOM_REMITTER_BENEFICIARY_RELATIONSHIP: 'Customer',
  };
  const result = getFlutterwaveDomRemitterMetadata(configuration);

  expect(result.missing).toEqual([]);
  expect(result.metadata.sender).toBe('Merchant KYC Name');
  expect(result.metadata.sender_id_number).toBe('KYC-123');
});
