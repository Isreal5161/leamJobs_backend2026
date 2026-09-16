export const publicCompanyLogoUrl = (employerId, companyLogoUrl) => (
  employerId && companyLogoUrl
    ? `/api/public/companies/${encodeURIComponent(employerId)}/logo`
    : null
);