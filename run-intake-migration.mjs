import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:sRwiURMdJiKGcxtQ@db.treeujtluzsfoktsrwlr.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log('Connected to database');

  const steps = [
    {
      name: 'Create IntakeEntryType enum',
      sql: `CREATE TYPE "IntakeEntryType" AS ENUM (
        'medication', 'supplement', 'meal', 'beverage', 'therapy',
        'exercise', 'symptom', 'sleep', 'protocol_action', 'biomarker_event', 'other'
      )`,
    },
    {
      name: 'Add intake_log_created to AuditAction',
      sql: `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'intake_log_created'`,
    },
    {
      name: 'Add intake_log_updated to AuditAction',
      sql: `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'intake_log_updated'`,
    },
    {
      name: 'Add intake_log_deleted to AuditAction',
      sql: `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'intake_log_deleted'`,
    },
    {
      name: 'Create intake_logs table',
      sql: `CREATE TABLE IF NOT EXISTS intake_logs (
        id TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "createdById" TEXT NOT NULL,
        "entryType" "IntakeEntryType" NOT NULL,
        name TEXT NOT NULL,
        dose TEXT,
        unit TEXT,
        route TEXT,
        notes TEXT,
        tags TEXT,
        "attachmentKey" TEXT,
        "attachmentUrl" TEXT,
        "eventAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT intake_logs_pkey PRIMARY KEY (id)
      )`,
    },
    {
      name: 'Create intake_log_edits table',
      sql: `CREATE TABLE IF NOT EXISTS intake_log_edits (
        id TEXT NOT NULL,
        "intakeLogId" TEXT NOT NULL,
        "editedById" TEXT NOT NULL,
        "fieldChanged" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "editedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT intake_log_edits_pkey PRIMARY KEY (id)
      )`,
    },
    {
      name: 'Index: intake_logs_userId_idx',
      sql: `CREATE INDEX IF NOT EXISTS intake_logs_userId_idx ON intake_logs("userId")`,
    },
    {
      name: 'Index: intake_logs_eventAt_idx',
      sql: `CREATE INDEX IF NOT EXISTS intake_logs_eventAt_idx ON intake_logs("eventAt")`,
    },
    {
      name: 'Index: intake_logs_entryType_idx',
      sql: `CREATE INDEX IF NOT EXISTS intake_logs_entryType_idx ON intake_logs("entryType")`,
    },
    {
      name: 'Index: intake_log_edits_intakeLogId_idx',
      sql: `CREATE INDEX IF NOT EXISTS intake_log_edits_intakeLogId_idx ON intake_log_edits("intakeLogId")`,
    },
    {
      name: 'FK: intake_logs -> users (userId)',
      sql: `ALTER TABLE intake_logs ADD CONSTRAINT intake_logs_userId_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`,
    },
    {
      name: 'FK: intake_logs -> users (createdById)',
      sql: `ALTER TABLE intake_logs ADD CONSTRAINT intake_logs_createdById_fkey FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE`,
    },
    {
      name: 'FK: intake_log_edits -> intake_logs',
      sql: `ALTER TABLE intake_log_edits ADD CONSTRAINT intake_log_edits_intakeLogId_fkey FOREIGN KEY ("intakeLogId") REFERENCES intake_logs(id) ON DELETE CASCADE ON UPDATE CASCADE`,
    },
    {
      name: 'FK: intake_log_edits -> users (editedById)',
      sql: `ALTER TABLE intake_log_edits ADD CONSTRAINT intake_log_edits_editedById_fkey FOREIGN KEY ("editedById") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE`,
    },
  ];

  for (const step of steps) {
    try {
      await client.query(step.sql);
      console.log(`✓ ${step.name}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  (already exists) ${step.name}`);
      } else {
        console.error(`✗ ${step.name}: ${err.message}`);
      }
    }
  }

  await client.end();
  console.log('\nMigration complete.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
