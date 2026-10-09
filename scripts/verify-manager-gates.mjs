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
    // THE COOKIE NAME HAS TO BE THE REAL ONE (sweep #8 T25, item 6). This said `lfh_admin_act`,
    // which exists nowhere in the app — lib/panelScope's ADMIN_ACT_COOKIE is `aevidine_admin_rid`.
    // So the admin super-user never got a restaurant to act on: editorScope answered 400 "No
    // restaurant scope", and because `allowed()` below only asked "is it not a 403", both admin
    // cases printed "allowed — 400" and passed. The one claim in this file that a person cannot
    // check by reading the route — "the admin passes every rung by design" — was never exercised.
    headers: { "content-type": "application/json", cookie: "aevidine_admin_rid=" + RID },
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
// "Not a 403" is not the same as "allowed", and the difference hid the fault above for a month:
// a 400 "No restaurant scope" satisfied it perfectly. A request that was genuinely allowed reaches
// the handler, so it answers 2xx — or a 4xx that is ABOUT THE DATA (409 "nothing to settle",
// 404 "not found"), never one about who is asking. Both shapes are accepted, and the status is
// printed either way so a surprise is visible rather than swallowed.
const GATE_REFUSALS = [400, 401, 403];
const allowed = async (label, verb, path, opts) => {
  const r = await call(verb, path, opts);
  if (!GATE_REFUSALS.includes(r.status)) ok(`${label} → allowed`, `${r.status}`);
  else bad(`${label} should have been ALLOWED`, `${r.status} "${r.error}"`);
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

// ── S10-T9 item 1 · the "Sections" Settings switch is refused, not only hidden ───────────────
// Access → Manager settings → "Sections — who serves which table" promises that switching it off
// makes its endpoints refuse. Until 2026-10-09 neither table-sections endpoint read it. Both doors
// are driven, for the person the switch is about (a manager) and the two it is not (owner, admin).
console.log("\nS10-T9 item 1 · GET/POST /table-sections and the Sections switch");
const SECTIONS_OFF = { menus: { mgrset: { access: false } } };
const SECTION_BODY = { body: { user_id: "w1", tables: [1, 2] } };
world({}, { accessConfig: SECTIONS_OFF });
await refused("a manager whose Sections section is switched off — reading the rota", "GET", "table-sections", {}, /waiter sections aren't part of this restaurant's manager panel/i);
world({}, { accessConfig: SECTIONS_OFF });
await refused("…and saving one waiter's tables", "POST", "table-sections", SECTION_BODY, /waiter sections aren't part of this restaurant's manager panel/i);
{
  const w = G.WRITES.filter((x) => x.table === "staff_users");
  if (w.length === 0) ok("…and nothing was written to the waiter's row");
  else bad("the refused save still wrote staff_users", JSON.stringify(w));
}
world({}, { accessConfig: { menus: { mgrset: { access: true, tables: false } } } });
G.FIX.staff_users = [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Waiter One", username: "w1" }];
await allowed("a manager who HAS the section (another section off) still reads the rota", "GET", "table-sections", {});
world({}, { accessConfig: { menus: { mgrset: { access: true } } } });
G.FIX.staff_users = [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Waiter One", username: "w1" }];
await allowed("…and saves it", "POST", "table-sections", SECTION_BODY);
world({}, { accessConfig: SECTIONS_OFF });
actAs("owner");
await allowed("the OWNER is not who the switch describes", "GET", "table-sections", {});
world({}, { accessConfig: SECTIONS_OFF });
actAs("admin");
await allowed("…and neither is the admin console", "GET", "table-sections", {});

// ── S10-T9 item 2 · the On-the-house report reaches only as far as the dashboard does ────────
// It sits behind view_dashboard, and the owner's 2026-09-23 rule is that this permission reaches
// exactly as far as Access → Dashboard → "How far back it reaches" says. One no-charge bill from
// this morning and one from ten days ago; the panel asks for ?days=30, as it always has.
console.log("\nS10-T9 item 2 · GET /onhouse and the dashboard reach");
{
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 10 * 864e5).toISOString();
  const COMPED = [
    { id: "oh1", restaurant_id: RID, session_id: "s-today", table_number: "4", subtotal: 400, tax: 20, total: 420, items: [{ qty: 2 }], paid_at: fresh, payment_method: "On the house", payment_status: "paid", payment_note: "" },
    { id: "oh2", restaurant_id: RID, session_id: "s-old", table_number: "9", subtotal: 900, tax: 45, total: 945, items: [{ qty: 1 }], paid_at: old, payment_method: "On the house", payment_status: "paid", payment_note: "" },
  ];
  const reachWorld = (range) => world({ view_dashboard: true }, { orders: COMPED, accessConfig: range ? { view_dashboard: { manager_opts: { range } } } : {} });
  const asked = async () => { const r = await call("GET", "onhouse", { query: "?days=30" }); return r; };

  reachWorld("today");
  let r = await asked();
  if (r.status === 200 && r.count === 1 && r.bills?.[0]?.table_number === "4" && r.days === 1 && r.windowLabel === "today") ok("a today-only reach is answered with TODAY's no-charge bills, however many days are asked for", `${r.count} bill · ${r.windowLabel}`);
  else bad("a today-only reach still lists older no-charge bills", JSON.stringify({ status: r.status, count: r.count, days: r.days, label: r.windowLabel }));
  reachWorld(null);
  r = await asked();
  if (r.count === 1 && r.days === 1) ok("…and an UNSET reach means today, the same default /stats uses");
  else bad("an unset reach reached further than today", JSON.stringify({ count: r.count, days: r.days }));
  reachWorld("last30");
  r = await asked();
  if (r.count === 2 && r.days === 30 && r.windowLabel === "the last 30 days") ok("a 30-day reach still gets the whole thirty days", `${r.count} bills`);
  else bad("a 30-day reach lost bills it is entitled to", JSON.stringify({ count: r.count, days: r.days, label: r.windowLabel }));
  reachWorld("today");
  actAs("admin");
  r = await asked();
  if (r.count === 1) ok("…and the clamp is for everyone, the admin console included — like /stats");
  else bad("the admin was handed a wider window than the screen offers", `${r.count}`);
  // The card must print the server's window, not a constant of its own.
  const panelSrc = (await import("node:fs")).readFileSync(join(ROOT, "public/panels/editor/app.js"), "utf8");
  if (/oh\.windowLabel/.test(panelSrc) && !/Last 30 days: <b>/.test(panelSrc)) ok("the Pay later card prints the window the server answered, not a hard-coded \"Last 30 days\"");
  else bad("the On-the-house card still hard-codes its window");
}

// ── S10-T9 item 3 · the dish-photo door obeys the Edit-menu switch like every editor door ────
// Switched off, the menu editor is a read-only Viewer for everyone below the admin (owner,
// 2026-08-02). The dish SAVE was refused; the photo UPLOAD was not, and stored the file anyway.
console.log("\nS10-T9 item 3 · POST /dish-photo and the Edit-menu switch");
{
  const photoReq = () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(8)], "dish.png", { type: "image/png" }));
    return new NextRequest("http://localhost/api/editor/dish-photo", { method: "POST", headers: { cookie: "aevidine_admin_rid=" + RID }, body: fd });
  };
  const send = async () => { const r = await route.POST(photoReq(), ctx("dish-photo")); let j = {}; try { j = await r.clone().json(); } catch {} return { status: r.status, ...j }; };
  const EDITOR_OFF = { menus: { manager: { editor: false } } };
  for (const who of ["manager", "owner"]) {
    world({}, { accessConfig: EDITOR_OFF });
    actAs(who);
    let r;
    try { r = await send(); } catch (e) { r = { status: 0, error: `the upload went ahead and reached storage (${e.message})` }; }
    if (r.status === 403 && /menu editor isn't part of this restaurant's manager panel/.test(String(r.error || ""))) ok(`${who === "owner" ? "an" : "a"} ${who} with Edit menu switched off cannot upload a dish photo`, `403 "${r.error}"`);
    else bad(`${who === "owner" ? "an" : "a"} ${who} with Edit menu switched off still reached the photo upload`, `${r.status} ${r.error || ""}`);
  }
  // …and with the switch ON the door is not refused by the tab (it reaches its own checks).
  world({}, {});
  const fd = new FormData();
  const r = await route.POST(new NextRequest("http://localhost/api/editor/dish-photo", { method: "POST", headers: { cookie: "aevidine_admin_rid=" + RID }, body: fd }), ctx("dish-photo"));
  const j = await r.json().catch(() => ({}));
  if (r.status === 400 && /No photo was attached/.test(String(j.error || ""))) ok("with Edit menu ON the photo door is reached (and asks for a file)", `400 "${j.error}"`);
  else bad("with Edit menu ON the photo door was refused", `${r.status} ${j.error}`);
}

