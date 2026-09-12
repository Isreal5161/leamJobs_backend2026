import { prisma } from '../config/database.js';

export const defaultSiteContent = {
  welcome: {
    heroTitle: 'Find a job that actually fits you.',
    heroSubtitle: 'Smart matching, better opportunities, and tools to help you grow your career.',
    primaryCta: 'Create free account',
    secondaryCta: 'Sign in',
    employerCta: 'Post a job',
    filterTitle: 'Filters',
    keywordPlaceholder: 'Job title or keyword',
    locationPlaceholder: 'City, state, or remote',
    searchButton: 'Search',
    stats: [
      { value: '120k+', label: 'Open roles' },
      { value: '18k+', label: 'Companies' },
      { value: '2.4M', label: 'Hired members' },
    ],
    filters: ['Remote', 'Full-time', 'Design', 'New York', '$100k+', 'Engineering', 'Marketing'],
  },
  about: {
    eyebrow: 'About LeamJobs',
    title: 'About LeamJobs',
    description:
      "We're on a mission to connect great people with meaningful opportunities and help companies build teams that drive the future.",
    primaryCta: 'Create free account',
    secondaryCta: 'I already have one',
    missionTitle: 'Our mission',
    missionText:
      'To create a smarter, more human way to find and fill jobs, empowering people to grow their careers and companies to build exceptional teams.',
    valuesTitle: 'Our values',
    values: [
      { title: 'People first', text: 'We put people at the center of everything we do.' },
      { title: 'Trust & transparency', text: 'Honest, open, and fair in every interaction.' },
      { title: 'Growth mindset', text: 'We learn, adapt, and keep improving together.' },
      { title: 'Impact', text: 'We build with purpose to create real, positive change.' },
    ],
    stats: [
      { value: '120k+', label: 'Open roles' },
      { value: '18k+', label: 'Companies' },
      { value: '2.4M', label: 'Hired members' },
      { value: '150+', label: 'Countries' },
    ],
    teamTitle: 'Built by a passionate team',
    teamText:
      'LeamJobs is crafted by a global team of builders, designers, and problem-solvers who care deeply about making the job search experience better for everyone.',
    teamButton: 'Join our team',
    teamMoreLabel: '+12',
    team: ['SA', 'JM', 'NK', 'AL', 'RP'],
    partnerTitle: 'Stronger together',
    partnerText:
      'We partner with amazing companies and communities to create more opportunities and drive meaningful careers forward.',
    partnerButton: 'Partner with us',
  },
  features: {
    heroTitle: 'Features that make job search smarter',
    heroSubtitle:
      'LeamJobs gives you the tools and insights you need to find the right opportunities, faster and with confidence.',
    primaryCta: 'Create free account',
    secondaryCta: 'I already have one',
    recommendationsTitle: 'Recommended for you',
    recommendations: [
      { title: 'Senior Product Designer', meta: 'Google - New York, NY - Remote', match: '95% match' },
      { title: 'Product Design Lead', meta: 'Slack - San Francisco, CA - Hybrid', match: '89% match' },
      { title: 'Design Systems Manager', meta: 'Dropbox - Austin, TX - Remote', match: '82% match' },
    ],
    profileCompletion: 72,
    profileTitle: 'Profile completeness',
    profileText: 'Add skills and experience to increase your match rate.',
    profileLink: 'Complete profile ->',
    items: [
      { title: 'Smart matching', text: 'Our AI matches you with jobs that fit your skills, experience, and career goals.' },
      { title: 'Save jobs', text: 'Bookmark jobs you love and come back to them anytime.' },
      { title: 'Track applications', text: 'Keep track of every application and stay organized in one place.' },
      { title: 'Salary insights', text: 'See real salary ranges and compensation insights for better decisions.' },
      { title: 'Company reviews', text: 'Read real reviews from employees to learn about company culture.' },
      { title: 'Remote filters', text: 'Find remote and hybrid jobs that fit your lifestyle.' },
    ],
    ctaTitle: 'Everything you need to find your next great opportunity',
    ctaSubtitle: 'Join millions of professionals using LeamJobs to build their dream careers.',
    ctaButton: 'Create free account',
  },
  'how-it-works': {
    heroTitle: 'How LeamJobs works',
    heroSubtitle: 'Three simple steps to your next great opportunity.',
    primaryCta: 'Create free account',
    secondaryCta: 'I already have one',
    heroStepLabels: ['Create profile', 'Get matched', 'Apply & get hired'],
    steps: [
      {
        title: 'Create your profile',
        text: "Tell us about your skills, experience, and what you're looking for. Our AI builds a smart profile in minutes.",
      },
      {
        title: 'Get matched instantly',
        text: 'Receive personalized job recommendations with a match score so you only see roles that truly fit.',
      },
      {
        title: 'Apply and get hired',
        text: 'Apply in one tap, track every application, and connect directly with hiring teams.',
      },
    ],
    stats: [
      { value: '120k+', label: 'Open roles' },
      { value: '18k+', label: 'Companies' },
      { value: '2.4M', label: 'Hired members' },
      { value: '150+', label: 'Countries' },
    ],
    ctaTitle: 'Ready to find your next role?',
    ctaSubtitle: 'Join millions of professionals using LeamJobs.',
    ctaButton: 'Create free account',
  },
  companies: {
    heroTitle: 'Companies on LeamJobs',
    heroSubtitle: 'Explore teams hiring right now-from early-stage startups to Fortune 500 leaders.',
    primaryCta: 'Create free account',
    secondaryCta: 'I already have one',
    filters: ['All', 'Startup', 'Enterprise', 'Remote-first', 'Fintech', 'Design', 'Product', 'Engineering'],
    companies: [
      { name: 'Google', category: 'Technology', location: 'Mountain View, CA', employees: '100k+ employees', tone: 'google' },
      { name: 'Slack', category: 'Software', location: 'San Francisco, CA', employees: '2k-5k employees', tone: 'slack' },
      { name: 'Dropbox', category: 'Cloud Storage', location: 'San Francisco, CA', employees: '2k-5k employees', tone: 'dropbox' },
      { name: 'Figma', category: 'Design', location: 'San Francisco, CA', employees: '1k-2k employees', tone: 'figma' },
      { name: 'Spotify', category: 'Audio', location: 'Stockholm, Sweden', employees: '5k+ employees', tone: 'spotify' },
      { name: 'Stripe', category: 'Fintech', location: 'Dublin, Ireland', employees: '4k+ employees', tone: 'stripe' },
      { name: 'Airbnb', category: 'Travel', location: 'San Francisco, CA', employees: '6k+ employees', tone: 'airbnb' },
      { name: 'Notion', category: 'Productivity', location: 'San Francisco, CA', employees: '1k+ employees', tone: 'notion' },
      { name: 'Amazon', category: 'Technology', location: 'Seattle, WA', employees: '1.5M+ employees', tone: 'amazon' },
      { name: 'Microsoft', category: 'Technology', location: 'Redmond, WA', employees: '220k+ employees', tone: 'microsoft' },
    ],
    viewJobsLabel: 'View jobs',
    stats: [
      { value: '120k+', label: 'Open roles' },
      { value: '18k+', label: 'Companies' },
      { value: '2.4M', label: 'Hired members' },
      { value: '150+', label: 'Countries' },
    ],
    ctaTitle: 'Hiring on LeamJobs?',
    ctaSubtitle: 'Reach millions of qualified candidates and find your next great hire.',
    ctaButton: 'Post a job',
  },
};

