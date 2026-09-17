import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'bridge-test-secret';

const mockPrisma = {
  notification: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findUnique: jest.fn() },
};
const queueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
const EMAIL_TYPES = {
  ADMIN_JOB_REVIEW_REQUIRED: 'ADMIN_JOB_REVIEW_REQUIRED', JOB_APPROVED: 'JOB_APPROVED', NEW_JOB_MATCH: 'NEW_JOB_MATCH', JOB_REJECTED: 'JOB_REJECTED', APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED', APPLICATION_STATUS_CHANGED: 'APPLICATION_STATUS_CHANGED', JOB_INVITATION_RECEIVED: 'JOB_INVITATION_RECEIVED', JOB_INVITATION_ACCEPTED: 'JOB_INVITATION_ACCEPTED', JOB_INVITATION_DECLINED: 'JOB_INVITATION_DECLINED', NEW_MESSAGE: 'NEW_MESSAGE', SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED', SUBSCRIPTION_EXPIRING: 'SUBSCRIPTION_EXPIRING', SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED', SUBSCRIPTION_PAYMENT_FAILED: 'SUBSCRIPTION_PAYMENT_FAILED', CONTRACT_ACTIVE: 'CONTRACT_ACTIVE', CONTRACT_COMPLETION_SUBMITTED: 'CONTRACT_COMPLETION_SUBMITTED', CONTRACT_RELEASE_ELIGIBLE: 'CONTRACT_RELEASE_ELIGIBLE', CONTRACT_FUNDING_FAILED: 'CONTRACT_FUNDING_FAILED', ESCROW_RELEASED: 'ESCROW_RELEASED', EMPLOYER_VERIFICATION_APPROVED: 'EMPLOYER_VERIFICATION_APPROVED', EMPLOYER_VERIFICATION_DECLINED: 'EMPLOYER_VERIFICATION_DECLINED',
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({ EMAIL_TYPES, queueEmail, createMarketingUnsubscribeToken: jest.fn(() => 'marketing-token') }));
const { createNotification } = await import('../src/services/notification.service.js');

const notification = (eventKey, link = '/seeker/dashboard') => ({ id: eventKey, recipientUserId: 'user-1', actorUserId: null, type: 'INFO', category: 'GENERAL', eventKey, title: 'Event', message: 'Message', link, metadata: null, isRead: false, readAt: null, createdAt: new Date(), updatedAt: new Date(), actor: null });

test.each([
  ['job:submitted:1', 'ADMIN_JOB_REVIEW_REQUIRED', '/admin/jobs'],
  ['job:approved:1', 'JOB_APPROVED', '/employer/jobs/1'],
  ['job:approved:seeker:1', 'NEW_JOB_MATCH', '/seeker/jobs/1'],
  ['job:rejected:1', 'JOB_REJECTED', '/employer/jobs/1'],
  ['employerVerification:approved:1', 'EMPLOYER_VERIFICATION_APPROVED', '/employer/verification'],
  ['employerVerification:declined:1', 'EMPLOYER_VERIFICATION_DECLINED', '/employer/verification'],
  ['application:submitted:1', 'APPLICATION_SUBMITTED', '/employer/applicants'],
  ['application:status:1:REJECTED', 'APPLICATION_STATUS_CHANGED', '/seeker/applications'],
  ['invitation:pending:1', 'JOB_INVITATION_RECEIVED', '/seeker/jobs'],
  ['invitation:accepted:1', 'JOB_INVITATION_ACCEPTED', '/employer/applicants'],
  ['invitation:declined:1', 'JOB_INVITATION_DECLINED', '/employer/applicants'],
  ['message:new:1:1', 'NEW_MESSAGE', '/seeker/messages'],
  ['subscription:activated:1', 'SUBSCRIPTION_ACTIVATED', '/seeker/payments'],
  ['subscription:expiry-reminder:1:3d', 'SUBSCRIPTION_EXPIRING', '/seeker/payments'],
  ['subscription:expired:1', 'SUBSCRIPTION_EXPIRED', '/seeker/payments'],
  ['subscription:payment-failed:1', 'SUBSCRIPTION_PAYMENT_FAILED', '/seeker/payments'],
  ['contract:active:1', 'CONTRACT_ACTIVE', '/seeker/contracts/1'],
  ['contract:completion-submitted:1', 'CONTRACT_COMPLETION_SUBMITTED', '/employer/contracts/1'],
  ['escrow:release-eligible:1', 'CONTRACT_RELEASE_ELIGIBLE', '/seeker/contracts/1'],
  ['contract:payment-failed:1', 'CONTRACT_FUNDING_FAILED', '/employer/contracts/1'],
  ['escrow:released:1', 'ESCROW_RELEASED', '/seeker/payments'],
])('bridges %s to %s', async (eventKey, emailType, link) => {
  mockPrisma.notification.create.mockResolvedValue(notification(eventKey, link));
  await createNotification({ recipientUserId: 'user-1', recipientEmail: 'user@example.com', eventKey, title: 'Event', message: 'Message', link });
  await new Promise((resolve) => setImmediate(resolve));
  expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ emailType, eventKey, recipientEmail: 'user@example.com' }));
  queueEmail.mockClear();
});
