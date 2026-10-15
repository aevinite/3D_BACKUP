// Block C — the four guest routes, CALLED in memory: the real route file bundled with the real
// lib/idempotency.ts and lib/publicCap.ts, against a stand-in database (./stubs/sb.mjs) and recording
// stand-ins for the floor snapshot, the plan check, the clash check and the owner ping.
import { check, fresh, nextServer } from "./lib.mjs";
import { G } from "./stubs/state.mjs";

const HOW = "STUB — real route + real lib/idempotency, stand-in database";
const FH = "00000000-0000-0000-0000-000000000001";
const AA = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const PO = "app/api/guest/place-order/route.ts", CW = "app/api/guest/call-waiter/route.ts", LV = "app/api/guest/leave/route.ts", LH = "app/api/guest/limit-hit/route.ts";
/** Hand a body to one route's POST handler IN MEMORY (no network). `raw` sends the text as-is;
 *  `again: true` reuses the module already loaded, so its in-process state (the beacon's cap) carries. */
const loaded = new Map();
async function callRoute(rel, body, { headers = {}, raw = null, again = false, ip = "10.0.0.1", cookie = "" } = {}) {
  const route = again && loaded.has(rel) ? loaded.get(rel) : fresh(rel);
  loaded.set(rel, route);
  const { NextRequest } = nextServer();
  const h = { "content-type": "application/json", "x-forwarded-for": ip, ...headers };
  if (cookie) h.cookie = cookie;
  const r = await route.POST(new NextRequest("http://localhost/api/guest/x", { method: "POST", headers: h, body: raw !== null ? raw : JSON.stringify(body) }), {});
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}
const W = (fn) => async () => { G.reset(); return fn(); };
const ITEMS = [{ id: "a", qty: 1 }];

