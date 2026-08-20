/**
 * Server Entry Point
 *
 * Imports the configured Express app and starts the HTTP server.
 * Separated from app setup (app.ts) for testability.
 */

import app from './app';

const PORT = process.env.PORT || 3000;

console.log('Starting Africa Health Facilities server...');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

try {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

export default app;
