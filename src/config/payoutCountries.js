// Mirrors the country list already collected on the seeker profile/onboarding forms.
// Keeping this backend-side (not imported from the frontend) so the backend remains the
// source of truth and is never trusted to accept an arbitrary client-supplied country.
export const PAYOUT_COUNTRIES = [
  'Nigeria',
  'Ghana',
  'Kenya',
  'South Africa',
  'United Kingdom',
  'United States',
  'Canada',
  'Germany',
  'United Arab Emirates',
  'India',
];

// Only Nigeria has a concrete, documented payout path today (Flutterwave bank transfer).
// Every other supported country is accepted for data-capture purposes only - see
// PayoutAccount.verifiedAt, which is never set automatically, so those accounts stay
// non-withdrawal-eligible until a real payment-provider integration exists for them.
export const isNigeria = (country) => country === 'Nigeria';