// ── C1. /api/guest/place-order (P172200–P172259) ────────────────────────────────────────────────
check("P172200", PO, "malformed JSON answers 400 bad_body, never a 500, and calls no database function", HOW, W(async () => {
  const r = await callRoute(PO, null, { raw: "{not json" }); return r.status === 400 && r.json.reason === "bad_body" && G.RPC_CALLS.length === 0;
}));
check("P172201", PO, "201 lines is refused (order_too_big), not trimmed — and nothing is placed", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: Array.from({ length: 201 }, () => ({ id: "a", qty: 1 })) });
  return r.status === 400 && r.json.reason === "order_too_big" && G.RPC_CALLS.length === 0;
}));
check("P172202", PO, "exactly 200 lines is allowed through to the database", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: Array.from({ length: 200 }, () => ({ id: "a", qty: 1 })) });
  return r.status === 200 && r.json.order_id === "o1";
}));
check("P172203", PO, "41 allergies is refused (allergies_too_long)", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS, allergies: Array.from({ length: 41 }, (_, i) => "a" + i) });
  return r.status === 400 && r.json.reason === "allergies_too_long" && G.RPC_CALLS.length === 0;
}));
check("P172204", PO, "one allergy of 201 characters is refused too", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS, allergies: ["x".repeat(201)] });
  return r.status === 400 && r.json.reason === "allergies_too_long";
}));
check("P172205", PO, "a session order with no token answers 400 invalid_token and places nothing", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "session", items: ITEMS }); return r.status === 400 && r.json.reason === "invalid_token" && G.RPC_CALLS.length === 0;
}));
check("P172206", PO, "a session order calls lfh_place_order with the token, the items and the allergies — nothing else", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS, allergies: ["nuts"] });
  const c = G.RPC_CALLS[0]; return c.name === "lfh_place_order" && Object.keys(c.args).sort().join() === "p_allergies,p_items,p_token" && c.args.p_token === "tok";
}));
check("P172207", PO, "a placed session order drops THAT restaurant's floor snapshot", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return G.FLOOR.join() === FH;
}));
check("P172208", PO, "a session order with NO restaurant in the body still drops the right snapshot — read from the token", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  G.TABLES.session_members.push({ token: "tok", session_id: "s1" }); G.TABLES.sessions.push({ id: "s1", restaurant_id: AA });
  await callRoute(PO, { mode: "session", token: "tok", items: ITEMS }); return { ok: G.FLOOR.join() === AA, note: G.FLOOR.join() };
}));
check("P172209", PO, "…by two single-row, column-listed, capped reads", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  G.TABLES.session_members.push({ token: "tok", session_id: "s1" }); G.TABLES.sessions.push({ id: "s1", restaurant_id: AA });
  await callRoute(PO, { mode: "session", token: "tok", items: ITEMS });
  return G.READS.length === 2 && G.READS.every((r) => r.limit === 1 && r.cols && r.cols !== "*");
}));
check("P172210", PO, "…and makes NO extra read when the body already carried the restaurant", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return G.READS.filter((r) => r.table !== "action_idempotency").length === 0;
}));
check("P172211", PO, "a failed token lookup never costs the diner their order (still placed, answered 200)", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" }; G.THROW_FROM = "session_members";
  const r = await callRoute(PO, { mode: "session", token: "tok", items: ITEMS }); return r.status === 200 && r.json.order_id === "o1";
}));
check("P172212", PO, "a REFUSED session order (ok:false) does not drop the floor snapshot — nothing changed", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: false, reason: "session_closed" };
  const r = await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return r.json.reason === "session_closed" && G.FLOOR.length === 0;
}));
check("P172213", PO, "a database error is answered 502 server_busy with a retryAfter — never the database's own words", HOW, W(async () => {
  G.RPC.lfh_place_order = { error: { message: "deadlock detected on relation orders" } };
  const r = await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS });
  return r.status === 502 && r.json.reason === "server_busy" && !/deadlock|relation/.test(r.text) && r.json.retryAfter >= 20 && r.json.retryAfter <= 45;
}));
check("P172214", PO, "…and the Retry-After header matches the body's hint", HOW, W(async () => {
  G.RPC.lfh_place_order = { error: { message: "x" } };
  const r = await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return r.headers.get("retry-after") === String(r.json.retryAfter);
}));
check("P172215", PO, "a database that answers nothing at all is not treated as a placed order", HOW, W(async () => {
  G.RPC.lfh_place_order = null;
  const r = await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return r.json.ok === false && G.FLOOR.length === 0;
}));
check("P172216", PO, "a session order's rate_limited answer pings the owner — about THIS restaurant", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: false, reason: "rate_limited" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return G.PINGS.length === 1 && G.PINGS[0].key === "guest_order" && G.PINGS[0].rid === FH;
}));
check("P172217", PO, "an ordinary refusal does not ping the owner", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: false, reason: "sold_out", item: "Soup" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return G.PINGS.length === 0;
}));
check("P172218", PO, "a QR order with NO restaurant is refused (unknown_restaurant) — never filed under restaurant #1", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "public", table: "4", items: ITEMS }); return r.status === 400 && r.json.reason === "unknown_restaurant" && G.RPC_CALLS.length === 0;
}));
check("P172219", PO, "a QR order with a malformed restaurant id is refused the same way", HOW, W(async () => {
  const r = await callRoute(PO, { mode: "public", restaurantId: "french-house", table: "4", items: ITEMS }); return r.status === 400 && r.json.reason === "unknown_restaurant";
}));
check("P172220", PO, "a body with no mode at all is treated as a QR order and needs a real restaurant", HOW, W(async () => {
  const r = await callRoute(PO, { table: "4", items: ITEMS }); return r.json.reason === "unknown_restaurant";
}));
check("P172221", PO, "a QR order is checked against the floor plan STRICTLY (a guest is locked to a floor table)", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }); return G.PLAN_CALLS[0]?.opts?.strict === true && G.PLAN_CALLS[0].rid === FH;
}));
check("P172222", PO, "a table off the plan answers off_plan_table — a CODE, not the helper's staff sentence", HOW, W(async () => {
  G.PLAN = () => "Table 99 doesn't exist — tables are 1–30.";
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "99", items: ITEMS });
  return r.status === 400 && r.json.reason === "off_plan_table" && !/1–30/.test(r.text) && G.RPC_CALLS.length === 0;
}));
check("P172223", PO, "a QR order runs the clash check (a table that moved on) BEFORE anything is placed", HOW, W(async () => {
  G.CLASH = () => ({ plain: "That table was closed.", kind: "closed" });
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS });
  return r.status === 409 && r.json.clash.plain === "That table was closed." && G.RPC_CALLS.length === 0;
}));
check("P172224", PO, "…and the clash check is asked about the right restaurant, kind 'order' and the table", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "7", items: ITEMS });
  const c = G.CLASH_CALLS[0]; return c.rid === FH && c.kind === "order" && c.ctx.table === "7";
}));
check("P172225", PO, "…and it sees the replay markers the phone sent", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "7", items: ITEMS }, { headers: { "x-lfh-replay": "1", "x-lfh-queued-at": "2026-10-11T10:00:00Z" } });
  const c = G.CLASH_CALLS[0]; return c.replay === "1" && c.queuedAt === "2026-10-11T10:00:00Z";
}));
check("P172226", PO, "the session path does NOT run the clash check (the RPC checks the diner's own session)", HOW, W(async () => {
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "session", token: "tok", restaurantId: FH, items: ITEMS }); return G.CLASH_CALLS.length === 0;
}));
check("P172227", PO, "a QR order calls lfh_place_order_public with table, items, allergies and the restaurant — no price", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: [{ id: "a", qty: 1, price: 1 }], allergies: [] });
  const c = G.RPC_CALLS[0]; return c.name === "lfh_place_order_public" && Object.keys(c.args).sort().join() === "p_allergies,p_items,p_restaurant_id,p_table" && c.args.p_restaurant_id === FH;
}));
check("P172228", PO, "a placed QR order drops THAT restaurant's floor snapshot", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  await callRoute(PO, { mode: "public", restaurantId: AA, table: "4", items: ITEMS }); return G.FLOOR.join() === AA;
}));
check("P172229", PO, "a refused QR order drops nothing", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: false, reason: "unknown_table" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "31", items: ITEMS }); return G.FLOOR.length === 0;
}));
check("P172230", PO, "a QR order's database error is server_busy (502), never the message", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { error: { message: "permission denied for table orders" } };
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }); return r.status === 502 && !/permission/.test(r.text);
}));
check("P172231", PO, "a QR order's rate_limited answer pings the owner about that restaurant", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: false, reason: "rate_limited" };
  await callRoute(PO, { mode: "public", restaurantId: AA, table: "4", items: ITEMS }); return G.PINGS[0]?.rid === AA;
}));
check("P172232", PO, "non-list items / allergies are treated as empty lists, not a crash", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: false, reason: "empty_order" };
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: "lots", allergies: { a: 1 } });
  const c = G.RPC_CALLS[0]; return r.status === 200 && Array.isArray(c.args.p_items) && c.args.p_items.length === 0 && Array.isArray(c.args.p_allergies);
}));
// re-pointed (sweep #10 T3 round 3, item 36): a guest order with no table is refused AT THE DOOR now
// (unknown_table) — it no longer reaches the database at all, where an empty table was stored as "no table"
check("P172233", PO, "a missing table is refused at the door (unknown_table) — never sent to the database as '' or 'undefined'", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o" };
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, items: ITEMS });
  return { ok: G.RPC_CALLS.length === 0 && r.status === 400 && r.json?.reason === "unknown_table", note: `${r.status} ${r.json?.reason} · ${G.RPC_CALLS.length} database call(s)` };
}));
// idempotency, end to end through the real wrapper
check("P172234", PO, "the same saved order sent TWICE places it once — the second answer is a duplicate echoing the order id", HOW, W(async () => {
  let n = 0; G.RPC.lfh_place_order_public = () => ({ ok: true, order_id: "o" + ++n });
  const h = { "x-lfh-action-id": "aaaaaaaa-1111-4111-8111-111111111111" };
  const a = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h });
  const b = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h, again: true });
  return { ok: n === 1 && a.json.order_id === "o1" && b.json.duplicate === true && b.json.order_id === "o1", note: `${n} placed · ${JSON.stringify(b.json)}` };
}));
check("P172235", PO, "a REFUSED attempt is not remembered as done — the next try under the same id really runs", HOW, W(async () => {
  let n = 0; G.RPC.lfh_place_order_public = () => (++n === 1 ? { ok: false, reason: "sold_out", item: "Soup" } : { ok: true, order_id: "o2" });
  const h = { "x-lfh-action-id": "bbbbbbbb-1111-4111-8111-111111111111" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h });
  const b = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h, again: true });
  return { ok: n === 2 && b.json.order_id === "o2", note: `${n} runs · ${JSON.stringify(b.json)}` };
}));
check("P172236", PO, "a 5xx attempt releases its claim, so the phone's retry is a real retry", HOW, W(async () => {
  let n = 0; G.RPC.lfh_place_order_public = () => (++n === 1 ? { error: { message: "timeout" } } : { ok: true, order_id: "o3" });
  const h = { "x-lfh-action-id": "cccccccc-1111-4111-8111-111111111111" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h });
  const b = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: h, again: true });
  return { ok: n === 2 && b.json.order_id === "o3", note: `${n} runs` };
}));
check("P172237", PO, "an attempt still in flight answers 409 retry — the phone waits and asks again", HOW, W(async () => {
  G.TABLES.action_idempotency.push({ action_id: "dddddddd-1111-4111-8111-111111111111", panel: "guest", done: false, created_at: new Date().toISOString() });
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: { "x-lfh-action-id": "dddddddd-1111-4111-8111-111111111111" } });
  return r.status === 409 && r.json.retry === true && G.RPC_CALLS.filter((c) => c.name.startsWith("lfh_place")).length === 0;
}));
check("P172238", PO, "a claim left by a crashed attempt (over 30s old) is taken over, not stuck forever", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o4" };
  G.TABLES.action_idempotency.push({ action_id: "eeeeeeee-1111-4111-8111-111111111111", panel: "guest", done: false, created_at: new Date(Date.now() - 60_000).toISOString() });
  const r = await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }, { headers: { "x-lfh-action-id": "eeeeeeee-1111-4111-8111-111111111111" } });
  return r.status === 200 && r.json.order_id === "o4";
}));
check("P172239", PO, "an online order (no action id) is passed straight through — nothing stored", HOW, W(async () => {
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o5" };
  await callRoute(PO, { mode: "public", restaurantId: FH, table: "4", items: ITEMS }); return G.TABLES.action_idempotency.length === 0;
}));

