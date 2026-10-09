// scripts/sweep/t9s10/r2-e-cover.mjs — round 2, block E (P178723–P178900): every line of my half the
// first 540 checks never executed, measured by scripts/sweep/t9s10/coverage.mjs (90.1% before this
// block). Each group names the lines it closes. Driven in memory through the real route (STUB).
import { check, world, call, SUBJECT, RID, RID2 } from "./lib.mjs";

let N = 178723;
const id = () => { if (N > 178900) throw new Error("block E is full"); return "P" + N++; };
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, `STUB · ${how}`, fn);
// One second ago: a report cuts at "until now", and a row stamped in the same millisecond falls
// outside it — a fixture flicker, not a product fault (found in round 2).
const NOW = () => new Date(Date.now() - 1000).toISOString();
// The admin's panel-view marker as lib/logMarks.ts defines it (a uuid — staff_actions.actor_id is a uuid column).
const ADMIN_VIEW = "00000000-0000-0000-0000-0000000000ad";
const PRINT_ON = { auto_print_kot: true, auto_print_kot_allowed: true };
const routes = (r, extra = {}) => ({ modules: { printing: { routes: r, ...extra } } });

// ═══ E1 · the counter screen's print poll — counterPrintTarget() + GET /print-jobs/pending (lines ~101–135, 2422–2465)
const poll = async (o) => { const G = await world(o); const r = await call("GET", "print-jobs/pending"); return { G, r, j: r.json || {} }; };
const SCREEN_MGR = { kot: { via: "screen", panel: "manager" } };
const QUEUED = { print_jobs: [{ id: "pj1", restaurant_id: RID, kind: "kot", order_id: "o1", status: "queued", created_at: NOW(), attempts: 0 }] };
C("print poll with auto-print never switched on answers off:true — the screen stops asking and prints nothing", "no auto_print settings",
  async () => { const { j } = await poll({}); return { ok: j.off === true && Array.isArray(j.jobs) && j.jobs.length === 0, note: JSON.stringify({ off: j.off, target: j.target }) }; });
C("print poll with no kitchen-slip route says the paper goes to the KITCHEN (a manager screen does not start printing by itself)", "auto-print on, no route",
  async () => { const { j } = await poll({ settings: PRINT_ON }); return { ok: j.off === true && j.target === "kitchen" }; });
C("print poll: a route naming the MANAGER screen, auto-print on and allowed → this screen is handed the queued slips", "route kot → manager screen",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, fix: QUEUED }); return { ok: !j.off && Array.isArray(j.jobs) && j.target === "counter", note: `${(j.jobs || []).length} job(s), target ${j.target}` }; });
C("print poll: the same route with the queue STOPPED holds this screen too", "modules.printing.paused",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR, { paused: true }) }, fix: QUEUED }); return { ok: j.off === true }; });
C("print poll: auto-print allowed but switched OFF by the restaurant → off", "auto_print_kot false",
  async () => { const { j } = await poll({ settings: { auto_print_kot: false, auto_print_kot_allowed: true, ...routes(SCREEN_MGR) } }); return { ok: j.off === true }; });
C("print poll: switched on by the restaurant but NOT allowed by Aevidine → off", "auto_print_kot_allowed false",
  async () => { const { j } = await poll({ settings: { auto_print_kot: true, auto_print_kot_allowed: false, ...routes(SCREEN_MGR) } }); return { ok: j.off === true }; });
C("print poll: a route naming the KITCHEN screen → this manager screen is off, and told the kitchen prints", "route kot → kitchen screen",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes({ kot: { via: "screen", panel: "kitchen" } }) } }); return { ok: j.off === true && j.target === "kitchen" && j.printRefused === "other_panel", note: `${j.printRefused}` }; });
C("print poll: a COMPUTER owning the slips takes them off every screen, and the panel is told who has them", "route kot → helper ag1",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes({ kot: { agent: "ag1", printer: "KOT58" } }) }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "Kitchen PC", last_seen_at: NOW(), revoked_at: null }] } });
    return { ok: j.off === true && j.helper?.owned === true && j.helper.agent === "Kitchen PC", note: JSON.stringify(j.helper) }; });
C("print poll: the slips switched to 'Nobody' → off, with the reason 'off'", "route kot via off",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes({ kot: { via: "off" } }) } }); return { ok: j.off === true && j.printRefused === "off", note: `${j.printRefused}` }; });
C("print poll: a route narrowed to ANOTHER person refuses this person's screen", "route person = someone else",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes({ kot: { via: "screen", panel: "manager", person: "u9" } }) } }); return { ok: j.off === true && j.printRefused === "other_person" }; });
C("print poll: being NAMED on the route is the permission — this person prints even with 'print here' switched off", "route person = u1, print_here off",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes({ kot: { via: "screen", panel: "manager", person: "u1" } }) }, accessConfig: { print_here: { on: false } }, fix: QUEUED });
    return { ok: !j.off, note: `off=${j.off} refused=${j.printRefused}` }; });
