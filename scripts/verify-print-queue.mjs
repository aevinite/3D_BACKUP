// verify-print-queue.mjs — auto-print is a QUEUE, and must never go back to being a tab noticing.
//
// WHY THIS EXISTS (owner, 2026-08-17). The kitchen has no room for a PC, so the kitchen panel sat in
// a Chrome tab on a shared computer: "if you minimize, or open another app in the same PC, the KOT
// prints totally stop". Four things switched printing off whenever that tab was not the front
// window — three of them OUR OWN CODE deliberately refusing to print while `document.hidden`, which
// was the honest thing to do back when a missed ticket was gone forever.
//
// Migration 335 removed the reason: a ticket is now a ROW in print_jobs (mig 269's durable queue), so
// a print that does not happen is requeued rather than lost, and TRYING is always right. Every check
// below is one half of that change that would look like a bug to somebody who did not read this file:
//
//   • the refusals are gone from the print path (they read like a safety net; they were the fault),
//   • the TARGETED ?table= slice carries the queue (a new order's breadcrumb NAMES its table, so the
//     targeted read is what answers it — without jobs=1 a ticket waited for the 60s backstop),
//   • an auto job raises NO breadcrumb of its own (it rides the order's, or every ticket costs every
//     panel a whole-floor reload),
//   • both routes claim through lib/printQueue.ts (two hand-kept claims is how a ticket prints twice),
//   • the printing screen keeps its socket + backstop while hidden, and ONLY the printing screen,
//   • the manager's per-device switch and its server-enforced backup window still exist.
//
// READ-ONLY, repo files only — no database, no login, no browser.
//
//   node scripts/verify-print-queue.mjs        (npm run verify:print-queue)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ok   " + m); };
const fail = (m) => { console.log("  FAIL " + m); failed++; };
const check = (cond, good, bad) => (cond ? pass(good) : fail(bad));

console.log("\nprint queue — a ticket is a row, and any screen can be the printer");

const mig = read("supabase/migrations/335_a_kitchen_ticket_queues_itself.sql");
const kroute = read("app/api/kitchen/[...path]/route.ts");
const eroute = read("app/api/editor/[...path]/route.ts");
const kpanel = read("public/panels/kitchen/app.js");
const epanel = read("public/panels/editor/app.js");
const rt = read("public/panels/realtime.js");
const lib = read("lib/printQueue.ts");

// ── 1. the database still queues the ticket ─────────────────────────────────────────────────────
check(/CREATE TRIGGER trg_kot_queue_autoprint\s+AFTER INSERT ON orders/i.test(mig),
  "mig 335 still queues a job on every new order (trigger on orders)",
  "mig 335 no longer creates trg_kot_queue_autoprint — nothing would queue a ticket and auto-print would go silent");
check(/auto_print_kot IS TRUE AND auto_print_kot_allowed IS TRUE/i.test(mig),
  "it queues only when BOTH mig-107 rungs are on (admin allowed + owner switched on)",
  "the trigger no longer checks both auto-print rungs — a restaurant that never asked for auto-print would print");
check(/deleted_at IS NOT NULL THEN RETURN NEW/i.test(mig),
  "a soft-deleted order queues nothing (a ticket off the books is not cooked again)",
  "the trigger lost its deleted_at guard — a removed bill could reach the printer");
check(/reprint\s*\)\s*\n?\s*VALUES[\s\S]{0,120}false/i.test(mig) || /'kot', NEW\.id, false/.test(mig),
  "an auto job is reprint=false, so a first ticket carries no DUPLICATE banner",
  "the auto job no longer sets reprint=false — every automatic ticket would print branded a duplicate");
check(/WHEN \(NEW\.reprint IS TRUE\)/.test(mig),
  "an auto job raises NO realtime breadcrumb (it rides the order's own event)",
  "rt_emit_print_jobs fires for auto jobs again — every ticket now forces a whole-floor reload on every panel (mig 335 removed exactly this cost)");
check(/REVOKE ALL ON FUNCTION lfh_kot_queue_autoprint\(\) FROM PUBLIC, anon, authenticated/i.test(mig),
  "the trigger function is revoked from PUBLIC, anon AND authenticated (verify:grants' rule)",
  "the trigger function's REVOKE no longer names anon+authenticated — on Supabase those are granted in their own right");

