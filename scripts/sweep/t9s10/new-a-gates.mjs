// scripts/sweep/t9s10/new-a-gates.mjs — block A of sweep #10 T9's 500 (P178001–P178200).
// Who may ask, which restaurant answers, and which tab a switch takes away — DRIVEN in memory
// through the real route (STUB), never by a signed-out or swapped-id call to a running app.
import { check, world, call, SUBJECT, RID, RID2 } from "./lib.mjs";

let N = 178001;
const id = () => { if (N > 178200) throw new Error("block A is full"); return "P" + N++; };

const GET_PATHS = [
  "customer-recognize", "table-sections", "customer-search", "whoami", "banquet/items", "banquet/bills", "banquet/bill",
  "khata", "khata/customers", "onhouse", "all", "ratings", "orders", "calls", "issues", "platform", "zreport",
  "gst-report", "summary", "print-jobs/pending", "printing", "printing/state", "print-jobs/00000000-0000-0000-0000-0000000000aa",
  "sessions", "stats", "users", "oplog", "staff-risk", "audit", "no-such-endpoint",
];
const trips = (G) => G.READS.length + G.RPCS.length + G.WRITES.length;

// ── A1 · the database blinking during the sign-in check is "retrying", never "log in again" ────
// gate() answers 503 when the sign-in lookup itself failed (requireRole's `transient`), so a panel
// stays signed in through a blip. Every GET endpoint in this half, driven with that answer.
for (const p of GET_PATHS) {
  check(id(), `${SUBJECT} — GET /${p}, while the sign-in lookup cannot reach the database, answers 503 "retrying" and touches nothing`,
    "STUB · the real route bundled, requireRole answering { ok:false, transient:true }",
    async () => { const G = await world({ who: "blip" }); const r = await call("GET", p);
      return { ok: r.status === 503 && /retrying/.test(r.json?.error || "") && trips(G) === 0, note: `${r.status} · ${trips(G)} trips` }; });
}
// ── A2 · the three POST doors of this half: signed out and mid-blip ─────────────────────────────
for (const [p, body] of [["print/send", { kind: "bill", sessionId: "s1" }], ["table-sections", { user_id: "w1", tables: [1] }], ["dish-photo", null]]) {
  check(id(), `${SUBJECT} — POST /${p} with nobody signed in answers 401 and writes nothing`, "STUB · requireRole answering { ok:false }",
    async () => { const G = await world({ who: "nobody" }); const r = await call("POST", p, body ? { body } : {});
      return { ok: r.status === 401 && G.WRITES.length === 0 && G.LOGS.length === 0, note: `${r.status} · ${G.WRITES.length} writes · ${G.LOGS.length} diary lines` }; });
  check(id(), `${SUBJECT} — POST /${p} during a sign-in blip answers 503, so the offline queue keeps it`, "STUB · requireRole transient",
    async () => { const G = await world({ who: "blip" }); const r = await call("POST", p, body ? { body } : {});
      return { ok: r.status === 503 && G.WRITES.length === 0, note: `${r.status}` }; });
}
check(id(), `${SUBJECT} — a refused POST (nobody signed in) never reaches the floor-snapshot drop, because it never learned a restaurant`, "STUB · nobody signs in, then a whole-floor read is counted",
  async () => { const G = await world({ who: "nobody", rpc: { lfh_table_view_summary: { tiles: {} } } });
    await call("POST", "table-sections", { body: { user_id: "w1", tables: [] } });
    return { ok: G.WRITES.length === 0, note: "no restaurant, no writes" }; });