// ── C2. /api/guest/call-waiter (P172240–P172279) ────────────────────────────────────────────────
check("P172240", CW, "malformed JSON answers 400 bad_body", HOW, W(async () => { const r = await callRoute(CW, null, { raw: "nope" }); return r.status === 400 && r.json.reason === "bad_body"; }));
check("P172241", CW, "a call stamped eleven minutes ago is refused call_too_old and rings nothing", HOW, W(async () => {
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", reason: "Water", at: Date.now() - 11 * 60_000 });
  return r.json.reason === "call_too_old" && G.RPC_CALLS.length === 0;
}));
check("P172242", CW, "…and that refusal is a plain 200 answer, so the phone stops retrying it", HOW, W(async () => {
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", at: Date.now() - 11 * 60_000 }); return r.status === 200;
}));
check("P172243", CW, "a call nine minutes old still rings", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", at: Date.now() - 9 * 60_000 }); return r.json.ok === true && G.RPC_CALLS.length === 1;
}));
for (const [i, bad] of [["abc"], [{ x: 1 }], [[]], [true]].entries()) {
  check(`P${172244 + i}`, CW, `an UNREADABLE 'at' (${JSON.stringify(bad[0])}) is treated as too old — never a free pass`, HOW, W(async () => {
    const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", at: bad[0] }); return { ok: r.json.reason === "call_too_old" && G.RPC_CALLS.length === 0, note: JSON.stringify(r.json) };
  }));
}
check("P172248", CW, "a call with NO 'at' at all is an ordinary live call and goes straight through", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4" }); return r.json.ok === true;
}));
check("P172249", CW, "a null or empty-string 'at' is also an ordinary live call", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  const a = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", at: null });
  const b = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", at: "" });
  return a.json.ok === true && b.json.ok === true;
}));
check("P172250", CW, "the note is capped at 200 characters before the database sees it", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", reason: "x".repeat(500) }); return G.RPC_CALLS[0].args.p_note.length === 200;
}));
check("P172251", CW, "an empty note reaches the database as null, not ''", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  await callRoute(CW, { mode: "public", restaurantId: FH, table: "4" }); return G.RPC_CALLS[0].args.p_note === null;
}));
check("P172252", CW, "a session call with no token answers 400 invalid_token", HOW, W(async () => {
  const r = await callRoute(CW, { mode: "session" }); return r.status === 400 && r.json.reason === "invalid_token" && G.RPC_CALLS.length === 0;
}));
check("P172253", CW, "a session call uses lfh_call_waiter with the token and the note — no table, no restaurant from the phone", HOW, W(async () => {
  G.RPC.lfh_call_waiter = { ok: true };
  await callRoute(CW, { mode: "session", token: "tok", table: "9", restaurantId: AA, reason: "Water" });
  const c = G.RPC_CALLS[0]; return c.name === "lfh_call_waiter" && Object.keys(c.args).sort().join() === "p_reason,p_token";
}));
check("P172254", CW, "a session call that landed drops the floor snapshot", HOW, W(async () => {
  G.RPC.lfh_call_waiter = { ok: true };
  await callRoute(CW, { mode: "session", token: "tok", restaurantId: FH }); return G.FLOOR.join() === FH;
}));
check("P172255", CW, "a session call answered already_active (same request pending) drops nothing", HOW, W(async () => {
  G.RPC.lfh_call_waiter = { ok: true, already_active: true };
  await callRoute(CW, { mode: "session", token: "tok", restaurantId: FH }); return G.FLOOR.length === 0;
}));
check("P172256", CW, "a session call with no restaurant in the body still drops the right snapshot, read from the token", HOW, W(async () => {
  G.RPC.lfh_call_waiter = { ok: true };
  G.TABLES.session_members.push({ token: "tok", session_id: "s1" }); G.TABLES.sessions.push({ id: "s1", restaurant_id: AA });
  await callRoute(CW, { mode: "session", token: "tok" }); return G.FLOOR.join() === AA;
}));
check("P172257", CW, "a session call's database error is server_busy with a retryAfter, never the message", HOW, W(async () => {
  G.RPC.lfh_call_waiter = { error: { message: "relation waiter_calls does not exist" } };
  const r = await callRoute(CW, { mode: "session", token: "tok", restaurantId: FH }); return r.status === 502 && r.json.reason === "server_busy" && r.json.retryAfter > 0 && !/relation/.test(r.text);
}));
check("P172258", CW, "a QR call with NO restaurant is refused unknown_restaurant — never guessed", HOW, W(async () => {
  const r = await callRoute(CW, { mode: "public", table: "4" }); return r.status === 400 && r.json.reason === "unknown_restaurant" && G.RPC_CALLS.length === 0;
}));
check("P172259", CW, "a QR call off the floor plan is refused off_plan_table, checked STRICTLY", HOW, W(async () => {
  G.PLAN = () => "nope";
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "999" }); return r.status === 400 && r.json.reason === "off_plan_table" && G.PLAN_CALLS[0].opts.strict === true && G.RPC_CALLS.length === 0;
}));
check("P172260", CW, "a QR call reaches lfh_call_waiter_table with table, note and THIS restaurant", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { ok: true };
  await callRoute(CW, { mode: "public", restaurantId: AA, table: "4", reason: "Napkins" });
  const c = G.RPC_CALLS[0]; return c.name === "lfh_call_waiter_table" && c.args.p_restaurant_id === AA && c.args.p_table === "4" && c.args.p_note === "Napkins";
}));
for (const [i, [ans, drops]] of [[{ ok: true }, true], [{ ok: true, reason: "already_sent" }, false], [{ ok: true, reason: "capped" }, false], [{ ok: true, reason: "rate_limited" }, false], [{ ok: false, reason: "blocked" }, false]].entries()) {
  check(`P${172261 + i}`, CW, `a QR call answered ${JSON.stringify(ans)} ${drops ? "DROPS" : "does not drop"} the floor snapshot`, HOW, W(async () => {
    G.RPC.lfh_call_waiter_table = ans;
    await callRoute(CW, { mode: "public", restaurantId: FH, table: "4" }); return G.FLOOR.length === (drops ? 1 : 0);
  }));
}
check("P172266", CW, "the same saved call delivered twice rings the floor ONCE", HOW, W(async () => {
  let n = 0; G.RPC.lfh_call_waiter_table = () => { n++; return { ok: true }; };
  const h = { "x-lfh-action-id": "ffffffff-1111-4111-8111-111111111111" };
  await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", reason: "Water", at: Date.now() }, { headers: h });
  const b = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4", reason: "Water", at: Date.now() }, { headers: h, again: true });
  return { ok: n === 1 && b.json.duplicate === true, note: `${n} rings` };
}));
check("P172267", CW, "a QR call's database error is answered server_busy, never the message", HOW, W(async () => {
  G.RPC.lfh_call_waiter_table = { error: { message: "function lfh_rid(uuid) does not exist" } };
  const r = await callRoute(CW, { mode: "public", restaurantId: FH, table: "4" }); return r.status === 502 && !/lfh_rid/.test(r.text);
}));

