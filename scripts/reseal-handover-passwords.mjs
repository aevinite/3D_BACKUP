#!/usr/bin/env node
// reseal-handover-passwords — move every stored handover password from the OLD vault key (v1, derived from
// the database's service key) onto the vault's OWN key (v2, CREDENTIAL_VAULT_KEY). Sweep #10 T17 item 14,
// owner picked 2026-10-08. Why: until this runs, rotating the service key would turn every handover sheet
// into "not stored yet". lib/passwordVault.ts explains the two keys.
//
// SAFE BY CONSTRUCTION:
//   · DRY RUN BY DEFAULT — it only counts. Pass --write to change anything.
//   · Nothing is lost if it stops halfway: the app opens v1 AND v2 copies, so a half-moved table reads exactly
//     like a fully moved one. Re-running simply continues.
//   · First save wins: each row is updated only `.eq("password_shown", <the value it read>)`, so a password
//     somebody changed meanwhile is never overwritten with an older one.
//   · A copy that cannot be opened is LEFT ALONE and counted — never blanked, never guessed.
//   · Never prints a password, a key or a sealed value. Counts only.
//
// Usage:  node --experimental-strip-types --no-warnings scripts/reseal-handover-passwords.mjs [--write]
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CREDENTIAL_VAULT_KEY from the environment,
// else from ./.env.local. It refuses to start without CREDENTIAL_VAULT_KEY (there would be nothing to move to).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* the environment may already carry everything */ }

const WRITE = process.argv.includes("--write");
if (!process.env.CREDENTIAL_VAULT_KEY || process.env.CREDENTIAL_VAULT_KEY.length < 16) {
  console.error("✗ CREDENTIAL_VAULT_KEY is not set (or shorter than 16 characters) — there is no new key to move the copies to.");
  process.exit(2);
}
const { createClient } = createRequire(join(ROOT, "package.json"))("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const V = await import(pathToFileURL(join(ROOT, "lib/passwordVault.ts")).href);

let seen = 0, moved = 0, unreadable = 0, changedMeanwhile = 0, failed = 0;
const PAGE = 500;
// Keyset paging (after the last id seen), so moving a row out of the "v1$" filter never shifts the window.
let after = "00000000-0000-0000-0000-000000000000";
for (;;) {
  const { data, error } = await sb.from("staff_users").select("id, password_shown")
    .like("password_shown", "v1$%").gt("id", after).order("id").limit(PAGE);
  if (error) { console.error("✗ could not read the stored copies:", error.message); process.exit(1); }
  for (const row of data || []) {
    seen++;
    after = row.id;
    if (!V.needsReseal(row.password_shown)) continue;
    const plain = await V.openPassword(row.password_shown);
    if (plain === null) { unreadable++; continue; }
    const sealed = await V.sealPassword(plain);
    if (!sealed || !sealed.startsWith("v2$") || (await V.openPassword(sealed)) !== plain) { failed++; continue; }
    if (!WRITE) { moved++; continue; }
    const up = await sb.from("staff_users").update({ password_shown: sealed })
      .eq("id", row.id).eq("password_shown", row.password_shown).select("id");
    if (up.error) failed++;
    else if (!up.data?.length) changedMeanwhile++;
    else moved++;
  }
  if (!data || data.length < PAGE) break;
}
console.log(`${WRITE ? "✓ resealed" : "dry run — would reseal"}: ${moved} of ${seen} old-key copies · unreadable (left alone): ${unreadable} · changed meanwhile (skipped): ${changedMeanwhile} · failed: ${failed}`);
process.exit(failed ? 1 : 0);