// ── 2. ONE implementation of the claim ──────────────────────────────────────────────────────────
for (const [name, src] of [["kitchen", kroute], ["editor", eroute]]) {
  check(/from "@\/lib\/printQueue"/.test(src),
    `${name} route claims through lib/printQueue.ts`,
    `${name} route no longer imports lib/printQueue — two hand-kept claims is how the same ticket prints twice`);
  check(!/from\("print_jobs"\)[\s\S]{0,200}\.update\(\{ status: "printing"/.test(src),
    `${name} route has no second, hand-rolled claim`,
    `${name} route flips a job to 'printing' itself instead of using claimKotJobs — the lock must live in one place`);
}
check(/\.or\(liveFilter\(\)\)[\s\S]*\.or\(liveFilter\(\)\)/s.test(lib),
  "what is OFFERED and what can be WON use the same live filter, so they cannot drift",
  "lib/printQueue no longer shares one filter between the read and the claim");
check(/minAgeMs/.test(lib) && /claimKotJobs[\s\S]{0,600}minAgeMs/.test(lib),
  "the backup-printer window is enforced at the CLAIM, server-side (a stale tab can't jump the kitchen's queue)",
  "claimKotJobs no longer enforces minAgeMs — 'backup only' would be a client-side promise");

// ── 3. the panels no longer refuse to print while hidden ────────────────────────────────────────
// CODE ONLY. The first version of this check read the function WITH its comments and failed on the
// comment that EXPLAINS why the refusal was removed ("this used to return early on document.hidden")
// — a guard that fails on its own explanation is a guard that teaches people to delete explanations.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
const procJobs = stripComments(kpanel.slice(kpanel.indexOf("function processPrintJobs"), kpanel.indexOf("function processPrintJobs") + 2200));
check(!/document\.hidden/.test(procJobs),
  "the kitchen's print path does NOT refuse to print while the window is hidden/covered",
  "processPrintJobs checks document.hidden again — that IS the owner's bug (a covered window printed nothing). A print that fails is requeued; refusing is what loses tickets");
check(!/function autoPrintNew\b/.test(kpanel) && /function autoPrintNet\b/.test(kpanel),
  "the old board-diff auto-print is gone; only the 20s NET remains",
  "autoPrintNew is back — the board diff and the queue would both print, twice per ticket");
check(/queuedFor/.test(kpanel) && /queuedFor/.test(kroute),
  "the net only prints an order the queue has NO row for (server-supplied queuedFor)",
  "the net no longer consults queuedFor — it can race the queue into a second sheet");
check(/\(j\.attempts \|\| 0\) > 0/.test(kpanel) && /\(j\.attempts \|\| 0\) > 0/.test(epanel),
  "a RETRY stamps the DUPLICATE banner on both panels (the first sheet may have printed)",
  "a retried ticket no longer says Duplicate — two identical tickets on the rail is the exact confusion the banner exists for");

// ── 4. a new order reaches the printer NOW, not on the 60s backstop ─────────────────────────────
check(/board\?table=" \+ encodeURIComponent\(t\) \+ jobsQ/.test(kpanel) && /state\.autoPrintKot \? "&jobs=1"/.test(kpanel),
  "the kitchen's TARGETED refetch asks for the queue while this screen is printing (&jobs=1)",
  "the targeted ?table= read no longer carries the queue — a new order's breadcrumb names its table, so its ticket would wait for the 60s backstop");
check(/searchParams\.get\("jobs"\) === "1"/.test(kroute),
  "the kitchen route answers ?jobs=1 on the targeted slice",
  "the kitchen route ignores ?jobs=1 — the panel would ask for the queue and be handed nothing");
check(/autojobs=1/.test(kpanel) && /searchParams\.get\("autojobs"\) === "1"/.test(kroute),
  "the panel-version handshake is intact (?autojobs=1): an OLD panel is never handed auto jobs",
  "the autojobs handshake is gone — a device still running last month's app.js would print every ticket twice");
check(/if (\(|!)?document\.hidden \|\| state\.autoPrintKot\)|!document\.hidden \|\| state\.autoPrintKot/.test(kpanel),
  "the 60s backstop keeps running on a hidden screen that is the printer",
  "the kitchen's 60s backstop skips a hidden tab again — the printing screen would have no heartbeat while covered");

// ── 5. the live socket survives a covered window, on the printing screen only ───────────────────
check(/keepAlive/.test(rt) && /holdOpen\(\)/.test(rt),
  "realtime.js honours keepAlive() — a screen that is printing keeps its channels while hidden",
  "realtime.js dropped keepAlive — a covered printing screen stops hearing about orders after 120s");
check(/keepAlive: \(\) => !!state\.autoPrintKot/.test(kpanel),
  "only a screen with auto-print ON holds the socket open (the egress rule still applies to displays)",
  "the kitchen holds its socket open unconditionally — that is the connection budget the owner asked us to protect");

// ── 6. the manager's own printer switch ─────────────────────────────────────────────────────────
check(/PRINT_HERE_KEY = "lfh_print_here"/.test(epanel) && /data-printhere-mode/.test(epanel),
  "the manager panel still offers the per-device switch (Off / Print here / Backup only)",
  "the manager's print-here switch is gone — the owner asked for exactly this");
check(/print-jobs" && path\[1\] === "pending"/.test(eroute) && /auto_print_kot_allowed/.test(eroute),
  "the manager's pending-jobs read exists and is gated on auto-print being live for the restaurant",
  "the manager's pending endpoint is missing or ungated");
check(/BACKUP_PRINTER_MS = 30000/.test(eroute),
  "'backup only' means 30 seconds, in one named place",
  "the backup window is no longer a named constant in the editor route");

console.log(failed
  ? `\n✗ ${failed} check(s) failed — read this file's header before 'fixing' the code\n`
  : "\n✓ a ticket is a row: it prints on a covered window, on either screen, exactly once\n");
process.exit(failed ? 1 : 0);
