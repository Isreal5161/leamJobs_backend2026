import { env } from '../config/env.js';

export const assertCurrentLegalAcceptance = ({ termsAccepted, privacyAccepted, acceptedTermsVersion, acceptedPrivacyVersion }) => {
  const validAcknowledgements = termsAccepted === true && privacyAccepted === true;
  const validTerms = typeof acceptedTermsVersion === 'string'
    && acceptedTermsVersion.trim() === env.TERMS_DOCUMENT_VERSION;
  const validPrivacy = typeof acceptedPrivacyVersion === 'string'
    && acceptedPrivacyVersion.trim() === env.PRIVACY_DOCUMENT_VERSION;

  if (!validAcknowledgements || !validTerms || !validPrivacy) {
    const error = new Error('Current Terms and Conditions and Privacy Policy acknowledgement is required.');
    error.status = 400;
    error.publicMessage = 'Please review and accept the current Terms and Conditions and acknowledge the Privacy Policy.';
    throw error;
  }
};

export const recordLegalAcceptance = async (transaction, userId, versions, registrationMethod) => {
  assertCurrentLegalAcceptance(versions);
  await transaction.userLegalAcceptance.createMany({
    data: [
      { userId, documentType: 'TERMS', version: versions.acceptedTermsVersion.trim(), registrationMethod },
      { userId, documentType: 'PRIVACY', version: versions.acceptedPrivacyVersion.trim(), registrationMethod },
    ],
    skipDuplicates: true,
  });
};
