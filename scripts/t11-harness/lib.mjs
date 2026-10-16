// scripts/t11-harness/lib.mjs — sweep #10 T11 ROUND 2's hermetic harness for the kitchen screen's server.
// (Fixture tickets are 20 seconds old: the live board only shows today's tickets from the 05:00 IST business-day
// cutover, so a ticket dated "5 minutes ago" vanished when the suite ran just after 05:00 — a clock artefact.)
//
// The REAL app/api/kitchen/[...path]/route.ts, run by Node (type-stripping) with the REAL libraries behind it —
// lib/userAuth (signed cookies, the role gate), lib/panelGate, lib/oplog, lib/printQueue, lib/printHelpers,
// lib/liveBoard, lib/clash, lib/idempotency, lib/floorSummary — and ONLY the database replaced, by the in-memory
// stub (scripts/t17-harness/sb.mjs via its hooks). Any fetch a check has not replaced is refused, so nothing
// leaves the Mac. Built on terminal 17's round-5 kit (scripts/t17-harness/), which already resolves @/ paths.
//
// Every check carries its OWN ledger id from T11's block (P180577–P181000) and names its SUBJECT file.
import { root } from "./hooks.mjs";
import { writeFileSync } from "node:fs";
import { createHmac, createHash, randomUUID } from "node:crypto";
// The kit below is the same shape as terminal 17's r5lib.mjs, kept here so ONLY T11's loader (and its stricter
// database stub) is registered — importing r5lib would register terminal 17's loader as well.
export const { G, resetWorld } = await import(root + "/scripts/panel-stubs/state.mjs");
G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {};
const { NextRequest } = await import("next/server.js");
process.env.SESSION_SECRET = "t11-session-secret-not-real";
for (const k0 of ["STAFF_PASSWORD", "EDITOR_PASSWORD", "TURNSTILE_SECRET_KEY"]) delete process.env[k0];
process.env.ADMIN_PASSWORD = "t11-admin-password-not-real";
export const ADMIN_PW = process.env.ADMIN_PASSWORD;
const b64url = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sign = (u, iat = Date.now()) => `${u.id}.${iat}.${b64url(createHmac("sha256", process.env.SESSION_SECRET).update(`${u.id}:${u.role}:${u.token_version ?? 0}:${iat}`).digest())}`;
export const sha = async (x) => createHash("sha256").update(x).digest("hex");
export function req(url, { method = "GET", cookies = {}, headers = {}, json, body } = {}) {
  const h = new Headers(headers);
  const ck = Object.entries(cookies).filter(([, v]) => v != null).map(([k1, v]) => `${k1}=${v}`).join("; ");
  if (ck) h.set("cookie", ck);
  let b2 = body;
  if (json !== undefined) { b2 = typeof json === "string" ? json : JSON.stringify(json); h.set("content-type", "application/json"); }
  return new NextRequest(new URL(url, "http://t11.local"), { method, headers: h, body: method === "GET" ? undefined : b2 });
}
export const RID_A = "00000000-0000-4000-8000-0000000000a1", RID_B = "00000000-0000-4000-8000-0000000000b2";
export { randomUUID };
export async function person(o = {}) {
  return { id: randomUUID(), username: "p", role: "kitchen", restaurant_id: RID_A, name: "P", phone: null, active: true, deleted_at: null, pin_hash: null,
    token_version: 0, can_self_reset: true, can_self_set_pin: false, profile_confirmed: true, permissions: null, assigned_tables: null, failed_count: 0,
    locked_until: null, last_seen_at: new Date().toISOString(), password_hash: "x", ...o };
}
const w0 = (fix) => { resetWorld(); G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {}; G.SCOPE_LOG = []; for (const [k1, v] of Object.entries(fix)) G.FIX[k1] = JSON.parse(JSON.stringify(v)); };
export const NET = []; globalThis.fetch = async (u) => { NET.push(String(u)); throw new TypeError("t11: network refused"); };
export const KF = "app/api/kitchen/[...path]/route.ts";
export const K = await import("@/app/api/kitchen/[...path]/route.ts");
export const PA = await import("@/lib/panelAccess.ts");

// ── people ─────────────────────────────────────────────────────────────────────────────────────
export const COOK = await person({ role: "kitchen", username: "cook1", name: "Cook One", restaurant_id: RID_A });
export const COOK_B = await person({ role: "kitchen", username: "cookb", name: "Cook Bee", restaurant_id: RID_B });
export const MGR = await person({ role: "manager", username: "mgr1", name: "Mgr One", restaurant_id: RID_A });
export const OWNER = await person({ role: "owner", username: "own1", name: "Owner One", restaurant_id: RID_A });
export const WAITER = await person({ role: "tablet", username: "wtr1", name: "Waiter One", restaurant_id: RID_A });
const ADMIN_TOKEN = await sha(ADMIN_PW);

