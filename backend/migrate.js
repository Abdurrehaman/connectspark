require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const schema = `
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reported_ip TEXT NOT NULL,
  reporter_ip TEXT NOT NULL,
  reason TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bans (
  id SERIAL PRIMARY KEY,
  ip TEXT UNIQUE NOT NULL,
  banned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_ip ON reports(reported_ip);
CREATE INDEX IF NOT EXISTS idx_bans_ip ON bans(ip);
`;

async function runWithRetry(retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Running migration on Neon database (Attempt ${i + 1}/${retries})...`);
      await db.query(schema);
      console.log('✅ Migration successful! Database is ready.');
      return;
    } catch (err) {
      console.error(`❌ Migration attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw err;
      console.log(`Waiting ${delayMs}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

runWithRetry()
  .catch(err => console.error('Final migration failure:', err))
  .finally(() => db.end());
