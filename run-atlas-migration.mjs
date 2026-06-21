import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

const statements = [
  // Atlas enums
  `DO $$ BEGIN
    CREATE TYPE "AtlasAnalysisType" AS ENUM ('BIOMARKER_TREND','PROTOCOL_EFFICACY','INTAKE_PATTERN','VAULT_SUMMARY','LONGITUDINAL_HEALTH','SYMPTOM_CORRELATION','CUSTOM');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`,

  `DO $$ BEGIN
    CREATE TYPE "AtlasStatus" AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`,

  // atlas_analyses table
  `CREATE TABLE IF NOT EXISTS "atlas_analyses" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "clientId"        TEXT NOT NULL,
    "requestedById"   TEXT NOT NULL,
    "analysisType"    "AtlasAnalysisType" NOT NULL,
    "customPrompt"    TEXT,
    "dateRangeStart"  TIMESTAMPTZ,
    "dateRangeEnd"    TIMESTAMPTZ,
    "dataSnapshot"    JSONB,
    "status"          "AtlasStatus" NOT NULL DEFAULT 'PENDING',
    "result"          TEXT,
    "errorMessage"    TEXT,
    "modelUsed"       TEXT,
    "tokensUsed"      INTEGER,
    "processingMs"    INTEGER,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completedAt"     TIMESTAMPTZ,
    CONSTRAINT "atlas_analyses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "atlas_analyses_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id")
  );`,

  // atlas_review_history table
  `CREATE TABLE IF NOT EXISTS "atlas_review_history" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "analysisId"    TEXT NOT NULL,
    "reviewedById"  TEXT NOT NULL,
    "action"        TEXT NOT NULL,
    "annotation"    TEXT,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "atlas_review_history_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "atlas_analyses"("id") ON DELETE CASCADE,
    CONSTRAINT "atlas_review_history_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  );`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS "atlas_analyses_clientId_idx" ON "atlas_analyses"("clientId");`,
  `CREATE INDEX IF NOT EXISTS "atlas_analyses_requestedById_idx" ON "atlas_analyses"("requestedById");`,
  `CREATE INDEX IF NOT EXISTS "atlas_analyses_analysisType_idx" ON "atlas_analyses"("analysisType");`,
  `CREATE INDEX IF NOT EXISTS "atlas_analyses_createdAt_idx" ON "atlas_analyses"("createdAt");`,
  `CREATE INDEX IF NOT EXISTS "atlas_review_history_analysisId_idx" ON "atlas_review_history"("analysisId");`,
  `CREATE INDEX IF NOT EXISTS "atlas_review_history_reviewedById_idx" ON "atlas_review_history"("reviewedById");`,
];

await client.connect();
console.log('Connected to database');

for (const [i, sql] of statements.entries()) {
  try {
    await client.query(sql);
    console.log(`✓ Step ${i + 1}/${statements.length}`);
  } catch (err) {
    console.error(`✗ Step ${i + 1} failed:`, err.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log('Atlas migration complete ✓');
