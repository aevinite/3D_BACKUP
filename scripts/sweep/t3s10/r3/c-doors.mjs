// Round 3 · C — THE FOUR GUEST DOORS AGAINST RANDOM BODIES.
//
// The REAL route files (./hooks.mjs) with the real idempotency door, floor-plan check and token lookup,
// against the in-memory database (../stubs/sb.mjs — nothing leaves the Mac). Bodies come from a grammar:
// every field a door reads, with every kind of value (missing, null, wrong type, empty, huge, unicode,
// digits with spaces, hostile keys), plus bodies that are not JSON at all. For every one:
//   · the door answers — never throws, never a 5xx (the database here never fails: a 5xx would be the app);
//   · the answer is JSON the phone can read, with a reason lib/guestOutbox.ts has words for;
//   · the database is only asked when the body was usable, and only with a canonical floor table.
import { check, real, rng } from "./h.mjs";
import { G } from "../stubs/state.mjs";

const FH = "00000000-0000-0000-0000-000000000001";
const DOORS = {
  "place-order": "app/api/guest/place-order/route.ts", "call-waiter": "app/api/guest/call-waiter/route.ts",
  leave: "app/api/guest/leave/route.ts", "limit-hit": "app/api/guest/limit-hit/route.ts",
};
// every reason a door may answer, all worded by reasonMsg (checked at R3-C10)
const KNOWN = new Set(["bad_body", "invalid_token", "unknown_restaurant", "order_too_big", "allergies_too_long", "off_plan_table",
  "unknown_table", "call_too_old", "server_busy", "empty", "already_gone", "rate_limited", "clash", "sold_out", "already_sent", "capped", "blocked", "no_table"]);
