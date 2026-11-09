import 'dotenv/config.js';
import { disconnectDatabase, prisma } from '../config/database.js';
import { processPendingEmails } from '../services/email.service.js';

try {
  await prisma.$connect();
  const sent = await processPendingEmails({ client: prisma });
  console.log(`Processed ${sent} email delivery(ies).`);
} catch (error) {
  console.error('Email delivery processing failed:', {
    errorName: typeof error?.name === 'string' ? error.name : 'Error',
    ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
  });
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
