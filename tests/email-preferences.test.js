import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'preferences-test-secret';

const mockPrisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
const { getEmailPreferences, updateEmailPreferences, getMarketingUnsubscribeToken, unsubscribeMarketingEmail, InvalidUnsubscribeTokenError } = await import('../src/services/emailPreference.service.js');

afterEach(() => jest.clearAllMocks());

test('marketing preference is server-backed and transactional email remains enabled', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({ marketingEmailsEnabled: false });
  await expect(getEmailPreferences('user-1')).resolves.toEqual({ marketingEmailsEnabled: false, transactionalEmailsEnabled: true });
  mockPrisma.user.update.mockResolvedValue({ marketingEmailsEnabled: true });
  await expect(updateEmailPreferences('user-1', true)).resolves.toEqual({ marketingEmailsEnabled: true, transactionalEmailsEnabled: true });
  expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' }, data: { marketingEmailsEnabled: true } }));
});

test('signed unsubscribe turns off marketing only', async () => {
  const token = getMarketingUnsubscribeToken('user-1');
  mockPrisma.user.update.mockResolvedValue({});
  await expect(unsubscribeMarketingEmail(token)).resolves.toEqual({ message: expect.stringContaining('turned off') });
  expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { marketingEmailsEnabled: false } });
  await expect(unsubscribeMarketingEmail(`${token}tampered`)).rejects.toBeInstanceOf(InvalidUnsubscribeTokenError);
});
