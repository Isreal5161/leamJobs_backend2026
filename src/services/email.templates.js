const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const renderMessage = (message) => escapeHtml(message)
  .split(/\r?\n/)
  .map((line) => {
    if (!line.trim()) return '';
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = Math.min(3, Math.max(2, heading[1].length));
      return `<h${level} style="margin:24px 0 12px;color:#17352b;font-size:${level === 2 ? 21 : 18}px;line-height:1.3">${heading[2]}</h${level}>`;
    }
    return `<p style="margin:0 0 16px">${line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
  })
  .join('');

const frontendBaseUrl = () => (process.env.FRONTEND_URL || process.env.FRONTEND_URL_PROD || 'https://leamjobs.com').replace(/\/$/, '');
const logoUrl = () => `${frontendBaseUrl()}/leamjobs-2.png`;

const layout = ({ heading, body, ctaLabel, ctaUrl, unsubscribeUrl, isMarketing, isInterview }) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;background:${isInterview ? '#f5f4fb' : '#f4f7f5'};color:#1d2924;font-family:Arial,sans-serif;line-height:1.6">
  <div style="max-width:620px;width:100%;margin:0 auto;background:transparent">
    <div style="background:${isInterview ? '#322F6A' : '#0B1F3A'};color:#fff;padding:18px 24px;border-radius:10px 10px 0 0;box-sizing:border-box;width:100%;margin:0">
      <img src="${escapeHtml(logoUrl())}" alt="LeamJobs" style="display:block;width:auto;height:28px;border:0;max-width:160px;" />
    </div>
    <main style="background:#fff;padding:0;border:1px solid #dce7e1;border-top:0;border-radius:0 0 10px 10px;box-sizing:border-box;width:100%">
      <div style="padding:28px 32px 34px;box-sizing:border-box;width:100%">
      <h1 style="margin:8px 0 18px;font-size:24px;line-height:1.25;color:${isInterview ? '#322F6A' : '#17352b'}">${escapeHtml(heading)}</h1>
      ${body}
      ${ctaLabel && ctaUrl ? `<p style="margin:26px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${isInterview ? '#EF5036' : '#d79a3d'};color:${isInterview ? '#fff' : '#1d2924'};text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">${escapeHtml(ctaLabel)}</a></p>` : ''}
      <p style="margin:28px 0 0;color:#63736c;font-size:13px">${isMarketing ? 'You are receiving this optional LeamJobs job-update email.' : 'You are receiving this important LeamJobs account or service message.'}</p>
      </div>
    </main>
    <p style="padding:16px 8px;color:#718078;font-size:12px">LeamJobs support: support@leamjobs.com${unsubscribeUrl ? ` · <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from marketing emails</a>` : ''}</p>
  </div>
</body>
</html>`;

const normalizeTemplateLink = (link) => {
  if (!link) return null;
  const value = String(link).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/api/')) return value;
  const baseUrl = process.env.FRONTEND_URL || process.env.FRONTEND_URL_PROD || 'http://localhost:5173';
  return `${baseUrl.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
};

const generic = ({ title, heading = title, message, link, linkLabel = 'Open LeamJobs', unsubscribeUrl, isMarketing, isInterview }) => {
  const normalizedLink = normalizeTemplateLink(link);
  return {
    subject: title,
    text: `${title}\n\n${message}${normalizedLink ? `\n\n${linkLabel}: ${normalizedLink}` : ''}\n\nLeamJobs support: support@leamjobs.com${unsubscribeUrl ? `\nUnsubscribe from marketing emails: ${unsubscribeUrl}` : ''}`,
    html: layout({
      heading,
      body: renderMessage(message),
      ctaLabel: normalizedLink ? linkLabel : null,
      ctaUrl: normalizedLink,
      unsubscribeUrl,
      isMarketing,
      isInterview,
    }),
  };
};

export const renderEmailTemplate = (emailType, context = {}) => {
  const title = context.title || 'LeamJobs notification';
  const message = context.message || 'There is new activity on your LeamJobs account.';

  if (['INTERVIEW_SCHEDULED', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_UPDATED', 'INTERVIEW_CANCELLED'].includes(emailType)) {
    const details = context.metadata && typeof context.metadata === 'object' ? context.metadata : {};
    const date = details.scheduledAt ? new Date(details.scheduledAt) : null;
    const formattedDate = date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: typeof details.timezone === 'string' ? details.timezone : 'UTC' }).format(date)
      : null;
    const detailLines = [
      details.jobTitle ? `Job: ${details.jobTitle}` : null,
      details.companyName ? `Company: ${details.companyName}` : null,
      formattedDate ? `Date and time: ${formattedDate}` : null,
      details.timezone ? `Timezone: ${details.timezone}` : null,
      details.method ? `Method: ${String(details.method).replaceAll('_', ' ').toLowerCase()}` : null,
      details.durationMinutes ? `Duration: ${details.durationMinutes} minutes` : null,
      details.location ? `Location: ${details.location}` : null,
      details.meetingUrl ? `Meeting link: ${details.meetingUrl}` : null,
      details.phoneNumber ? `Contact number: ${details.phoneNumber}` : null,
      details.message ? `Employer instructions: ${details.message}` : null,
    ].filter((line) => typeof line === 'string');
    const interviewHeading = {
      INTERVIEW_SCHEDULED: 'Interview Invitation',
      INTERVIEW_RESCHEDULED: 'Interview Rescheduled',
      INTERVIEW_UPDATED: 'Interview Details Updated',
      INTERVIEW_CANCELLED: 'Interview Cancelled',
    }[emailType];
    return generic({
      title,
      heading: interviewHeading,
      message: [message, ...detailLines].join('\n\n'),
      link: context.link,
      linkLabel: 'View interview',
      isInterview: true,
      isMarketing: false,
    });
  }

  if (emailType === 'EMPLOYER_VERIFICATION_APPROVED') {
    return generic({
      title: title || 'Company verification approved',
      heading: 'Company verification approved',
      message: message || 'Your company documents have been approved and your employer account is now verified.',
      link: context.link || '/employer/verification',
      linkLabel: 'View verification status',
      ...({ unsubscribeUrl: context.unsubscribeUrl, isMarketing: false }),
    });
  }

  if (emailType === 'EMPLOYER_VERIFICATION_DECLINED') {
    return generic({
      title: title || 'Company verification needs attention',
      heading: 'Company verification needs attention',
      message: message || 'Your verification request requires a few updates before it can be approved.',
      link: context.link || '/employer/verification',
      linkLabel: 'Review feedback',
      ...({ unsubscribeUrl: context.unsubscribeUrl, isMarketing: false }),
    });
  }

  if (emailType === 'EMAIL_VERIFICATION_CODE') {
    const verificationCode = context.code || '123456';
    const textBody = `${message}\n\nVerification code: ${verificationCode}`;
    return {
      subject: title || 'Verify your LeamJobs email',
      text: textBody,
      html: layout({
        heading: context.heading || 'Verify your email address',
        body: renderMessage(message + `\n\nVerification code: ${verificationCode}`),
        ctaLabel: null,
        ctaUrl: null,
        unsubscribeUrl: context.unsubscribeUrl,
        isMarketing: false,
      }),
    };
  }

  return generic({
    title,
    heading: context.heading,
    message,
    link: context.link,
    linkLabel: context.linkLabel,
    unsubscribeUrl: context.unsubscribeUrl,
    isMarketing: context.isMarketing === true || emailType === 'JOB_UPDATES_SUBSCRIBED',
  });
};

export { escapeHtml };
