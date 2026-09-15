import { disconnectDatabase, prisma } from '../config/database.js';
import { expireSubscriptions } from '../services/subscriptionLifecycle.service.js';

try {
  await prisma.$connect();
  const expiredCount = await expireSubscriptions({ client: prisma });
  console.log(`Expired ${expiredCount} subscription(s).`);
} catch (error) {
  console.error('Subscription expiration failed:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