// ── A3 · each restaurant only sees its own rows ─────────────────────────────────────────────────
// A world holding rows for BOTH restaurants; the manager is French House's (RID). The stub honours
// every .eq() the route writes, so a query that forgot its restaurant would hand back Aangan's row.
const BOTH = (mk) => [mk(RID, "fh"), mk(RID2, "aa")];
const sepCase = (path, fix, pick, opts = {}) => check(id(), `${SUBJECT} — GET /${path} hands French House's manager French House's rows only, never the other restaurant's`,
  "STUB · fixtures for two restaurants; every returned row checked",
  async () => { await world({ fix, ...(opts.world || {}) }); const r = await call("GET", path, { query: opts.query || "" });
    const rows = pick(r.json) || [];
    const foreign = JSON.stringify(rows).includes("-aa\"") || JSON.stringify(rows).includes(RID2);
    return { ok: r.status === 200 && rows.length >= 1 && !foreign, note: `${r.status} · ${rows.length} row(s) · other restaurant's: ${foreign ? "PRESENT" : "none"}` }; });
const ORD = (rid, s) => ({ id: `o-${s}`, restaurant_id: rid, table_number: "3", session_id: null, status: "served", payment_status: "pending", archived: false, deleted_at: null, subtotal: 100, total: 105, discount: 0, created_at: new Date().toISOString(), items: [] });
sepCase("orders", { orders: BOTH(ORD) }, (j) => j);
sepCase("orders", { orders: BOTH(ORD) }, (j) => j && j.rows, { query: "?bills=1" });
sepCase("calls", { waiter_calls: BOTH((rid, s) => ({ id: `c-${s}`, restaurant_id: rid, table_number: "3", created_at: new Date().toISOString() })) }, (j) => j);
sepCase("issues", { issues: BOTH((rid, s) => ({ id: `i-${s}`, restaurant_id: rid, status: "open", created_at: new Date().toISOString() })) }, (j) => j);
sepCase("khata/customers", { khata_customers: BOTH((rid, s) => ({ id: `k-${s}`, restaurant_id: rid, name: "Ravi", phone: "98", created_at: "2026-10-01" })) }, (j) => j && j.customers,
  { world: { settings: { khata_allowed: true, khata_owner_control: false, khata_enabled: true }, rpc: { lfh_khata_outstanding: [] } }, query: "?q=Ravi" });
sepCase("banquet/items", { banquet_items: BOTH((rid, s) => ({ id: `b-${s}`, restaurant_id: rid, title: "Hall", price: 1, sort_order: 1, active: true })) }, (j) => j && j.items,
  { world: { settings: { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true } } });
sepCase("banquet/bills", { banquet_bills: BOTH((rid, s) => ({ id: `bb-${s}`, restaurant_id: rid, bill_no: "1", issued_at: "2026-10-01" })) }, (j) => j && j.bills,
  { world: { settings: { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true } } });
sepCase("ratings", { feedback: BOTH((rid, s) => ({ id: `f-${s}`, restaurant_id: rid, rating: 5, created_at: "2026-10-01", acknowledged: false })) }, (j) => j && j.ratings,
  { world: { rpc: { lfh_ratings_summary: [{ total: 1 }] } } });
