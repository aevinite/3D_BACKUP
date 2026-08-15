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

// ── A THIRD PROJECT EXISTS, IT IS STALE, AND IT MUST NOT BE ADDED ABOVE ──────────────────────────
//
// `.env.local`'s whole SUPABASE_DEV_* family (URL, PROJECT_REF, ANON, SERVICE_ROLE, ACCESS_TOKEN)
// points at a Supabase project called **lfh-saas-dev**, created 2026-06-25 — the original
// throwaway sandbox from the SaaS phase-1 work. It is not on the list above, so every script that
// reads those keys refuses, which is the correct outcome and also a confusing one: the refusal
// says "not a dev/test database" about a project genuinely named …-dev.
//
// MEASURED 2026-08-16, read-only, before writing this: it holds 31 public tables and 68 lfh_
// functions against backup-1's 166 — roughly a hundred migrations behind — and `staff_actions` has
// never recorded a single action. Nothing has used it since June.
//
// So the obvious "fix" — adding it to DEV_TEST_DBS — is the one thing that must not happen. The
// demo seeders and the migration applier would then run happily against a database ~100 migrations
// out of date, the output would look like success, and nothing anyone was testing would be true.
// It is named HERE, in the file whose whole job is naming stacks, so that decision can't be made by
// accident by someone who only sees a refusal message.
//
// WHAT TO USE INSTEAD, today:
//   · apply ONE migration to the working dev DB → `node scripts/run-migration.mjs <file>.sql`
//     (it reads NEXT_PUBLIC_SUPABASE_URL, i.e. backup-1, and is allow-listed)
//   · re-seed the working dev DB → `node scripts/seed-supabase.mjs` WITHOUT `--dev`
// If a sandbox is ever wanted again, point SUPABASE_DEV_* at a FRESH project, bring it up to the
// current migrations, and add its ref above deliberately — with this note updated to say so.
export const STALE_DEV_SANDBOX = "fkgzykfvopotpbcxuvcs"; // lfh-saas-dev — abandoned June 2026

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
    `  allowed   ${DEV_TEST_DBS.join(", ")}` +
    // SAY WHY, when we know why. A refusal that only prints two ids sends the reader to add the
    // one they were given — which for the stale sandbox is precisely the wrong move (see the long
    // note above DEV_TEST_DBS). Naming it here costs one line and closes that loop where it is
    // actually read: in the terminal, by the person who just got refused.
    (ref === STALE_DEV_SANDBOX
      ? `\n\n  That is lfh-saas-dev — the ABANDONED June-2026 sandbox that .env.local's SUPABASE_DEV_*\n` +
        `  keys still point at. It is ~100 migrations behind and nothing has used it since June, so\n` +
        `  do NOT add it to the allow-list. Use instead:\n` +
        `    node scripts/run-migration.mjs <file>.sql     (one migration → the working dev DB)\n` +
        `    node scripts/seed-supabase.mjs                (re-seed, WITHOUT --dev)`
      : "")
  );
  process.exit(1);
}