let NS = null;
async function nextServer() { NS ||= await import("next/server.js"); return NS; }
const uuid = () => crypto.randomUUID();
export function world() {
  G.reset();
  G.TABLES.settings = [{ restaurant_id: FH, table_count: 30 }];
  G.TABLES.session_members = [{ token: "tok-live", session_id: "s1" }];
  G.TABLES.sessions = [{ id: "s1", restaurant_id: FH }];
  G.RPC.lfh_place_order = { ok: true, order_id: "o1", restaurant_id: FH };
  G.RPC.lfh_place_order_public = { ok: true, order_id: "o2" };
  G.RPC.lfh_call_waiter = { ok: true, restaurant_id: FH };
  G.RPC.lfh_call_waiter_table = { ok: true };
  G.RPC.lfh_leave_session = { ok: true };
}
export async function call(door, body, { id = uuid(), raw = false, headers = {} } = {}) {
  const mod = await real(DOORS[door]); const { NextRequest } = await nextServer();
  const req = new NextRequest(`http://localhost/api/guest/${door}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", ...(id ? { "X-LFH-Action-Id": id } : {}), ...headers }, body: raw ? body : JSON.stringify(body) });
  const res = await mod.POST(req, {}); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
// ── the grammar ─────────────────────────────────────────────────────────────────────────────────
function value(r, field) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const any = [undefined, null, true, false, 0, -1, 1.5, NaN, 1e309, "", " ", "x".repeat(5000), "🍽️", "<b>", "null", [], [1], {}, { a: 1 }];
  switch (field) {
    case "mode": return pick(["public", "session", "PUBLIC", "", null, 3, undefined, "public"]);
    case "token": return pick(["tok-live", "tok-dead", "", null, 7, ["tok"], undefined, "tok-live"]);
    case "table": return pick(["7", "07", " 7 ", "0", "-1", "31", "30", "abc", "7A", "", " ", "1e3", "9999999999", "12.5", 7, 7.5, -3, null, undefined, [7], { t: 7 }, "٧"]);
    case "restaurantId": return pick([FH, FH.toUpperCase(), "nope", "", null, 1, undefined, uuid()]);
    case "items": return pick([[{ id: "tea", qty: 1 }], [], [{ id: "" }], [{ qty: 2 }], [null], [{ id: "tea", qty: "x" }], "items", { id: "tea" }, Array.from({ length: 201 }, () => ({ id: "t" })), undefined, [{ id: "tea", qty: 1, __proto__: { polluted: 1 } }]]);
    case "allergies": return pick([[], ["nuts"], [7], ["x".repeat(201)], Array.from({ length: 41 }, () => "a"), "nuts", null, undefined]);
    case "reason": return pick(["Water", "", null, 9, "x".repeat(400), undefined]);
    case "at": return pick([Date.now(), Date.now() - 11 * 60_000, "soon", null, undefined, "", -1]);
    case "fn": return pick(["lfh_place_order_public", "lfh_call_waiter_table", "nope", 3, ["lfh_place_order"], null, undefined]);
    case "rid": return pick([FH, "nope", null, undefined]);
    default: return pick(any);
  }
}
const FIELDS = { "place-order": ["mode", "token", "table", "restaurantId", "items", "allergies"], "call-waiter": ["mode", "token", "table", "restaurantId", "reason", "at"], leave: ["token", "restaurantId"], "limit-hit": ["fn", "rid"] };
function body(r, door) {
  const roll = r();
  if (roll < 0.04) return { raw: true, b: ["", "{", "nul", "[", "\"x\"", "{\"a\":}", "\u0000"][Math.floor(r() * 7)] };
  if (roll < 0.08) return { raw: false, b: [null, 7, "x", [], true][Math.floor(r() * 5)] };
  const o = {}; for (const f of FIELDS[door]) { const v = value(r, f); if (v !== undefined) o[f] = v; }
  if (r() < 0.05) o["__proto__"] = { polluted: true };
  if (r() < 0.05) o.constructor = { prototype: { polluted: true } };
  return { raw: false, b: o };
}
const isCanonicalTable = (t) => typeof t === "string" && /^[1-9]\d{0,8}$/.test(t);

for (const door of Object.keys(DOORS)) {
  check(`R3-C0${Object.keys(DOORS).indexOf(door) + 1}`, "C", `${door}: 1,500 random bodies — always a readable, worded answer, never a crash; the database only asked with a usable body`, async () => {
    const r = rng(777 + door.length); const bad = [];
    for (let k = 0; k < 1500 && bad.length < 3; k++) {
      world(); const { raw, b } = body(r, door); let res;
      try { res = await call(door, raw ? b : b, { raw }); } catch (e) { bad.push(`threw on ${JSON.stringify(b)?.slice(0, 80)}: ${String(e).slice(0, 80)}`); continue; }
      const reason = res.json?.reason;
      if (res.status >= 500) bad.push(`${res.status} for ${JSON.stringify(b)?.slice(0, 90)}`);
      else if (door !== "limit-hit" && (!res.json || typeof res.json !== "object")) bad.push(`unreadable answer ${res.text.slice(0, 60)}`);
      else if (door !== "limit-hit" && res.json.ok !== true && !KNOWN.has(String(reason))) bad.push(`unworded reason "${reason}" for ${JSON.stringify(b)?.slice(0, 80)}`);
      for (const c of G.RPC_CALLS) {
        if (c.name === "lfh_place_order_public" || c.name === "lfh_call_waiter_table") {
          if (!isCanonicalTable(String(c.args.p_table))) bad.push(`${c.name} was asked with table ${JSON.stringify(c.args.p_table)} (body table ${JSON.stringify(b?.table)})`);
          // French House's floor plan (30 tables) is the one this world knows. Another well-formed id is passed on
          // for the DATABASE to judge (offPlanTable fails open with no plan to compare; migrations 423/424 refuse).
          if (String(c.args.p_restaurant_id).toLowerCase() === FH && Number(c.args.p_table) > 30) bad.push(`${c.name} asked for table ${c.args.p_table} above the floor plan`);
          if (!/^[0-9a-f-]{36}$/i.test(String(c.args.p_restaurant_id))) bad.push(`${c.name} asked for restaurant ${c.args.p_restaurant_id}`);
        }
        if (c.name === "lfh_place_order_public" && (!Array.isArray(c.args.p_items) || !c.args.p_items.every((x) => x && typeof x.id === "string" && x.id))) bad.push(`an order went to the database with unusable items ${JSON.stringify(c.args.p_items).slice(0, 60)}`);
      }
      if ({}.polluted || Object.prototype.polluted) { bad.push("a body polluted Object.prototype"); delete Object.prototype.polluted; }
    }
    return { ok: bad.length === 0, note: bad.join(" · ") || "1,500 bodies" };
  });
}
check("R3-C05", "C", "the same action id twice reaches the database ONCE, and the second answer is the first one's", async () => {
  const out = [];
  for (const [door, b, fn] of [["place-order", { mode: "public", table: "7", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] }, "lfh_place_order_public"], ["call-waiter", { mode: "public", table: "7", restaurantId: FH, reason: "Water" }, "lfh_call_waiter_table"], ["leave", { token: "tok-live", restaurantId: FH }, "lfh_leave_session"]]) {
    world(); const id = uuid(); const a = await call(door, b, { id }); const c = await call(door, b, { id });
    const n = G.RPC_CALLS.filter((x) => x.name === fn).length;
    out.push({ door, ok: n === 1 && JSON.stringify(a.json?.ok) === JSON.stringify(c.json?.ok), n });
  }
  return { ok: out.every((x) => x.ok), note: out.map((x) => `${x.door} ${x.n} call(s)`).join(" · ") };
});
check("R3-C06", "C", "a guest order or call for table \" 07 \" reaches the database as \"7\", and one for \"\", \"abc\", \"0\" or 7.5 never does", async () => {
  const rows = [];
  for (const door of ["place-order", "call-waiter"]) for (const t of [" 07 ", "", "abc", "0", 7.5, "1e3", 12]) {
    world(); const b = door === "place-order" ? { mode: "public", table: t, restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] } : { mode: "public", table: t, restaurantId: FH, reason: "Water" };
    const res = await call(door, b); const asked = G.RPC_CALLS.find((c) => /public|table/.test(c.name));
    rows.push({ door, t, ok: (t === " 07 " || t === 12) ? asked?.args.p_table === String(Number(String(t).trim())) : !asked && res.json?.reason === "unknown_table" });
  }
  const bad = rows.filter((x) => !x.ok); return { ok: !bad.length, note: bad.map((x) => `${x.door} ${JSON.stringify(x.t)}`).join(", ") || `${rows.length} cases` };
});
check("R3-C07", "C", "a session order or call never opens the public door, and a dead token is answered, not crashed", async () => {
  world(); G.RPC.lfh_place_order = { ok: false, reason: "invalid_token" };
  const a = await call("place-order", { mode: "session", token: "tok-dead", items: [{ id: "tea", qty: 1 }], allergies: [] });
  const pub = G.RPC_CALLS.some((c) => c.name === "lfh_place_order_public");
  return { ok: a.status < 500 && a.json?.reason === "invalid_token" && !pub, note: `${a.status} ${a.text.slice(0, 60)}` };
});
check("R3-C08", "C", "when the database fails, every door answers busy with a Retry-After (saved and sent later), never a bare 500", async () => {
  const bad = [];
  for (const [door, b, fn] of [["place-order", { mode: "public", table: "7", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] }, "lfh_place_order_public"], ["place-order", { mode: "session", token: "tok-live", items: [{ id: "tea", qty: 1 }], allergies: [] }, "lfh_place_order"], ["call-waiter", { mode: "public", table: "7", restaurantId: FH, reason: "Water" }, "lfh_call_waiter_table"], ["call-waiter", { mode: "session", token: "tok-live", reason: "Water" }, "lfh_call_waiter"]]) {
    world(); G.RPC[fn] = { error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const res = await call(door, b);
    if (!(res.status === 502 || res.status === 503) || res.json?.reason !== "server_busy" || !(res.json?.retryAfter >= 1)) bad.push(`${door}/${fn}: ${res.status} ${res.text.slice(0, 60)}`);
  }
  return { ok: !bad.length, note: bad.join(" · ") || "4 doors × busy" };
});
check("R3-C09", "C", "the limit beacon never pings the owner for a function it does not know, and at most 6 times a minute per phone", async () => {
  // its own caller: the in-memory per-caller window (lib/publicCap.ts) is shared across this run
  const ip = { "x-forwarded-for": "10.77.0." + Math.floor(Math.random() * 250) };
  world(); const a = await call("limit-hit", { fn: "nope", rid: FH }, { id: null, headers: ip }); const n1 = G.PINGS.length;
  world(); for (let i = 0; i < 9; i++) await call("limit-hit", { fn: "lfh_place_order_public", rid: FH }, { id: null, headers: ip });
  return { ok: a.status < 500 && n1 === 0 && G.PINGS.length === 6, note: `unknown fn pings ${n1} · nine real taps → ${G.PINGS.length} pings` };
});
check("R3-C10", "C", "every reason these doors can answer is worded for the diner by lib/guestOutbox.ts (never the code itself)", async () => {
  const M = await real("lib/guestOutbox.ts"); const bad = [];
  // never the code itself: no snake_case word may reach the diner (an ordinary word like "blocked" may)
  for (const r of KNOWN) for (const kind of ["order", "call", "leave"]) { const s = M.reasonMsg(r, { kind, queued: true }); if (!s || /[a-z]+_[a-z]+/.test(s) || s.length < 12) bad.push(`${r}/${kind}: ${s}`); }
  return { ok: !bad.length, note: bad.join(", ") || `${KNOWN.size} reasons × 3 kinds` };
});