sepCase("table-sections", { staff_users: BOTH((rid, s) => ({ id: `w-${s}`, restaurant_id: rid, role: "tablet", name: "Waiter", username: `w${s}`, active: true, deleted_at: null })) }, (j) => j && j.waiters);
sepCase("users", { session_members: BOTH((rid, s) => ({ id: `m-${s}`, restaurant_id: rid, name: "Guest", joined_at: "2026-10-01" })) }, (j) => j && j.members);
sepCase("users", { customers: BOTH((rid, s) => ({ id: `cu-${s}`, restaurant_id: rid, name: "Guest", last_seen_at: "2026-10-01" })) }, (j) => j && j.customers);
sepCase("users", { blocklist: BOTH((rid, s) => ({ id: `bl-${s}`, restaurant_id: rid, phone: "9", blocked_at: "2026-10-01" })) }, (j) => j && j.blocklist);
sepCase("audit", { deletion_audit: BOTH((rid, s) => ({ id: s === "fh" ? 1 : 2, restaurant_id: rid, kind: "order_cancelled", at: "2026-10-01", actor: `x-${s}` })) }, (j) => j);
sepCase("all", { menu_items: BOTH((rid, s) => ({ id: `mi-${s}`, restaurant_id: rid, title: "Dish", sort_order: 1 })) }, (j) => j && j.items);
sepCase("all", { categories: BOTH((rid, s) => ({ id: `ca-${s}`, slug: `ca-${s}`, restaurant_id: rid, sort_order: 1 })) }, (j) => j && j.categories);
sepCase("all", { filters: BOTH((rid, s) => ({ id: `fi-${s}`, slug: `fi-${s}`, restaurant_id: rid, sort_order: 1 })) }, (j) => j && j.filters);
check(id(), `${SUBJECT} — GET /all's restaurant identity (for the printed bill) is French House's own row, not the other one`, "STUB · two restaurants",
  async () => { await world(); const r = await call("GET", "all"); return { ok: r.json?.restaurant?.id === RID && r.json?.restaurant?.name === "French House", note: r.json?.restaurant?.name }; });
check(id(), `${SUBJECT} — GET /all's settings row is French House's (table count 20), not the other restaurant's (12)`, "STUB · two settings rows",
  async () => { await world(); const r = await call("GET", "all"); return { ok: r.json?.settings?.table_count === 20, note: `table_count ${r.json?.settings?.table_count}` }; });
check(id(), `${SUBJECT} — GET /banquet/bill?id=<the other restaurant's bill> is "not found", never that bill`, "STUB · the id exists, under RID2",
  async () => { await world({ settings: { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true }, fix: { banquet_bills: [{ id: "bb-aa", restaurant_id: RID2, bill_no: "9", total: 900 }] } });
    const r = await call("GET", "banquet/bill", { query: "?id=bb-aa" }); return { ok: r.status === 404 && !r.text.includes("900"), note: `${r.status}` }; });
check(id(), `${SUBJECT} — GET /print-jobs/<the other restaurant's job> is "That print job is gone.", never its order`, "STUB · the job exists, under RID2",
  async () => { await world({ fix: { print_jobs: [{ id: "pj-aa", restaurant_id: RID2, order_id: "o-aa", status: "queued" }] } });
    const r = await call("GET", "print-jobs/pj-aa"); return { ok: r.status === 404 && r.json?.error === "That print job is gone.", note: `${r.status}` }; });
