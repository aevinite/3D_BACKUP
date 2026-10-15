// Block K — ROUND 2 (2026-10-15): checks written for the deliberate breaks that SURVIVED the first mutation
// pass (scripts/sweep/t4s10/mutate.mjs) — each one is a question no earlier check asked (P173901…).
// Part A runs the libraries and routes in memory; part B (./lab/k2-screens.mjs) drives the screens.
import { check, band, load, FILES, W, resetWorld, nextServer } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
const HOW = "STUB — real file in memory, stand-in database / phone (round 2: written for a surviving break)";
band(173901);
install();
const { NextRequest } = nextServer();
const RID = "aaaaaaaa-0000-4000-8000-000000000001";
const L = async (rel, o = {}) => { resetWorld(); return load(rel, o); };
const P = async (rel, path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(rel); };
const reqOf = (url, { method = "GET", headers = {}, body } = {}) => new NextRequest("http://localhost:4404" + url, { method, headers: new Headers(headers), body });
const json = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const has = (st, kind, col, val) => !!st && st.filters.some((f) => f.kind === kind && f.col === col && (val === undefined || f.val === val));
let ipN = 1; const ip = () => `192.0.2.${ipN++}`;
const BL = FILES.blocked;
const blockedWorld = ({ open = [], used = 0 } = {}) => {
  W.from.login_throttle = { data: [{ locked_until: new Date(Date.now() + 5 * 365 * 864e5).toISOString() }], error: null };
  W.from.unblock_requests = (st) => (st.op === "insert" ? { data: { id: "u1" }, error: null } : st.count ? { data: null, error: null, count: used } : { data: open, error: null });
};

// ── /api/blocked ──────────────────────────────────────────────────────────────────────────────────
check(BL, "GET: a blocked visitor with NO open request is told 'pending: false' — and the read asks for one row only", HOW, async () => {
  const r = await L(BL); blockedWorld({ open: [] }); const j = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } })));
  const st = W.fromLog.find((x) => x.table === "unblock_requests" && x.op === "select" && has(x, "eq", "status", "open"));
  return { ok: j.blocked === true && j.pending === false && !("pendingUnknown" in j) && has(st, "limit", null, 1), note: JSON.stringify(j) };
});
check(BL, "GET: …and one WITH an open request is told 'pending: true'", HOW, async () => {
  const r = await L(BL); blockedWorld({ open: [{ id: "u9" }] }); const j = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } }))); return { ok: j.pending === true, note: JSON.stringify(j) };
});
check(BL, "GET: past its own per-minute ceiling it answers the plain page shape — blocked, nothing used, nothing pending — and reads nothing", HOW, async () => {
  const r = await L(BL); blockedWorld(); const who = ip(); let last;
  for (let i = 0; i < 22; i++) last = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": who } })));
  return { ok: last.throttled === true && last.blocked === true && last.usedToday === 0 && last.remaining === 3 && last.pending === false, note: JSON.stringify(last) };
});
check(BL, "POST: a count we could not read refuses with ok:false (try later) — it never says the request went in", HOW, async () => {
  const r = await L(BL); blockedWorld(); W.from.unblock_requests = (st) => (st.count ? { data: null, error: { message: "count failed" }, count: null } : { data: [], error: null });
  const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" }))); return { ok: j.ok === false && j.reason === "try_later", note: JSON.stringify(j) };
});
check(BL, "POST: a message of only spaces is saved as NO message, a real one is trimmed and capped at 200", HOW, async () => {
  const r = await L(BL); blockedWorld(); await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ message: "    " }) }));
  const a = W.fromLog.find((x) => x.op === "insert"); resetWorld(); blockedWorld();
  await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ message: "  please " + "x".repeat(300) }) })); const b = W.fromLog.find((x) => x.op === "insert");
  return { ok: a.patch.message === null && b.patch.message.startsWith("please ") && b.patch.message.length === 200, note: `${JSON.stringify(a.patch.message)} / ${b.patch.message.length}` };
});

