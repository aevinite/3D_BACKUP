// scripts/sweep/restore.mjs — PUT THE WORLD BACK EVEN WHEN NOTHING ASKS US TO.
//
// WHY THIS EXISTS (sweep #7 / T28, 2026-08-27).
//
// Five guards change a REAL, VISIBLE setting on a real restaurant and then change it back:
//
//   verify-customers          · "print the customer's details on the bill", switched OFF and on
//   verify-owner-territory-live · the restaurant's owner_entitlements — which screens the owner sees
//   verify-printing-sweep     · the printing routes, the auto-print switches, manager_permissions
//   verify-realtime           · a dish's title, and settings.updated_at
//   verify-rota-clash         · a waiter's table rota
//
// Every one of them puts it back at the end, and every one of them was still one interruption away
// from leaving it wrong. `finally` covers a throw. It does not cover Ctrl-C, and it does not cover
// a lane runner that kills a guard because it ran past its timeout — which is precisely how this
// project's own scar happened: verify:realtime switched a category off across seven restaurants and
// then died two steps later. The sweep rules name it: "restore it in a `finally` AND on
// SIGINT/SIGTERM".
//
// I watched a smaller version of it on 2026-08-27: verify-rota-clash's restore was inside `finally`
// and the restore ITSELF timed out, leaving a waiter holding the two tables the test had given them
// instead of their real thirty.
//
//   import { restoreOnExit } from "./sweep/restore.mjs";
//   const was = (await read()).value;
//   restoreOnExit("French House · bill_customer_print", () => write(was));
//
// HONEST LIMIT, stated rather than implied: `SIGKILL` (kill -9, and what a hard timeout usually
// sends) cannot be caught by any process, so nothing here can survive it. What this covers is the
// interruptions that CAN be caught — Ctrl-C, a polite terminate, and a crash the guard did not
// expect — which is every one this repo has actually been bitten by.

const jobs = [];        // [name, fn] — put back in REVERSE order, so the last change goes first
let wired = false;
let ran = false;

async function runAll(why) {
  if (ran || !jobs.length) return;
  ran = true;
  console.error(`\n  ${why} — putting the world back before leaving (${jobs.length} thing(s))`);
  for (const [name, fn] of [...jobs].reverse()) {
    try { await fn(); console.error(`    · put back: ${name}`); }
    // A failure here is the thing a person MUST see: it is the difference between "we tidied up"
    // and "a restaurant is left with a test's settings". Never swallowed.
    catch (e) { console.error(`    ❌ COULD NOT PUT BACK ${name} — ${String(e && e.message || e).slice(0, 160)}`); }
  }
}

/**
 * Register a put-back for a change this run has just made. It runs if the process is interrupted
 * or crashes; on a normal finish the guard's own teardown has already done it, so nothing fires.
 */
export function restoreOnExit(name, fn) {
  if (!wired) {
    wired = true;
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, async () => { await runAll(`interrupted (${sig})`); process.exit(130); });
    }
    process.on("uncaughtException", async (e) => {
      console.error("\n  crashed: " + String(e && e.message || e).slice(0, 200));
      await runAll("crashed"); process.exit(1);
    });
    process.on("unhandledRejection", async (e) => {
      console.error("\n  a promise was rejected and nobody caught it: " + String(e && e.message || e).slice(0, 200));
      await runAll("crashed"); process.exit(1);
    });
  }
  jobs.push([name, fn]);
}

/** Run the registered put-backs now (for a guard that would rather have one place for both paths). */
export const restoreNow = () => runAll("finished");

/** How many put-backs are registered — so a guard's own test can prove it registered one. */
export const pendingRestores = () => jobs.length;
