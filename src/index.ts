/**
 * Server Entry Point
 *
 * Imports the configured Express app and starts the HTTP server.
 * Separated from app setup (app.ts) for testability.
 */

import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