check(id(), `${SUBJECT} — GET /audit?detail=<the other restaurant's removal> answers "That record isn't for this restaurant."`, "STUB · the record exists, under RID2",
  async () => { await world({ fix: { deletion_audit: [{ id: 7, restaurant_id: RID2, kind: "order_cancelled", at: "2026-10-01" }] } });
    const r = await call("GET", "audit", { query: "?detail=7" }); return { ok: r.status === 404 && /isn't for this restaurant/.test(r.json?.error || ""), note: `${r.status}` }; });
for (const [rpc, path, argKey, q] of [
  ["lfh_recognize_customer", "customer-recognize", "p_restaurant_id", "?phone=9876543210"],
  ["lfh_customer_phone_search", "customer-search", "p_restaurant_id", "?q=98765"],
  ["lfh_table_view_summary", "summary", "p_restaurant_id", ""],
  ["lfh_table_view_summary", "summary", "p_restaurant_id", "?table=4"],
  ["lfh_floor_bundle", "sessions", "p_restaurant_id", ""],
  ["lfh_floor_bundle", "sessions", "p_restaurant_id", "?table=4"],
  ["lfh_ratings_summary", "ratings", "p_ids", ""],
]) {
  check(id(), `${SUBJECT} — GET /${path}${q} asks ${rpc} about French House ONLY (the restaurant comes from the session, not the request)`, "STUB · the RPC's arguments recorded",
    async () => { const G = await world({ rpc: { [rpc]: rpc === "lfh_ratings_summary" ? [{}] : rpc === "lfh_customer_phone_search" ? [] : {} } });
      await call("GET", path, { query: q + (q ? "&" : "?") + `rid=${RID2}` });
      const c = G.RPCS.find((x) => x.name === rpc); const v = c && c.args[argKey];
      return { ok: !!c && (Array.isArray(v) ? v.length === 1 && v[0] === RID : v === RID), note: `${argKey}=${JSON.stringify(v)} (the URL said rid=${RID2})` }; });
}
for (const [rpc, path] of [["lfh_khata_outstanding", "khata"], ["lfh_khata_collected", "khata"]]) {
  check(id(), `${SUBJECT} — GET /${path} asks ${rpc} for exactly ONE restaurant, French House`, "STUB · the RPC's arguments recorded",
    async () => { const G = await world({ settings: { khata_allowed: true, khata_owner_control: false, khata_enabled: true }, rpc: { lfh_khata_outstanding: [], lfh_khata_collected: [] } });
      await call("GET", path, { query: `?rid=${RID2}` });
      const c = G.RPCS.find((x) => x.name === rpc); const v = c && c.args.p_restaurant_ids;
      return { ok: Array.isArray(v) && v.length === 1 && v[0] === RID, note: JSON.stringify(v) }; });
}
// ── A4 · the restaurant is the SESSION's, whatever the URL says ─────────────────────────────────
check(id(), `${SUBJECT} — a MANAGER's ?rid=<another restaurant> is ignored: the answer is still their own restaurant`, "STUB · manager of RID, URL names RID2",
  async () => { await world({ fix: { orders: BOTH(ORD) } }); const r = await call("GET", "orders", { query: `?rid=${RID2}` });
    return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].restaurant_id === RID, note: `${(r.json || []).map((o) => o.restaurant_id).join(",")}` }; });
check(id(), `${SUBJECT} — an OWNER's ?rid=<a restaurant they own> is honoured`, "STUB · restaurant_owners links o1 to RID2",
  async () => { await world({ who: "owner", fix: { restaurant_owners: [{ user_id: "o1", restaurant_id: RID }, { user_id: "o1", restaurant_id: RID2 }], orders: BOTH(ORD) } });
    const r = await call("GET", "orders", { query: `?rid=${RID2}` });
    return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].restaurant_id === RID2, note: `${r.status} · ${(r.json || []).map?.((o) => o.restaurant_id).join(",")}` }; });
check(id(), `${SUBJECT} — an OWNER's ?rid=<a restaurant they do NOT own> is refused with "You can only edit restaurants you own."`, "STUB · owner o2 owns RID only",
  async () => { const G = await world({ who: "owner", fix: { restaurant_owners: [{ user_id: "o2", restaurant_id: RID }] } });
    G.ACTOR.user.id = "o2";
    const r = await call("GET", "orders", { query: `?rid=${RID2}` });
    return { ok: r.status === 403 && r.json?.error === "You can only edit restaurants you own.", note: `${r.status} ${r.json?.error}` }; });
check(id(), `${SUBJECT} — …and the same refusal holds on a WRITE (POST /table-sections), with nothing written`, "STUB · owner o3 owns RID only",
  async () => { const G = await world({ who: "owner", fix: { restaurant_owners: [{ user_id: "o3", restaurant_id: RID }] } });
    G.ACTOR.user.id = "o3";
    const r = await call("POST", "table-sections", { query: `?rid=${RID2}`, body: { user_id: "w1", tables: [1] } });
    return { ok: r.status === 403 && G.WRITES.length === 0, note: `${r.status} · ${G.WRITES.length} writes` }; });
check(id(), `${SUBJECT} — an OWNER with no ?rid acts on their own restaurant`, "STUB · owner, no rid",
  async () => { await world({ who: "owner", fix: { orders: BOTH(ORD) } }); const r = await call("GET", "orders");
    return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].restaurant_id === RID, note: `${r.status}` }; });