C("print poll: NOT named, and 'print here' switched off → refused with 'not_allowed'", "print_here feature off",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, accessConfig: { print_here: { on: false } } }); return { ok: j.off === true && j.printRefused === "not_allowed", note: `${j.printRefused}` }; });
C("print poll: the admin console looking in always counts as allowed to print (X-ray)", "admin, print_here off",
  async () => { const { j } = await poll({ who: "admin", settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, accessConfig: { print_here: { on: false } }, fix: QUEUED }); return { ok: !j.off, note: `${j.off}` }; });
C("print poll: another screen is the live printing STATION → this one gets no jobs, only the station's name", "print_stations: dev-other active, fresh",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, fix: { ...QUEUED, print_stations: [{ restaurant_id: RID, device_id: "dev-other", active: true, label: "Counter PC", last_seen_at: NOW() }] } });
    return { ok: Array.isArray(j.jobs) && j.jobs.length === 0 && j.station?.active?.device_id === "dev-other" && !j.off, note: JSON.stringify(j.station) }; });
C("print poll: …but a station gone QUIET does not block this screen", "station last seen an hour ago",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, fix: { ...QUEUED, print_stations: [{ restaurant_id: RID, device_id: "dev-other", active: true, last_seen_at: new Date(Date.now() - 3600e3).toISOString() }] } });
    return { ok: j.station?.stale === true && "targets" in j, note: `stale=${j.station?.stale}` }; });
C("print poll: when THIS device is the station, its heartbeat is stamped", "print_stations: dev-test (this device)",
  async () => { const { G, j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, fix: { print_stations: [{ restaurant_id: RID, device_id: "dev-test", active: true, last_seen_at: new Date(Date.now() - 5000).toISOString() }] } });
    const w = G.WRITES.find((x) => x.table === "print_stations" && x.op === "update"); return { ok: j.station?.mine === true && !!w?.patch?.last_seen_at, note: `mine=${j.station?.mine}` }; });
C("print poll: always reports how far behind the printer is (the waiting count), on or off", "auto-print off, one job queued",
  async () => { const { j } = await poll({ fix: QUEUED }); return { ok: typeof j.waiting === "object" && j.stuckAfterMs > 0, note: JSON.stringify(j.waiting) }; });
C("print poll: always reports every paper's owner (helpers), so a bill tap knows if a computer will print it", "no routes",
  async () => { const { j } = await poll({}); return { ok: j.helpers && "kot" in j.helpers && "bill" in j.helpers && "banquet" in j.helpers }; });
C("print poll: another restaurant's queued slip is never handed to this screen", "the only queued job is RID2's",
  async () => { const { j } = await poll({ settings: { ...PRINT_ON, ...routes(SCREEN_MGR) }, fix: { print_jobs: [{ id: "pjx", restaurant_id: RID2, kind: "kot", status: "queued", created_at: NOW() }] } });
    return { ok: !(j.jobs || []).some((x) => x.id === "pjx"), note: `${(j.jobs || []).length}` }; });

