import { jest } from '@jest/globals';

const { validateSubmitEmployerVerification } = await import('../src/validators/employerVerification.validation.js');

const makeResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const validPayload = (overrides = {}) => ({
  registrationNumber: 'RC123456',
  registrationType: 'CAC Private Limited Company (Ltd)',
  company: {
    companyName: 'Example Ltd',
    website: '',
    linkedinUrl: 'https://linkedin.com/company/example',
    twitterUrl: null,
    facebookUrl: '',
  },
  ...overrides,
});

describe('employer verification request validation', () => {
  test('accepts optional empty URLs and detailed registration type strings', () => {
    const req = { body: validPayload() };
    const res = makeResponse();
    const next = jest.fn();

    validateSubmitEmployerVerification(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.registrationType).toBe('CAC Private Limited Company (Ltd)');
    expect(req.body.company.website).toBeNull();
    expect(req.body.company.facebookUrl).toBeNull();
  });

  test.each(['CAC', 'BN', 'OTHER'])('keeps accepting the existing %s registration value', (registrationType) => {
    const req = { body: validPayload({ registrationType }) };
    const res = makeResponse();
    const next = jest.fn();

    validateSubmitEmployerVerification(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.registrationType).toBe(registrationType);
  });

  test.each([
    ['website', 'Website must be a valid URL'],
    ['linkedinUrl', 'LinkedIn URL must be a valid URL'],
    ['twitterUrl', 'X/Twitter URL must be a valid URL'],
    ['facebookUrl', 'Facebook URL must be a valid URL'],
  ])('returns a field-specific error for an invalid %s', (field, message) => {
    const req = { body: validPayload({ company: { ...validPayload().company, [field]: 'example.com/profile' } }) };
    const res = makeResponse();
    const next = jest.fn();

    validateSubmitEmployerVerification(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Validation failed',
      errors: [expect.objectContaining({ field: `company.${field}`, message })],
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('keeps the existing 120-character registration-type limit', () => {
    const req = { body: validPayload({ registrationType: 'x'.repeat(121) }) };
    const res = makeResponse();
    const next = jest.fn();

    validateSubmitEmployerVerification(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      errors: [expect.objectContaining({ field: 'registrationType' })],
    }));
  });

  test('returns multiple field-specific errors for missing required values and invalid URLs', () => {
    const req = {
      body: validPayload({
        registrationNumber: ' ',
        registrationType: '',
        company: {
          ...validPayload().company,
          companyName: ' ',
          website: 'example.com/profile',
        },
      }),
    };
    const res = makeResponse();
    const next = jest.fn();

    validateSubmitEmployerVerification(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Validation failed',
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'registrationNumber' }),
        expect.objectContaining({ field: 'registrationType' }),
        expect.objectContaining({ field: 'company.companyName' }),
        expect.objectContaining({ field: 'company.website' }),
      ]),
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