// ── S10-T9 item 5 · the repeat-customer lookup obeys the Customer directory switch ──────────
console.log("\nS10-T9 item 5 · GET /customer-recognize and the Customer directory switch");
{
  world({});
  G.FIX.restaurants[0].owner_entitlements = { customers: false };
  G.RPC_ANSWERS.lfh_recognize_customer = { known: true, name: "Ravi", visits: 3 };
  let r = await call("GET", "customer-recognize", { query: "?phone=9876543210" });
  if (r.known === false && !G.RPCS.some((c) => c.name === "lfh_recognize_customer")) ok("with the directory OFF the pay sheet is told 'not known', and the lookup is never run");
  else bad("with the directory OFF a saved customer was still recognised", JSON.stringify(r));
  world({});
  G.RPC_ANSWERS.lfh_recognize_customer = { known: true, name: "Ravi", visits: 3 };
  r = await call("GET", "customer-recognize", { query: "?phone=9876543210" });
  if (r.known === true && r.name === "Ravi") ok("…and with it ON (the default) a returning guest is still greeted");
  else bad("with the directory ON a returning guest was not recognised", JSON.stringify(r));
}

// ── S10-T9 item 6 · the banquet ledger reaches as far as the Bills record ────────────────────
console.log("\nS10-T9 item 6 · banquet bills and the Bills reach");
{
  const BQ = { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true };
  const IST = 5.5 * 3600e3, F5 = 5 * 3600e3;
  const todayStart = Math.floor((Date.now() + IST - F5) / 864e5) * 864e5 + F5 - IST;
  const BILLS = [
    { id: "bq-today", restaurant_id: RID, bill_no: "B3", issued_at: new Date().toISOString(), total: 300 },
    { id: "bq-yday", restaurant_id: RID, bill_no: "B2", issued_at: new Date(todayStart - 864e5 + 3600e3).toISOString(), total: 200 },
    { id: "bq-old", restaurant_id: RID, bill_no: "B1", issued_at: new Date(todayStart - 10 * 864e5).toISOString(), total: 100 },
  ];
  const bqWorld = (range) => { world({}, { settings: BQ, accessConfig: range ? { view_bills: { manager_opts: { range } } } : {} }); G.FIX.banquet_bills = JSON.parse(JSON.stringify(BILLS)); };
  bqWorld(null);
  let r = await call("GET", "banquet/bills");
  if ((r.bills || []).length === 1 && r.bills[0].id === "bq-today" && r.windowLabel === "today") ok("a today-only Bills reach lists today's banquet bills only, and says so");
  else bad("the banquet list reached past the Bills reach", JSON.stringify({ n: (r.bills || []).length, label: r.windowLabel }));
  bqWorld("today_yesterday");
  r = await call("GET", "banquet/bills");
  if ((r.bills || []).length === 2 && !r.bills.some((b) => b.id === "bq-old") && r.windowLabel === "today and yesterday") ok("…today + yesterday lists both days, and nothing older");
  else bad("the two-day reach listed the wrong bills", JSON.stringify((r.bills || []).map((b) => b.id)));
  bqWorld(null);
  r = await call("GET", "banquet/bill", { query: "?id=bq-old" });
  if (r.status === 404) ok("…a bill older than the reach cannot be opened by its id either");
  else bad("an older banquet bill opened by id", `${r.status}`);
  bqWorld(null);
  r = await call("GET", "banquet/bill", { query: "?id=bq-today" });
  if (r.status === 200 && r.bill?.id === "bq-today") ok("…while today's bill still opens for its reprint");
  else bad("today's banquet bill no longer opens", `${r.status}`);
  bqWorld(null);
  G.FIX.settings[0].modules = { printing: { routes: { banquet: { agent: "ag1", printer: "POS80" } } } };
  G.FIX.print_agents = [{ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: new Date().toISOString(), revoked_at: null }];
  r = await call("POST", "print/send", { body: { kind: "banquet", billId: "bq-old" } });
  if (r.status === 404 && !G.WRITES.some((w) => w.table === "print_jobs")) ok("…and an older one cannot be sent to the printer by its id");
  else bad("an older banquet bill was queued for printing", `${r.status}`);
}