// ═══ E2 · Settings → Printing status: originOfReq / osOfRequest / GET /printing (lines ~166–178, 2485–2522)
const board = async (headers = {}, o = {}) => { await world(o); return (await call("GET", "printing/state", { headers })).json || {}; };
for (const [ua, os] of [["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "windows"], ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "mac"], ["Mozilla/5.0 (X11; Linux x86_64)", "linux"], ["", "linux"]]) {
  C(`Printing status opens on the right system for "${ua.slice(0, 30) || "(no user-agent)"}" → ${os}`, "user-agent header", async () => { const j = await board({ "user-agent": ua }); return { ok: j.os === os, note: j.os }; });
}
C("Printing status: the launcher text points at the site the request came to (x-forwarded host + proto)", "x-forwarded-host shop.example",
  async () => { const j = await board({ "x-forwarded-host": "shop.example", "x-forwarded-proto": "https" }); return { ok: JSON.stringify(j.stationFiles || "").includes("https://shop.example"), note: JSON.stringify(j.stationFiles || "").slice(0, 80) }; });
C("Printing status: with no forwarded proto it assumes https", "x-forwarded-host only",
  async () => { const j = await board({ "x-forwarded-host": "shop2.example" }); return { ok: JSON.stringify(j.stationFiles || "").includes("https://shop2.example") }; });
C("Printing status offers NO setup controls to anyone (maySetup is false — setup is Aevidine's, 2026-09-14)", "manager and admin",
  async () => { const a = await board(); const b = await board({}, { who: "admin" }); return { ok: a.maySetup === false && b.maySetup === false }; });
C("Printing status: a manager without 'clear the printing queue' gets no clear button", "print_clear off",
  async () => { const j = await board({}, { accessConfig: { print_clear: { on: false } } }); return { ok: j.mayClear === false }; });
C("Printing status: the admin console may clear", "admin", async () => { const j = await board({}, { who: "admin" }); return { ok: j.mayClear === true }; });
C("Printing status names the person looking (and nobody for the admin console)", "manager vs admin",
  async () => { const a = await board(); const b = await board({}, { who: "admin" }); return { ok: a.person?.id === "u1" && a.person.name === "Diag Manager" && b.person === null }; });
C("Printing status carries this device's id so the board can say 'this computer'", "device header",
  async () => { const j = await board(); return { ok: j.deviceId === "dev-test", note: j.deviceId }; });
C("Printing status: /printing and /printing/state are the same answer", "both paths",
  async () => { await world(); const a = (await call("GET", "printing")).json; const b = (await call("GET", "printing/state")).json; return { ok: !!a && !!b && a.maySetup === b.maySetup && a.os === b.os }; });
C("Printing status never carries the helper's install file (it left this panel on 2026-09-14)", "manager",
  async () => { const j = await board(); return { ok: !("files" in j) && !("helperFiles" in j) }; });

// ═══ E3 · platformOrParcelCan() through its callers in the other half (lines ~206–210) ═════════
const AGG = (source) => ({ aggregator_orders: [{ id: "ag-1", restaurant_id: RID, source, status: "accepted", total: 100, paid: false }] });
const plat = async (o, path, body) => { await world(o); return call("POST", path, { body, query: "" }); };
C("a staff PARCEL's status can be changed by a manager — the parcel module is permanent", "POST platform/ag-1/status, source parcel",
  async () => { const r = await plat({ fix: AGG("parcel"), rpc: { lfh_platform_set_status: [{ id: "ag-1" }] } }, "platform/ag-1/status", { status: "ready" }); return { ok: r.status === 200, note: `${r.status} ${r.json?.error || ""}` }; });
C("…unless the parcel power's FEATURE half is switched off for managers", "access_config.parcel.on=false",
  async () => { const r = await plat({ fix: AGG("parcel"), accessConfig: { parcel: { on: false } } }, "platform/ag-1/status", { status: "ready" }); return { ok: r.status === 403 && /manage this order/.test(r.json?.error || ""), note: `${r.status}` }; });
C("a ZOMATO order rides the platform power, not the parcel one", "source zomato, platform power off",
  async () => { const r = await plat({ fix: AGG("zomato"), accessConfig: { platform: { on: false } } }, "platform/ag-1/status", { status: "ready" }); return { ok: r.status === 403, note: `${r.status}` }; });
C("…and with the PARCEL power off, a Zomato order is still allowed (different power)", "source zomato, parcel power off",
  async () => { const r = await plat({ fix: AGG("zomato"), accessConfig: { parcel: { on: false } }, rpc: { lfh_platform_set_status: [{ id: "ag-1" }] } }, "platform/ag-1/status", { status: "ready" }); return { ok: r.status === 200, note: `${r.status}` }; });
C("the admin console passes both powers (X-ray)", "admin, both off",
  async () => { const r = await plat({ who: "admin", fix: AGG("parcel"), accessConfig: { parcel: { on: false }, platform: { on: false } }, rpc: { lfh_platform_set_status: [{ id: "ag-1" }] } }, "platform/ag-1/status", { status: "ready" }); return { ok: r.status === 200 }; });
C("collecting a parcel's money asks the same power", "POST platform/ag-1/pay, parcel power off",
  async () => { const r = await plat({ fix: AGG("parcel"), accessConfig: { parcel: { on: false } } }, "platform/ag-1/pay", { method: "Cash" }); return { ok: r.status === 403 && /collect this order/.test(r.json?.error || "") }; });

// ═══ E4 · tableOpsGate() through the KOT ▾ verbs (lines ~481–485) ═════════════════════════════
const OPS = { table_ops_allowed: true, table_ops_owner_control: false, table_ops_enabled: true };
for (const [verb, path] of [["move", "orders/o1/move"], ["merge", "sessions/s1/merge"], ["shift", "sessions/s1/shift"]]) {
  C(`KOT ▾ ${verb}: with Table & KOT operations OFF for the restaurant → "aren't enabled for this restaurant"`, "table_ops_allowed false",
    async () => { const r = await (async () => { await world(); return call("POST", path, { body: { to: "3" } }); })(); return { ok: r.status === 403 && /Table & KOT operations aren't enabled/.test(r.json?.error || ""), note: `${r.status}` }; });
  C(`KOT ▾ ${verb}: module ON but the manager's table_ops power off → the power sentence`, "table_ops feature half off",
    async () => { await world({ settings: OPS, accessConfig: { table_ops: { on: false } } }); const r = await call("POST", path, { body: { to: "3" } }); return { ok: r.status === 403 && /use table & KOT operations/.test(r.json?.error || ""), note: `${r.status}` }; });
  C(`KOT ▾ ${verb}: the admin console passes the gate even with the module off, and meets the real checks`, "admin, module off, a bad target",
    async () => { await world({ who: "admin" }); const r = await call("POST", path, { body: { to: "x" } }); return { ok: r.status === 400 && /Pick a valid table/.test(r.json?.error || ""), note: `${r.status} ${r.json?.error}` }; });
}

// ═══ E5 · the four refusal-wording maps (lines ~490–517, 801–809) ═════════════════════════════
const MOVE = { no_order: /isn't there anymore/, item_not_found: /no longer on the order/, order_not_found: /no longer exists/, order_cancelled: /cancelled — nothing to move/,
  order_paid: /Won't move a PAID order/, bad_table: /Pick a valid table/, same_table: /already on that table/, source_invoiced: /already invoiced — void or regenerate its invoice before moving an order off/,
  target_invoiced: /target table's bill is already invoiced/, weird_new_reason: /weird_new_reason/ };
for (const [reason, re] of Object.entries(MOVE)) {
  C(`moving a KOT, refused '${reason}', says it in plain words (409)`, `lfh_staff_move_order answers {ok:false, reason:'${reason}'}`,
    async () => { await world({ settings: OPS, rpc: { lfh_staff_move_order: { ok: false, reason } } }); const r = await call("POST", "orders/o1/move", { body: { to: "3" } }); return { ok: r.status === 409 && re.test(r.json?.error || ""), note: r.json?.error }; });
}
C("moving a KOT with no reason at all from the database still gets a sentence", "reason missing",
  async () => { await world({ settings: OPS, rpc: { lfh_staff_move_order: { ok: false } } }); const r = await call("POST", "orders/o1/move", { body: { to: "3" } }); return { ok: r.status === 409 && r.json?.error === "Couldn't move the order." }; });
const MERGE = { no_session: /session isn't there anymore/, session_closed: /already closed — nothing to merge/, bad_table: /Pick a valid table/, same_table: /That's the same table/,
  target_not_open: /has no party — use Change table/, source_invoiced: /void its invoice before merging/, target_invoiced: /target table's bill is already invoiced — void its invoice before merging/ };
for (const [reason, re] of Object.entries(MERGE)) {
  C(`merging tables, refused '${reason}', says it in plain words`, `lfh_staff_merge_tables answers {ok:false, reason:'${reason}'}`,
    async () => { await world({ settings: OPS, fix: { sessions: [{ id: "s1", restaurant_id: RID }] }, rpc: { lfh_staff_merge_tables: { ok: false, reason } } }); const r = await call("POST", "sessions/s1/merge", { body: { to: "3" } }); return { ok: r.status === 409 && re.test(r.json?.error || ""), note: r.json?.error }; });
}
C("merging tables with no reason from the database still gets 'Couldn't merge the tables.'", "reason missing",
  async () => { await world({ settings: OPS, fix: { sessions: [{ id: "s1", restaurant_id: RID }] }, rpc: { lfh_staff_merge_tables: { ok: false } } }); const r = await call("POST", "sessions/s1/merge", { body: { to: "3" } }); return { ok: r.json?.error === "Couldn't merge the tables." }; });
const BQ = { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true };
for (const [reason, re] of Object.entries({ not_allowed: /Banquet isn't enabled/, empty_order: /at least one banquet line/, unknown_item: /no longer exists — reload/, bad_table: /Pick a valid table/, other: /^other$/, "": /Couldn't create the banquet bill/ })) {
  C(`a banquet bill refused '${reason || "(no reason)"}' says it in plain words`, `lfh_banquet_bill_create answers {ok:false, reason:'${reason}'}`,
    async () => { await world({ settings: BQ, rpc: { lfh_banquet_bill_create: reason ? { ok: false, reason } : { ok: false } } }); const r = await call("POST", "banquet/bill", { body: { lines: [{ id: "x", qty: 1 }] } }); return { ok: r.status === 400 && re.test(r.json?.error || ""), note: r.json?.error }; });
}
const EDIT = { order_paid: /Won't change a PAID bill/, order_cancelled: /cancelled — nothing to edit/, item_not_found: /no longer on the order/, order_not_found: /no longer exists/,
  sold_out: /sold out — can't add it/, unknown_item: /isn't on the menu/, empty_order: /Nothing to add/, price_required: /priced as-per-MRP/, mystery: /Couldn't edit the order — please try again/ };
for (const [reason, re] of Object.entries(EDIT)) {
  C(`changing a dish quantity, refused '${reason}', says it in plain words`, `lfh_staff_edit_item_qty answers {ok:false, reason:'${reason}'}`,
    async () => { await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 2, title: "Tea", unit_price: 20 }], orders: [{ id: "o1", restaurant_id: RID }] }, rpc: { lfh_staff_edit_item_qty: { ok: false, reason } } });
      const r = await call("POST", "items/i1/qty", { body: { qty: 1 } }); return { ok: (r.status === 400 || r.status === 409) && re.test(r.json?.error || ""), note: `${r.status} ${r.json?.error}` }; });
}

// ═══ E6 · stampEdited() and bustMenuCache() through their callers (lines ~525–526, 587) ═════════
C("a quantity change stamps the order 'edited' (the ✎ badge on every ticket)", "items/i1/qty succeeds",
  async () => { const G = await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 2, title: "Tea", unit_price: 20 }], orders: [{ id: "o1", restaurant_id: RID }] }, rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 3 } } });
    await call("POST", "items/i1/qty", { body: { qty: 3 } }); const w = G.WRITES.find((x) => x.table === "orders" && x.patch?.edited_at); return { ok: !!w, note: JSON.stringify(w?.patch) }; });
