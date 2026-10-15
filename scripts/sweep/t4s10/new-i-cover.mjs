// Block I — ROUND 2 (2026-10-15): the lines and branches of the in-memory files that NO earlier check
// ever ran, as measured by scripts/sweep/t4s10/cover.mjs (P173601…). Each check names the branch it was
// written for, and asks the question a restaurant would ask of it — what does this answer when the
// thing it leans on is missing, empty, or broken?
import { check, band, load, FILES, W, resetWorld, OPTIONAL, nextServer } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
const HOW = "STUB — real file in memory, stand-in database / phone (round 2: closes a measured gap)";
band(173601);
install();
const { NextRequest } = nextServer();
const RID = "aaaaaaaa-0000-4000-8000-000000000001";
const L = async (rel, o = {}) => { resetWorld(); return load(rel, o); };
const P = async (rel, path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(rel); };
const reqOf = (url, { method = "GET", headers = {}, body, cookies = {} } = {}) => {
  const h = new Headers(headers); const ck = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "); if (ck) h.set("cookie", ck);
  return new NextRequest("http://localhost:4404" + url, { method, headers: h, body });
};
const json = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const flush = () => new Promise((r) => setTimeout(r, 10));
let ipN = 100; const ip = () => `198.51.100.${ipN++}`;
const BL = FILES.blocked, IM = FILES.media, MD = FILES.menuData, RT = FILES.rt;

// ── /api/blocked: the count that THREW (L44–45) ─────────────────────────────────────────────────
const blockedThrows = () => {
  W.from.login_throttle = { data: [{ locked_until: new Date(Date.now() + 5 * 365 * 864e5).toISOString() }], error: null };
  W.from.unblock_requests = (st) => { if (st.count) throw new Error("stand-in: socket hang up"); return { data: [], error: null }; };
};
check(BL, "POST: a request count that THREW (database unreachable) is 'could not count' → 503 try_later, and nothing is written", HOW, async () => {
  const r = await L(BL); blockedThrows(); const res = await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })); const j = await json(res);
  return { ok: res.status === 503 && j.reason === "try_later" && j.transient === true && !W.fromLog.some((x) => x.op === "insert"), note: `${res.status} ${JSON.stringify(j)}` };
});
check(BL, "GET: …and the blocked page still renders for that visitor (a count we could not read shows as 0 used, 3 left)", HOW, async () => {
  const r = await L(BL); blockedThrows(); const j = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } })));
  return { ok: j.blocked === true && j.usedToday === 0 && j.remaining === 3, note: JSON.stringify(j) };
});
check(BL, "POST: a count that came back EMPTY (no number, no error) counts as none used — the request is taken", HOW, async () => {
  const r = await L(BL); W.from.login_throttle = { data: [{ locked_until: new Date(Date.now() + 5 * 365 * 864e5).toISOString() }], error: null };
  W.from.unblock_requests = (st) => (st.op === "insert" ? { data: { id: "u1" }, error: null } : st.count ? { data: null, error: null, count: null } : { data: [], error: null });
  const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })));
  return { ok: j.ok === true && j.remaining === 2, note: JSON.stringify(j) };
});