export const ensureDefaultSiteContent = async () => {
  const rows = await prisma.siteContent.findMany({ select: { pageKey: true } });
  const existing = new Set(rows.map((row) => row.pageKey));

  for (const [pageKey, content] of Object.entries(defaultSiteContent)) {
    if (existing.has(pageKey)) continue;
    await prisma.siteContent.upsert({
      where: { pageKey },
      create: { pageKey, content },
      update: { content },
    });
    existing.add(pageKey);
  }

  return defaultSiteContent;
};

export const getSiteContent = async () => {
  const rows = await prisma.siteContent.findMany({ select: { pageKey: true, content: true }, orderBy: { pageKey: 'asc' } });

  if (rows.length === 0) {
    await ensureDefaultSiteContent();
    const seededRows = await prisma.siteContent.findMany({ select: { pageKey: true, content: true }, orderBy: { pageKey: 'asc' } });
    return Object.fromEntries(seededRows.map((row) => [row.pageKey, row.content]));
  }

  return Object.fromEntries(rows.map((row) => [row.pageKey, row.content]));
};

export const updateSiteContent = async ({ pageKey, content }) => {
  return prisma.siteContent.upsert({
    where: { pageKey },
    create: { pageKey, content },
    update: { content },
    select: { pageKey: true, content: true, updatedAt: true },
  });
};