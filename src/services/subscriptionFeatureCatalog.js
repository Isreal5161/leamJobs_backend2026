export const ENTITLEMENT_ALIASES = {
  RECOMMENDATION_BOOST: 'PRIORITY_RECOMMENDATIONS',
  PROFILE_ANALYTICS: 'APPLICATION_INSIGHTS',
  FEATURED_CANDIDATE: 'PROFILE_VISIBILITY_BOOST',
  ADVANCED_CV: 'AI_CV_IMPROVEMENT',
  ADVANCED_JOB_FILTERS: 'SEARCH_FILTERS',
  CAREER_MATCHING: 'AI_JOB_MATCHING',
  AI_PROFILE_ASSISTANT: 'AI_CV_REVIEW',
  AI_CV_OPTIMIZER: 'AI_CV_IMPROVEMENT',
  AI_APPLICATION_ASSISTANCE: 'APPLICATION_INSIGHTS',
  AI_INTERVIEW_PREP: 'AI_INTERVIEW_PREPARATION',
};

export const canonicalizeEntitlementKey = (value) => {
  const key = String(value ?? '').trim().toUpperCase();
  return ENTITLEMENT_ALIASES[key] ?? key;
};

export const subscriptionEntitlements = [
  { key: 'BROWSE_JOBS', displayName: 'Browse jobs', description: 'Access approved job listings.' },
  { key: 'SEARCH_FILTERS', displayName: 'Search & filters', description: 'Search jobs and use available filters.' },
  { key: 'APPLY_FOR_JOBS', displayName: 'Apply for jobs', description: 'Submit applications to approved jobs.' },
  { key: 'SAVED_JOBS', displayName: 'Saved jobs', description: 'Save jobs for later review.' },
  { key: 'JOB_ALERTS', displayName: 'Job alerts', description: 'Receive relevant job alert notifications.' },
  { key: 'BASIC_PROFILE', displayName: 'Basic profile', description: 'Maintain a visible seeker profile.' },
  { key: 'CV_UPLOAD', displayName: 'CV upload', description: 'Upload and use a CV in applications.' },
  { key: 'APPLICATION_TRACKING', displayName: 'Application tracking', description: 'Track submitted application status.' },
  { key: 'AI_CV_REVIEW', displayName: 'AI CV review', description: 'Get AI feedback on CV quality and content.' },
  { key: 'AI_CV_IMPROVEMENT', displayName: 'AI CV improvement', description: 'Get AI suggestions to improve CV content.' },
  { key: 'AI_COVER_LETTER', displayName: 'AI cover letter', description: 'Generate job-specific cover-letter drafts.' },
  { key: 'AI_JOB_MATCHING', displayName: 'AI job matching', description: 'Receive AI-assisted job matching.' },
  { key: 'AI_INTERVIEW_PREPARATION', displayName: 'AI interview preparation', description: 'Access AI interview preparation support.' },
  { key: 'AI_CAREER_ASSISTANT', displayName: 'AI career assistant', description: 'Access premium AI career guidance.' },
  { key: 'SKILLS_GAP_ANALYSIS', displayName: 'Skills-gap analysis', description: 'Identify gaps between skills and target roles.' },
  { key: 'PROFILE_STRENGTH', displayName: 'Profile strength', description: 'See profile completeness and strength guidance.' },
  { key: 'APPLICATION_INSIGHTS', displayName: 'Application insights', description: 'Access deeper application feedback and insights.' },
  { key: 'CAREER_RECOMMENDATIONS', displayName: 'Career recommendations', description: 'Receive personalized career recommendations.' },
  { key: 'PRIORITY_RECOMMENDATIONS', displayName: 'Priority recommendations', description: 'Receive prioritized job recommendations.' },
  { key: 'SALARY_CAREER_INSIGHTS', displayName: 'Salary/career insights', description: 'Access salary and career market insights.' },
  { key: 'PROFILE_VISIBILITY_BOOST', displayName: 'Profile visibility boost', description: 'Improve profile visibility in candidate discovery.' },
  { key: 'PREMIUM_SUPPORT', displayName: 'Premium support', description: 'Access priority support assistance.' },
];

export const subscriptionEntitlementKeys = new Set(subscriptionEntitlements.map(({ key }) => key));
