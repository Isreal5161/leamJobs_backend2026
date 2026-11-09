import 'dotenv/config.js';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import cron from 'node-cron';
import { processJobAlerts } from './services/jobAlerts.service.js';
import { processPendingContractWebhookEvents } from './services/contractPayment.service.js';

const PORT = env.PORT || 5000;
const HOST = env.HOST || 'localhost';
const DATABASE_CONNECT_ATTEMPTS = 5;
const DATABASE_RETRY_DELAY_MS = 1000;

const connectDatabaseWithRetry = async () => {
  for (let attempt = 1; attempt <= DATABASE_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await connectDatabase();
      return;
    } catch (error) {
      if (attempt === DATABASE_CONNECT_ATTEMPTS) throw error;
      const delay = DATABASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
      console.error('Database connection attempt failed; retrying.', {
        attempt,
        errorName: typeof error?.name === 'string' ? error.name : 'Error',
        ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

/**
 * Start the server
 */
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabaseWithRetry();

    // Start Express server
    const server = app.listen(PORT, HOST, () => {
      console.log(`✓ Server running on http://${HOST}:${PORT}`);
      console.log(`✓ Environment: ${env.NODE_ENV}`);
    });

    let activeJobAlertProcessing = null;
    let activeContractWebhookRecovery = null;
    const jobAlertSchedule = cron.schedule('0 * * * *', () => {
      if (activeJobAlertProcessing) return;
      activeJobAlertProcessing = processJobAlerts()
        .catch((error) => console.error('Scheduled job alert processing failed:', {
          errorName: typeof error?.name === 'string' ? error.name : 'Error',
          ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
        }))
        .finally(() => { activeJobAlertProcessing = null; });
    }, { scheduled: env.NODE_ENV !== 'test' });
    const contractWebhookSchedule = cron.schedule('*/5 * * * *', () => {
      if (activeContractWebhookRecovery) return;
      activeContractWebhookRecovery = processPendingContractWebhookEvents()
        .catch((error) => console.error('Scheduled contract webhook recovery failed:', {
          errorName: typeof error?.name === 'string' ? error.name : 'Error',
          ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
        }))
        .finally(() => { activeContractWebhookRecovery = null; });
    }, { scheduled: env.NODE_ENV !== 'test' });

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received, shutting down gracefully...`);
      jobAlertSchedule.stop();
      contractWebhookSchedule.stop();
      server.close(async () => {
        await Promise.all([activeJobAlertProcessing, activeContractWebhookRecovery]);
        await disconnectDatabase();
        console.log('Server closed');
        process.exit(0);
      });
    };

    // Graceful shutdown - SIGTERM
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Graceful shutdown - SIGINT (Ctrl+C)
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', {
      errorName: typeof error?.name === 'string' ? error.name : 'Error',
      ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
    });
    process.exit(1);
  }
};

// Start the server
startServer();