// ── lib/botCheck.ts ───────────────────────────────────────────────────────────────────────────────
check(FILES.bot, "verifyTurnstile with a secret set and an EMPTY token refuses at once, without asking Cloudflare", HOW, async () => {
  const b = await L(FILES.bot); const keepF = globalThis.fetch, keepS = process.env.TURNSTILE_SECRET_KEY; let asked = 0;
  globalThis.fetch = async () => { asked++; return { json: async () => ({ success: true }) }; }; process.env.TURNSTILE_SECRET_KEY = "s";
  try { const r = await b.verifyTurnstile(""); return { ok: r === false && asked === 0, note: `answered ${r}, asked ${asked}` }; }
  finally { globalThis.fetch = keepF; if (keepS === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = keepS; }
});

// ── lib/guestDevice.ts ────────────────────────────────────────────────────────────────────────────
check(FILES.gdev, "the ban/session device id is a real random UUID where the phone can make one, kept and reused", HOW, async () => {
  const g = await P(FILES.gdev); const a = g.getGuestDeviceId(), b = g.getGuestDeviceId();
  return { ok: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a) && a === b, note: a };
});

// ── lib/session.ts: the location check at its edges ───────────────────────────────────────────────
const geo = (lat, lng) => ({ getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lng } }) });
check(FILES.sess, "checkLocation: ~240 m from the café with a 250 m radius is NEAR, ~260 m is FAR (the distance is measured, not guessed)", HOW, async () => {
  const s = await P(FILES.sess); const M = 1 / 111195; // ≈ degrees of latitude per metre
  phone.geo = geo(19 + 240 * M, 72.8); const a = await s.checkLocation(19, 72.8, 250); phone.geo = geo(19 + 260 * M, 72.8); const b = await s.checkLocation(19, 72.8, 250);
  phone.geo = geo(19, 72.8 + 240 * M / Math.cos(19 * Math.PI / 180)); const c = await s.checkLocation(19, 72.8, 250);
  return { ok: a.near && !b.near && c.near, note: `${a.reason} / ${b.reason} / east ${c.reason}` };
});
check(FILES.sess, "…a café with only HALF a location set (latitude, no longitude) counts as not set — everyone is let through", HOW, async () => {
  const s = await P(FILES.sess); phone.geo = null; const a = await s.checkLocation(19, null, 250); phone.geo = geo(1, 1); const b = await s.checkLocation(null, 72.8, 250);
  return { ok: a.near && a.reason === "bypassed" && b.near && b.reason === "bypassed", note: `${a.reason} / ${b.reason}` };
});

