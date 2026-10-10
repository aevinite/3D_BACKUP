// Block D — the database functions my half calls, and two measurements (P179701–P179727).
// One read-only statement each against the DEV database (scoped, limited). Never AV live.
//   P179701–P179725  each function exists and only the server may run it (no anon / authenticated)
//   P179726          the data: how many orders carry a cancel time but are no longer cancelled (item 1)
//   P179727          the data: which restaurants give managers a discount limit below 100% (item 4)
import { check, sql, MC } from "./lib.mjs";

// FROZEN to the 25 the route called on 2026-10-09, so each keeps its own id. A function the route
// starts calling later gets a NEW id in a later block (round 3: lfh_price_order → P211xxx), never a
// slot in this list — sorting a grown list would hand every later id to a different function.
const FNS = ["lfh_banquet_bill_create","lfh_banquet_place_order","lfh_cancel_classify","lfh_capture_customer","lfh_delete_order_item",
  "lfh_generate_invoice","lfh_issue_credit_note","lfh_platform_insert","lfh_platform_set_status","lfh_record_removal","lfh_reopen_table",
  "lfh_staff_add_item_to_order","lfh_staff_bill_discount","lfh_staff_edit_item_note","lfh_staff_edit_item_qty","lfh_staff_mark_placed",
  "lfh_staff_merge_tables","lfh_staff_move_order","lfh_staff_move_order_item","lfh_staff_open_table","lfh_staff_place_order",
  "lfh_staff_shift_table","lfh_staff_unmerge_table","lfh_uncapture_customer","lfh_void_invoice"];
export const CALLED_NOW = [...new Set([...MC.matchAll(/sb\.rpc\("([a-z_0-9]+)"/g)].map((m) => m[1]))].sort();
let acl = null;
const acls = async () => {
  if (!acl) {
    const list = FNS.map((f) => `'${f}'`).join(",");
    const rows = await sql(`select p.proname, array_to_string(p.proacl, ',') acl, p.prosecdef sd from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${list}) limit 200`);
    acl = new Map(rows.map((r) => [r.proname, r]));
  }
  return acl;
};
let n = 179701;
for (const fn of FNS.slice(0, 25)) {
  check(`P${n++}`, `${fn} — exists, and only the server may run it`, "DB · pg_proc.proacl (read-only, dev)",
    async () => { const m = await acls(); const r = m.get(fn); if (!r) return { ok: false, note: "not in the database" };
      const a = r.acl || "";
      const open = /(^|,)=X|anon=|authenticated=|PUBLIC/.test(a);
      return { ok: !open && /service_role=X/.test(a), note: a || "(default ACL — PUBLIC may execute)" }; }, "`supabase/migrations/` (the function) · called from `app/api/editor/[...path]/route.ts`");
}
check("P179726", "the data: orders that carry a cancel time while no longer cancelled — the shape item 1's doors leave behind", "DB · count, dev, with how fast each was made",
  async () => { const rows = await sql(`select r.slug, (extract(epoch from (o.cancelled_at - o.created_at)) < 60) rig from orders o join restaurants r on r.id = o.restaurant_id where o.cancelled_at is not null and o.status <> 'cancelled' limit 200`);
    const rig = rows.filter((r) => r.rig).length;
    return { ok: true, note: `MEASURED: ${rows.length} such order(s); ${rig} were created AND cancelled inside one minute (test-script rows, not a person) — ${rows.length - rig} look like real use` }; });
check("P179727", "the data: which restaurants give managers a discount limit below 100% (where item 4 bit)", "DB · restaurants.access_config, dev",
  async () => { const rows = await sql(`select slug, (access_config->'give_discounts'->'limit'->>'manager')::numeric cap from restaurants where (access_config->'give_discounts'->'limit'->>'manager') is not null limit 50`);
    const low = rows.filter((r) => Number(r.cap) < 100);
    return { ok: true, note: `${low.length} of ${rows.length} with a stored manager limit are below 100%: ${low.map((r) => `${r.slug} ${r.cap}%`).join(", ")}; with none stored the default is 50%` }; });