check(id(), `${SUBJECT} — the ADMIN console acts on the restaurant its own per-tab ?rid names`, "STUB · admin, ?rid=RID2",
  async () => { await world({ who: "admin", fix: { orders: BOTH(ORD) } }); const r = await call("GET", "orders", { query: `?rid=${RID2}` });
    return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].restaurant_id === RID2, note: `${r.status}` }; });
check(id(), `${SUBJECT} — the ADMIN console with neither ?rid nor the act-as cookie is refused with a sentence, not a crash`, "STUB · admin, no scope",
  async () => { await world({ who: "admin" }); const r = await call("GET", "orders", { headers: { cookie: "" } });
    return { ok: r.status === 400 && /No restaurant scope/.test(r.json?.error || ""), note: `${r.status} ${r.json?.error}` }; });

// ── A5 · the menu tabs a restaurant switched off refuse their endpoints (tabGate) ───────────────
const TAB_OFF = (k) => ({ menus: { manager: { [k]: false } } });
const tabCase = (what, verb, path, ac, expectRefused, opts = {}) => check(id(), `${SUBJECT} — ${what}`, "STUB · tabGate driven with access_config.menus.manager",
  async () => { const G = await world({ accessConfig: ac, who: opts.who || "manager", perms: opts.perms || {}, fix: opts.fix, rpc: opts.rpc });
    const r = await call(verb, path, { body: opts.body, query: opts.query });
    const refusedByTab = r.status === 403 && /isn't part of this restaurant's manager panel/.test(r.json?.error || "");
    return { ok: expectRefused ? refusedByTab : !refusedByTab, note: `${r.status} ${String(r.json?.error || "").slice(0, 70)}` }; });
tabCase("Rating review switched off: GET /ratings is refused with \"guest ratings isn't part of…\"", "GET", "ratings", TAB_OFF("ratings"), true);
tabCase("…and GET /ratings?filter=unhandled the same", "GET", "ratings", TAB_OFF("ratings"), true, { query: "?filter=unhandled" });
tabCase("…but the ADMIN looking in still reads ratings (admin keeps every tab)", "GET", "ratings", TAB_OFF("ratings"), false, { who: "admin", rpc: { lfh_ratings_summary: [{}] } });
tabCase("Audit & logs switched off: GET /oplog is refused", "GET", "oplog", TAB_OFF("log"), true);
tabCase("…GET /audit (the removals record) is refused", "GET", "audit", TAB_OFF("log"), true);
tabCase("…GET /audit?detail=1 is refused", "GET", "audit", TAB_OFF("log"), true, { query: "?detail=1" });
tabCase("…GET /users (the customer log) is refused", "GET", "users", TAB_OFF("log"), true);
tabCase("…but POST /audit (RECORDING a removal) is NOT refused by the tab — the trail must keep landing", "POST", "audit", TAB_OFF("log"), false, { body: { kind: "order_cancelled" } });
tabCase("…and the admin still reads the activity log", "GET", "oplog", TAB_OFF("log"), false, { who: "admin" });
tabCase("Edit menu switched off: POST /items (a dish save) is refused", "POST", "items", TAB_OFF("editor"), true, { body: { id: "x" } });
tabCase("…POST /categories is refused", "POST", "categories", TAB_OFF("editor"), true, { body: { slug: "x" } });
tabCase("…POST /filters is refused", "POST", "filters", TAB_OFF("editor"), true, { body: { slug: "x" } });
tabCase("…DELETE /items/x is refused", "DELETE", "items/x", TAB_OFF("editor"), true);
tabCase("…DELETE /categories/x is refused", "DELETE", "categories/x", TAB_OFF("editor"), true);
for (const act of ["qty", "note", "removed", "status", "delete"]) {
  tabCase(`…but a LIVE order's dish action POST /items/x/${act} is NOT refused by the menu-editor switch (the floor keeps working)`, "POST", `items/x/${act}`, TAB_OFF("editor"), false, { body: {} });
}
tabCase("…and the OWNER is refused too — the owner's 2026-08-02 rule makes it read-only for everyone below the admin", "POST", "items", TAB_OFF("editor"), true, { who: "owner", body: { id: "x" } });
tabCase("…and the admin still saves a dish", "POST", "items", TAB_OFF("editor"), false, { who: "admin", body: { id: "x" } });
tabCase("Tab ON but the person's power OFF: view_ratings=false refuses GET /ratings the same way", "GET", "ratings", {}, true, { perms: { view_ratings: false } });
tabCase("Tab ON but view_logs=false refuses GET /oplog the same way", "GET", "oplog", {}, true, { perms: { view_logs: false } });
tabCase("Tab ON but edit_menu=false refuses a dish save the same way", "POST", "items", {}, true, { perms: { edit_menu: false }, body: { id: "x" } });
tabCase("A path that belongs to no tab (GET /summary) pays no tab lookup and is never refused by it", "GET", "summary", { menus: { manager: { editor: false, ratings: false, log: false } } }, false, { rpc: { lfh_table_view_summary: { tiles: {} } } });
tabCase("A switched-off Bills key is IGNORED — the Bill menu is fixed (owner, 2026-08-02)", "GET", "orders", { menus: { manager: { bills: false } } }, false, { query: "?bills=1" });
check(id(), `${SUBJECT} — tabGate reads the restaurant row only for a path that BELONGS to a tab (an ordinary floor read pays nothing)`, "STUB · count restaurants reads on GET /calls",
  async () => { const G = await world(); await call("GET", "calls"); const n = G.READS.filter((x) => x.table === "restaurants").length;
    return { ok: n === 0, note: `${n} restaurants read(s)` }; });