// ── a restaurant world ─────────────────────────────────────────────────────────────────────────
export const NOW = () => new Date().toISOString();
export const AGO = (ms) => new Date(Date.now() - ms).toISOString();
export const ord = (id, o = {}) => ({ id, restaurant_id: RID_A, status: "preparing", archived: false, deleted_at: null, table_number: "4", kot_no: 11, created_at: AGO(20000), items: [{ title: "Soup", qty: 1, status: "preparing" }], session_id: null, placed_by: "Ravi", placed_by_id: WAITER.id, ...o });
export const item = (id, order_id, o = {}) => ({ id, order_id, restaurant_id: RID_A, status: "preparing", title: "Soup", qty: 1, created_at: AGO(20000), served_at: null, ...o });
export function world(o = {}) {
  w0({
    staff_users: [COOK, COOK_B, MGR, OWNER, WAITER, ...(o.staff || [])],
    restaurant_owners: [{ user_id: OWNER.id, restaurant_id: RID_A }],
    restaurants: [{ id: RID_A, slug: "fh", name: "French House", logo_text: "FH", accent_color: "#c00", active: true, deleted_at: null, owner_entitlements: {}, access_config: {}, manager_permissions: {} },
                  { id: RID_B, slug: "ag", name: "Aangan", logo_text: null, active: true, deleted_at: null, owner_entitlements: {}, access_config: {}, manager_permissions: {} }, ...(o.restaurants || [])],
    settings: [{ id: "sa", restaurant_id: RID_A, kitchen_can_accept_platform: false, auto_print_kot: false, auto_print_kot_allowed: false, platform_channels: {}, table_names: {}, modules: {}, ...(o.settings || {}) },
               { id: "sb", restaurant_id: RID_B, kitchen_can_accept_platform: true, auto_print_kot: true, auto_print_kot_allowed: true, platform_channels: { zomato: { on: true } }, table_names: { 4: "B-FOUR" }, modules: {} }],
    orders: [ord("o1"), ord("o2", { status: "received", table_number: "5", kot_no: 12 }), ord("ob", { restaurant_id: RID_B, kot_no: 99 })],
    order_items: [item("i1", "o1"), item("i2", "o1", { title: "Bread" }), item("i3", "o2", { status: "received" }), item("ib", "ob", { restaurant_id: RID_B })],
    menu_items: [{ id: "d1", restaurant_id: RID_A, title: "Soup", category: "Starters", tags: [] }, { id: "d2", restaurant_id: RID_A, title: "Cake", category: "Dessert", tags: ["sold-out", "veg"] }, { id: "db", restaurant_id: RID_B, title: "Theirs", tags: [] }],
    aggregator_orders: [{ id: "p1", restaurant_id: RID_A, source: "zomato", status: "accepted", kot_no: 40, created_at: AGO(600000), items: [{ title: "Wrap", qty: 2 }], customer_name: "Asha", customer_phone: "9", total: 100, payload: { secret: 1 }, status_history: [] },
                        { id: "p2", restaurant_id: RID_A, source: "parcel", status: "new", kot_no: 41, created_at: AGO(60000), items: [] },
                        { id: "pb", restaurant_id: RID_B, source: "zomato", status: "accepted", kot_no: 77, created_at: AGO(60000), items: [] }],
    sessions: [], table_tags: [], print_jobs: [], print_stations: [], print_agents: [], printer_events: [], blocklist: [], staff_actions: [],
    ...(o.fix || {}),
  });
  for (const r of [RID_A, RID_B]) PA.forgetRestaurant?.(r, [OWNER.id]);
}
/** Call the real kitchen route. who: cook | cookB | manager | owner | waiter | admin | none | expired */
export async function call(verb, path, o = {}) {
  const who = o.who || "cook";
  const cookies = { ...(o.cookies || {}) };
  const u = { cook: COOK, cookB: COOK_B, manager: MGR, owner: OWNER, waiter: WAITER }[who];
  if (u) cookies.lfh_user = sign(u, o.iat);
  if (who === "admin") cookies.lfh_staff_auth = ADMIN_TOKEN;
  if (who === "expired") cookies.lfh_user = sign(COOK, Date.now() - 400 * 24 * 3600 * 1000);
  if (o.device !== null) cookies.lfh_panel_device = o.device || "dev-a";
  const r = await K[verb](req("/api/kitchen/" + path + (o.query || ""), { method: verb, cookies, headers: o.headers, json: o.json, body: o.body }), { params: Promise.resolve({ path: path ? path.split("/") : [] }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text, headers: r.headers };
}
export const writes = (...t) => G.WRITES.filter((x) => !t.length || t.includes(x.table));
export const logs = (a) => (G.FIX.staff_actions || []).filter((r) => !a || r.action === a);

// ── the row registry ─────────────────────────────────────────────────────────────────────────
const rows = []; const seen = new Set();
export function k(id, file, check, ok, note = "", how = "HARNESS — the real file run by Node against an in-memory database (scripts/t11-harness)") {
  if (seen.has(id)) throw new Error("duplicate id " + id); seen.add(id);
  const n = +id.slice(1); if (n < 180577 || n > 181000) throw new Error(id + " is outside T11's remaining block");
  const pass = ok === true; rows.push({ id, file, check, how, mark: pass ? "✅" : "❌", note: String(note ?? "").slice(0, 220) });
  if (!pass || process.env.T11_ALL) console.log(`${pass ? "✅" : "❌"} ${id}  ${check}${note ? "  — " + String(note).slice(0, 150) : ""}`);
  if (process.env.T11_STRICT && !pass) { console.log("KILLED by " + id); process.exit(1); }
}
export function done(name) {
  const bad = rows.filter((r) => r.mark === "❌");
  if (process.env.T11_SAVE) writeFileSync(process.env.T11_SAVE + "/" + name + ".json", JSON.stringify(rows, null, 1));
  console.log(`\n${rows.length} rows · ${rows.length - bad.length} ✅ · ${bad.length} ❌`);
  process.exitCode = bad.length ? 1 : 0;
}
