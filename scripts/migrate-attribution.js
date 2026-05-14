const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:sRwiURMdJiKGcxtQ@db.treeujtluzsfoktsrwlr.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL');

  const migrations = [
    // ── uploads ──────────────────────────────────────────────────────────────
    `ALTER TABLE uploads
       ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "createdByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "updatedByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "createdByName"   TEXT`,

    // ── protocols ─────────────────────────────────────────────────────────────
    `ALTER TABLE protocols
       ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "createdByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "updatedByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "createdByName"   TEXT,
       ADD COLUMN IF NOT EXISTS "updatedByName"   TEXT`,

    // ── protocol_versions ─────────────────────────────────────────────────────
    `ALTER TABLE protocol_versions
       ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "createdByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "createdByName"   TEXT`,

    // ── messages ──────────────────────────────────────────────────────────────
    // Messages already have senderId/sender — add role snapshot for immutability
    `ALTER TABLE messages
       ADD COLUMN IF NOT EXISTS "senderRole"      TEXT,
       ADD COLUMN IF NOT EXISTS "senderName"      TEXT`,

    // ── timeline_events ───────────────────────────────────────────────────────
    `ALTER TABLE timeline_events
       ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "createdByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "createdByName"   TEXT`,

    // ── biomarker_logs ────────────────────────────────────────────────────────
    `ALTER TABLE biomarker_logs
       ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
       ADD COLUMN IF NOT EXISTS "createdByRole"   TEXT,
       ADD COLUMN IF NOT EXISTS "createdByName"   TEXT`,

    // ── indexes for audit queries ─────────────────────────────────────────────
    `CREATE INDEX IF NOT EXISTS idx_uploads_created_by ON uploads ("createdByUserId")`,
    `CREATE INDEX IF NOT EXISTS idx_protocols_created_by ON protocols ("createdByUserId")`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_created_by ON timeline_events ("createdByUserId")`,
  ];

  for (const sql of migrations) {
    console.log('Running:', sql.slice(0, 80).replace(/\n/g, ' ') + '...');
    await client.query(sql);
    console.log('  ✓ OK');
  }

  console.log('\nAll attribution columns added successfully.');
  await client.end();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
