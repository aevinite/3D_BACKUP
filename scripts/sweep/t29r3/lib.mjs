// t29r3/lib.mjs — SWEEP #9 · T29 · ROUND 3. Shared plumbing for the round that CALLS the functions
// instead of reading them.
//
// SAFETY, because this round is the first of the three that can touch data.
//   · `SAFE_TO_CALL` is a HAND-PICKED list, never a heuristic. The obvious heuristic — "its body has
//     no INSERT/UPDATE/DELETE" — says `lfh_next_counter` is read-only. It is not: it delegates to
//     `lfh_next_counter_on`, which writes, and calling it would BURN A REAL KOT NUMBER out of a live
//     restaurant's daily series. `lfh_place_order(6-arg)` is the same shape. Nothing goes on this
//     list without its delegates read.
//   · Restaurant #1 (French House) is the only one written to. Aangan is the read-only control.
//   · Anything that writes goes through scripts/sweep/fixture.mjs, which seats its own party on its
//     own tables and retires them the way a real cancellation does.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const g = (k) => (envText.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
export const RID = "00000000-0000-0000-0000-000000000001";          // My Little French House
export const sb = createClient(g("NEXT_PUBLIC_SUPABASE_URL"), g("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
export const anon = createClient(g("NEXT_PUBLIC_SUPABASE_URL"), g("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });

// Every function this round is allowed to CALL, and why each is safe. Read the delegates before
// adding one: a function is only read-only if everything it calls is too.
export const SAFE_TO_CALL = {
  lfh_nice_usd: "IMMUTABLE arithmetic, reads nothing",
  lfh_business_day: "IMMUTABLE date arithmetic",
  lfh_rid: "IMMUTABLE, raises or returns its argument",
  lfh_already_applied: "reads the ledger table",
  lfh_effective_tax_rate: "reads settings",
  lfh_geo_ok: "reads settings",
  lfh_is_blocked: "reads blocklist + customers",
  lfh_device_banned: "reads blocklist",
  lfh_check_ban: "reads blocklist",
  lfh_recognize_customer: "reads customers",
  lfh_table_status: "reads sessions + session_members",
  lfh_price_order: "STABLE; prices from menu_items and writes nothing — migration 031 granted it to anon for exactly this",
  get_order_status: "reads one order by id",
  lfh_session_state: "reads by token",
  lfh_get_cart: "reads by token",
  lfh_floor_state: "reads the floor",
  lfh_kitchen_tickets: "reads the kitchen's slice",
  lfh_table_view_summary: "reads one table",
};

export async function call(fn, args) {
  if (!SAFE_TO_CALL[fn]) throw new Error(`${fn} is not on SAFE_TO_CALL — read its delegates before adding it`);
  const { data, error } = await sb.rpc(fn, args);
  return { data, error: error ? (error.message || String(error)) : null };
}

export class Phases {
  // EACH ROW IS WRITTEN THE MOMENT IT IS DECIDED, not collected and printed at the end.
  // Two runs of the browser group died part-way — once at 113 of 154 rows — and took every row with
  // them, because the table was only assembled after the last check. A permanent numbered check that
  // was RUN but never recorded is indistinguishable from one nobody wrote, which is the same loss
  // item 17 was about, arrived at from the other side. `--out <file>` makes the rows survive a crash.
  constructor(start, out) {
    this.ids = start.slice(); this.i = 0; this.rows = []; this.failed = 0;
    this.quiet = process.argv.includes("--quiet");
    const flag = process.argv.indexOf("--out");
    this.out = out || (flag > -1 ? process.argv[flag + 1] : null);
    if (this.out) writeFileSync(this.out, "");
  }
  next() { if (this.i >= this.ids.length) throw new Error("ID BLOCK EXHAUSTED — stop and report, never take another terminal's range"); return this.ids[this.i++]; }
  add(check, how, ok, note) {
    const id = this.next();
    if (ok === false) this.failed++;
    this.rows.push({ id, check, how, result: ok === null ? "⏭" : ok ? "✅" : "❌", note: note == null ? "" : String(note) });
    if (!this.quiet || ok === false) console.log(`  ${ok === null ? "⏭" : ok ? "✓" : "✗"} ${id}  ${check}${note ? " — " + note : ""}`);
    if (this.out) { const r = this.rows[this.rows.length - 1]; appendFileSync(this.out, `| ${r.id} | ${r.check.replace(/\|/g, "\\|")} | ${r.how.replace(/\|/g, "\\|")} | ${r.result} | ${r.note.replace(/\|/g, "\\|").slice(0, 300)} |\n`); }
    return ok;
  }
  get used() { return this.i; }
  table() {
    return this.rows.map((r) => `| ${r.id} | ${r.check.replace(/\|/g, "\\|")} | ${r.how.replace(/\|/g, "\\|")} | ${r.result} | ${r.note.replace(/\|/g, "\\|").slice(0, 300)} |`).join("\n");
  }
}

// P148451-P148950: the rest of this terminal's pre-allocated round-2 block. Nothing claimed.
export const ID_BLOCK = Array.from({ length: 500 }, (_, i) => `P${148451 + i}`);