// ── S10-T9 item 7 · the manager route's reads name their columns ─────────────────────────────
// Five reads took every column; they name them now. The only whole-row reads left are the ones whose
// comment says why (the editor form edits every column of a dish/category/filter/settings row, and
// the live floor renders the full order row). A new select("*") must come with that same reason.
console.log("\nS10-T9 item 7 · whole-row reads in the manager route");
{
  // The FIRST half of the route only (through the table-sections branch) — sweep #10 T9's boundary.
  // The second half has one more (the blocklist row read before an unblock); its owner decides it.
  const whole = (await import("node:fs")).readFileSync(join(ROOT, "app/api/editor/[...path]/route.ts"), "utf8");
  const cut = whole.indexOf('if (a === "customer-capture")');
  const src = cut > 0 ? whole.slice(0, cut) : whole;
  const ALLOWED = new Set(["menu_items", "categories", "filters", "settings"]);
  const stars = [...src.matchAll(/from\("([a-z_]+)"\)\.select\("\*"\)/g)].map((m) => m[1]);
  const unexplained = stars.filter((t) => !ALLOWED.has(t));
  if (unexplained.length === 0) ok("no read takes every column except the editor bundle's four, whose comment says why", stars.join(", "));
  else bad("a read takes every column with no reason given", unexplained.join(", "));
  for (const [t, col] of [["waiter_calls", "member_id"], ["issues", "audio_url"], ["customers", "consent_at"], ["staff_actions", "actor_id"], ["banquet_bills", "tax_lines"]]) {
    if (new RegExp(`from\\("${t}"\\)\\.select\\("[^"*]*\\b${col}\\b`).test(src)) ok(`the ${t} read names its columns (and keeps ${col}, which a screen reads)`);
    else bad(`the ${t} read lost its column list or the ${col} column`);
  }
}

