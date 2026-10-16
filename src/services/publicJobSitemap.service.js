import { prisma } from '../config/database.js';

const CANONICAL_ORIGIN = 'https://leamjobs.com';

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const getPublicJobSitemapXml = async () => {
  const jobs = await prisma.job.findMany({
    where: { status: 'APPROVED' },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: 50000,
  });

  const urls = jobs.map(({ id }) => (
    `  <url><loc>${escapeXml(`${CANONICAL_ORIGIN}/jobs/${encodeURIComponent(id)}`)}</loc></url>`
  ));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
};