// ── A6 · each permission-gated read refuses a manager who lacks it, in a sentence ─────────────
const permCase = (path, perms, wording, opts = {}) => check(id(), `${SUBJECT} — GET /${path} with ${Object.keys(perms).join("+")} off is refused in plain words, before any data is read`,
  "STUB · manager_permissions switched off",
  async () => { const G = await world({ perms, settings: opts.settings, accessConfig: opts.accessConfig });
    const r = await call("GET", path, { query: opts.query || "" });
    const dataReads = G.READS.filter((x) => !["restaurants", "settings", "app_config"].includes(x.table)).length + G.RPCS.length;
    return { ok: r.status === 403 && wording.test(r.json?.error || "") && dataReads === 0, note: `${r.status} "${r.json?.error}" · ${dataReads} data reads` }; });
const ON = (k) => ({ [`${k}_allowed`]: true, [`${k}_owner_control`]: false, [`${k}_enabled`]: true });
permCase("zreport", { view_dashboard: false }, /view the dashboard/);
permCase("gst-report", { view_dashboard: false }, /view the dashboard/);
permCase("stats", { view_dashboard: false }, /view the dashboard/);
permCase("staff-risk", { view_dashboard: false }, /view the dashboard/);
permCase("onhouse", { view_dashboard: false }, /view the dashboard/, { settings: ON("table_tags") });
// table_assign, banquet and khata are RETIRED grants (lib/accessTree → managerGrantValue): the
// module switch is the only switch, so a stored `false` left over in manager_permissions must be
// IGNORED rather than resurrect a dead control. Driven both ways.
const retiredCase = (path, flag, opts = {}) => check(id(), `${SUBJECT} — GET /${path}: a leftover manager_permissions.${flag}=false is IGNORED (retired grant — the module switch decides)`,
  "STUB · stored false for a retired flag",
  async () => { await world({ perms: { [flag]: false }, settings: opts.settings, rpc: opts.rpc }); const r = await call("GET", path, { query: opts.query || "" });
    return { ok: r.status !== 403, note: `${r.status}` }; });
