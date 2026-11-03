import { validateCampaignCreate, validateCampaignRecipientQuery } from '../src/validators/adminCommunications.validation.js';

const invoke = (middleware, request) => new Promise((resolve) => {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      resolve({ status: this.statusCode, body, request });
      return this;
    },
  };
  middleware(request, response, () => resolve({ status: 200, request }));
});

test.each([
  ['ESSENTIAL_ANNOUNCEMENT', 'ALL_REGISTERED_USERS', true, true],
  ['ESSENTIAL_ANNOUNCEMENT', 'SEEKERS', true, true],
  ['ESSENTIAL_ANNOUNCEMENT', 'EMPLOYERS', true, true],
  ['PROMOTIONAL_MARKETING', 'ALL_MARKETING_USERS', false, true],
  ['PROMOTIONAL_MARKETING', 'SEEKERS', false, true],
  ['PROMOTIONAL_MARKETING', 'EMPLOYERS', false, true],
  ['PROMOTIONAL_MARKETING', 'PUBLIC_JOB_SUBSCRIBERS', false, true],
  ['ESSENTIAL_ANNOUNCEMENT', 'PUBLIC_JOB_SUBSCRIBERS', true, false],
  ['PROMOTIONAL_MARKETING', 'ALL_REGISTERED_USERS', false, false],
  ['ESSENTIAL_ANNOUNCEMENT', 'ALL_REGISTERED_USERS', false, false],
])('validates %s with segment %s and required confirmation', async (purpose, segment, operationalContentConfirmed, valid) => {
  const result = await invoke(validateCampaignCreate, {
    body: { subject: 'Status', heading: 'Status', body: 'Operational update.', purpose, segment, operationalContentConfirmed },
  });
  expect(result.status).toBe(valid ? 200 : 400);
});

test('recipient count query requires a purpose and compatible segment', async () => {
  const valid = await invoke(validateCampaignRecipientQuery, {
    query: { purpose: 'ESSENTIAL_ANNOUNCEMENT', segment: 'SEEKERS' },
  });
  expect(valid.status).toBe(200);
  expect(valid.request.validatedPurpose).toBe('ESSENTIAL_ANNOUNCEMENT');
  expect(valid.request.validatedSegment).toBe('SEEKERS');

  const missingPurpose = await invoke(validateCampaignRecipientQuery, { query: { segment: 'SEEKERS' } });
  const incompatible = await invoke(validateCampaignRecipientQuery, {
    query: { purpose: 'ESSENTIAL_ANNOUNCEMENT', segment: 'PUBLIC_JOB_SUBSCRIBERS' },
  });
  expect(missingPurpose.status).toBe(400);
  expect(incompatible.status).toBe(400);
});
