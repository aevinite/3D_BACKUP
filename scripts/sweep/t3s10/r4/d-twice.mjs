// Round 4 · D — THE SAME TAP TWICE, AND TWO PHONES AT ONCE, through the real server and the real database.
//
// The only real writes of round 4: a few orders and waiter calls on ONE free French House table (no party, no
// live order, no waiting call), each put back by its own id the moment it is checked — the order cancelled
// and archived with its stamps (its kitchen ticket is dismissed by the queue itself: "the order was cancelled
// before this ticket printed"), the party it opened closed, the call deleted. Aangan is never touched.
import { check } from "./h4.mjs";
import { rest, FH_ID, sql } from "./db.mjs";
import { BASE } from "./live4.mjs";

let FH = null; const DISH = "pink-pineapple-smoothie";
const T0 = new Date(Date.now() - 2000).toISOString(); const USED = new Set();   // every table this area touched   // a dish with no stock recipe: no inventory moves
const post = (door, body, id) => fetch(`${BASE}/api/guest/${door}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.44.0.5", ...(id ? { "X-LFH-Action-Id": id } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
async function freeTable(avoid = []) {
  for (const t of ["24", "23", "22", "21", "26", "25"]) {
    if (avoid.includes(t)) continue;
    const s = (await rest(`sessions?restaurant_id=eq.${FH}&table_number=eq.${t}&status=eq.open&select=id&limit=1`)).json;
    const o = (await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${t}&archived=is.false&status=in.(received,preparing,served)&select=id&limit=1`)).json;
    const c = (await rest(`waiter_calls?restaurant_id=eq.${FH}&table_number=eq.${t}&resolved=is.false&select=id&limit=1`)).json;
    if (Array.isArray(s) && !s.length && Array.isArray(o) && !o.length && Array.isArray(c) && !c.length) { USED.add(t); return t; }
  }
  return null;
}
export async function retireOrder(id) {
  const now = new Date().toISOString(); const [o] = (await rest(`orders?id=eq.${id}&restaurant_id=eq.${FH}&select=session_id`)).json || [];
  await rest(`orders?id=eq.${id}&restaurant_id=eq.${FH}`, { method: "PATCH", body: { status: "cancelled", cancelled_at: now, archived: true, archived_at: now } });
  // its kitchen ticket: dismissed exactly as the print queue itself dismisses one (lib/printQueue.ts) — only
  // this order's, only while it is still waiting
  await rest(`print_jobs?order_id=eq.${id}&restaurant_id=eq.${FH}&status=eq.queued`, { method: "PATCH", body: { status: "dismissed", done_at: now, error: "the order was cancelled before this ticket printed" } });
  if (o?.session_id) { const others = (await rest(`orders?session_id=eq.${o.session_id}&id=neq.${id}&status=neq.cancelled&select=id&limit=1`)).json; if (Array.isArray(others) && !others.length) await rest(`sessions?id=eq.${o.session_id}&restaurant_id=eq.${FH}&status=eq.open`, { method: "PATCH", body: { status: "closed", closed_at: now, deleted_at: now } }); }
}
const ordersSince = async (t, iso) => (await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${t}&created_at=gte.${iso}&select=id,session_id,status`)).json || [];
const callsSince = async (t, iso) => (await rest(`waiter_calls?restaurant_id=eq.${FH}&table_number=eq.${t}&created_at=gte.${iso}&select=id,note`)).json || [];

check("R4-D01", "D", "one order sent twice with the same action id (the saved-work queue re-sending after a lost answer) is ONE order — the repeat says 'duplicate' and names the same order", async () => {
  FH ||= await FH_ID(); const t = await freeTable(); if (!t) return "skip: no free French House table right now";
  const iso = new Date(Date.now() - 1000).toISOString(); const id = crypto.randomUUID(); let mine = [];
  try {
    const body = { mode: "public", restaurantId: FH, table: t, items: [{ id: DISH, qty: 1 }], allergies: [] };
    const a = await post("place-order", body, id), b = await post("place-order", body, id);
    const rows = await ordersSince(t, iso); mine = rows.map((r) => r.id);
    return { ok: a.json?.ok === true && b.json?.duplicate === true && b.json?.order_id === a.json?.order_id && rows.length === 1, note: `table ${t}: first ${JSON.stringify(a.json)} · repeat ${JSON.stringify(b.json)} · ${rows.length} order(s) in the database` };
  } finally { for (const o of mine) await retireOrder(o); }
});
check("R4-D02", "D", "two phones at one table order at the same instant: both orders land, in ONE party (session) — never two parties on one table", async () => {
  FH ||= await FH_ID(); const t = await freeTable(); if (!t) return "skip: no free French House table right now";
  const iso = new Date(Date.now() - 1000).toISOString(); let mine = [];
  const before = new Set((await ordersSince(t, new Date(Date.now() - 600_000).toISOString())).map((o) => o.id));   // count only what THIS check makes
  try {
    const body = (q) => ({ mode: "public", restaurantId: FH, table: t, items: [{ id: DISH, qty: q }], allergies: [] });
    const [a, b] = await Promise.all([post("place-order", body(1), crypto.randomUUID()), post("place-order", body(2), crypto.randomUUID())]);
    const rows = (await ordersSince(t, iso)).filter((o) => !before.has(o.id)); mine = rows.map((r) => r.id);
    const parties = new Set(rows.map((r) => r.session_id));
    const open = (await rest(`sessions?restaurant_id=eq.${FH}&table_number=eq.${t}&status=eq.open&select=id`)).json || [];
    return { ok: a.json?.ok && b.json?.ok && rows.length === 2 && parties.size === 1 && !parties.has(null) && open.length === 1, note: `table ${t}: ${rows.length} orders, ${parties.size} party, ${open.length} open session(s)` };
  } finally { for (const o of mine) await retireOrder(o); }
});
check("R4-D03", "D", "one waiter call sent twice with the same action id rings ONCE", async () => {
  FH ||= await FH_ID(); const t = await freeTable(); if (!t) return "skip: no free French House table right now";
  const iso = new Date(Date.now() - 1000).toISOString(); const id = crypto.randomUUID(); let rows = [];
  try {
    const body = { mode: "public", restaurantId: FH, table: t, reason: "Water", at: Date.now() };
    const a = await post("call-waiter", body, id), b = await post("call-waiter", body, id);
    rows = await callsSince(t, iso);
    return { ok: a.json?.ok === true && b.json?.duplicate === true && rows.length === 1, note: `table ${t}: ${JSON.stringify(a.json)} then ${JSON.stringify(b.json)} · ${rows.length} call(s) ringing` };
  } finally { for (const r of rows) await rest(`waiter_calls?id=eq.${r.id}&restaurant_id=eq.${FH}`, { method: "DELETE" }); }
});
check("R4-D04", "D", "two phones at one table ring for the SAME thing at the same instant: the waiter sees it once (the 6-second same-request rule holds under a race)", async () => {
  // a table D03 did not ring: the bell's own limit (6 a minute per table) must not be what answers here
  FH ||= await FH_ID(); const t = await freeTable([...USED]); if (!t) return "skip: no free French House table right now";
  const iso = new Date(Date.now() - 1000).toISOString(); let rows = [];
  try {
    const body = { mode: "public", restaurantId: FH, table: t, reason: "Bill", at: Date.now() };
    const res = await Promise.all([post("call-waiter", body, crypto.randomUUID()), post("call-waiter", body, crypto.randomUUID()), post("call-waiter", body, crypto.randomUUID())]);
    rows = await callsSince(t, iso);
    return { ok: rows.length === 1 && res.every((r) => r.json?.ok === true) && !res.some((r) => r.json?.reason === "rate_limited"), note: `table ${t}: 3 phones at once → ${rows.length} call(s) ringing · answers ${res.map((r) => r.json?.reason || "rang").join(", ")}` };
  } finally { for (const r of rows) await rest(`waiter_calls?id=eq.${r.id}&restaurant_id=eq.${FH}`, { method: "DELETE" }); }
});
check("R4-D05", "D", "every order this area placed is retired, its party closed and its kitchen ticket dismissed — nothing of round 4 is left on French House's floor or print queue", async () => {
  FH ||= await FH_ID(); await new Promise((s) => setTimeout(s, 4000));
  const left = await sql(`select o.table_number t, o.status, o.archived, (select string_agg(j.status, ',') from print_jobs j where j.order_id = o.id) jobs from orders o where o.restaurant_id='${FH}' and o.created_at > now() - interval '30 minutes' and o.items::text like '%${DISH}%' and o.table_number in ('21','22','23','24','25','26')`);
  const bad = left.filter((o) => o.status !== "cancelled" || !o.archived || (o.jobs && /queued|pending|printing/.test(o.jobs)));
  const calls = await sql(`select count(*)::int n from waiter_calls where restaurant_id='${FH}' and created_at > now() - interval '30 minutes' and table_number in ('21','22','23','24','25','26') and note in ('Water','Bill')`);
  return { ok: !bad.length && calls[0].n === 0, note: `${left.length} round-4 orders: ${left.map((o) => `t${o.t} ${o.status} ticket ${o.jobs || "none"}`).join(", ")} · ${calls[0].n} calls left` };
});
check("R4-D06", "D", "this area tripped no limit: no 'limit reached' record is left for the owner's phone on any table it used (any it caused is removed by its id)", async () => {
  FH ||= await FH_ID(); const subs = [...USED].map((t) => `table:${t}`);
  if (!subs.length) return "skip: no table was used";
  const ev = (await rest(`rate_limit_events?restaurant_id=eq.${FH}&created_at=gte.${T0}&subject=in.(${subs.join(",")})&select=id,key,subject`)).json || [];
  for (const e of ev) await rest(`rate_limit_events?id=eq.${e.id}&restaurant_id=eq.${FH}`, { method: "DELETE" });
  return { ok: !ev.length, note: ev.length ? `${ev.length} limit record(s) were caused and have been removed: ${ev.map((e) => e.key + " " + e.subject).join(", ")}` : `tables ${[...USED].join(", ")}: no limit reached` };
});