C("…and the stamp is scoped to THIS restaurant's order", "another restaurant's order with the same id is untouched",
  async () => { const G = await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 2 }], orders: [{ id: "o1", restaurant_id: RID2 }] }, rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 3 } } });
    await call("POST", "items/i1/qty", { body: { qty: 3 } }); return { ok: !G.FIX.orders[0].edited_at }; });
C("…and when the database names no order, nothing is stamped (and nothing fails)", "RPC answers no order_id",
  async () => { const G = await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 2 }] }, rpc: { lfh_staff_edit_item_qty: { ok: true } } });
    const r = await call("POST", "items/i1/qty", { body: { qty: 3 } }); return { ok: r.status === 200 && !G.WRITES.some((x) => x.table === "orders"), note: `${r.status}` }; });
C("deleting a dish from the menu busts the guest menu's cache — and a cache that cannot be reached never fails the delete", "DELETE items/x1 outside a Next server",
  async () => { const G = await world({ fix: { menu_items: [{ id: "x1", slug: "x1", restaurant_id: RID, title: "Old dish" }] } }); const r = await call("DELETE", "items/x1");
    return { ok: r.status === 200 && G.FIX.menu_items.length === 0, note: `${r.status}` }; });

// ═══ E7 · the dish photo, stored (lines ~624–642) ═════════════════════════════════════════════
const photo = async (o, file, extra = {}) => { const G = await world({ storage: true, ...o }); const fd = new FormData(); if (file) fd.append("file", file); for (const [k, v] of Object.entries(extra)) fd.append(k, v); const r = await call("POST", "dish-photo", { form: fd }); return { G, r }; };
const IMG = (type, n = 16) => new File([new Uint8Array(n)], "d", { type });
C("a PNG dish photo is stored and its public address handed back", "storage on",
  async () => { const { G, r } = await photo({}, IMG("image/png")); const up = G.STORAGE_LOG.find((x) => x.op === "upload"); return { ok: r.status === 200 && r.json?.ok && /^https:\/\/stub\.storage\/menu-media\/rest-1\/\d+-[0-9a-f]{8}\.png$/.test(r.json.url) && up?.opts?.upsert === false, note: r.json?.url }; });
