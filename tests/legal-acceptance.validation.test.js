process.env.NODE_ENV = 'test';
process.env.TERMS_DOCUMENT_VERSION = '1.0';
process.env.PRIVACY_DOCUMENT_VERSION = '1.0';

const { validateLegalAcceptance, validateRegistration } = await import('../src/validators/auth.validation.js');

const validRegistration = {
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com',
  password: 'ValidPassword1!', role: 'SEEKER',
  termsAccepted: true, privacyAccepted: true,
  acceptedTermsVersion: '1.0', acceptedPrivacyVersion: '1.0',
};

const runValidator = (validator, req) => {
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  validator(req, response, () => { nextCalled = true; });
  return { response, nextCalled };
};

test('password registration rejects missing and incomplete legal acceptance with field errors', () => {
  const missing = runValidator(validateRegistration, { body: {
    ...validRegistration,
    termsAccepted: undefined,
    privacyAccepted: undefined,
    acceptedTermsVersion: undefined,
    acceptedPrivacyVersion: undefined,
  } });
  expect(missing.response.statusCode).toBe(400);
  expect(missing.response.body).toMatchObject({ message: 'Validation failed' });
  expect(missing.response.body.errors.map(({ field }) => field)).toEqual(expect.arrayContaining(['acceptedTermsVersion', 'acceptedPrivacyVersion']));

  const incomplete = runValidator(validateRegistration, { body: { ...validRegistration, acceptedPrivacyVersion: undefined } });
  expect(incomplete.response.statusCode).toBe(400);
  expect(incomplete.response.body.errors.map(({ field }) => field)).toContain('acceptedPrivacyVersion');

  const declined = runValidator(validateRegistration, { body: { ...validRegistration, termsAccepted: false } });
  expect(declined.response.statusCode).toBe(400);
  expect(declined.response.body.errors.map(({ field }) => field)).toContain('termsAccepted');
});

test('password registration rejects document version mismatches', () => {
  const password = runValidator(validateRegistration, { body: { ...validRegistration, acceptedTermsVersion: 'old-version' } });
  expect(password.response.statusCode).toBe(400);
  expect(password.response.body.errors).toContainEqual(expect.objectContaining({ field: 'acceptedTermsVersion' }));
});

test('password registration accepts matching explicit versions through the standard validator', () => {
  const result = runValidator(validateRegistration, { body: { ...validRegistration } });
  expect(result.nextCalled).toBe(true);
  expect(result.response.statusCode).toBe(200);
});

test('authenticated legal acceptance rejects declined choices and client-selected user IDs', () => {
  const declined = runValidator(validateLegalAcceptance, { body: {
    termsAccepted: true,
    privacyAccepted: false,
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
  } });
  expect(declined.response.statusCode).toBe(400);

  const forgedUser = runValidator(validateLegalAcceptance, { body: {
    termsAccepted: true,
    privacyAccepted: true,
    acceptedTermsVersion: '1.0',
    acceptedPrivacyVersion: '1.0',
    userId: 'another-user',
  } });
  expect(forgedUser.response.statusCode).toBe(400);
});
