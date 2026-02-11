require('dotenv').config({ override: true });

const db = require('./config/database');

async function main() {
  await db._ready;
  // Schema is auto-created by the DB layer; this script exists to make `pnpm seed` reliable.
  console.log('✅ Database ready (schema ensured)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