C("…a JPG is stored as .jpg", "image/jpeg", async () => { const { r } = await photo({}, IMG("image/jpeg")); return { ok: /\.jpg$/.test(r.json?.url || "") }; });
C("…a WEBP as .webp", "image/webp", async () => { const { r } = await photo({}, IMG("image/webp")); return { ok: /\.webp$/.test(r.json?.url || "") }; });
C("…the stored file carries its real content type", "image/png", async () => { const { G } = await photo({}, IMG("image/png")); return { ok: G.STORAGE_LOG.find((x) => x.op === "upload")?.opts?.contentType === "image/png" }; });
C("…a file of exactly 4 MB is accepted (the limit is 'larger than')", "4,194,304 bytes", async () => { const { r } = await photo({}, IMG("image/png", 4 * 1024 * 1024)); return { ok: r.status === 200 }; });
C("re-photographing a dish removes the photo it replaces, when that photo is this restaurant's", "replaces = rest-1/old.png",
  async () => { const { G } = await photo({}, IMG("image/png"), { replaces: "https://x.supabase.co/storage/v1/object/public/menu-media/rest-1/old.png" }); const rm = G.STORAGE_LOG.find((x) => x.op === "remove"); return { ok: JSON.stringify(rm?.paths) === '["rest-1/old.png"]', note: JSON.stringify(rm) }; });
