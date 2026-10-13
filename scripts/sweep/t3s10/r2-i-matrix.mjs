// Round 2 · Block I — EVERY guest door × EVERY field it reads × EVERY wrong type a body can carry.
// The real route, in memory, against the stand-in database. The rule under test is one sentence from
// the sweep brief: "a bad or missing input gets a clear refusal, not a crash or a silent wrong write".
// So every cell asserts three things: no 5xx, an answer the phone knows how to word, and — when the
// input is unusable — NO database function was called with it.
import { check, fresh, nextServer } from "./lib.mjs";
import { G } from "./stubs/state.mjs";

const HOW = "STUB — real route in memory, one malformed field at a time";
const FH = "00000000-0000-0000-0000-000000000001";
async function call(rel, body) {
  const route = fresh(rel); const { NextRequest } = nextServer();
  const r = await route.POST(new NextRequest("http://localhost/api/guest/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.1.1.1" }, body: typeof body === "string" ? body : JSON.stringify(body) }), {});
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const KNOWN = new Set(["bad_body", "invalid_token", "unknown_restaurant", "order_too_big", "allergies_too_long", "off_plan_table", "call_too_old", "server_busy", "empty"]);
const BAD = [["null", null], ["a number", 7], ["an object", { x: 1 }], ["a list", [1]], ["true", true], ["an empty string", ""]];
let n = 172621;
const cell = (rel, label, body, expect) => check(`P${n++}`, rel, label, HOW, async () => {
  G.reset();
  G.RPC.lfh_place_order = { ok: true, order_id: "o1" }; G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" };
  G.RPC.lfh_call_waiter = { ok: true }; G.RPC.lfh_call_waiter_table = { ok: true }; G.RPC.lfh_leave_session = { ok: true };
  const r = await call(rel, body);
  const reason = r.json?.reason;
  const noCrash = r.status < 500;
  const worded = r.json?.ok === true || KNOWN.has(String(reason));
  const ok = noCrash && worded && expect(r, G);
  return { ok, note: `${r.status} ${r.text.slice(0, 70)} · rpc calls ${G.RPC_CALLS.length}` };
});
const refusedNoRpc = (r, g) => r.status === 400 && g.RPC_CALLS.length === 0;

