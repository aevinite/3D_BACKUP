// scripts/sweep/fixture.mjs — SEAT A PARTY, AND ALWAYS CLEAR IT UP.
//
// WHY (sweep #6 / T28, 2026-08-22). Several guards need a table with a live party in order to have
// anything to look at, and they used to go hunting for whatever happened to be on the floor:
//
//   · verify:sweep-extras phase 5465 (the waiter tablet's KOT ▾ button) reported
//     "❌ no table with a party on the floor right now — cannot exercise it", so it passed only while
//     some OTHER guard's leftover was still sitting there. 5466-5468 hang off it, so four checks had
//     never run at all.
//   · verify:tablet-floor picked "the first tile that is not free" and then demanded the full
//     table-operations row and the ‹ › stepper. A tile can be non-free with its SESSION already
//     closed — the ops row needs an open session — and the stepper only appears with TWO busy tables.
//     Three checks failed on a floor that was behaving perfectly.
//
// A guard that depends on litter is worse than a guard that skips: it goes green for the wrong reason
// and red when the house is finally tidy. So it seats its own, on a table nothing else uses
// (scripts/sweep/fixtureTables.mjs), and retires it the way a real cancellation does — mig 190 refuses
// a hard delete of anything carrying a KOT or a bill number, which is what made every hand-rolled
// teardown in this folder quietly fail.
//
//   import { seatParty, retireTables } from "./sweep/fixture.mjs";
//   const seated = await seatParty(["9965", "9966"]);      // returns the tables that took an order
//   …
//   await retireTables(["9965", "9966"]);                   // in a finally, and on a crash

import { readFileSync } from "node:fs";

const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the only one written to

const env = (() => {
  try {
    const t = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const g = (k) => (t.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    return { url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("SUPABASE_SERVICE_ROLE_KEY") };
  } catch { return {}; }
})();

export const fixtureReady = () => !!(env.url && env.key);

const rest = async (path, method = "GET", body) => {
  const r = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${txt.slice(0, 160)}`);
  return txt ? JSON.parse(txt) : null;
};

/**
 * Retire everything on these tables: cancel + archive the orders, close + soft-delete the sessions,
 * and dismiss the kitchen tickets those orders queued. Never throws — a teardown that dies halfway is
 * worse than one that says what it could not do.
 */
export async function retireTables(tables, log = console.log) {
  if (!fixtureReady()) return;
  const list = [...new Set(tables.map(String))];
  const now = new Date().toISOString();
  for (const t of list) {
    try {
      const ours = (await rest(`orders?restaurant_id=eq.${RID}&table_number=eq.${encodeURIComponent(t)}&select=id`)) || [];
      await rest(`orders?restaurant_id=eq.${RID}&table_number=eq.${encodeURIComponent(t)}&archived=is.false`, "PATCH",
        { status: "cancelled", archived: true, archived_at: now, cancelled_at: now });
      await rest(`sessions?restaurant_id=eq.${RID}&table_number=eq.${encodeURIComponent(t)}&status=eq.open`, "PATCH",
        { status: "closed", closed_at: now, deleted_at: now });
      // The tickets those orders queued. Nothing polls the print basket on a stack with no kitchen
      // screen open, so lib/printQueue's own "cancelled before this ticket printed" dismissal never
      // runs, and the manager's floor keeps a red "hasn't printed" banner for each. Same wording.
      const mine = new Set(ours.map((o) => o.id));
      const queued = (await rest(`print_jobs?restaurant_id=eq.${RID}&status=eq.queued&select=id,order_id&limit=200`)) || [];
      for (const j of queued.filter((j) => mine.has(j.order_id))) {
        await rest(`print_jobs?restaurant_id=eq.${RID}&id=eq.${j.id}`, "PATCH",
          { status: "dismissed", done_at: now, error: "the order was cancelled before this ticket printed" });
      }
    } catch (e) { log(`   fixture: table ${t} would not clear — ${String(e.message).slice(0, 140)}`); }
  }
}

/**
 * Put one real round on each table, through the waiter's own RPC — the same call the tablet makes.
 * Clears the slate first, so a crashed earlier run cannot block the one-open-session-per-table index.
 * Returns the tables that actually took an order.
 */
export async function seatParty(tables, log = console.log) {
  if (!fixtureReady()) { log("   fixture: no .env.local keys, so no party could be seated"); return []; }
  const list = [...new Set(tables.map(String))];
  await retireTables(list, log);
  const seated = [];
  try {
    const dishes = (await rest(`menu_items?restaurant_id=eq.${RID}&select=id&limit=${list.length + 1}`)) || [];
    if (!dishes.length) { log("   fixture: the test restaurant has no dishes to order"); return []; }
    for (let i = 0; i < list.length; i++) {
      const dish = dishes[i % dishes.length];
      const placed = await rest("rpc/lfh_staff_place_order", "POST", {
        p_table: list[i], p_items: [{ id: dish.id, qty: i + 1 }], p_allergies: [], p_note: null,
        // Named, never left to the RPC's default; and confirmed, because two rounds of the same dish
        // inside three seconds are one order to this app (its double-tap guard).
        p_restaurant_id: RID, p_confirm_duplicate: true,
      });
      if (placed && placed.ok === true) seated.push(list[i]);
      else log(`   fixture: table ${list[i]} refused the order — ${JSON.stringify(placed)}`);
    }
  } catch (e) { log(`   fixture: could not seat a party — ${String(e.message).slice(0, 140)}`); }
  return seated;
}

/** Register the crash paths once, so a fixture can never be left on the floor by an exception. */
export function retireOnCrash(tables, log = console.log) {
  for (const sig of ["uncaughtException", "unhandledRejection"]) {
    process.on(sig, async (e) => {
      log(`\n${sig}: ${e && e.message ? e.message : e}`);
      await retireTables(tables, log);
      process.exit(1);
    });
  }
}
