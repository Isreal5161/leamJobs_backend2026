import 'dotenv/config.js';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import cron from 'node-cron';
import { processJobAlerts } from './services/jobAlerts.service.js';
import { processPendingContractWebhookEvents } from './services/contractPayment.service.js';

const PORT = env.PORT || 5000;
const HOST = env.HOST || 'localhost';

/**
 * Start the server
 */
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();

    // Start Express server
    const server = app.listen(PORT, HOST, () => {
      console.log(`✓ Server running on http://${HOST}:${PORT}`);
      console.log(`✓ Environment: ${env.NODE_ENV}`);
    });

    let activeContractWebhookRecovery = null;
    const jobAlertSchedule = cron.schedule('0 * * * *', () => {
      void processJobAlerts().catch((error) => console.error('Scheduled job alert processing failed:', error.message));
    }, { scheduled: env.NODE_ENV !== 'test' });
    const contractWebhookSchedule = cron.schedule('*/5 * * * *', () => {
      if (activeContractWebhookRecovery) return;
      activeContractWebhookRecovery = processPendingContractWebhookEvents()
        .catch(() => console.error('Scheduled contract webhook recovery failed'))
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
        await activeContractWebhookRecovery;
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
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Start the server
startServer();