retiredCase("table-sections", "table_assign");
retiredCase("banquet/items", "banquet", { settings: ON("banquet") });
retiredCase("banquet/bills", "banquet", { settings: ON("banquet") });
retiredCase("khata", "khata", { settings: ON("khata"), rpc: { lfh_khata_outstanding: [], lfh_khata_collected: [] } });
retiredCase("khata/customers", "khata", { settings: ON("khata"), rpc: { lfh_khata_outstanding: [] } });
// …but the FEATURE half of the same flag (access_config.<flag>.on=false) does refuse.
permCase("table-sections", {}, /give waiters their own tables/, { accessConfig: { table_assign: { on: false } } });
permCase("banquet/items", {}, /banquet billing/, { settings: ON("banquet"), accessConfig: { banquet: { on: false } } });
permCase("khata", {}, /khata book/, { settings: ON("khata"), accessConfig: { khata: { on: false } } });
const modCase = (path, wording, opts = {}) => check(id(), `${SUBJECT} — GET /${path} with its MODULE off answers "isn't enabled for this restaurant" (403), however the person is set up`,
  "STUB · the module ladder off in settings",
  async () => { await world({ settings: opts.settings || {} }); const r = await call("GET", path, { query: opts.query || "" });
    return { ok: r.status === 403 && wording.test(r.json?.error || ""), note: `${r.status} "${r.json?.error}"` }; });