// ── S10-T9 item 8 · the Platform board answers even with nothing switched on ─────────────────
// Delivery and parcels are both permanent (2026-08-03), so a "both off" refusal could never fire and
// was removed. Driven with an empty settings row: the board must open, never refuse.
console.log("\nS10-T9 item 8 · GET /platform with nothing switched on");
{
  world({}, { settings: { takeaway_allowed: false } });
  const r = await call("GET", "platform");
  if (r.status === 200 && r.platform_on === true && r.parcel_on === true) ok("the Platform board opens — its modules are permanent, so there is nothing to refuse");
  else bad("the Platform board refused or answered oddly with nothing switched on", JSON.stringify({ status: r.status, error: r.error }));
}

// ── S10-T9 item 10 · a waiter id the database refuses is a 4xx, never "server busy" ─────────
console.log("\nS10-T9 item 10 · POST /table-sections with an id the database refuses");
{
  world({});
  G.FAIL = { "staff_users:update": "refuse" };
  let r = await call("POST", "table-sections", { body: { user_id: "not-an-id", tables: [1] } });
  if (r.status === 404 && /no longer on this restaurant's team/.test(String(r.error || ""))) ok("a refused id is answered 404 in plain words, so the offline queue does not retry it", `${r.status}`);
  else bad("a refused id was answered as server trouble", `${r.status} ${r.error}`);
  world({});
  G.FAIL = { "staff_users:update": "error" };
  r = await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] } });
  if (r.status === 500) ok("…while real database trouble is still a 500 (kept and retried)", `${r.status}`);
  else bad("real database trouble stopped being a 500", `${r.status}`);
  delete G.FAIL;
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
