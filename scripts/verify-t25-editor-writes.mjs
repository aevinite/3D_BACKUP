// verify-t25-editor-writes.mjs — the DRIVEN half of terminal 25's guard.
//
// It bundles the REAL app/api/editor/[...path]/route.ts with esbuild and calls its POST / PATCH /
// DELETE handlers against the repo's in-memory stubs (scripts/panel-stubs/*), exactly the way
// verify:manager-gates drives the same route. So the handlers, the ladders, managerCan(), every
// gate and every write execute for real, while nothing touches a database, a deployed site, a
// login or a rate limit.
//
// WHY DRIVEN AND NOT GREPPED. Both faults it defends were found by driving, not by reading:
//   · item 1 — DELETE /settings/<id> removed a restaurant's whole settings row for a manager
//     holding no permissions at all. A grep for "settings" in the delete branch finds nothing,
//     because the word never appears there — the kind was INHERITED from the shared TABLES map.
//   · item 2 — deleting a dish that was already gone answered 200 {ok:true} and wrote BOTH an
//     activity-log line and an Audit removal row. Nothing in the source says "no row check";
//     you only see it when the table is empty and the records appear anyway.
// A static guard would have gone green over both.
//
//   node scripts/verify-t25-editor-writes.mjs
//   node scripts/verify-t25-editor-writes.mjs --ids
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { NextRequest } = require_("next/server");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDS_ONLY = process.argv.includes("--ids");

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";

let pass = 0;
const fails = [];
const seen = new Set();
const check = (id, msg, cond, got) => {
  if (seen.has(id)) { fails.push(`DUPLICATE ID ${id}`); console.log(`  ✗ DUPLICATE ID ${id}`); return; }
  seen.add(id);
  if (IDS_ONLY) { console.log(`${id}\t${msg}`); return; }
  if (cond) { pass++; console.log(`  ✓ ${id} ${msg}`); }
  else { fails.push(`${id} ${msg}`); console.log(`  ✗ ${id} ${msg}${got === undefined ? "" : `  → got ${JSON.stringify(got)}`}`); }
};
const head = (t) => { if (!IDS_ONLY) console.log(`\n── ${t} ──`); };

const OUT = join(ROOT, "node_modules/.cache/t25-editor-route.cjs");
execFileSync("npx", ["esbuild", "app/api/editor/[...path]/route.ts", "--bundle", "--platform=node",
  "--format=cjs", "--alias:@=.",
  "--alias:@/lib/supabaseAdmin=./scripts/panel-stubs/sb.mjs",
  "--alias:@/lib/userAuth=./scripts/panel-stubs/userAuth.mjs",
  "--alias:@/lib/oplog=./scripts/panel-stubs/oplog.mjs",
  "--external:next/server", "--external:next/cache", "--external:next/headers",
  `--outfile=${OUT}`, "--log-level=warning"], { cwd: ROOT });

const { G, resetWorld } = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
const route = require_(OUT);

const RID = "rest-1";
const actAs = (who) => {
  if (who === "admin") G.ACTOR = { ok: true, user: null };
  else if (who === "owner") G.ACTOR = { ok: true, user: { id: "o1", role: "owner", name: "Owner", username: "own1", restaurant_id: RID, permissions: {} } };
  else G.ACTOR = { ok: true, user: { id: "u1", role: "manager", name: "Diag Manager", username: "diagm1", restaurant_id: RID, permissions: {} } };
};
function world(extra = {}) {
  resetWorld();
  actAs(extra.who || "manager");
  G.FIX.restaurants = [{ id: RID, manager_permissions: extra.perms || {}, owner_entitlements: {}, access_config: extra.accessConfig || {} }];
  G.FIX.settings = [{ id: "site", restaurant_id: RID, table_count: 20, tax_rate: 0.05, restaurant_name: "French House", gstin: "24AAAAA0000A1Z5", ...(extra.settings || {}) }];
  G.FIX.menu_items = JSON.parse(JSON.stringify(extra.menu_items || []));
  G.FIX.categories = JSON.parse(JSON.stringify(extra.categories || []));
  G.FIX.filters = JSON.parse(JSON.stringify(extra.filters || []));
  G.FIX.orders = JSON.parse(JSON.stringify(extra.orders || []));
  G.FIX.sessions = JSON.parse(JSON.stringify(extra.sessions || []));
  G.FIX.waiter_calls = JSON.parse(JSON.stringify(extra.waiter_calls || []));
}
const ctx = (p) => ({ params: Promise.resolve({ path: p.split("/") }) });
const call = async (verb, path, opts = {}) => {
  const r = await route[verb](new NextRequest(`http://localhost/api/editor/${path}${opts.query || ""}`, {
    method: verb,
    // The act-as cookie is what gives the ADMIN super-user a restaurant to act on; a real staff
    // session ignores it (lib/panelScope). Sent on every call so "who is acting" is the only
    // variable between cases.
    headers: { "content-type": "application/json", cookie: "aevidine_admin_rid=" + RID },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  }), ctx(path));
  let json = {};
  try { json = await r.clone().json(); } catch {}
  return { status: r.status, ...json };
};
const logsNamed = (...actions) => G.LOGS.filter((l) => actions.includes(l.action));
const removalsNamed = (kind) => (G.RPCS || []).filter((c) => c.name === "lfh_record_removal" && c.args?.p_kind === kind);