// ── C3. /api/guest/leave (P172268–P172279) ──────────────────────────────────────────────────────
check("P172268", LV, "malformed JSON answers 400 bad_body", HOW, W(async () => { const r = await callRoute(LV, null, { raw: "{" }); return r.status === 400 && r.json.reason === "bad_body"; }));
check("P172269", LV, "no token answers 400 invalid_token and calls nothing", HOW, W(async () => { const r = await callRoute(LV, {}); return r.status === 400 && r.json.reason === "invalid_token" && G.RPC_CALLS.length === 0; }));
check("P172270", LV, "a token that is not a string (a number, an object) is refused the same way", HOW, W(async () => {
  const a = await callRoute(LV, { token: 5 }), b = await callRoute(LV, { token: { t: 1 } }); return a.json.reason === "invalid_token" && b.json.reason === "invalid_token";
}));
check("P172271", LV, "leaving calls lfh_leave_session with the token ONLY", HOW, W(async () => {
  G.RPC.lfh_leave_session = { ok: true };
  await callRoute(LV, { token: "tok", restaurantId: FH }); const c = G.RPC_CALLS[0]; return c.name === "lfh_leave_session" && Object.keys(c.args).join() === "p_token";
}));
check("P172272", LV, "a leave that changed the table drops the floor snapshot", HOW, W(async () => {
  G.RPC.lfh_leave_session = { ok: true }; await callRoute(LV, { token: "tok", restaurantId: FH }); return G.FLOOR.join() === FH;
}));
check("P172273", LV, "an 'already gone' leave (a replay, or staff already closed it) drops nothing", HOW, W(async () => {
  G.RPC.lfh_leave_session = { ok: true, already_gone: true }; await callRoute(LV, { token: "tok", restaurantId: FH }); return G.FLOOR.length === 0;
}));
check("P172274", LV, "a database error is server_busy (502) with a retryAfter, never the message", HOW, W(async () => {
  G.RPC.lfh_leave_session = { error: { message: "could not serialize access" } };
  const r = await callRoute(LV, { token: "tok", restaurantId: FH }); return r.status === 502 && r.json.reason === "server_busy" && r.json.retryAfter > 0 && !/serialize/.test(r.text);
}));
check("P172275", LV, "the same saved leave sent twice runs once", HOW, W(async () => {
  let n = 0; G.RPC.lfh_leave_session = () => { n++; return { ok: true }; };
  const h = { "x-lfh-action-id": "abababab-1111-4111-8111-111111111111" };
  await callRoute(LV, { token: "tok", restaurantId: FH }, { headers: h }); await callRoute(LV, { token: "tok", restaurantId: FH }, { headers: h, again: true });
  return n === 1;
}));
check("P172276", LV, "a leave with no restaurant in the body still answers the diner (the floor snapshot is the only thing skipped)", HOW, W(async () => {
  G.RPC.lfh_leave_session = { ok: true }; const r = await callRoute(LV, { token: "tok" }); return r.status === 200 && r.json.ok === true;
}));