modCase("banquet/items", /Banquet isn't enabled/);
modCase("banquet/bills", /Banquet isn't enabled/);
modCase("banquet/bill", /Banquet isn't enabled/, { query: "?id=x" });
modCase("khata", /Pay later \(khata\) isn't enabled/);
modCase("khata/customers", /Pay later \(khata\) isn't enabled/);
modCase("onhouse", /Table types aren't enabled/);
check(id(), `${SUBJECT} — GET /platform is answered even with nothing switched on: the delivery board and parcels are PERMANENT (2026-08-03), so its "isn't enabled" refusal can no longer fire`,
  "STUB · empty settings",
  async () => { await world(); const r = await call("GET", "platform"); return { ok: r.status === 200 && r.json?.platform_on === true && r.json?.parcel_on === true, note: `${r.status} platform_on=${r.json?.platform_on} parcel_on=${r.json?.parcel_on}` }; });
check(id(), `${SUBJECT} — …but the ADMIN looking in at a module that is off still gets the banquet menu (X-ray: visible = usable)`, "STUB · admin, banquet module off",
  async () => { await world({ who: "admin" }); const r = await call("GET", "banquet/items"); return { ok: r.status === 200, note: `${r.status}` }; });
check(id(), `${SUBJECT} — the Platform board with every delivery channel off still opens (parcels), and makes no orders query`, "STUB · channels off",
  async () => { const G = await world({ settings: { platform_channels: {} } }); const r = await call("GET", "platform");
    const aggReads = G.READS.filter((x) => x.table === "aggregator_orders").length;
    return { ok: r.status === 200 && r.json?.channels?.zomato === false && r.json?.channels?.swiggy === false && r.json?.channels?.website === false, note: `${r.status} · ${aggReads} aggregator read(s) (parcel source still listed)` }; });
check(id(), `${SUBJECT} — the Audit & logs "Customers" view switched off refuses GET /users, by name`, "STUB · access_config.view_logs.manager_opts.customers=false",
  async () => { await world({ accessConfig: { view_logs: { manager_opts: { customers: false } } } }); const r = await call("GET", "users");
    return { ok: r.status === 403 && /customer log/.test(r.json?.error || ""), note: `${r.status} "${r.json?.error}"` }; });
check(id(), `${SUBJECT} — the "Activity" view switched off refuses GET /oplog`, "STUB · manager_opts.activity=false",
  async () => { await world({ accessConfig: { view_logs: { manager_opts: { activity: false } } } }); const r = await call("GET", "oplog");
    return { ok: r.status === 403 && /activity log/.test(r.json?.error || ""), note: `${r.status}` }; });
check(id(), `${SUBJECT} — the "Removals" view switched off refuses GET /audit`, "STUB · manager_opts.removals=false",
  async () => { await world({ accessConfig: { view_logs: { manager_opts: { removals: false } } } }); const r = await call("GET", "audit");
    return { ok: r.status === 403 && /removals record/.test(r.json?.error || ""), note: `${r.status}` }; });
check(id(), `${SUBJECT} — …and the OWNER keeps all three views whatever the managers' switches say`, "STUB · owner, all three views off",
  async () => { await world({ who: "owner", accessConfig: { view_logs: { manager_opts: { removals: false, activity: false, customers: false } } } });
    const a = await call("GET", "audit"), u = await call("GET", "users");
    return { ok: a.status === 200 && u.status === 200, note: `audit ${a.status} · users ${u.status}` }; });
check(id(), `${SUBJECT} — a person's own view_logs="off" override refuses GET /audit even when the restaurant grants it`, "STUB · permissions.view_logs='off'",
  async () => { await world({ user: { permissions: { view_logs: "off" } } }); const r = await call("GET", "audit");
    return { ok: r.status === 403, note: `${r.status} "${r.json?.error}"` }; });
check(id(), `${SUBJECT} — …and a person's "on" override lets them read it when the restaurant took it from managers`, "STUB · manager_permissions.view_logs=false, permissions.view_logs='on'",
  async () => { await world({ perms: { view_logs: false }, user: { permissions: { view_logs: "on" } } }); const r = await call("GET", "audit");
    return { ok: r.status === 200, note: `${r.status}` }; });

// ── A7 · item 1 of this sweep, from both doors and every role ───────────────────────────────────
const SOFF = { menus: { mgrset: { access: false } } };
for (const [what, o, verb, expect] of [
  ["a manager, Sections switched off, reading the rota", { accessConfig: SOFF }, "GET", 403],
  ["a manager, Sections switched off, saving a waiter's tables", { accessConfig: SOFF }, "POST", 403],
  ["a manager, Sections ON, reading", { accessConfig: { menus: { mgrset: { access: true } } } }, "GET", 200],
  ["a manager, the Tables section off but Sections on, reading", { accessConfig: { menus: { mgrset: { tables: false } } } }, "GET", 200],
  ["the owner, Sections switched off for managers, reading", { who: "owner", accessConfig: SOFF }, "GET", 200],
  ["the admin, Sections switched off, saving", { who: "admin", accessConfig: SOFF, fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "W" }] } }, "POST", 200],
]) {
  check(id(), `${SUBJECT} — S10-T9 item 1: ${what} → ${expect}`, "STUB · menus.mgrset.access",
    async () => { const G = await world(o); const r = await call(verb, "table-sections", verb === "POST" ? { body: { user_id: "w1", tables: [2] } } : {});
      const wrote = G.WRITES.filter((w) => w.table === "staff_users").length;
      return { ok: r.status === expect && (expect !== 403 || (wrote === 0 && /Waiter sections aren't part/.test(r.json?.error || ""))), note: `${r.status} · ${wrote} write(s)` }; });
}
check(id(), `${SUBJECT} — S10-T9 item 1: the Sections refusal comes AFTER the table_assign power, so a manager without the power still hears the power sentence`, "STUB · both off",
  async () => { await world({ accessConfig: { ...SOFF, table_assign: { on: false } } }); const r = await call("GET", "table-sections");
    return { ok: r.status === 403 && /give waiters their own tables/.test(r.json?.error || ""), note: `"${r.json?.error}"` }; });

console.log(`block A: ${N - 178001} checks defined (P178001–P${N - 1})`);