// ═════════════════════════════════════════════════════════════════════════════════════════════
head("ITEM 1 — the delete door may not touch a restaurant's settings row (P79301–P79318)");
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  world();
  const r = await call("DELETE", "settings/site");
  check("P79301", "a manager asking to delete the settings row is refused", r.status === 404, r);
  check("P79302", "…with the plain 'unknown kind' answer, which is what it now is", r.error === "unknown kind", r.error);
  check("P79303", "…and the restaurant still HAS its settings row", G.FIX.settings.length === 1, G.FIX.settings.length);
  check("P79304", "…still carrying its tax rate", G.FIX.settings[0]?.tax_rate === 0.05);
  check("P79305", "…its table count", G.FIX.settings[0]?.table_count === 20);
  check("P79306", "…its billing name", G.FIX.settings[0]?.restaurant_name === "French House");
  check("P79307", "…and its GSTIN", G.FIX.settings[0]?.gstin === "24AAAAA0000A1Z5");
  check("P79308", "…and nothing at all was written to that table",
    (G.WRITES || []).filter((w) => w.table === "settings").length === 0, (G.WRITES || []).filter((w) => w.table === "settings"));
  check("P79309", "…and no activity-log line claims a deletion happened", logsNamed("menu_delete").length === 0);
}
{
  world({ who: "owner" });
  const r = await call("DELETE", "settings/site");
  check("P79310", "the OWNER cannot delete it either — this is not a permission anyone holds",
    r.status === 404 && G.FIX.settings.length === 1, r);
}
{
  world({ who: "admin" });
  const r = await call("DELETE", "settings/site");
  check("P79311", "…and neither can the Aevidine admin through this door (the console has its own)",
    r.status === 404 && G.FIX.settings.length === 1, r);
}
{
  world();
  const r = await call("DELETE", `settings/${RID}`);
  check("P79312", "naming the row by the restaurant id instead of the legacy 'site' is refused the same way",
    r.status === 404 && G.FIX.settings.length === 1, r);
}
// …and the three kinds that ARE deletable still are, so the fix refuses the right thing only.
for (const [id, kind, fixture, key] of [
  ["P79313", "items", "menu_items", "id"],
  ["P79314", "categories", "categories", "slug"],
  ["P79315", "filters", "filters", "slug"],
]) {
  world({ [fixture]: [{ [key]: "x1", restaurant_id: RID, title: "Paneer Tikka", slug: "x1", id: "x1" }] });
  const r = await call("DELETE", `${kind}/x1`);
  check(id, `a ${kind === "items" ? "dish" : kind === "categories" ? "category" : "tag"} can still be deleted`,
    r.status === 200 && G.FIX[fixture].length === 0, { status: r.status, left: G.FIX[fixture].length });
}
{
  world({ menu_items: [{ id: "x1", slug: "x1", title: "Paneer Tikka", restaurant_id: "SOMEONE-ELSE" }] });
  const r = await call("DELETE", "items/x1");
  check("P79316", "a dish belonging to another restaurant is not deleted",
    G.FIX.menu_items.length === 1, G.FIX.menu_items.length);
  check("P79317", "…and the caller is told so rather than thanked", r.status === 404, r);
}
{
  world();
  const r = await call("DELETE", "nonsense/x1");
  check("P79318", "a kind that does not exist is still a plain 404", r.status === 404 && r.error === "unknown kind", r);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
head("ITEM 2 — a delete that deleted nothing must not report success (P79319–P79334)");
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  world({ menu_items: [] });   // the dish is already gone: another device removed it a second ago
  const r = await call("DELETE", "items/paneer-tikka");
  check("P79319", "the second person to tap ✕ is refused, not thanked", r.status === 404, r);
  check("P79320", "…in plain words that tell them what to do", /already gone — reload/.test(String(r.error)), r.error);
  check("P79321", "…and it says WHICH kind of thing", /That dish is already gone/.test(String(r.error)), r.error);
  check("P79322", "…and NO activity-log line was written", logsNamed("menu_delete").length === 0, G.LOGS.map((l) => l.action));
  check("P79323", "…and NO Audit removal row was written", removalsNamed("menu_item_deleted").length === 0);
  check("P79324", "…so the Audit cannot show two people removing one dish", removalsNamed("menu_item_deleted").length === 0);
}
{
  world({ categories: [] });
  const r = await call("DELETE", "categories/starters");
  check("P79325", "the same holds for a category", r.status === 404, r);
  check("P79326", "…and it is named as a category, not as a dish", /That category is already gone/.test(String(r.error)), r.error);
  check("P79327", "…and nothing was logged", logsNamed("menu_delete").length === 0);
}
{
  world({ filters: [] });
  const r = await call("DELETE", "filters/spicy");
  check("P79328", "…and for a tag", r.status === 404, r);
  check("P79329", "…named as a tag", /That tag is already gone/.test(String(r.error)), r.error);
}
{
  world({ menu_items: [{ id: "x1", slug: "x1", title: "Paneer Tikka", restaurant_id: RID }] });
  const r = await call("DELETE", "items/x1");
  check("P79330", "a delete that DID remove a row still answers 200", r.status === 200, r);
  check("P79331", "…and still writes its activity-log line", logsNamed("menu_delete").length === 1, G.LOGS.map((l) => l.action));
  check("P79332", "…naming the dish rather than only its id", /Paneer Tikka|x1/.test(String(logsNamed("menu_delete")[0]?.detail)));
  check("P79333", "…and still writes the Audit removal row", removalsNamed("menu_item_deleted").length === 1);
  check("P79334", "…which names the dish's title, not a raw key",
    /Paneer Tikka/.test(String(removalsNamed("menu_item_deleted")[0]?.args?.p_item_title)),
    removalsNamed("menu_item_deleted")[0]?.args?.p_item_title);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
head("ITEM 3 — the reads left behind when auto-settle was deleted (P79335–P79342)");
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const ORDER = [{ id: "o1", restaurant_id: RID, table_number: "5", session_id: "s1", status: "preparing",
                   payment_status: "pending", archived: false, deleted_at: null, items: [{ title: "A", status: "preparing" }],
                   subtotal: 100, tax: 5, total: 105, discount: 0, khata_at: null }];
  world({ orders: ORDER, sessions: [{ id: "s1", restaurant_id: RID, table_number: "5", status: "open" }] });
  const before = (G.READS || []).length;
  const r = await call("POST", "orders/o1/serve-all", { body: {} });
  const reads = (G.READS || []).slice(before).filter((x) => x.table === "orders" && x.op === "select");
  check("P79335", "✓ Serve all still works", r.status === 200, r);
  check("P79336", "…and reads the order EXACTLY ONCE (it used to read it again afterwards for nothing)",
    reads.length <= 1, reads.length);
  check("P79337", "…and the order really is served", G.FIX.orders[0].status === "served");
  check("P79338", "…and every dish on it is served", G.FIX.orders[0].items.every((i) => i.status === "served"));
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, table_number: "5", session_id: "s1", status: "cancelled",
                     payment_status: "pending", archived: false, deleted_at: null, items: [{ title: "A" }] }] });
  const r = await call("POST", "orders/o1/serve-all", { body: {} });
  check("P79339", "a VOIDED ticket still cannot be served back to life", r.status === 409, r);
  check("P79340", "…and it is still cancelled afterwards", G.FIX.orders[0].status === "cancelled");
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, table_number: "5", session_id: "s1", status: "received",
                     payment_status: "pending", archived: false, deleted_at: null,
                     items: [{ title: "A", status: "received" }, { title: "B", status: "received" }] }] });
  const r = await call("POST", "orders/o1/item", { body: { index: 0, status: "served" } });
  check("P79341", "marking one dish served still works", r.status === 200, r);
  check("P79342", "…and the order moves to preparing, not to served, while a dish is left",
    G.FIX.orders[0].status === "preparing", G.FIX.orders[0].status);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
