#!/usr/bin/env node
/**
 * local-db-validate.mjs
 *
 * Validates ALL supabase/migrations/*.sql files against a LOCAL throwaway
 * PostgreSQL cluster (no Supabase cloud, no secrets).
 *
 * Usage:
 *   node scripts/local-db-validate.mjs
 *
 * Requirements:
 *   - PostgreSQL 17 installed via Homebrew at /opt/homebrew/opt/postgresql@17
 *   - A running cluster on port 55432 started with:
 *       /opt/homebrew/opt/postgresql@17/bin/pg_ctl \
 *         -D /private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-localpg \
 *         -l <logfile> -o "-p 55432" start
 *   - Bootstrap SQL at:
 *       /private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-bootstrap.sql
 *
 * To re-run after editing a migration:
 *   node scripts/local-db-validate.mjs
 *
 * The script drops + recreates lfh_dev each run, so it is fully idempotent.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────
const PG_BIN     = '/opt/homebrew/opt/postgresql@17/bin';
const PSQL       = `${PG_BIN}/psql`;
const PORT       = '55432';
const SUPERUSER  = 'lfh_super';          // the initdb superuser
const DB_NAME    = 'lfh_dev';

const SCRIPT_DIR  = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT   = resolve(SCRIPT_DIR, '..');
const MIGRATIONS  = join(REPO_ROOT, 'supabase', 'migrations');
const BOOTSTRAP   = '/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-bootstrap.sql';

// ── Helpers ───────────────────────────────────────────────────────────────────
function psql(db, sql, opts = {}) {
  const args = [
    '-h', 'localhost',
    '-p', PORT,
    '-U', SUPERUSER,
    '-d', db,
    '-v', 'ON_ERROR_STOP=1',
    ...(opts.file ? ['-f', opts.file] : ['-c', sql]),
  ];
  return spawnSync(PSQL, args, { encoding: 'utf8' });
}

function die(msg) {
  console.error(`\n❌  FAIL: ${msg}`);
  process.exit(1);
}

// ── 1. Verify the cluster is reachable ───────────────────────────────────────
console.log(`\nConnecting to local cluster on port ${PORT} …`);
{
  const r = psql('postgres', 'SELECT 1');
  if (r.status !== 0) {
    die(
      `Cannot reach cluster on port ${PORT}.\n` +
      `Start it with:\n` +
      `  ${PG_BIN}/pg_ctl -D /private/tmp/claude-501/...scratchpad/lfh-localpg -l /tmp/pg.log -o "-p ${PORT}" start\n\n` +
      (r.stderr || r.stdout)
    );
  }
}
console.log('  cluster OK\n');

// ── 2. Drop & recreate lfh_dev ────────────────────────────────────────────────
console.log(`Recreating database "${DB_NAME}" …`);
{
  // Terminate any open connections (safe — this is a throwaway db)
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`);
  psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME}`);
  const r = psql('postgres', `CREATE DATABASE ${DB_NAME} WITH OWNER ${SUPERUSER}`);
  if (r.status !== 0) die(`CREATE DATABASE failed:\n${r.stderr}`);
}
console.log(`  "${DB_NAME}" created\n`);

// ── 3. Bootstrap (roles, extensions, publication, auth stub) ─────────────────
console.log('Applying bootstrap (roles, pgcrypto, publication, auth stub) …');
{
  const r = psql(DB_NAME, '', { file: BOOTSTRAP });
  if (r.status !== 0) die(`Bootstrap failed:\n${r.stderr}`);
}
console.log('  bootstrap OK\n');

// ── 4. Collect & sort migrations ─────────────────────────────────────────────
const files = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .sort()   // lexicographic = correct numeric order for NNN_ prefix scheme
  .map(f  => join(MIGRATIONS, f));

console.log(`Found ${files.length} migration files.\n`);
console.log('─'.repeat(60));

// ── 5. Apply each migration ───────────────────────────────────────────────────
let passed = 0;
for (const filePath of files) {
  const name = filePath.split('/').pop();
  const r = psql(DB_NAME, '', { file: filePath });
  if (r.status !== 0) {
    console.error(`❌  FAIL at ${name}\n`);
    console.error('─── PSQL ERROR ──────────────────────────────────────────');
    console.error(r.stderr || r.stdout);
    console.error('─────────────────────────────────────────────────────────');
    console.error(`\nFAIL at ${name}  (${passed}/${files.length} migrations applied before failure)`);
    process.exit(1);
  }
  console.log(`✓  ${name}`);
  passed++;
}

// ── 6. Summary ────────────────────────────────────────────────────────────────
console.log('─'.repeat(60));
console.log(`\n✅  PASS (${passed} migrations)\n`);
