import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: {} }));

const { matchesJobAlert } = await import('../src/services/jobAlerts.service.js');

const baseAlert = { keywords: null, location: null, jobType: null, workArrangement: null, skills: [], salaryMin: null, salaryMax: null };
const baseJob = { title: 'Engineer', description: 'Build products', location: 'Lagos', skills: ['JavaScript'], jobType: 'NORMAL_EMPLOYMENT', workArrangement: 'HYBRID', employmentCompensation: { salaryMin: 2000, salaryMax: 3000 }, freelanceCompensation: null };

test('matches employment salary ranges', () => {
  expect(matchesJobAlert({ ...baseAlert, salaryMin: 2500, salaryMax: 3500 }, baseJob)).toBe(true);
  expect(matchesJobAlert({ ...baseAlert, salaryMin: 3501 }, baseJob)).toBe(false);
  expect(matchesJobAlert({ ...baseAlert, salaryMax: 1999 }, baseJob)).toBe(false);
});

test('matches freelance project compensation', () => {
  const job = { ...baseJob, jobType: 'FREELANCE_PROJECT', employmentCompensation: null, freelanceCompensation: { projectAmount: 5000 } };
  expect(matchesJobAlert({ ...baseAlert, salaryMin: 4500, salaryMax: 5500 }, job)).toBe(true);
  expect(matchesJobAlert({ ...baseAlert, salaryMin: 5001 }, job)).toBe(false);
});

test('does not match a salary-filtered alert when compensation is missing', () => {
  expect(matchesJobAlert({ ...baseAlert, salaryMin: 1 }, { ...baseJob, employmentCompensation: null, freelanceCompensation: null })).toBe(false);
  expect(matchesJobAlert(baseAlert, { ...baseJob, employmentCompensation: null, freelanceCompensation: null })).toBe(true);
});