// ── /api/issue-media: a failure that is not an Error object (L98–102) ──────────────────────────────
const fd = (parts) => { const f = new FormData(); for (const [k, v] of Object.entries(parts)) f.append(k, v); return f; };
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "p.png", { type: "image/png" });
check(IM, "a storage failure thrown as a bare value (not an Error) is still a plain 503 'photo couldn't be uploaded', never the raw value", HOW, async () => {
  const r = await L(IM);
  W.auth.user = { role: "kitchen", restaurant_id: RID }; W.misc.storeThrowsValue = { code: "ECONNRESET" };
  const res = await r.POST(reqOf("/api/issue-media", { method: "POST", body: fd({ file: png(), kind: "image" }), cookies: { lfh_user: "t" } })); const j = await json(res);
  return { ok: res.status === 503 && res.headers.get("X-LFH-Busy") === "1" && /^The photo couldn't be uploaded just now/.test(j.error) && !/ECONNRESET|object/.test(j.error), note: j.error };
});

// ── /api/rt-config: the two arms no check took (L48, L75) ─────────────────────────────────────────
check(RT, "a sign-in lookup that fails for a reason OTHER than a busy database is not dressed up as 'busy' — it is raised", HOW, async () => {
  const r = await L(RT); W.auth.badCookie = true;
  const out = await r.GET(reqOf("/api/rt-config", { cookies: { lfh_user: "tok" } })).then((res) => `answered ${res.status}`, (e) => `raised: ${e.message}`);
  return { ok: out === "raised: bad cookie", note: out };
});
check(RT, "the public key missing (URL set) is the same 'not configured' 503 as the URL missing — both halves are checked", HOW, async () => {
  const keep = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const r = await L(RT); delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try { const res = await r.GET(reqOf("/api/rt-config")); const j = await json(res); return { ok: res.status === 503 && j.reason === "rt_unconfigured", note: `${res.status} ${j.reason}` }; }
  finally { process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = keep; }
});

// ── /api/r/<slug>/menu-data: the last-resort catch (L115–116) ─────────────────────────────────────
check(MD, "a menu bundle that cannot even be turned into text (a loop inside it) answers 503 'try again', never a bare 500", HOW, async () => {
  const r = await L(MD, { extra: OPTIONAL }); W.misc.restaurant = { id: RID, slug: "aangan", active: true }; W.rpc.lfh_guest_settings = { data: { menu_enabled: true }, error: null };
  const loop = { items: [] }; loop.self = loop; W.misc.bundle = loop;
  const res = await r.GET(reqOf("/api/r/aangan/menu-data"), { params: Promise.resolve({ restaurant: "aangan" }) }); const j = await json(res);
  return { ok: res.status === 503 && j.transient === true && res.headers.get("cache-control") === "no-store", note: `${res.status}` };
});

check(MD, "…and one whose turning-into-text throws something that is not even an Error still answers 503, logged as what it was", HOW, async () => {
  const r = await L(MD, { extra: OPTIONAL }); W.misc.restaurant = { id: RID, slug: "aangan", active: true }; W.rpc.lfh_guest_settings = { data: { menu_enabled: true }, error: null };
  W.misc.bundle = { toJSON() { throw "not an error"; } }; const logged = []; const keep = console.error; console.error = (...a) => logged.push(a);
  try { const res = await r.GET(reqOf("/api/r/aangan/menu-data"), { params: Promise.resolve({ restaurant: "aangan" }) }); return { ok: res.status === 503 && logged.some((a) => a[1] === "not an error"), note: `${res.status}` }; }
  finally { console.error = keep; }
});

// ── lib/botCheck.ts: turnstileSiteKey (L111) ──────────────────────────────────────────────────────
check(FILES.bot, "turnstileSiteKey() is '' when the key is unset, and the key itself when set (the forms read it to decide)", HOW, async () => {
  const keep = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; const b = await L(FILES.bot);
  try { delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; const a = b.turnstileSiteKey(); process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-k"; const c = b.turnstileSiteKey(); return a === "" && c === "site-k"; }
  finally { if (keep === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = keep; }
});

// ── lib/guestName.ts: the worst addresses and browsers the name helper can meet (L59–60, L90, L93) ──
// MEASURED (cover.mjs): the catches at L59 and L90 are UNREACHABLE — tget/tset swallow every failure
// underneath them (even tenantSlug() throwing on a damaged percent-escape), and tidyGuestName cannot
// throw. They are a harmless second net, recorded as such in the findings, not a fault. What CAN be
// asked is that the answers stay right on the worst input: a damaged address (middleware.ts redirects
// one before any page runs, so a diner never sees it) and a browser whose events are blocked (L93).
check(FILES.gname, "on a damaged address getGuestName() answers '' — the render it runs in never throws", HOW, async () => {
  const g = await P(FILES.gname, "/r/%E0%A4/menu"); try { return g.getGuestName() === ""; } catch { return false; }
});
check(FILES.gname, "…and setGuestName() answers false (nothing kept → no 'saved as your name'), without throwing", HOW, async () => {
  const g = await P(FILES.gname, "/r/%E0%A4/menu"); try { return g.setGuestName("Mia") === false; } catch { return false; }
});
check(FILES.gname, "a browser whose events are blocked still KEEPS the name and still renames past reviews (the event is best-effort)", HOW, async () => {
  const g = await P(FILES.gname); const keep = globalThis.window.dispatchEvent; globalThis.window.dispatchEvent = () => { throw new Error("events blocked"); };
  try { const r = g.setGuestName("Ravi", "RID"); await flush(); return { ok: r === true && g.getGuestName() === "Ravi" && W.rpcLog.some((x) => x.fn === "lfh_rename_my_reviews"), note: `answered ${r}` }; }
  finally { globalThis.window.dispatchEvent = keep; }
});

// ── lib/openSession.ts: an insert that returned no row (L65) ──────────────────────────────────────
check(FILES.open, "opening a free table whose insert answers no row returns null — never undefined, never a crash", HOW, async () => {
  const m = await L(FILES.open); W.from.sessions = (st) => (st.op === "select" ? { data: [], error: null } : { data: [], error: null });
  const r = await m.openTableSession(RID, "4"); return { ok: r === null, note: JSON.stringify(r) };
});

// ── lib/session.ts: the offline test, run in memory (L169–173), and three small arms ────────────────
const SS = FILES.sess;
check(SS, "isNetworkFailureText: what Chrome, Firefox and Safari say with no signal is recognised; a busy answer, a refusal and nothing at all are not", HOW, async () => {
  const s = await P(SS);
  const yes = ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "The network connection was lost.", "The Internet connection appears to be offline.", "Network request failed"];
  const no = ["timed_out", "empty", "permission denied", "no_open_session", "", null, undefined, 0];
  return { ok: yes.every((t) => s.isNetworkFailureText(t)) && no.every((t) => !s.isNetworkFailureText(t)), note: `${yes.filter((t) => !s.isNetworkFailureText(t)).length} missed, ${no.filter((t) => s.isNetworkFailureText(t)).length} wrongly matched` };
});
check(SS, "isPhoneOffline: a busy restaurant (timed_out) is NEVER the phone's fault — not even when the phone also says it is offline", HOW, async () => {
  const s = await P(SS); phone.online = false; return s.isPhoneOffline({ reason: "timed_out" }) === false;
});
check(SS, "…a phone that says it is offline is offline, whatever the answer said (and with no answer at all)", HOW, async () => {
  const s = await P(SS); phone.online = false; return s.isPhoneOffline({ reason: "something odd" }) === true && s.isPhoneOffline(null) === true && s.isPhoneOffline() === true;
});
check(SS, "…an online phone whose request died at the network ('Failed to fetch') is offline; any other answer is not", HOW, async () => {
  const s = await P(SS); phone.online = true;
  return s.isPhoneOffline({ reason: "TypeError: Failed to fetch" }) === true && s.isPhoneOffline({ reason: "permission denied" }) === false && s.isPhoneOffline(null) === false && s.isPhoneOffline({}) === false;
});
check(SS, "a phone where reading AbortSignal.timeout THROWS still makes the call — just without a deadline", HOW, async () => {
  const s = await P(SS); const keep = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, get() { throw new Error("not supported"); } });
  try { const r = await s.tableStatus("7", "RID"); const call = W.rpcLog.find((x) => x.fn === "lfh_table_status"); return { ok: !!call && call.signal === false && r.ok === true, note: JSON.stringify(call) }; }
  finally { Object.defineProperty(AbortSignal, "timeout", keep); }
});
check(SS, "a database error with NO message is not mistaken for a timeout and does not crash — it comes back as an empty reason", HOW, async () => {
  const s = await P(SS); W.rpc.lfh_table_status = { data: null, error: {} }; const r = await s.tableStatus("7", "RID");
  return { ok: r.ok === false && r.reason !== "timed_out" && !s.isSessionTimeout(r), note: JSON.stringify(r) };
});
check(SS, "the limit-hit nudge whose request REJECTS later is swallowed — the guest still gets 'rate_limited', nothing unhandled", HOW, async () => {
  const s = await P(SS); const keep = globalThis.fetch; let unhandled = 0; const onU = () => { unhandled++; }; process.on("unhandledRejection", onU);
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  try { W.rpc.lfh_call_waiter = { data: { ok: false, reason: "rate_limited" }, error: null }; const r = await s.callWaiterSession("tok", "x"); await flush(); return { ok: r.reason === "rate_limited" && unhandled === 0, note: `unhandled ${unhandled}` }; }
  finally { globalThis.fetch = keep; process.off("unhandledRejection", onU); }
});
check(SS, "requestUnban with no restaurant sends p_restaurant_id null (the database's own 'not this café' answer), never undefined", HOW, async () => {
  const s = await P(SS); await s.requestUnban("98765"); const c = W.rpcLog.find((x) => x.fn === "lfh_request_unban"); return { ok: !!c && c.args.p_restaurant_id === null && "p_restaurant_id" in c.args, note: JSON.stringify(c && c.args) };
});