// ── C4. /api/guest/limit-hit (P172277–P172299) ──────────────────────────────────────────────────
check("P172277", LH, "an empty body answers 200 ok and pings nobody", HOW, W(async () => { const r = await callRoute(LH, null, { raw: "" }); return r.status === 200 && r.json.ok === true && G.PINGS.length === 0; }));
check("P172278", LH, "an unknown function name pings nobody", HOW, W(async () => { await callRoute(LH, { fn: "lfh_drop_everything", rid: FH }); return G.PINGS.length === 0; }));
for (const [i, [fn, key]] of [["lfh_place_order", "guest_order"], ["lfh_place_order_public", "guest_order"], ["lfh_call_waiter", "waiter_call"], ["lfh_call_waiter_table", "waiter_call"], ["lfh_join_session", "join_session"]].entries()) {
  check(`P${172279 + i}`, LH, `${fn} maps to the '${key}' limit`, HOW, W(async () => { await callRoute(LH, { fn, rid: FH }); return G.PINGS.length === 1 && G.PINGS[0].key === key && G.PINGS[0].rid === FH; }));
}
check("P172284", LH, "a malformed restaurant id is passed on as NO restaurant, never as the text", HOW, W(async () => { await callRoute(LH, { fn: "lfh_place_order", rid: "french-house" }); return G.PINGS[0].rid === null; }));
check("P172285", LH, "the seventh beacon from one caller inside a minute pings nobody (six per caller per limit)", HOW, W(async () => {
  loaded.delete(LH);
  for (let i = 0; i < 7; i++) await callRoute(LH, { fn: "lfh_place_order", rid: FH }, { again: true, ip: "10.9.9.9" });
  return { ok: G.PINGS.length === 6, note: `${G.PINGS.length} pings` };
}));
check("P172286", LH, "…and a DIFFERENT limit from the same caller still has its own six", HOW, W(async () => {
  loaded.delete(LH);
  for (let i = 0; i < 7; i++) await callRoute(LH, { fn: "lfh_place_order", rid: FH }, { again: true, ip: "10.8.8.8" });
  await callRoute(LH, { fn: "lfh_call_waiter_table", rid: FH }, { again: true, ip: "10.8.8.8" });
  return G.PINGS.filter((p) => p.key === "waiter_call").length === 1;
}));
check("P172287", LH, "…and a different caller has its own six", HOW, W(async () => {
  loaded.delete(LH);
  for (let i = 0; i < 7; i++) await callRoute(LH, { fn: "lfh_place_order", rid: FH }, { again: true, ip: "10.7.7.7" });
  await callRoute(LH, { fn: "lfh_place_order", rid: FH }, { again: true, ip: "10.7.7.8" });
  return G.PINGS.length === 7;
}));
check("P172288", LH, "the caller is counted by its device cookie when it has one — a body field cannot choose the bucket", HOW, W(async () => {
  loaded.delete(LH);
  for (let i = 0; i < 7; i++) await callRoute(LH, { fn: "lfh_place_order", rid: FH, capKey: "x" + i }, { again: true, ip: "10.6.6." + i, cookie: "lfh_panel_device=dev-1" });
  return { ok: G.PINGS.length === 6, note: `${G.PINGS.length} pings across 7 IPs on one device cookie` };
}));
check("P172289", LH, "it ALWAYS answers 200 ok, even after the cap — the beacon never shows a diner an error", HOW, W(async () => {
  loaded.delete(LH); let all = true;
  for (let i = 0; i < 8; i++) { const r = await callRoute(LH, { fn: "lfh_place_order", rid: FH }, { again: true, ip: "10.5.5.5" }); all = all && r.status === 200 && r.json.ok === true; }
  return all;
}));
check("P172290", LH, "it writes nothing to the database itself", HOW, W(async () => {
  await callRoute(LH, { fn: "lfh_place_order", rid: FH }); return G.RPC_CALLS.length === 0 && G.TABLES.action_idempotency.length === 0;
}));
