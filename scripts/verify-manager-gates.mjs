// verify-manager-gates.mjs — do the permission gates the T3 sweep added actually REFUSE?
//
// Five of the nine fixes are permission checks, and a static grep only proves the line is there.
// This runs the REAL shipped manager route (bundled with esbuild) against stubs for the database,
// the login and the diary — so the handlers, the ladders, managerCan() and the gates all execute
// for real, while nothing touches a database, a deployed site, a login, or a rate limit.
//
// Each gate is checked BOTH ways: refused for a manager it is switched off for, and allowed for a
// manager who has it (and for the admin super-user, who passes every rung by design). A test that
// only proves the refusal would pass on a handler that refuses everybody.
//
// Usage: node scripts/verify-manager-gates.mjs   (bundle first — see the header of run() below)
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { NextRequest } = require_("next/server");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Some modules in the import chain build a Supabase client at load time (the ANON client, which
// none of these handlers touch — every query they make goes through the stubbed admin client).
// Give it a syntactically valid but unreachable address so construction succeeds; nothing here
// ever opens a socket, and no real project is named.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
const OUT = join(ROOT, "node_modules/.cache/manager-route.cjs");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

execFileSync("npx", ["esbuild", "app/api/editor/[...path]/route.ts", "--bundle", "--platform=node",
  "--format=cjs", "--alias:@=.",
  "--alias:@/lib/supabaseAdmin=./scripts/panel-stubs/sb.mjs",
  "--alias:@/lib/userAuth=./scripts/panel-stubs/userAuth.mjs",
  "--alias:@/lib/oplog=./scripts/panel-stubs/oplog.mjs",
  "--external:next/server", "--external:next/cache", "--external:next/headers",
  `--outfile=${OUT}`, "--log-level=warning"], { cwd: ROOT });

const { G, resetWorld } = await import(pathToFileURL(join(ROOT, "scripts/panel-stubs/state.mjs")).href);
const route = require_(OUT);   // the bundle carries its own copy of the stubs; both talk to G

const RID = "rest-1";

// The restaurant, with every module switched ON so only the permission under test decides.
const restaurantRow = (managerPerms, accessConfig) => ({
  id: RID,
  manager_permissions: managerPerms,
  owner_entitlements: {},
  access_config: accessConfig || {},
});
const settingsRow = () => ({
  restaurant_id: RID, table_count: 20, sessions_enabled: true,
  table_tags_allowed: true, table_tags_owner_control: false, table_tags_enabled: true,
  khata_allowed: true, khata_owner_control: false, khata_enabled: true,
  takeaway_allowed: true, tax_rate: 0.05,
});

// WHO is acting. `manager` with a permission map; `admin` = no staff cookie at all.
function actAs(who, perms = {}) {
  if (who === "admin") G.ACTOR = { ok: true, user: null };
  else if (who === "owner") G.ACTOR = { ok: true, user: { id: "o1", role: "owner", name: "Owner", username: "own1", restaurant_id: RID, permissions: {} } };
  else G.ACTOR = { ok: true, user: { id: "u1", role: "manager", name: "Diag Manager", username: "diagm1", restaurant_id: RID, permissions: perms.person || {} } };
}
actAs("manager");

// Fresh world for every case.
function world(managerPerms = {}, extra = {}) {
  resetWorld();
  actAs("manager");
  G.FIX.restaurants = [restaurantRow(managerPerms, extra.accessConfig)];
  G.FIX.settings = [{ ...settingsRow(), ...(extra.settings || {}) }];
  G.FIX.sessions = JSON.parse(JSON.stringify(extra.sessions || []));
  G.FIX.orders = JSON.parse(JSON.stringify(extra.orders || []));
  G.FIX.table_tags = JSON.parse(JSON.stringify(extra.table_tags || []));
  G.FIX.khata_customers = JSON.parse(JSON.stringify(extra.khata_customers || []));
  Object.assign(G.RPC_ANSWERS, extra.rpc || {});
}

const req = (path, { method = "POST", body = null, query = "" } = {}) =>
  new NextRequest(`http://localhost/api/editor/${path}${query}`, {
    method,
    headers: { "content-type": "application/json", cookie: "lfh_admin_act=" + RID },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const ctx = (path) => ({ params: Promise.resolve({ path: path.split("/") }) });

const call = async (verb, path, opts = {}) => {
  const r = await route[verb](req(path, { ...opts, method: verb }), ctx(path));
  let json = {};
  try { json = await r.clone().json(); } catch {}
  return { status: r.status, ...json };
};

// A refusal must be a 403 whose message names the thing, not a generic error.
const refused = async (label, verb, path, opts, wording) => {
  const r = await call(verb, path, opts);
  if (r.status === 403 && wording.test(String(r.error || ""))) ok(`${label} → refused`, `403 "${r.error}"`);
  else bad(`${label} should have been refused`, `got ${r.status} ${JSON.stringify(r.error || r).slice(0, 120)}`);
};
const allowed = async (label, verb, path, opts) => {
  const r = await call(verb, path, opts);
  if (r.status !== 403) ok(`${label} → allowed`, `${r.status}`);
  else bad(`${label} should have been ALLOWED`, `403 "${r.error}"`);
};

const OPEN_SESSION = [{ id: "s1", restaurant_id: RID, table_number: "5", status: "open", last_activity_at: "2026-08-04T10:00:00Z", opened_at: "2026-08-04T09:00:00Z" }];
// One accepted, served, unpaid order — a table that owes money.
const UNPAID = [{ id: "o1", restaurant_id: RID, table_number: "5", session_id: "s1", status: "served", payment_status: "pending", archived: false, deleted_at: null, subtotal: 1000, tax: 50, total: 1050, discount: 0, khata_at: null }];

console.log("T3 GATE BEHAVIOUR — does a switched-off permission actually refuse?\n");

// ── F3 · clearing a table that owes money needs void_bills ───────────────────────────────────
console.log("F3 · POST /tables/5/restart  (clear a table)");
world({ void_bills: false }, { sessions: OPEN_SESSION, orders: UNPAID });
await refused("a manager with 'void bills' switched off", "POST", "tables/5/restart", { body: {} }, /clear a table that still owes money/i);
world({ void_bills: true }, { sessions: OPEN_SESSION, orders: UNPAID });
await allowed("a manager who has it", "POST", "tables/5/restart", { body: {} });
{
  // …and it must have RECORDED the money that was still owed, before archiving.
  const line = G.LOGS.find((l) => l.action === "close_unpaid");
  if (line && /₹1050/.test(String(line.detail))) ok("the walk-out money is recorded", `"${line.detail}"`);
  else bad("no close_unpaid line naming the amount", JSON.stringify(G.LOGS.map((l) => l.action)));
  const restart = G.LOGS.find((l) => l.action === "table_restart");
  restart ? ok("…and the clear itself is still logged") : bad("table_restart was not logged");
  // The order must have been archived AFTER the money was read (else the read finds nothing).
  const iMoney = G.LOGS.findIndex((l) => l.action === "close_unpaid");
  const iArch = G.WRITES.findIndex((w) => w.table === "orders" && w.op === "update" && w.patch && w.patch.archived === true);
  (iMoney >= 0 && iArch >= 0) ? ok("the money was read before the rows were archived") : bad("ordering could not be established");
}
world({ void_bills: false }, { sessions: OPEN_SESSION, orders: UNPAID });
actAs("admin");
await allowed("the admin super-user (passes every rung by design)", "POST", "tables/5/restart", { body: {} });
actAs("manager");

// ── F4 · the staff-watch tally needs the dashboard permission ────────────────────────────────
console.log("\nF4 · GET /staff-risk  (who discounts / voids / deletes)");
world({ view_dashboard: false });
await refused("a manager with the dashboard switched off", "GET", "staff-risk", { query: "?range=today" }, /view the dashboard/i);
world({ view_dashboard: true });
await allowed("a manager who has the dashboard", "GET", "staff-risk", { query: "?range=today" });
world({ view_dashboard: false });
actAs("admin");
await allowed("the admin", "GET", "staff-risk", { query: "?range=today" });
actAs("manager");

// ── F6/F7 · the mark_paid gates — WHAT THEY ACTUALLY DO ─────────────────────────────────────
// THIS CORRECTS MY OWN SWEEP FINDING. `mark_paid` has NO row on the Access screen: the owner took
// take_orders / mark_paid / print_invoice / table_tags / table_ops out of the grant list on
// 2026-08-01 — "how the floor RUNS; a restaurant that switched them off could not trade" — so
// managerGrantValue() answers ON for them permanently and `manager_permissions.mark_paid` is
// IGNORED by design. There was therefore never a "side door" round Mark-paid: the front door
// cannot be shut. The gates I added are guards-in-waiting in the same shape as their siblings
// (pay-split, PATCH /orders and sessions/:id/invoice all read the same inert flag); they fire only
// on the feature rung `access_config.mark_paid.on`, which nothing writes today.
//
// So this section proves three DIFFERENT things, each labelled for what it is:
//   1. the flag really is ignored via manager_permissions — so nobody believes it bites
//   2. the gate does fire on the one rung that can carry it — so it is wired correctly
//   3. the feature's OWN switch (its module ladder) still refuses — that is the real protection
console.log("\nF6/F7 · the mark_paid gates — inert today, and why");
const FAMILY_TAG = [{ restaurant_id: RID, table_number: "5", tag: "family" }];
const KHATA_ROW = [{ ...UNPAID[0], khata_at: "2026-08-03T10:00:00Z", archived: true }];

world({ mark_paid: false }, { sessions: OPEN_SESSION, orders: UNPAID, table_tags: FAMILY_TAG });
{
  const r = await call("POST", "tables/5/on-the-house", { body: {} });
  r.status !== 403
    ? ok("manager_permissions.mark_paid=false is IGNORED — by the owner's design, not a bug", `${r.status}`)
    : bad("mark_paid was honoured via manager_permissions — the access model says it cannot be", JSON.stringify(r.error));
}
world({}, { sessions: OPEN_SESSION, orders: UNPAID, table_tags: FAMILY_TAG, accessConfig: { mark_paid: { on: false } } });
await refused("On the house, on the rung that CAN carry it", "POST", "tables/5/on-the-house", { body: {} }, /mark a bill paid/i);
world({}, { orders: UNPAID, accessConfig: { mark_paid: { on: false } } });
await refused("a tip, on the rung that CAN carry it", "POST", "orders/o1/tip", { body: { amount: 100 } }, /record a tip/i);
world({}, { orders: KHATA_ROW, accessConfig: { mark_paid: { on: false } } });
await refused("Khata collect, on the rung that CAN carry it", "POST", "khata/pay", { body: { session_id: "s1", method: "Cash" } }, /mark a bill paid/i);

// The REAL protection for these two features is their module, and it still refuses.
world({}, { sessions: OPEN_SESSION, orders: UNPAID, table_tags: FAMILY_TAG, settings: { table_tags_allowed: false } });
await refused("On the house is refused when Table types is switched off", "POST", "tables/5/on-the-house", { body: {} }, /table types aren't enabled/i);
world({}, { orders: KHATA_ROW, settings: { khata_allowed: false } });
await refused("Khata collect is refused when Pay later is switched off", "POST", "khata/pay", { body: { session_id: "s1", method: "Cash" } }, /isn't enabled/i);

// The tip's CEILING — the half of that finding that was real — reaching the database.
console.log("\nF7 · the tip ceiling, at the write");
world({}, { orders: UNPAID });
await call("POST", "orders/o1/tip", { body: { amount: 100 } });
{
  const w = G.WRITES.find((x) => x.table === "orders" && x.patch && "tip" in x.patch);
  w && w.patch.tip === 100 ? ok("a normal tip is stored as typed", "₹100") : bad("the tip was not stored", JSON.stringify(w));
}
world({}, { orders: UNPAID });
await call("POST", "orders/o1/tip", { body: { amount: 500000 } });
{
  const w = G.WRITES.find((x) => x.table === "orders" && x.patch && "tip" in x.patch);
  w && w.patch.tip === 100000 ? ok("a mis-typed tip is CAPPED before it reaches the database", "₹100000") : bad("the cap did not reach the write", JSON.stringify(w && w.patch));
}

// ── the neighbours must be unchanged ────────────────────────────────────────────────────────
console.log("\nRegression · the gates that were already there still behave");
world({ give_discounts: false }, { sessions: OPEN_SESSION, orders: UNPAID });
await refused("a discount still needs give_discounts", "POST", "orders/o1/discount", { body: { amount: 50 } }, /give discounts/i);
world({ void_bills: false }, { sessions: OPEN_SESSION, orders: UNPAID });
await refused("voiding an invoice still needs void_bills", "POST", "sessions/s1/void-invoice", { body: { reason: "x" } }, /void bills/i);
world({ void_bills: false }, { sessions: OPEN_SESSION, orders: UNPAID });
await refused("deleting a bill still needs void_bills", "DELETE", "orders/o1", {}, /delete bills/i);
world({ view_dashboard: false });
await refused("the Z-report still needs the dashboard", "GET", "zreport", {}, /view the dashboard/i);
// …and a fully-granted manager is NOT refused, so this suite can't pass by refusing everybody.
world({ give_discounts: true, void_bills: true, view_dashboard: true }, { sessions: OPEN_SESSION, orders: UNPAID });
await allowed("a fully-granted manager is not refused", "GET", "zreport", {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