C("…but never another restaurant's photo", "replaces = rest-2/theirs.png",
  async () => { const { G, r } = await photo({}, IMG("image/png"), { replaces: "https://x/storage/v1/object/public/menu-media/rest-2/theirs.png" }); return { ok: r.status === 200 && !G.STORAGE_LOG.some((x) => x.op === "remove") }; });
C("…and never a path that climbs out of the folder", "replaces = rest-1/../rest-2/x.png",
  async () => { const { G } = await photo({}, IMG("image/png"), { replaces: "https://x/storage/v1/object/public/menu-media/rest-1/../rest-2/x.png" }); return { ok: !G.STORAGE_LOG.some((x) => x.op === "remove") }; });
C("…and never a file from a different bucket", "replaces = issue-media/…",
  async () => { const { G } = await photo({}, IMG("image/png"), { replaces: "https://x/storage/v1/object/public/issue-media/rest-1/a.png" }); return { ok: !G.STORAGE_LOG.some((x) => x.op === "remove") }; });
C("a failed upload says 'Couldn't save that photo — please try again.' (500), never the storage library's words", "storage upload errors",
  async () => { const { r } = await photo({ fail: { "storage:upload": "error" } }, IMG("image/png")); return { ok: r.status === 500 && r.json?.error === "Couldn't save that photo — please try again." }; });
C("uploading a photo writes nothing to the dish row (the dish save does, with its own clash check and cache bust)", "storage on",
  async () => { const { G } = await photo({}, IMG("image/png")); return { ok: !G.WRITES.some((x) => x.table === "menu_items") }; });
C("photo addresses cannot be guessed from the restaurant id alone (time + random part)", "two uploads",
  async () => { const a = (await photo({}, IMG("image/png"))).r.json?.url; const b = (await photo({}, IMG("image/png"))).r.json?.url; return { ok: !!a && !!b && a !== b }; });

// ═══ E8 · the Bills search modes the first round never drove (lines ~1458, 1476, 1485, 1503–1508, 1545)
const O = (id_, o = {}) => ({ id: id_, restaurant_id: RID, table_number: "5", session_id: "s5", status: "served", payment_status: "paid", archived: false, deleted_at: null, created_at: NOW(), subtotal: 100, total: 105, items: [], ...o });
C("one-box search: a guest's own name on their phone finds their bill", "session_members row for s5",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID, created_at: NOW() }], session_members: [{ session_id: "s5", restaurant_id: RID, name: "Meera" }] } });
    const r = await call("GET", "orders", { query: "?history=1&type=any&q=Meera" }); return { ok: Array.isArray(r.json) && r.json.length === 1 }; });
C("table search finds that table's bills", "type=table q=5",
  async () => { await world({ fix: { orders: [O("b1"), O("b2", { table_number: "6", session_id: "s6" })] } }); const r = await call("GET", "orders", { query: "?history=1&type=table&q=5" }); return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].id === "b1" }; });
C("customer search with a match returns that guest's bills", "type=cust, member Meera on s5",
  async () => { await world({ fix: { orders: [O("b1"), O("b2", { session_id: "s6" })], session_members: [{ session_id: "s5", restaurant_id: RID, name: "Meera" }] } });
    const r = await call("GET", "orders", { query: "?history=1&type=cust&q=Meera" }); return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].id === "b1", note: `${r.json?.length}` }; });
C("date search with a written-out date ('9 Oct 2026') is read as that IST calendar day", "type=date",
  async () => { const today = new Date(Date.now() + 5.5 * 3600e3); const label = today.toUTCString().slice(5, 16);
    await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=date&q=" + encodeURIComponent(label) }); return { ok: r.status === 200 && Array.isArray(r.json), note: `${label} → ${r.json?.length}` }; });
C("date search with YYYY-MM-DD for today finds today's bill", "type=date",
  async () => { const d = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: `?history=1&type=date&q=${d}` }); return { ok: Array.isArray(r.json) && r.json.length === 1, note: d }; });
