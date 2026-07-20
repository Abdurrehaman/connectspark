require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const schema = `
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  screen_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friends (
  user_id_1 TEXT NOT NULL,
  user_id_2 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id_1, user_id_2)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friends_u1 ON friends(user_id_1);
CREATE INDEX IF NOT EXISTS idx_friends_u2 ON friends(user_id_2);
CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id);
`;

async function runWithRetry(retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Running friends migration on Neon database (Attempt ${i + 1}/${retries})...`);
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
