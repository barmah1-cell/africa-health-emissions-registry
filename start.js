// Production startup script
// Runs migrations then starts the server with proper error handling

const { execSync } = require('child_process');

console.log('=== Starting deployment ===');
console.log('Node version:', process.version);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

try {
  console.log('Running migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('Migrations complete.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}

console.log('Loading application...');
try {
  require('./dist/index.js');
  console.log('Application loaded successfully.');
} catch (err) {
  console.error('Application failed to load:');
  console.error(err.stack || err.message || err);
  process.exit(1);
}