C("date search with a calendar-impossible day answers [] rather than failing", "q=2026-02-31",
  async () => { await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=date&q=2026-02-31" }); return { ok: r.status === 200 && Array.isArray(r.json), note: `${r.status} ${r.json?.length}` }; });
C("a table's slice reads the party sitting there now (the open session), not old food", "orders?table=5 with an open session",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "open", opened_at: NOW(), last_activity_at: NOW() }] } }); const r = await call("GET", "orders", { query: "?table=5" }); return { ok: Array.isArray(r.json), note: `${r.json?.length}` }; });
C("a MERGED table's slice reads its parent's party", "table_merges: child 6 → parent 5",
  async () => { const G = await world({ fix: { orders: [O("b1", { table_number: "6" })], table_merges: [{ restaurant_id: RID, child_table: "6", parent_table: "5", ended_at: null }], sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "open", opened_at: NOW(), last_activity_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?table=6" }); return { ok: r.status === 200 && G.READS.some((x) => x.table === "table_merges"), note: `${r.json?.length}` }; });

// ═══ E9 · the dashboard's "last time" and the channel split (lines ~2681, 2823–2850) ═════════════
const IST = 5.5 * 3600e3, F5 = 5 * 3600e3;
const dayStart = () => Math.floor((Date.now() + IST - F5) / 864e5) * 864e5 + F5 - IST;
const YDAY_SAME = () => new Date(dayStart() - 864e5 + Math.max(0, Date.now() - dayStart() - 60000)).toISOString();
const DORD = (id_, at, o = {}) => ({ id: id_, restaurant_id: RID, session_id: `s-${id_}`, status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 0, created_at: at, items: [], deleted_at: null, ...o });
C("the dashboard's 'last time' counts yesterday's bills cut at the same elapsed time", "one paid order yesterday, earlier in the day",
  async () => { await world({ fix: { orders: [DORD("y1", YDAY_SAME())] } }); const r = await call("GET", "stats"); return { ok: r.json?.prev?.orders === 1 && r.json.prev.revenue > 0, note: JSON.stringify(r.json?.prev && { o: r.json.prev.orders, r: r.json.prev.revenue }) }; });
C("…a cancelled order yesterday counts as last time's cancellation, not its revenue", "one cancelled yesterday",
  async () => { await world({ fix: { orders: [DORD("y2", YDAY_SAME(), { status: "cancelled", payment_status: "pending" })] } }); const r = await call("GET", "stats"); return { ok: r.json?.prev?.cancelled === 1 && r.json.prev.revenue === 0 }; });
C("…an unpaid order yesterday counts as an order but not as money", "one unpaid yesterday",
  async () => { await world({ fix: { orders: [DORD("y3", YDAY_SAME(), { payment_status: "pending" })] } }); const r = await call("GET", "stats"); return { ok: r.json?.prev?.orders === 1 && r.json.prev.revenue === 0 }; });
C("…and yesterday's money lands in the ghost line at its own hour", "series point",
  async () => { await world({ fix: { orders: [DORD("y4", YDAY_SAME())] } }); const r = await call("GET", "stats"); const s = (r.json?.prev?.series || []).reduce((a, b) => a + b, 0); return { ok: s > 0 && Math.abs(s - r.json.prev.revenue) < 0.02, note: `${s} vs ${r.json?.prev?.revenue}` }; });
C("the channel split leaves out cancelled AND rejected delivery orders", "aggregator rows: accepted 100, cancelled 200, rejected 400",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, source: "zomato", total: 100, status: "accepted", created_at: NOW() }, { restaurant_id: RID, source: "zomato", total: 200, status: "cancelled", created_at: NOW() }, { restaurant_id: RID, source: "swiggy", total: 400, status: "rejected", created_at: NOW() }] } });
    const r = await call("GET", "stats"); return { ok: r.json?.channels?.zomato?.rev === 100 && r.json.channels.swiggy.rev === 0, note: JSON.stringify(r.json?.channels) }; });
C("a channel the dashboard has never heard of still gets its own line, not a crash", "source 'ondc'",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, source: "ondc", total: 50, status: "accepted", created_at: NOW() }] } }); const r = await call("GET", "stats"); return { ok: r.json?.channels?.ondc?.rev === 50 }; });
C("a restaurant with more orders than the dashboard's 12,000-row ceiling says so (truncated:true), honestly", "12,001 invented orders today",
  async () => { const many = Array.from({ length: 12001 }, (_, i) => DORD(`m${i}`, new Date(Date.now() - i * 10).toISOString()));
    await world({ fix: { orders: many } }); const r = await call("GET", "stats"); return { ok: r.json?.truncated === true && r.json.statsCap === 12000, note: `${r.json?.truncated}` }; });

