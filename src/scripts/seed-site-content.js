import { prisma } from '../config/database.js';
import { ensureDefaultSiteContent } from '../services/siteContent.service.js';

const run = async () => {
  try {
    const result = await ensureDefaultSiteContent();
    console.log(`Site content seed checked. ${Object.keys(result).length} pages ensured.`);
    await prisma.$disconnect();
  } catch (error) {
    console.error('Site content seed failed:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
};

void run();