// ── lib/sessionClose.ts: the owed sum and the log fields with things missing (L141–145, L191–192) ──
const SC = FILES.close;
const closeWorld = ({ owed = [], session = { id: "s1", restaurant_id: RID, table_number: "4" }, updated = undefined } = {}) => {
  W.from.sessions = (st) => (st.op === "select" ? { data: { id: "s1" }, error: null } : { data: updated !== undefined ? updated : session ? [session] : [], error: null });
  W.from.orders = (st) => (st.op === "select" && /payment_status/.test(st.cols || "") ? { data: [], error: null } : st.op === "select" ? { data: owed, error: null } : { data: [], error: null });
  W.from.session_members = { data: [], error: null }; W.from.waiter_calls = { data: [], error: null }; W.from.requests = { data: [], error: null };
};
const ctx = (o = {}) => ({ panel: "tablet", restaurantId: RID, deviceId: "dev-1", ...o });
const logOf = (action) => (W.misc.log || []).find((x) => x.k === "logAction" && x.v.action === action);
check(SC, "the owed amount of an order with no subtotal (0) takes its discount at face value — no divide-by-zero, no NaN", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 300, discount: 20, subtotal: 0, tax: 15, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const la = logOf("close_unpaid"); return { ok: !!la && /₹280 owed$/.test(la.v.fields.detail), note: la && la.v.fields.detail };
});
check(SC, "…an order whose money fields are blank or not numbers counts as ₹0 owed, never 'NaN'", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: null, discount: "x", subtotal: undefined, tax: "", khata_at: null }, { id: "o2", total: "100", discount: null, subtotal: "100", tax: null, khata_at: null }] });
  await m.closeSession("s1", { force: true }, ctx()); const la = logOf("close_unpaid"); return { ok: !!la && la.v.fields.detail === "closed with 2 unpaid orders, ₹100 owed", note: la && la.v.fields.detail };
});
check(SC, "…a session row missing its restaurant / table, and a device with no id, are logged as 'unknown' — never the word 'null' or a crash", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 50, discount: 0, subtotal: 50, tax: 0, khata_at: null }], session: { id: "s1" } }); await m.closeSession("s1", { force: true }, ctx({ deviceId: undefined }));
  const a = logOf("close_unpaid"), b = logOf("table_close");
  return { ok: !!a && a.v.fields.restaurant_id === undefined && a.v.fields.table_number === null && a.v.fields.device_id === undefined && !!b && b.v.fields.restaurant_id === undefined && b.v.fields.table_number === null, note: JSON.stringify(a && a.v.fields) };
});
check(SC, "a close whose session row vanished under it (no row updated) answers ok with session null, logs the close, and touches no member or signal", HOW, async () => {
  const m = await L(SC); closeWorld({ updated: [] }); const r = await m.closeSession("s1", { force: true }, ctx());
  return { ok: r.ok === true && r.session === null && !!logOf("table_close") && !W.fromLog.some((x) => x.table === "session_members" && x.op === "update"), note: JSON.stringify(r) };
});