// ── lib/sessionClose.ts ───────────────────────────────────────────────────────────────────────────
const SC = FILES.close;
const closeWorld = ({ live = [], owed = [], session = { id: "s1", restaurant_id: RID, table_number: "4" } } = {}) => {
  W.from.sessions = (st) => (st.op === "select" ? { data: { id: "s1" }, error: null } : { data: [session], error: null });
  W.from.orders = (st) => (st.op === "select" && /payment_status/.test(st.cols || "") ? { data: live, error: null } : st.op === "select" ? { data: owed, error: null } : { data: [], error: null });
  W.from.session_members = { data: [], error: null }; W.from.waiter_calls = { data: [], error: null }; W.from.requests = { data: [], error: null };
};
const ctx = (o = {}) => ({ panel: "editor", restaurantId: RID, deviceId: "dev-1", ...o });
check(SC, "each 'can't close yet' reason has its OWN sentence: money only, cooking only, or both", HOW, async () => {
  const f = (await L(SC)).closeBlock; const u = f([{ status: "served", payment_status: "pending" }], false).message, c = f([{ status: "preparing", payment_status: "paid" }], false).message, b = f([{ status: "preparing", payment_status: "pending" }], false).message;
  return { ok: /owes money/.test(u) && !/cooking/.test(u) && /cooking/.test(c) && !/owes money/.test(c) && /owes money/.test(b) && /cooking/.test(b) && new Set([u, c, b]).size === 3, note: [u, c, b].map((m) => m.slice(0, 30)).join(" | ") };
});
check(SC, "a FORCED close goes through even with food still cooking and money unpaid (the staff chose 'close anyway')", HOW, async () => {
  const m = await L(SC); closeWorld({ live: [{ id: "o1", status: "preparing", payment_status: "pending" }], owed: [{ id: "o1", total: 100, discount: 0, subtotal: 100, tax: 0, khata_at: null }] });
  const r = await m.closeSession("s1", { force: true }, ctx()); return { ok: r.ok === true && W.fromLog.some((x) => x.table === "sessions" && x.op === "update"), note: JSON.stringify(r).slice(0, 80) };
});
check(SC, "…and an UNforced close of that table is refused 409 'both'", HOW, async () => {
  const m = await L(SC); closeWorld({ live: [{ id: "o1", status: "preparing", payment_status: "pending" }] }); const r = await m.closeSession("s1", {}, ctx());
  return { ok: r.ok === false && r.status === 409 && r.reason === "both" && !W.fromLog.some((x) => x.op === "update"), note: JSON.stringify(r).slice(0, 80) };
});
check(SC, "the money-still-owed read is this session, this restaurant, NOT archived, not cancelled, and bounded at 500", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [] }); await m.closeSession("s1", { force: true }, ctx()); const st = W.fromLog.find((x) => x.table === "orders" && x.op === "select" && /khata_at/.test(x.cols || ""));
  return { ok: has(st, "eq", "session_id", "s1") && has(st, "eq", "restaurant_id", RID) && has(st, "eq", "archived", false) && has(st, "neq", "status", "cancelled") && has(st, "limit", null, 500), note: JSON.stringify(st && st.filters) };
});
check(SC, "a forced close cancels only the LIVE (not archived) orders of this session and restaurant", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 100, discount: 0, subtotal: 100, tax: 0, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const up = W.fromLog.find((x) => x.table === "orders" && x.op === "update"); return { ok: has(up, "eq", "session_id", "s1") && has(up, "eq", "restaurant_id", RID) && has(up, "eq", "archived", false), note: JSON.stringify(up && up.filters) };
});
check(SC, "the walk-out record keeps the person's own note when they gave one, and the plain default when they did not", HOW, async () => {
  const m = await L(SC); const owed = [{ id: "o1", total: 100, discount: 0, subtotal: 100, tax: 0, khata_at: null }];
  closeWorld({ owed }); await m.closeSession("s1", { force: true }, ctx({ reason: { code: "walkout", note: "left without paying" } })); const a = (W.misc.log || []).find((x) => x.k === "recordRemoval");
  resetWorld(); closeWorld({ owed }); await m.closeSession("s1", { force: true }, ctx()); const b = (W.misc.log || []).find((x) => x.k === "recordRemoval");
  return { ok: a.v.reason.note === "left without paying" && a.v.reason.code === "walkout" && /^Table closed while the bill was still unpaid/.test(b.v.reason.note) && b.v.reason.code === null, note: `${a.v.reason.note} / ${b.v.reason.note.slice(0, 30)}` };
});
check(SC, "…and it says, in its own fields, that this was a closed-unpaid table: how many orders, and the amount owed to the paisa", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 100.25, discount: 0, subtotal: 100, tax: 0, khata_at: null }, { id: "o2", total: 50.13, discount: 0, subtotal: 50, tax: 0, khata_at: null }] });
  await m.closeSession("s1", { force: true }, ctx()); const r = (W.misc.log || []).find((x) => x.k === "recordRemoval").v.meta;
  return { ok: r.closed_unpaid === true && r.orders_on_bill === 2 && r.owed === 150.38 && r.panel === "editor", note: JSON.stringify(r) };
});
check(SC, "clearing a table's leftover calls touches only calls still OPEN (resolved = false), for this restaurant and table", HOW, async () => {
  const m = await L(SC); await m.clearTableSignals(RID, 4); const up = W.fromLog.find((x) => x.table === "waiter_calls" && x.op === "update");
  return { ok: has(up, "eq", "resolved", false) && has(up, "eq", "restaurant_id", RID) && has(up, "eq", "table_number", "4") && up.patch.resolved === true, note: JSON.stringify(up && up.filters) };
});

