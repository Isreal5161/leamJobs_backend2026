import { validateCreateEmployerJob } from '../src/validators/employerJobs.validation.js';

const payload = (contractCompensation = {}) => ({
  title: 'Build company website',
  description: 'A defined paid project',
  location: 'Remote',
  workArrangement: 'REMOTE',
  engagementType: 'CONTRACT',
  jobType: 'NORMAL_EMPLOYMENT',
  requirements: [],
  responsibilities: [],
  skills: [],
  benefits: [],
  monthlyCompensation: null,
  freelanceCompensation: null,
  contractCompensation: {
    amount: 300000,
    currency: 'NGN',
    duration: '30 days',
    startMode: 'IMMEDIATE',
    scheduledStartDate: null,
    expectedCompletionDate: null,
    ...contractCompensation,
  },
});

const parse = (body) => new Promise((resolve) => {
  const request = { body };
  const response = { status: () => response, json: (value) => resolve({ error: value }) };
  validateCreateEmployerJob(request, response, () => resolve({ value: request.validatedJob }));
});

test('immediate Contract Jobs accept no scheduled date', async () => {
  const result = await parse(payload({ startMode: 'IMMEDIATE', scheduledStartDate: null }));
  expect(result.value.contractCompensation.startMode).toBe('IMMEDIATE');
  expect(result.value.contractCompensation.scheduledStartDate).toBeNull();
});

test('scheduled Contract Jobs require a scheduled date', async () => {
  const result = await parse(payload({ startMode: 'SCHEDULED', scheduledStartDate: null }));
  expect(result.error).toBeDefined();
});

test('expected completion is optional but must follow scheduled start', async () => {
  const optional = await parse(payload({ startMode: 'SCHEDULED', scheduledStartDate: '2026-10-01', expectedCompletionDate: null }));
  expect(optional.value.contractCompensation.expectedCompletionDate).toBeNull();

  const invalid = await parse(payload({ startMode: 'SCHEDULED', scheduledStartDate: '2026-10-10', expectedCompletionDate: '2026-10-01' }));
  expect(invalid.error).toBeDefined();
});