// ── lib/tableAssign.ts: a restaurant with no floor at all (L151) ──────────────────────────────────
check(FILES.assign, "newWaiterTables on a restaurant with NO tables set up refuses every pick ('Pick at least one') instead of granting table 0", HOW, async () => {
  const m = await L(FILES.assign); W.from.settings = { data: { table_count: 0 }, error: null }; const r = await m.newWaiterTables(RID, [1, 2]).then((x) => `granted ${JSON.stringify(x)}`, (e) => e.message);
  return { ok: /^Pick at least one/.test(r), note: r.slice(0, 80) };
});

// ── lib/tableMerge.ts: no table at all (L24) ───────────────────────────────────────────────────────
check(FILES.merge, "mergeParentTable with no table (empty, null, spaces) answers '' and reads nothing", HOW, async () => {
  const f = (await L(FILES.merge)).mergeParentTable; const sb = { from: (t) => { W.fromLog.push({ table: t }); throw new Error("must not read"); } };
  const out = [await f(sb, RID, ""), await f(sb, RID, null), await f(sb, RID, "   ")]; return { ok: out.every((x) => x === "") && W.fromLog.length === 0, note: JSON.stringify(out) };
});

// ── lib/tenantStorage.ts: an empty address and a refused tab pin (L30, L61) ───────────────────────
check(FILES.ts, "tenantSlug() with an empty address falls back to this tab's pin, else restaurant #1 — never a throw", HOW, async () => {
  const T = await P(FILES.ts, ""); const a = T.tenantSlug(); phone.ss.set("lfh_tab_tenant", "sakura-sushi"); const b = T.tenantSlug(); return { ok: a === "french-house" && b === "sakura-sushi", note: `${a} / ${b}` };
});
check(FILES.ts, "…a bare /menu with tab storage switched off is still restaurant #1, without throwing", HOW, async () => {
  const T = await P(FILES.ts, "/menu"); phone.ssBlocked = true; try { return T.tenantSlug() === "french-house"; } catch { return false; }
});
