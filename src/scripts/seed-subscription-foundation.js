import { prisma } from '../config/database.js';
import { ensureDefaultSubscriptionFoundation } from '../services/subscriptionFoundation.service.js';

const run = async () => {
  try {
    const result = await ensureDefaultSubscriptionFoundation();
    console.log(`Subscription foundation seed checked. ${Object.keys(result.plans).length} plans and ${Object.keys(result.entitlements).length} entitlements ensured.`);
    await prisma.$disconnect();
  } catch (error) {
    console.error('Subscription foundation seed failed:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
};

void run();