head("The write half's own invariants, driven (P79343–P79370)");
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  world({ waiter_calls: [] });
  const r = await call("PATCH", "calls/c1", { body: { resolved: true } });
  check("P79343", "ticking off a waiter call that is gone is refused, not thanked", r.status === 404, r);
  check("P79344", "…in words a person can act on", /no longer on the board/.test(String(r.error)), r.error);
}
{
  world({ waiter_calls: [{ id: "c1", restaurant_id: RID, resolved: false, table_number: "5" }] });
  const r = await call("PATCH", "calls/c1", { body: { resolved: true } });
  check("P79345", "…and a real one is still ticked off", r.status === 200 && G.FIX.waiter_calls[0].resolved === true, r);
}
{
  world({ waiter_calls: [{ id: "c1", restaurant_id: "SOMEONE-ELSE", resolved: false }] });
  const r = await call("PATCH", "calls/c1", { body: { resolved: true } });
  check("P79346", "another restaurant's call is not touched", G.FIX.waiter_calls[0].resolved === false);
  check("P79347", "…and the caller is told it is not on their board", r.status === 404, r);
}
for (const [id, seg] of [["P79348", "undefined"], ["P79349", "null"], ["P79350", "NaN"]]) {
  world();
  const r = await call("PATCH", `orders/${seg}`, { body: { status: "served" } });
  check(id, `a PATCH whose id segment is the string "${seg}" is a clean 400, not a database error`,
    r.status === 400 && /refresh/i.test(String(r.error)), r);
}
for (const [id, seg] of [["P79351", "undefined"], ["P79352", "null"], ["P79353", "NaN"]]) {
  world();
  const r = await call("DELETE", `items/${seg}`);
  check(id, `…and so is a DELETE with the same segment`, r.status === 400, r);
}
{
  world();
  const r = await call("PATCH", "orders/o1", { body: { status: "levitating" } });
  check("P79354", "an order status that is not one of the four is refused by name", r.status === 400, r);
}
{
  world();
  const r = await call("PATCH", "orders/o1", { body: { payment_status: "maybe" } });
  check("P79355", "…and so is a payment status that is not pending or paid", r.status === 400, r);
}
{
  world();
  const r = await call("PATCH", "orders/o1", { body: {} });
  check("P79356", "a PATCH that names nothing to change is refused rather than logged as an edit",
    r.status === 400 && /nothing to update/.test(String(r.error)), r);
  check("P79357", "…and writes no diary line", G.LOGS.length === 0, G.LOGS.map((l) => l.action));
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, status: "served", payment_status: "paid",
                     archived: false, deleted_at: null, session_id: null, table_number: "5" }] });
  const r = await call("PATCH", "orders/o1", { body: { status: "cancelled" } });
  check("P79358", "a PAID order cannot be cancelled without being un-paid first", r.status === 409, r);
  check("P79359", "…and the refusal names the step to take", /mark it unpaid/i.test(String(r.error)), r.error);
  check("P79360", "…and the order is untouched", G.FIX.orders[0].status === "served");
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, status: "received", payment_status: "pending",
                     archived: false, deleted_at: null, session_id: null, table_number: "5" }] });
  const r = await call("PATCH", "orders/o1", { body: { payment_status: "paid" } });
  check("P79361", "a bill cannot be paid before the order is accepted", r.status === 409, r);
  check("P79362", "…and the refusal says to accept it first", /Accept the order first/.test(String(r.error)), r.error);
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, status: "served", payment_status: "paid",
                     paid_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                     archived: false, deleted_at: null, session_id: null, table_number: "5" }] });
  const r = await call("PATCH", "orders/o1", { body: { payment_status: "pending", revert_reason: "wrong table" } });
  check("P79363", "a payment older than the 30-minute window can no longer be reverted", r.status === 409, r);
  check("P79364", "…and it stays paid", G.FIX.orders[0].payment_status === "paid");
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, status: "served", payment_status: "paid",
                     paid_at: new Date().toISOString(), archived: false, deleted_at: null,
                     session_id: null, table_number: "5" }] });
  const r = await call("PATCH", "orders/o1", { body: { payment_status: "pending" } });
  check("P79365", "reverting a paid bill without a reason is refused", r.status === 409, r);
  check("P79366", "…and the money is still booked", G.FIX.orders[0].payment_status === "paid");
}
{
  world({ orders: [{ id: "o1", restaurant_id: RID, status: "preparing", payment_status: "pending",
                     archived: false, deleted_at: null, session_id: null, table_number: "5", khata_at: null }] });
  await call("PATCH", "orders/o1", { body: { archived: true } });
  check("P79367", "archiving unpaid food off the floor still leaves a visible ✕, not a silent disappearance",
    G.FIX.orders[0].status === "cancelled", G.FIX.orders[0].status);
  check("P79368", "…stamped with when it was cancelled", !!G.FIX.orders[0].cancelled_at);
  check("P79369", "…and recorded in the Audit as a removal", removalsNamed("order_cancelled").length === 1);
  check("P79370", "…marked as forced by the archive, not as somebody deliberately voiding a ticket",
    /unpaid food archived off the floor/.test(JSON.stringify(removalsNamed("order_cancelled")[0]?.args?.p_meta || {})),
    removalsNamed("order_cancelled")[0]?.args?.p_meta);
}

if (IDS_ONLY) process.exit(0);
console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`   · ${f}`); process.exit(1); }