// ── the whole body ─────────────────────────────────────────────────────────────────────────────
for (const rel of ["app/api/guest/place-order/route.ts", "app/api/guest/call-waiter/route.ts", "app/api/guest/leave/route.ts"]) {
  for (const [lab, v] of [["null", "null"], ["a number", "7"], ["a string", '"hi"'], ["a list", "[]"], ["true", "true"], ["unparseable bytes", "{"], ["an empty body", ""]]) {
    cell(rel, `${rel.split("/")[3]} — a whole body that is ${lab} is a clear refusal (bad_body), nothing called`, v, refusedNoRpc);
  }
}
for (const [lab, v] of [["null", "null"], ["a number", "7"], ["a list", "[]"], ["unparseable bytes", "{"], ["an empty body", ""]]) {
  cell("app/api/guest/limit-hit/route.ts", `limit-hit — a body that is ${lab} answers 200 and pings nobody`, v, (r, g) => r.status === 200 && r.json?.ok === true && g.PINGS.length === 0);
}
// ── place-order, field by field ────────────────────────────────────────────────────────────────
const PO = "app/api/guest/place-order/route.ts";
const goodPublic = { mode: "public", restaurantId: FH, table: "4", items: [{ id: "a", qty: 1 }], allergies: [] };
const goodSession = { mode: "session", token: "tok", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [] };
for (const [lab, v] of BAD) cell(PO, `place-order — an ITEM that is ${lab} is refused bad_body, nothing placed`, { ...goodPublic, items: [v] }, refusedNoRpc);
for (const [lab, v] of [["missing", undefined], ["a number", 5], ["an empty string", ""], ["an object", {}], ["null", null]]) cell(PO, `place-order — an item whose dish id is ${lab} is refused, nothing placed`, { ...goodPublic, items: [{ id: v, qty: 1 }] }, refusedNoRpc);
for (const [lab, v] of [["text", "two"], ["an object", {}], ["NaN-ish", "NaN"]]) cell(PO, `place-order — an item whose quantity is ${lab} is refused, nothing placed`, { ...goodPublic, items: [{ id: "a", qty: v }] }, refusedNoRpc);
cell(PO, "place-order — an item with no quantity at all is let through (the database reads it as 1)", { ...goodPublic, items: [{ id: "a" }] }, (r, g) => r.status === 200 && g.RPC_CALLS.length === 1);
for (const [lab, v] of [["a number", 5], ["an object", { a: 1 }], ["null", null], ["a list", ["x"]]]) cell(PO, `place-order — an ALLERGY that is ${lab} is refused, nothing placed`, { ...goodPublic, allergies: [v] }, refusedNoRpc);
for (const [lab, v] of [["an object", { t: 4 }], ["a list", [4]], ["true", true]]) cell(PO, `place-order — a TABLE that is ${lab} is refused, nothing placed`, { ...goodPublic, table: v }, refusedNoRpc);
cell(PO, "place-order — a numeric table is accepted (a QR may carry a number)", { ...goodPublic, table: 4 }, (r, g) => r.status === 200 && g.RPC_CALLS.length === 1);
for (const [lab, v] of [["a number", 5], ["an object", {}], ["a list", ["t"]], ["true", true]]) cell(PO, `place-order — a seated TOKEN that is ${lab} is refused, nothing placed`, { ...goodSession, token: v }, refusedNoRpc);
cell(PO, "place-order — a null token on a seated order is refused invalid_token", { ...goodSession, token: null }, (r, g) => r.json?.reason === "invalid_token" && g.RPC_CALLS.length === 0);
for (const [lab, v] of [["a number", 5], ["an object", {}], ["an empty string", ""], ["the slug", "french-house"]]) cell(PO, `place-order — a QR restaurantId that is ${lab} is refused unknown_restaurant`, { ...goodPublic, restaurantId: v }, (r, g) => r.json?.reason === "unknown_restaurant" && g.RPC_CALLS.length === 0);
for (const [lab, v] of [["a number", 3], ["an unknown word", "takeaway"], ["null", null]]) cell(PO, `place-order — a mode that is ${lab} is treated as a QR order (needs a real restaurant)`, { ...goodPublic, mode: v, restaurantId: undefined }, (r) => r.json?.reason === "unknown_restaurant");
cell(PO, "place-order — a good QR body still places, after all the new checks", goodPublic, (r, g) => r.status === 200 && r.json.order_id === "o1" && g.RPC_CALLS.length === 1);
cell(PO, "place-order — a good seated body still places", goodSession, (r, g) => r.status === 200 && r.json.order_id === "o1" && g.RPC_CALLS[0].name === "lfh_place_order");
cell(PO, "place-order — options, removed and a note on an item travel untouched to the database", { ...goodPublic, items: [{ id: "a", qty: 2, options: [{ group: "Size", label: "L" }], removed: ["milk"], note: "less ice" }] }, (r, g) => g.RPC_CALLS[0]?.args.p_items[0].note === "less ice" && g.RPC_CALLS[0].args.p_items[0].removed[0] === "milk");
// ── call-waiter, field by field ────────────────────────────────────────────────────────────────
const CW = "app/api/guest/call-waiter/route.ts";
const goodCall = { mode: "public", restaurantId: FH, table: "4", reason: "Water" };
for (const [lab, v] of [["an object", { t: 1 }], ["a list", [4]], ["true", true]]) cell(CW, `call-waiter — a TABLE that is ${lab} is refused bad_body, nothing rung`, { ...goodCall, table: v }, refusedNoRpc);
for (const [lab, v] of [["a number", 5], ["an object", {}], ["a list", ["t"]], ["true", true]]) cell(CW, `call-waiter — a seated TOKEN that is ${lab} is refused, nothing rung`, { mode: "session", token: v, reason: "Water" }, refusedNoRpc);
for (const [lab, v] of [["a number", 42], ["an object", { a: 1 }], ["a list", ["Water"]], ["null", null]]) cell(CW, `call-waiter — a REASON that is ${lab} becomes text (never a crash)`, { ...goodCall, reason: v }, (r, g) => r.status === 200 && typeof (g.RPC_CALLS[0]?.args.p_note ?? "") === "string");
cell(CW, "call-waiter — a numeric table is accepted", { ...goodCall, table: 4 }, (r, g) => r.status === 200 && g.RPC_CALLS.length === 1);
for (const [lab, v] of [["a number", 5], ["an empty string", ""], ["the slug", "aangan"]]) cell(CW, `call-waiter — a QR restaurantId that is ${lab} is refused unknown_restaurant`, { ...goodCall, restaurantId: v }, (r, g) => r.json?.reason === "unknown_restaurant" && g.RPC_CALLS.length === 0);
for (const [lab, v] of [["Infinity as text", "Infinity"], ["a far-future time", Date.now() + 86_400_000], ["a negative number", -1]]) cell(CW, `call-waiter — an 'at' that is ${lab} never rings a stale call`, { ...goodCall, at: v }, (r, g) => (r.json?.reason === "call_too_old" && g.RPC_CALLS.length === 0) || (r.status === 200 && g.RPC_CALLS.length <= 1));
cell(CW, "call-waiter — a good QR call still rings, after all the new checks", goodCall, (r, g) => r.status === 200 && g.RPC_CALLS.length === 1);
// ── leave, field by field ──────────────────────────────────────────────────────────────────────
const LV = "app/api/guest/leave/route.ts";
for (const [lab, v] of [["a number", 5], ["an object", {}], ["a list", ["t"]], ["true", true], ["an empty string", ""]]) cell(LV, `leave — a TOKEN that is ${lab} is refused invalid_token`, { token: v }, (r, g) => r.json?.reason === "invalid_token" && g.RPC_CALLS.length === 0);
cell(LV, "leave — a restaurantId that is not a real id is ignored, the leave still lands", { token: "tok", restaurantId: "french-house" }, (r, g) => r.status === 200 && g.RPC_CALLS.length === 1);
cell(LV, "leave — a good leave still lands", { token: "tok", restaurantId: FH }, (r, g) => r.status === 200 && g.RPC_CALLS[0]?.name === "lfh_leave_session");
// ── limit-hit, field by field ──────────────────────────────────────────────────────────────────
const LH = "app/api/guest/limit-hit/route.ts";
for (const [lab, v] of [["a number", 5], ["an object", {}], ["null", null], ["a list", ["lfh_place_order"]]]) cell(LH, `limit-hit — a function name that is ${lab} pings nobody`, { fn: v, rid: FH }, (r, g) => r.status === 200 && g.PINGS.length === 0);
for (const [lab, v] of [["a number", 5], ["an object", {}], ["a list", [FH]]]) cell(LH, `limit-hit — a restaurant that is ${lab} becomes NO restaurant, never the value`, { fn: "lfh_place_order", rid: v }, (r, g) => r.status === 200 && g.PINGS[0]?.rid === null);
export const LAST_I = () => n - 1;