// ── lib/tableAssign.ts ────────────────────────────────────────────────────────────────────────────
const TA = FILES.assign;
check(TA, "newWaiterTables: the LAST table of the floor can be given to a waiter (table 5 of 5 is kept)", HOW, async () => {
  const m = await L(TA); W.from.settings = { data: { table_count: 5 }, error: null }; return { ok: JSON.stringify(await m.newWaiterTables(RID, [5, 4])) === "[4,5]" };
});
check(TA, "…a pick of '10' on a 12-table floor is table 10 (read as a plain number), and the floor read names THIS restaurant", HOW, async () => {
  const m = await L(TA); W.from.settings = { data: { table_count: 12 }, error: null }; const r = await m.newWaiterTables(RID, ["10", "12"]); const st = W.fromLog.find((x) => x.table === "settings");
  return { ok: JSON.stringify(r) === "[10,12]" && has(st, "eq", "restaurant_id", RID), note: `${JSON.stringify(r)} · ${JSON.stringify(st && st.filters)}` };
});
check(TA, "…a one-table restaurant's floor is exactly table 1 — a pick of 2 is not granted", HOW, async () => {
  const m = await L(TA); W.from.settings = { data: { table_count: 1 }, error: null }; return { ok: JSON.stringify(await m.newWaiterTables(RID, [1, 2])) === "[1]" };
});
check(TA, "waiterTables: a floor read that THREW keeps the error it threw (so the route can say busy), not a made-up one", HOW, async () => {
  const m = await L(TA); W.from.settings = "throw"; const l = await m.waiterTables({ role: "tablet", tables: [1], restaurant_id: RID }, RID);
  return { ok: !!l.floorUnknown && /unreachable/.test(String(l.floorUnknown.message)), note: String(l.floorUnknown && l.floorUnknown.message) };
});

// ── lib/tableConnection.ts: the sessions-switch watcher ──────────────────────────────────────────
const REAL_ST = globalThis.setTimeout;
const settled = (ms = 200) => new Promise((r) => REAL_ST(r, ms));
const fastClock = () => { const real = REAL_ST; globalThis.setTimeout = (fn) => real(fn, 0); return () => { globalThis.setTimeout = real; }; };
check(FILES.conn, "watchSessionsSwitch: the 'it failed' fallback runs on the FIRST failure — once — even when the second ask succeeds", HOW, async () => {
  const c = await P(FILES.conn); let n = 0; W.rpc.lfh_guest_settings = () => (++n === 1 ? { data: null, error: { message: "x" } } : { data: { sessions_enabled: true }, error: null });
  const restore = fastClock(); let fails = 0; const got = [];
  try { const stop = c.watchSessionsSwitch(RID, (s) => got.push(s.sessionsEnabled), () => fails++); await settled(); stop(); } finally { restore(); }
  return { ok: fails === 1 && got.join() === "true", note: `fallback ${fails}, answers ${got}` };
});
check(FILES.conn, "…stopping the watcher BEFORE the answer arrives means that answer is never delivered (no update after the screen is gone)", HOW, async () => {
  const c = await P(FILES.conn); let release; W.rpc.lfh_guest_settings = () => new Promise((r) => { release = () => r({ data: { sessions_enabled: true }, error: null }); });
  const got = []; const stop = c.watchSessionsSwitch(RID, (s) => got.push(s)); await settled(20); stop(); release(); await settled(40);
  return { ok: got.length === 0, note: `${got.length} delivered` };
});
check(FILES.conn, "…and stopping it while a retry is waiting cancels that retry — no ask after stop", HOW, async () => {
  const c = await P(FILES.conn); let n = 0; W.rpc.lfh_guest_settings = () => { n++; return { data: null, error: { message: "x" } }; };
  const stop = c.watchSessionsSwitch(RID, () => {}); await settled(40); stop(); const before = n; await settled(2800);
  return { ok: before === 1 && n === 1, note: `${before} → ${n}` };
});

// ── part B: the screens, in the lab ──────────────────────────────────────────────────────────────
await import("./lab/k2-screens.mjs");
// ── part C: what pass 2 of the deliberate-break test still found unasked ─────────────────────────
await import("./lab/k3-pass2.mjs");
