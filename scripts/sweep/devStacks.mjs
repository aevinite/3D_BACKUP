// WHICH DATABASES THIS TEST RIG IS ALLOWED TO WRITE TO — one list, one place.
//
// Several scripts place real orders, flip real settings and delete rows they created. Each one
// used to carry its OWN copy of a single hard-coded project id, and the copies said "the dev
// database", singular. That was true when there was one dev stack. There are now TWO:
//
//   backup-1  wnsfcizclkbobwzcxqsf   → 3-d-backup.vercel.app     (the .env.local pair)
//   backup-2  jhhqzexlpzzwoqnzrgje   → 3d-backup-2.vercel.app    (the failover, its own Supabase)
//
// Backup-2 is not a curiosity: when backup-1's Vercel hits its 100-deploys-per-day cap, backup-2
// is where a merged fix actually goes live, so it is the only place that fix CAN be checked
// (owner, 2026-08-05: "if backup one limit is over, deploy everything on backup two and check on
// backup two"). With the id pinned in each script, every write-capable phase refused there and the
// suite reported ~60 red phases that were nothing but the guard saying no.
//
// This is an ALLOW-LIST, deliberately, and it stays one:
//   · AV live (kclqkmdxnwlhtyrducku) is NOT here and must never be added. It has paying clients.
//   · Anything not listed is refused. A new stack is a deliberate edit to this file, by a person
//     who has read this comment — never a wildcard, never "whatever .env.local says".
export const DEV_TEST_DBS = ["wnsfcizclkbobwzcxqsf", "jhhqzexlpzzwoqnzrgje"];

// The AV LIVE project, named so a caller can say "is this the live one?" without repeating the id.
export const AV_LIVE_DB = "kclqkmdxnwlhtyrducku";

/** The Supabase project ref inside a URL (or "(none)" when there isn't one). */
export function dbRefOf(url) {
  return String(url || "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || "(none)";
}

/** True only for a database this rig may write to. */
export function isDevTestDb(url) {
  return DEV_TEST_DBS.includes(dbRefOf(url));
}

/**
 * The one-line refusal a write-capable script prints before exiting. Kept here so every script
 * says the same thing and names what it saw — a refusal that does not say which database it got
 * is the reason this took an hour to diagnose the first time.
 */
export function refuseUnlessDevTestDb(url, what = "this test places real orders") {
  if (isDevTestDb(url)) return;
  const ref = dbRefOf(url);
  console.error(
    `refusing: ${what} and may only run against a dev/test database.\n` +
    `  got       ${ref}${ref === AV_LIVE_DB ? "  ← AV LIVE. Never." : ""}\n` +
    `  allowed   ${DEV_TEST_DBS.join(", ")}`
  );
  process.exit(1);
}
