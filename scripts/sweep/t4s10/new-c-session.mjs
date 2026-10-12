// Block C — lib/session.ts RUN on a stand-in phone with a stand-in public database client (P173144…).
// What the guest's phone keeps about its table, how every database answer is translated (a busy
// restaurant must come back as `timed_out`; a dropped signal must NOT — item 1 depends on that split),
// the single-flight state read, and the soft location check.
import { check, band, load, FILES, W, resetWorld } from "./lib.mjs";
import { install, reset, phone } from "./phone.mjs";
const F = FILES.sess, HOW = "STUB — real lib/session.ts, stand-in database client";
band(173144);
install();
const S = async (path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(F); };
const put = (v) => phone.ls.set("lfh_session:aangan", typeof v === "string" ? v : JSON.stringify(v));
const GOOD = { table: "4", token: "tok", memberId: "m1", role: "guest" };
for (const [what, val, want] of [
  ["nothing saved → null", undefined, null], ["a real note → the note", GOOD, "tok"], ["a parsed NUMBER is not a session", "42", null],
  ["…nor a parsed null", "null", null], ["…nor an array", "[1,2]", null], ["…nor a string", '"abc"', null],
  ["a note with no token is not a session", { table: "4" }, null], ["…nor one with an empty token", { ...GOOD, token: "" }, null],
  ["…nor one whose token is a number", { ...GOOD, token: 7 }, null], ["corrupt text answers null, never a throw", "{not json", null],
]) {
  check(F, `getStoredSession(): ${what}`, HOW, async () => { const s = await S(); if (val !== undefined) put(val); const r = s.getStoredSession(); return { ok: (r ? r.token : null) === want, note: JSON.stringify(r) }; });
}
check(F, "getStoredSession(table): a token for table 4 is never used at table 8", HOW, async () => { const s = await S(); put(GOOD); return s.getStoredSession("8") === null && s.getStoredSession("4")?.token === "tok"; });
check(F, "getStoredSession(): another restaurant's saved session is invisible here", HOW, async () => { const s = await S(); phone.ls.set("lfh_session:sakura-sushi", JSON.stringify(GOOD)); return s.getStoredSession() === null; });
check(F, "getStoredSession(): storage switched off answers null, never a throw", HOW, async () => { const s = await S(); phone.lsBlocked = true; try { return s.getStoredSession() === null; } catch { return false; } });
check(F, "storeSession() writes the tenant-scoped key, and clearStoredSession() removes it", HOW, async () => {
  const s = await S(); s.storeSession(GOOD); const had = phone.ls.has("lfh_session:aangan"); s.clearStoredSession(); return had && !phone.ls.has("lfh_session:aangan");
});
// ── every wrapper calls exactly ONE named database function, with the arguments the server expects
const DEV = "dev-0001";
const wrappers = [
  ["greetDevice", (s) => s.greetDevice("RID"), "lfh_greet_device", { p_restaurant_id: "RID", p_device_id: DEV }],
  ["tableStatus", (s) => s.tableStatus("7", "RID"), "lfh_table_status", { p_table: "7", p_restaurant_id: "RID" }],
  ["joinSession", (s) => s.joinSession("7", "Mia", 1.5, 2.5, "RID"), "lfh_join_session", { p_table: "7", p_name: "Mia", p_lat: 1.5, p_lng: 2.5, p_device: DEV, p_restaurant_id: "RID" }],
  ["checkBan", (s) => s.checkBan("RID"), "lfh_check_ban", { p_device: DEV, p_phone: null, p_restaurant_id: "RID" }],
  ["requestUnban", (s) => s.requestUnban("98765", "RID"), "lfh_request_unban", { p_device: DEV, p_phone: "98765", p_restaurant_id: "RID" }],
  ["getSessionState", (s) => s.getSessionState("tok"), "lfh_session_state", { p_token: "tok" }],
  ["touchSession", (s) => s.touchSession("tok"), "lfh_touch_session", { p_token: "tok" }],
  ["leaveSession", (s) => s.leaveSession("tok"), "lfh_leave_session", { p_token: "tok" }],
  ["requestAccess", (s) => s.requestAccess("7", "open", "Mia", null, "RID"), "lfh_request", { p_table: "7", p_type: "open", p_name: "Mia", p_phone: null, p_restaurant_id: "RID" }],
  ["approveMember", (s) => s.approveMember("own", "m2", "Ravi"), "lfh_approve_member", { p_owner_token: "own", p_member_id: "m2", p_name: "Ravi" }],
  ["removeMember", (s) => s.removeMember("own", "m2"), "lfh_remove_member", { p_owner_token: "own", p_member_id: "m2" }],
  ["setMemberName", (s) => s.setMemberName("tok", "Mia"), "lfh_set_member_name", { p_token: "tok", p_name: "Mia" }],
  ["setAutoApprove", (s) => s.setAutoApprove("own", true), "lfh_set_auto_approve", { p_owner_token: "own", p_value: true }],
  ["sendOtp", (s) => s.sendOtp("98765", "RID"), "lfh_send_otp", { p_phone: "98765", p_restaurant_id: "RID" }],
  ["verifyOtp", (s) => s.verifyOtp("tok", "98765", "1234"), "lfh_verify_otp", { p_token: "tok", p_phone: "98765", p_code: "1234" }],
  ["getSessionCart", (s) => s.getSessionCart("tok"), "lfh_get_cart", { p_token: "tok" }],
  ["setSessionCart", (s) => s.setSessionCart("tok", [{ id: "d" }]), "lfh_set_cart", { p_token: "tok", p_cart: [{ id: "d" }], p_seen: null }],
  ["mergeSessionCart", (s) => s.mergeSessionCart("tok", [1], [2], [3]), "lfh_merge_cart", { p_token: "tok", p_added: [1], p_removed: [2], p_qty: [3] }],
  ["callWaiterSession", (s) => s.callWaiterSession("tok", "Water"), "lfh_call_waiter", { p_token: "tok", p_reason: "Water" }],
];
for (const [name, call, fn, args] of wrappers) {
  check(F, `${name}() calls ${fn} — once, with exactly the arguments the server expects`, HOW, async () => {
    const s = await S(); phone.ls.set("lfh_device", DEV); await call(s);
    const c = W.rpcLog.filter((x) => x.fn === fn); return { ok: W.rpcLog.length === 1 && c.length === 1 && JSON.stringify(c[0].args) === JSON.stringify(args), note: JSON.stringify(W.rpcLog.map((x) => x.fn)) };
  });
}
check(F, "checkBan() with no restaurant asks about 'any' (null), never quietly restaurant #1", HOW, async () => { const s = await S(); await s.checkBan(); return W.rpcLog[0].args.p_restaurant_id === null; });
check(F, "joinSession() with no restaurant falls back to restaurant #1 only by its own default (the single-restaurant contract)", HOW, async () => {
  const s = await S(); await s.joinSession("7", null, null, null); return W.rpcLog[0].args.p_restaurant_id === "00000000-0000-0000-0000-000000000001";
});
check(F, "setSessionCart(…, seen) carries what this phone last saw, so first save wins (mig 311)", HOW, async () => { const s = await S(); await s.setSessionCart("tok", [], "2026-10-12T00:00:00Z"); return W.rpcLog[0].args.p_seen === "2026-10-12T00:00:00Z"; });
check(F, "every call is given a deadline (an AbortSignal) where the phone supports one", HOW, async () => { const s = await S(); await s.tableStatus("7", "R"); return W.rpcLog[0].signal === true; });
check(F, "…and an older phone with no AbortSignal.timeout still gets an answer (the guard is feature-tested)", HOW, async () => {
  const s = await S(); const keep = AbortSignal.timeout; AbortSignal.timeout = undefined;
  try { const r = await s.tableStatus("7", "R"); return r.ok === true && W.rpcLog[0].signal === false; } finally { AbortSignal.timeout = keep; }
});
// ── how a database answer is translated for the guest screens ─────────────────────────────────────
const verdicts = [
  ["an abort (the deadline fired)", { data: null, error: { message: "AbortError: signal is aborted without reason" } }, "timed_out"],
  ["a statement timeout (57014) — the restaurant is busy", { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, "timed_out"],
  ["too many connections (53300)", { data: null, error: { code: "53300", message: "sorry, too many clients already" } }, "timed_out"],
  ["a gateway that never answered", { data: null, error: { message: "upstream request timeout" } }, "timed_out"],
  ["a 503 page", { data: null, error: { message: "503: Service Unavailable" } }, "timed_out"],
  ["a refused VALUE (22P02) keeps its own message — it is not 'busy'", { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }, "invalid input syntax for type uuid"],
  ["a phone with no signal (the browser's 'Failed to fetch') is NOT the restaurant's busy — it keeps its message", { data: null, error: { message: "TypeError: Failed to fetch" } }, "TypeError: Failed to fetch"],
  ["a refusal by the function itself passes through", { data: { ok: false, reason: "no_open_session" }, error: null }, "no_open_session"],
  ["an empty answer is a failure, not a quiet success", { data: null, error: null }, "empty"],
];
for (const [what, ans, reason] of verdicts) {
  check(F, `rpc(): ${what} → reason ${JSON.stringify(reason)}`, HOW, async () => {
    const s = await S(); W.rpc.lfh_table_status = ans; const r = await s.tableStatus("7", "R"); return { ok: r.ok === false && r.reason === reason, note: JSON.stringify(r) };
  });
}
check(F, "isSessionTimeout() is true for timed_out and for nothing else", HOW, async () => {
  const s = await S(); return s.isSessionTimeout({ ok: false, reason: "timed_out" }) && !s.isSessionTimeout({ ok: false, reason: "empty" }) && !s.isSessionTimeout({ ok: false }) && !s.isSessionTimeout({ ok: true });
});
check(F, "a limit tripped inside the database nudges the owner's phone — one keepalive beacon naming the function and restaurant", HOW, async () => {
  const s = await S(); const beacons = []; globalThis.fetch = async (u, i) => { beacons.push({ u, i }); return { ok: true }; };
  W.rpc.lfh_join_session = { data: { ok: false, reason: "rate_limited" }, error: null }; const r = await s.joinSession("7", null, null, null, "RID-X");
  const b = beacons[0]; const body = b ? JSON.parse(b.i.body) : {};
  return { ok: r.reason === "rate_limited" && beacons.length === 1 && b.u === "/api/guest/limit-hit" && b.i.keepalive === true && body.fn === "lfh_join_session" && body.rid === "RID-X", note: JSON.stringify(body) };
});
check(F, "…fire-and-forget: a beacon that fails, or a browser with no fetch, never changes the answer", HOW, async () => {
  const s = await S(); globalThis.fetch = () => { throw new Error("no fetch"); }; W.rpc.lfh_call_waiter = { data: { ok: false, reason: "rate_limited" }, error: null };
  const r = await s.callWaiterSession("tok", "x"); return r.reason === "rate_limited";
});
check(F, "…and an ordinary answer sends no beacon at all", HOW, async () => { const s = await S(); let n = 0; globalThis.fetch = async () => { n++; return {}; }; await s.tableStatus("7", "R"); return n === 0; });
check(F, "getSessionState() is single-flight: two identical reads at once make ONE round trip", HOW, async () => {
  const s = await S(); let release; W.rpc.lfh_session_state = () => new Promise((r) => { release = () => r({ data: { ok: true }, error: null }); });
  const a = s.getSessionState("tok"), b = s.getSessionState("tok"); await new Promise((r) => setTimeout(r, 10)); release(); await Promise.all([a, b]); return { ok: W.rpcLog.length === 1 && a === b, note: `${W.rpcLog.length} call(s)` };
});
check(F, "…and the entry is dropped the moment it settles, so the next tick gets FRESH data", HOW, async () => { const s = await S(); await s.getSessionState("tok"); await s.getSessionState("tok"); return W.rpcLog.length === 2; });
check(F, "…two different tokens are two reads (one table's answer is never another's)", HOW, async () => { const s = await S(); await Promise.all([s.getSessionState("a"), s.getSessionState("b")]); return W.rpcLog.length === 2; });
check(F, "…and a FAILED read is dropped too, so a blip cannot stick", HOW, async () => {
  const s = await S(); W.rpc.lfh_session_state = { data: null, error: { code: "57014", message: "statement timeout" } }; const r1 = await s.getSessionState("tok"); delete W.rpc.lfh_session_state;
  const r2 = await s.getSessionState("tok"); return r1.reason === "timed_out" && r2.ok === true && W.rpcLog.length === 2;
});
// ── the soft location check ──────────────────────────────────────────────────────────────────────
const geo = (outcome) => ({ getCurrentPosition: (ok, bad, opts) => { geo.last = opts; outcome(ok, bad); } });
const at = (lat, lng) => (ok) => ok({ coords: { latitude: lat, longitude: lng } });
const err = (code) => (_ok, bad) => bad({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
check(F, "checkLocation(): a phone with no geolocation and a café with no location set → let through ('bypassed')", HOW, async () => { const s = await S(); phone.geo = null; const r = await s.checkLocation(null, null, 250); return r.ok && r.near && r.reason === "bypassed"; });
check(F, "…no geolocation but the café HAS a location → reported 'unavailable' (the screen offers a waiter)", HOW, async () => { const s = await S(); phone.geo = null; const r = await s.checkLocation(19.0, 72.8, 250); return !r.ok && !r.near && r.reason === "unavailable"; });
check(F, "…a fix ~110 m away with a 250 m radius is 'near'", HOW, async () => { const s = await S(); phone.geo = geo(at(19.001, 72.8)); const r = await s.checkLocation(19.0, 72.8, 250); return { ok: r.near && r.reason === "near", note: r.reason }; });
check(F, "…a fix ~330 m away is 'far' (reported, never a hard block)", HOW, async () => { const s = await S(); phone.geo = geo(at(19.003, 72.8)); const r = await s.checkLocation(19.0, 72.8, 250); return r.ok && !r.near && r.reason === "far"; });
check(F, "…the distance is a real great-circle one: 1° of longitude at 60°N is half what it is at the equator", HOW, async () => {
  const s = await S(); phone.geo = geo(at(60, 1)); const a = await s.checkLocation(60, 0, 60000); phone.geo = geo(at(0, 1)); const b = await s.checkLocation(0, 0, 60000);
  return a.near === true && b.near === false; // ~55.6 km vs ~111 km against a 60 km radius
});
check(F, "…a blocked permission is told apart from a timeout and from 'unavailable'", HOW, async () => {
  const s = await S(); phone.geo = geo(err(1)); const d = await s.checkLocation(1, 1, 250); phone.geo = geo(err(3)); const t = await s.checkLocation(1, 1, 250); phone.geo = geo(err(2)); const u = await s.checkLocation(1, 1, 250);
  return d.reason === "denied" && t.reason === "timeout" && u.reason === "unavailable" && !d.ok && !t.ok && !u.ok;
});
check(F, "…a café with no location set still lets everyone through, but hands back the real coordinates for the server", HOW, async () => { const s = await S(); phone.geo = geo(at(19.5, 72.5)); const r = await s.checkLocation(null, null, 250); return r.ok && r.reason === "bypassed" && r.lat === 19.5 && r.lng === 72.5; });
check(F, "…the browser is asked for a precise fix, gives up after 10 s, and accepts one from the last minute", HOW, async () => {
  const s = await S(); phone.geo = geo(at(1, 1)); await s.checkLocation(1, 1, 250); const o = geo.last || {}; return o.enableHighAccuracy === true && o.timeout === 10000 && o.maximumAge === 60000;
});
