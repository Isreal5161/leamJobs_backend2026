import 'dotenv/config.js';
import app from './app.js';
import { env } from './config/env.js';

const PORT = env.PORT || 5000;
const HOST = env.HOST || 'localhost';

const server = app.listen(PORT, HOST, () => {
  console.log(`✓ Server running on http://${HOST}:${PORT}`);
  console.log(`✓ Environment: ${env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