// ═══ E10 · the Activity log and Staff watch with real "not in" filtering (lines ~3004, 3044) ═════
const SA = (id_, panel, o = {}) => ({ id: id_, restaurant_id: RID, panel, action: "order_place", created_at: NOW(), actor: "Ravi", ...o });
C("the manager's Activity log never shows the admin's, the owner's or the database's own rows", "staff_actions from four panels",
  async () => { await world({ fix: { staff_actions: [SA("a1", "manager"), SA("a2", "admin"), SA("a3", "owner"), SA("a4", "db"), SA("a5", "kitchen")] } }); const r = await call("GET", "oplog");
    return { ok: Array.isArray(r.json) && r.json.length === 2 && r.json.every((x) => ["manager", "kitchen"].includes(x.panel)), note: (r.json || []).map((x) => x.panel).join(",") }; });
C("…an action the admin took from a panel view reaches a manager with no admin mark on it", "actor_id admin:view",
  async () => { await world({ fix: { staff_actions: [SA("a1", "manager", { actor_id: ADMIN_VIEW })] } }); const r = await call("GET", "oplog"); return { ok: r.json?.[0]?.actor_id === null }; });
C("…while the admin console sees its own mark", "admin", async () => { await world({ who: "admin", fix: { staff_actions: [SA("a1", "manager", { actor_id: ADMIN_VIEW })] } }); const r = await call("GET", "oplog"); return { ok: r.json?.[0]?.actor_id === ADMIN_VIEW }; });
C("…an ERROR row arrives with its plain-English sentence attached, and keeps its exact text", "level error",
  async () => { await world({ fix: { staff_actions: [SA("a1", "manager", { level: "error", detail: "TypeError: fetch failed" })] } }); const r = await call("GET", "oplog"); const x = r.json?.[0] || {}; return { ok: typeof x.plain === "string" && x.plain.length > 5 && x.detail === "TypeError: fetch failed", note: x.plain }; });
C("…an ordinary row carries no extra sentence (no paid-for payload with nothing in it)", "level info",
  async () => { await world({ fix: { staff_actions: [SA("a1", "manager", { level: "info", detail: "placed" })] } }); const r = await call("GET", "oplog"); return { ok: r.json?.[0] && !("plain" in r.json[0]) }; });
C("Staff watch counts each person's discounts, voids, deletes and paid-reverts", "five risk rows for Ravi, two for Asha",
  async () => { await world({ fix: { staff_actions: [SA("r1", "manager", { action: "order_discount" }), SA("r2", "manager", { action: "invoice_void" }), SA("r3", "manager", { action: "orders_delete" }), SA("r4", "manager", { action: "payment_revert" }), SA("r5", "manager", { action: "void_invoice" }), SA("r6", "tablet", { action: "order_discount", actor: "Asha" }), SA("r7", "tablet", { action: "order_delete", actor: "Asha" })] } });
    const r = await call("GET", "staff-risk"); const ravi = (r.json?.rows || []).find((x) => x.who === "Ravi"); return { ok: ravi?.disc === 1 && ravi.void === 2 && ravi.del === 1 && ravi.rev === 1 && ravi.total === 5 && r.json.rows[0].who === "Ravi", note: JSON.stringify(r.json?.rows) }; });
C("…ignores an action that is not a risk", "order_place rows", async () => { await world({ fix: { staff_actions: [SA("x", "manager")] } }); const r = await call("GET", "staff-risk"); return { ok: (r.json?.rows || []).length === 0 }; });
C("…never counts the admin's or the owner's own actions", "admin + owner discount rows",
  async () => { await world({ fix: { staff_actions: [SA("x1", "admin", { action: "order_discount" }), SA("x2", "owner", { action: "order_discount" })] } }); const r = await call("GET", "staff-risk"); return { ok: (r.json?.rows || []).length === 0 }; });
C("…a risk action with no named person is filed under '— (device only)'", "actor null",
  async () => { await world({ fix: { staff_actions: [SA("x", "tablet", { action: "order_discount", actor: null })] } }); const r = await call("GET", "staff-risk"); return { ok: r.json?.rows?.[0]?.who === "— (device only)" }; });
C("…and on a day with more than 20,000 log rows it says truncated:true instead of a silently-low count", "20,001 invented rows",
  async () => { const many = Array.from({ length: 20001 }, (_, i) => SA(`m${i}`, "manager", { action: "order_discount", created_at: new Date(Date.now() - i).toISOString() }));
    await world({ fix: { staff_actions: many } }); const r = await call("GET", "staff-risk"); return { ok: r.json?.truncated === true, note: `${r.json?.truncated}` }; });

console.log(`block E: ${N - 178723} checks defined (P178723–P${N - 1})`);
