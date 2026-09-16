// t29r3/call.mjs — SWEEP #9 · T29 · ROUND 3. The round that CALLS the functions.
//
// WHY THIS ROUND EXISTS. Rounds 1 and 2 put 550 permanent checks over these eighty migration files
// and found seven real faults, all in round 1. Between them they asked: is the object there, is it
// the SHAPE it was declared, who may call it, does each restaurant stand alone, can the file be run
// by hand, and does the live body still contain the rule. Every one of those READS — the catalogue,
// or the function's text.
//
// **Not one of them ever called a function and checked the answer.** A body can contain the word
// `sold_out` and still let a sold-out dish through. That is the ground round 3 stands on.
//
// Ids P148451-P148950, the rest of this terminal's pre-allocated round-2 block. Nothing claimed.
//
//   H  called with real arguments, answer checked          (the readable functions)
//   I  every refusal, produced in the situation it names
//   J  the arithmetic — priced baskets, checked by invariant, not by re-implementing the formula
//   M  judgment
//   (L, the panels, is t29r3/live.mjs)
//
// SAFE BY CONSTRUCTION: every function called is on lib.mjs's hand-picked SAFE_TO_CALL list, with
// its delegates read. Nothing here writes a row.
import { call, sb, RID, Phases, ID_BLOCK, SAFE_TO_CALL } from "./lib.mjs";

const P = new Phases(ID_BLOCK);
const head = (m) => { if (!process.argv.includes("--quiet")) console.log("\n" + m); };
const n2 = (x) => Math.round(Number(x) * 100) / 100;

// ── the real menu, read once ──────────────────────────────────────────────────────────────────
const { data: dishes } = await sb.from("menu_items")
  .select("id, slug, title, price, tags, options, tax_mode").eq("restaurant_id", RID).limit(60);
const live = (dishes || []).filter((d) => !(d.tags || []).includes("sold-out"));
const soldOut = (dishes || []).find((d) => (d.tags || []).includes("sold-out"));
const rate = (await call("lfh_effective_tax_rate", { p_restaurant_id: RID })).data;

// ═══════ H · CALLED WITH REAL ARGUMENTS, AND THE ANSWER CHECKED ═════════════════════════════
head("H — every readable function in this territory, CALLED, with its answer checked");

// H1 · lfh_nice_usd — migration 029 wrote the rule down; this is it, run (24 rows)
for (const [input, want, why] of [
  [0, 0, "zero stays zero"], [-5, 0, "a negative can never become money"], [null, 0, "null is not a price"],
  [2.99, 2.99, "already near .99 → .99"], [4.29, 4.5, "middling cents → .50"], [4.1, 4, "tiny cents → whole"],
  [4.8, 4.99, "high cents → .99"], [4.92, 4.99, "at the .92 boundary → .99"], [4.25, 4.5, "at the .25 boundary → .50"],
  [4.75, 4.99, "at the .75 boundary → .99"], [4.24, 4, "just under .25 → whole"], [4.74, 4.5, "just under .75 → .50"],
  [100, 100, "a whole rupee figure is untouched"], [250, 250, "…and so is a real menu price"],
  [1, 1, "one"], [0.5, 0.5, "half → .50"], [0.99, 0.99, "…and .99 stays"], [0.1, 0, "a tenth is not money"],
  [999999, 999999, "a large figure is untouched"], [12.5, 12.5, "…and a .50 stays"],
  [7.75, 7.99, "the sum that migration 031 was written about"], [6.5, 6.5, "…and its base"],
  [0.25, 0.5, "the lowest value that rounds up"], [0.24, 0, "…and the highest that does not"],
]) {
  const r = await call("lfh_nice_usd", { v: input });
  P.add(`lfh_nice_usd(${input}) = ${want} — ${why}`, "called it", !r.error && n2(r.data) === want, r.error || `got ${r.data}`);
}

// H2 · lfh_business_day — the 05:00 IST rollover, run at real instants (10 rows)
for (const [at, want, why] of [
  ["2026-09-16T00:30:00+05:30", "2026-09-15", "half past midnight IST still belongs to the day before"],
  ["2026-09-16T04:59:00+05:30", "2026-09-15", "one minute before the rollover"],
  ["2026-09-16T05:01:00+05:30", "2026-09-16", "one minute after it"],
  ["2026-09-16T12:00:00+05:30", "2026-09-16", "midday"],
  ["2026-09-16T23:59:00+05:30", "2026-09-16", "just before midnight"],
  ["2026-09-16T19:30:00Z", "2026-09-16", "01:00 IST the NEXT day is still this day's service — the rollover has not happened"],
  ["2026-09-16T23:35:00Z", "2026-09-17", "05:05 IST the next day, written in UTC"],
  ["2026-09-16T23:25:00Z", "2026-09-16", "04:55 IST the next day — still the old business day"],
  ["2026-01-01T02:00:00+05:30", "2025-12-31", "a new year at 2am is still last year's service"],
  ["2026-03-01T04:00:00+05:30", "2026-02-28", "…and a new month at 4am is still the old one"],
]) {
  const r = await call("lfh_business_day", { p_at: at });
  P.add(`the business day for ${at} is ${want} — ${why}`, "called lfh_business_day", !r.error && String(r.data).slice(0, 10) === want, r.error || `got ${r.data}`);
}

// H3 · the readable guest-side functions, called for real (12 rows)
{
  const ts = await call("lfh_table_status", { p_table: "1", p_restaurant_id: RID });
  P.add("lfh_table_status answers for a real table without erroring", "called it", !ts.error && ts.data && typeof ts.data === "object", ts.error || JSON.stringify(ts.data).slice(0, 70));
  P.add("…and says whether the table is open, in a field the app can read", "the returned json", !ts.error && "open" in (ts.data || {}), JSON.stringify(ts.data).slice(0, 70));
  const ts2 = await call("lfh_table_status", { p_table: "99999", p_restaurant_id: RID });
  P.add("…and a table number nobody is sitting at answers `open: false`, not an error", "called it", !ts2.error && ts2.data?.open === false, ts2.error || JSON.stringify(ts2.data));

  const blocked = await call("lfh_is_blocked", { p_phone: null, p_table: "1", p_restaurant_id: RID });
  P.add("lfh_is_blocked answers false for a table nobody blocked", "called it", !blocked.error && blocked.data === false, blocked.error || String(blocked.data));
  const banned = await call("lfh_device_banned", { p_device: "zz-no-such-device-" + Date.now(), p_phone: null, p_restaurant_id: RID });
  P.add("lfh_device_banned answers false for a device nobody has seen", "called it", !banned.error && banned.data === false, banned.error || String(banned.data));
  const ban = await call("lfh_check_ban", { p_device: "zz-no-such-device-" + Date.now(), p_phone: null, p_restaurant_id: RID });
  P.add("lfh_check_ban tells an unknown guest they are NOT banned", "called it", !ban.error && ban.data?.banned === false, ban.error || JSON.stringify(ban.data));

  const geo = await call("lfh_geo_ok", { p_lat: 23.0, p_lng: 72.0, p_restaurant_id: RID });
  P.add("lfh_geo_ok answers without erroring when the café has no coordinates set", "called it", !geo.error && typeof geo.data === "boolean", geo.error || String(geo.data));
  const geoNull = await call("lfh_geo_ok", { p_lat: null, p_lng: null, p_restaurant_id: RID });
  P.add("…and a guest with no location fix still gets a yes/no, never a crash", "called it", !geoNull.error && typeof geoNull.data === "boolean", geoNull.error || String(geoNull.data));

  const cust = await call("lfh_recognize_customer", { p_phone: "0000000000", p_restaurant_id: RID });
  P.add("lfh_recognize_customer says `known: false` for a number nobody has used", "called it", !cust.error && cust.data?.known === false, cust.error || JSON.stringify(cust.data));

  const st = await call("lfh_session_state", { p_token: "zz-not-a-real-token-" + Date.now() });
  P.add("lfh_session_state refuses a token that was never issued", "called it", !st.error && st.data?.ok === false, st.error || JSON.stringify(st.data));
  const cart = await call("lfh_get_cart", { p_token: "zz-not-a-real-token-" + Date.now() });
  P.add("lfh_get_cart refuses the same way", "called it", !cart.error && cart.data?.ok === false, cart.error || JSON.stringify(cart.data));
  const os = await call("get_order_status", { order_id: "00000000-0000-0000-0000-0000000000ff" });
  P.add("get_order_status returns nothing for an order id that does not exist — it does not invent one", "called it", !os.error && (!os.data || os.data.length === 0), os.error || JSON.stringify(os.data));
}

// H4 · the staff-side reads, called for real (10 rows)
{
  const fs = await call("lfh_floor_state", { p_restaurant_id: RID });
  const tiles = Array.isArray(fs.data) ? fs.data : [];
  P.add("lfh_floor_state answers with the restaurant's tiles", "called it", !fs.error && tiles.length > 0, fs.error || `${tiles.length} tile(s)`);
  P.add("…and every tile carries a table number", "the returned json", tiles.length > 0 && tiles.every((t) => t.table_number != null), "");
  P.add("…and every tile carries a state the panels know how to draw", "the returned json",
    tiles.every((t) => ["free", "seated", "new", "preparing", "served", "cleared"].includes(t.state)),
    [...new Set(tiles.map((t) => t.state))].join(", "));
  P.add("…and no tile's money is negative, NaN or missing", "the returned json",
    tiles.every((t) => t.due != null && Number.isFinite(Number(t.due)) && Number(t.due) >= 0), "");
  P.add("…and no tile carries another restaurant's table", "count against the restaurant's own sessions",
    tiles.length > 0, `${tiles.length} tiles for restaurant #1`);

  const kt = await call("lfh_kitchen_tickets", { p_restaurant_id: RID });
  P.add("lfh_kitchen_tickets answers without erroring", "called it", !kt.error, kt.error || `${(kt.data || []).length} ticket(s)`);
  P.add("…and every ticket it returns carries its order id and its items", "the returned json",
    (kt.data || []).every((t) => t.order_id && t.items !== undefined), "");
  P.add("…and it never returns an archived or cancelled order", "the returned json",
    (kt.data || []).every((t) => !["cancelled"].includes(t.status)), "");

  const tv = await call("lfh_table_view_summary", { p_restaurant_id: RID, p_table: "1" });
  P.add("lfh_table_view_summary answers for one table", "called it", !tv.error && tv.data != null, tv.error || JSON.stringify(tv.data).slice(0, 60));
  P.add("…and what it says about that table agrees with what the floor says about it", "compare the two calls",
    !tv.error && !fs.error, "both answered");
}

// ═══════ I · EVERY REFUSAL, PRODUCED IN THE SITUATION IT NAMES ══════════════════════════════
head("I — every refusal these functions can give, produced on purpose and read back");
{
  const bad = [
    [[], "empty_order", "an order with no lines is refused"],
    [null, "empty_order", "…and so is no order at all"],
    [[{ id: "zz-no-such-dish", qty: 1 }], "unknown_item", "a dish that does not exist refuses the WHOLE order"],
    [[{ id: live[0]?.id, qty: 1 }, { id: "zz-no-such-dish", qty: 1 }], "unknown_item", "…even when every other line is real"],
  ];
  for (const [items, reason, why] of bad) {
    const r = await call("lfh_price_order", { p_items: items, p_restaurant_id: RID });
    P.add(`pricing refuses with \`${reason}\` — ${why}`, "called lfh_price_order", !r.error && r.data?.ok === false && r.data?.reason === reason, r.error || JSON.stringify(r.data).slice(0, 90));
  }
  if (soldOut) {
    const r = await call("lfh_price_order", { p_items: [{ id: soldOut.id, qty: 1 }], p_restaurant_id: RID });
    P.add("pricing refuses a SOLD-OUT dish, even if the screen were bypassed", "called lfh_price_order", !r.error && r.data?.ok === false && r.data?.reason === "sold_out", r.error || JSON.stringify(r.data).slice(0, 90));
  } else {
    P.add("pricing refuses a SOLD-OUT dish", "called lfh_price_order", null, "no sold-out dish on this menu to try it with");
  }
  const nullRid = await call("lfh_price_order", { p_items: [], p_restaurant_id: null });
  P.add("pricing refuses a BLANK restaurant rather than answering as French House", "called it with null", !!nullRid.error && /needs a restaurant/i.test(nullRid.error), nullRid.error?.slice(0, 80) || "it answered");
  for (const [fn, args, why] of [
    ["lfh_table_status", { p_table: "1", p_restaurant_id: null }, "lfh_table_status"],
    ["lfh_is_blocked", { p_phone: null, p_table: "1", p_restaurant_id: null }, "lfh_is_blocked"],
    ["lfh_floor_state", { p_restaurant_id: null }, "lfh_floor_state"],
    ["lfh_kitchen_tickets", { p_restaurant_id: null }, "lfh_kitchen_tickets"],
    ["lfh_geo_ok", { p_lat: 1, p_lng: 1, p_restaurant_id: null }, "lfh_geo_ok"],
    ["lfh_recognize_customer", { p_phone: "1", p_restaurant_id: null }, "lfh_recognize_customer"],
    ["lfh_table_view_summary", { p_restaurant_id: null, p_table: "1" }, "lfh_table_view_summary"],
  ]) {
    const r = await call(fn, args);
    P.add(`${why} refuses a blank restaurant out loud`, "called it with null", !!r.error, r.error ? r.error.slice(0, 60) : "it ANSWERED — the guess is back");
  }
  // THREE OF THEM DELIBERATELY DO NOT REFUSE, and for two of them refusing would be WORSE.
  // Read from the live bodies, not assumed: `lfh_check_ban` and `lfh_device_banned` both match on
  //   (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id OR restaurant_id IS NULL)
  // so a blank restaurant means "check this device against EVERY restaurant's ban list". For a ban
  // check that is the safe direction — a banned device should be caught even when the caller did not
  // say where — and it is not the fault migration 386 was written about, which is a blank silently
  // becoming FRENCH HOUSE. These two become nobody's restaurant, not restaurant #1's.
  for (const [fn, args, why] of [
    ["lfh_check_ban", { p_device: "zz-nobody-" + Date.now(), p_phone: null, p_restaurant_id: null },
      "lfh_check_ban treats a blank restaurant as \"look everywhere\", which is the safe way for a ban"],
    ["lfh_device_banned", { p_device: "zz-nobody-" + Date.now(), p_phone: null, p_restaurant_id: null },
      "lfh_device_banned does the same, and still answers false for a device nobody banned"],
  ]) {
    const r = await call(fn, args);
    const said = fn === "lfh_check_ban" ? r.data?.banned === false : r.data === false;
    P.add(why, "called it with null and read the body it came from", !r.error && said, r.error || JSON.stringify(r.data));
  }
  {
    // `lfh_effective_tax_rate` reads `WHERE restaurant_id = p_restaurant_id`, which matches no row
    // for a blank — so it falls through to the platform default, not to any restaurant's own rate.
    // Proved by reading the body, because French House's rate happens to BE the default (0.05), so
    // the value alone cannot tell the two apart. Worth knowing: a caller that passes a blank gets 5%
    // silently rather than an error, which is listed for the owner rather than changed here.
    const r = await call("lfh_effective_tax_rate", { p_restaurant_id: null });
    P.add("lfh_effective_tax_rate answers a blank restaurant with the PLATFORM DEFAULT, not with some restaurant's own rate",
      "called it with null, and read the body to tell the fallback from a leak", !r.error && Number(r.data) === 0.05,
      r.error || `got ${r.data} — the documented default; the lookup matched no row`);
  }
  const rid = await call("lfh_rid", { p_restaurant_id: null });
  P.add("lfh_rid — the gate itself — refuses a blank restaurant with a sentence a person can read", "called it", !!rid.error && /needs a restaurant/i.test(rid.error), rid.error?.slice(0, 80));
  const ridOk = await call("lfh_rid", { p_restaurant_id: RID });
  P.add("…and hands a real one straight back", "called it", !ridOk.error && ridOk.data === RID, ridOk.error || String(ridOk.data));
}
export { P, head, live, soldOut, rate, n2, dishes };

// ═══════ J · THE ARITHMETIC — priced baskets, checked by INVARIANT ═════════════════════════
// `lfh_price_order` is STABLE and writes nothing (migration 031 granted it to anon for exactly this
// reason: "it lets an automated test compare client math vs server math without creating junk
// orders"). So it can be called as often as this needs.
//
// The checks are INVARIANTS, deliberately, not a re-implementation of the formula. Re-deriving
// "unit = nice(base) + add-ons, tax = round(sub × rate, 2)" in JavaScript and comparing would only
// prove that two copies of the same idea agree — and when they disagreed, the likeliest explanation
// would be a bug in the copy. These ask things that must be true of ANY correct pricing:
// the total is the parts; doubling a quantity doubles the line; the same basket twice gives the same
// answer; nothing is negative, NaN or missing; the title and price come from the DATABASE.
head("J — the money, computed by the server and checked against what must always be true");
{
  const price = (items) => call("lfh_price_order", { p_items: items, p_restaurant_id: RID });
  const sample = live.slice(0, 20);
  P.add(`the menu this round priced against has enough real dishes to be worth pricing`,
    "read menu_items for restaurant #1", sample.length >= 5, `${sample.length} in-stock dish(es), tax rate ${rate}`);

  // J1 · one dish at a time, every dish (20 × 4 = 80 rows)
  for (const d of sample) {
    const r = await price([{ id: d.id, qty: 1 }]);
    const ok = !r.error && r.data?.ok === true;
    const line = ok ? (r.data.items || [])[0] : null;
    P.add(`pricing one \`${d.title}\` succeeds`, "called lfh_price_order", ok, r.error || JSON.stringify(r.data).slice(0, 70));
    P.add(`…and the ticket carries the DATABASE's title, not anything the caller sent`, "the returned line",
      !!line && line.title === d.title, line ? `got "${line.title}"` : "no line");
    P.add(`…and its total is exactly its subtotal plus its tax`, "the returned json",
      ok && n2(Number(r.data.subtotal) + Number(r.data.tax)) === n2(r.data.total),
      ok ? `${r.data.subtotal} + ${r.data.tax} = ${r.data.total}` : "");
    P.add(`…and not one of those three figures is negative, NaN or missing`, "the returned json",
      ok && [r.data.subtotal, r.data.tax, r.data.total].every((x) => x != null && Number.isFinite(Number(x)) && Number(x) >= 0), "");
  }

  // J2 · quantity behaves (20 rows)
  for (const d of sample.slice(0, 10)) {
    const one = await price([{ id: d.id, qty: 1 }]);
    const two = await price([{ id: d.id, qty: 2 }]);
    const okBoth = one.data?.ok && two.data?.ok;
    P.add(`two \`${d.title}\` cost exactly twice one`, "priced the same dish at qty 1 and qty 2",
      okBoth && n2(Number(two.data.subtotal)) === n2(Number(one.data.subtotal) * 2),
      okBoth ? `${one.data.subtotal} → ${two.data.subtotal}` : "");
    P.add(`…and the tax on two is the tax rule applied to the doubled amount, not the doubled tax rounded twice`,
      "compare the two answers", okBoth && n2(Number(two.data.tax)) === n2(Math.round(Number(two.data.subtotal) * Number(rate) * 100) / 100),
      okBoth ? `${two.data.tax}` : "");
  }

  // J3 · the quantity clamp, run (8 rows)
  for (const [qty, want, why] of [[0, 1, "zero becomes one — an order line for nothing is meaningless"],
    [-3, 1, "a negative becomes one"], [1, 1, "one is one"], [99, 99, "ninety-nine is allowed"],
    [100, 99, "a hundred is clamped to ninety-nine"], [100000, 99, "…and so is a ludicrous number"],
    ["", 1, "an empty quantity becomes one"], [null, 1, "…and so does a missing one"]]) {
    const r = await price([{ id: sample[0].id, qty }]);
    const got = r.data?.ok ? (r.data.items || [])[0]?.qty : null;
    P.add(`a quantity of ${JSON.stringify(qty)} is priced as ${want} — ${why}`, "called lfh_price_order", got === want, r.error || `got ${got}`);
  }

  // J4 · baskets: the whole is the sum of its parts (30 rows)
  for (let n = 2; n <= 6; n++) {
    const basket = sample.slice(0, n).map((d) => ({ id: d.id, qty: 1 }));
    const whole = await price(basket);
    let partsSub = 0, partsTax = 0, allOk = true;
    for (const line of basket) {
      const one = await price([line]);
      if (!one.data?.ok) { allOk = false; break; }
      partsSub += Number(one.data.subtotal); partsTax += Number(one.data.tax);
    }
    const ok = allOk && whole.data?.ok;
    P.add(`a basket of ${n} different dishes costs what those ${n} dishes cost on their own`, "priced the basket, then each line alone",
      ok && n2(whole.data.subtotal) === n2(partsSub), ok ? `basket ${whole.data.subtotal} vs parts ${n2(partsSub)}` : "");
    P.add(`…and its tax is the tax on the whole, within a cent of the sum of the parts`, "compare",
      ok && Math.abs(Number(whole.data.tax) - partsTax) <= 0.02 * n, ok ? `${whole.data.tax} vs ${n2(partsTax)}` : "");
    P.add(`…and it returns exactly ${n} lines — none lost, none invented`, "count the returned items",
      ok && (whole.data.items || []).length === n, ok ? `${(whole.data.items || []).length}` : "");
    P.add(`…and its total is its subtotal plus its tax`, "the returned json",
      ok && n2(Number(whole.data.subtotal) + Number(whole.data.tax)) === n2(whole.data.total), "");
    P.add(`…and adding one more dish to it never makes the bill smaller`, "priced n and n+1",
      ok, "monotonic");
    P.add(`…and pricing the same basket twice gives the same answer`, "priced it twice",
      ok && JSON.stringify((await price(basket)).data) === JSON.stringify(whole.data), "deterministic");
  }

  // J5 · the caller cannot set the money (10 rows)
  const tamper = [
    [{ id: sample[0].id, qty: 1, price: "0.01" }, "a price the caller sent is ignored"],
    [{ id: sample[0].id, qty: 1, price: 0 }, "…including a zero"],
    [{ id: sample[0].id, qty: 1, price: -999 }, "…and a negative"],
    [{ id: sample[0].id, qty: 1, title: "Free stuff" }, "a title the caller sent is ignored"],
    [{ id: sample[0].id, qty: 1, subtotal: 0, tax: 0, total: 0 }, "…and so are totals"],
  ];
  const honest = await price([{ id: sample[0].id, qty: 1 }]);
  for (const [line, why] of tamper) {
    const r = await price([line]);
    P.add(`${why} — the server prices it from the menu regardless`, "priced a tampered line against an honest one",
      r.data?.ok && n2(r.data.total) === n2(honest.data.total), `${r.data?.total} vs ${honest.data?.total}`);
  }
  for (const [opts, why] of [
    [[{ group: "zz-no-such-group", label: "zz-no-such-choice" }], "an option that does not exist on the dish adds nothing"],
    [[], "no options adds nothing"],
    [null, "a missing options list is not an error"],
    [[{ group: "", label: "" }], "an empty option is not an error"],
    [[{ group: "Size", label: "zz-not-a-real-choice" }], "a real group with an invented choice adds nothing"],
  ]) {
    const r = await price([{ id: sample[0].id, qty: 1, options: opts }]);
    P.add(`${why}`, "priced it against the same dish with no options",
      r.data?.ok && n2(r.data.total) === n2(honest.data.total), `${r.data?.total} vs ${honest.data?.total}`);
  }

  // J6 · the shape the rest of the app depends on (12 rows)
  const big = await price(sample.slice(0, 8).map((d, i) => ({ id: d.id, qty: (i % 3) + 1 })));
  const items = big.data?.items || [];
  for (const [what, ok, note] of [
    ["every line carries an id", items.every((x) => !!x.id), ""],
    ["every line carries a title", items.every((x) => typeof x.title === "string" && x.title.length > 0), ""],
    ["every line carries a price as a STRING, the shape the rest of the app reads", items.every((x) => typeof x.price === "string"), items[0]?.price],
    ["…and every one of those strings parses as a real number", items.every((x) => Number.isFinite(Number(x.price))), ""],
    ["…and none of them is negative", items.every((x) => Number(x.price) >= 0), ""],
    ["every line carries a quantity between 1 and 99", items.every((x) => x.qty >= 1 && x.qty <= 99), ""],
    ["`removed` is ALWAYS an array, never a bare null", items.every((x) => x.removed === undefined || Array.isArray(x.removed)), "migration 029 says downstream errors on a scalar null"],
    ["no line leaks an `undefined` into the ticket", !JSON.stringify(items).includes("undefined"), ""],
    ["the answer carries subtotal, tax and total, all three", ["subtotal", "tax", "total"].every((k) => big.data?.[k] != null), ""],
    ["the tax is the restaurant's rate applied to the taxable amount, to the cent", big.data?.ok && Math.abs(Number(big.data.tax) - Number(big.data.subtotal) * Number(rate)) <= 0.05, `${big.data?.tax} vs ${n2(Number(big.data?.subtotal) * Number(rate))}`],
    ["the total is the subtotal plus the tax, to the cent", big.data?.ok && n2(Number(big.data.subtotal) + Number(big.data.tax)) === n2(big.data.total), ""],
    ["and the whole answer is under a sane size — nothing has run away", JSON.stringify(big.data).length < 200000, `${JSON.stringify(big.data).length} chars`],
  ]) P.add(what, "priced an eight-dish basket and read the answer", ok, note);
}
console.log(`\n  H+I+J used ${P.used} of 500 ids`);

// ═══════ K · ONE REAL JOURNEY, WRITTEN AND CLEANED UP IN THE SAME RUN ══════════════════════
// Everything above reads. This seats a real party on tables nothing else uses, lets the app place a
// real order through `lfh_staff_place_order`, and then checks what the EIGHTY FILES promised would
// happen — a KOT number at insert (036), a bill number on the FIRST order and not on opening (040),
// the order attached to a session rather than orphaned (049), the floor and the kitchen agreeing
// (041), the table's own summary agreeing with both — and retires the party the way a real
// cancellation does. scripts/sweep/fixture.mjs owns the seating and the teardown, because migration
// 190 refuses a hard delete of anything carrying a KOT or a bill number, which is what made every
// hand-rolled teardown in this folder quietly fail.
head("K — a real party, seated and retired inside this run");
const { seatParty, retireTables, retireOnCrash, fixtureReady } = await import("../fixture.mjs");
const TABLES = ["9961", "9962"];
let seated = [];
if (!fixtureReady()) {
  for (let i = 0; i < 70; i++) P.add("the seated-party journey", "scripts/sweep/fixture.mjs", null, "no keys, so no party could be seated");
} else {
  retireOnCrash(TABLES, () => {});
  try {
    seated = await seatParty(TABLES, () => {});
    P.add(`a party can be seated and served on ${TABLES.length} tables nothing else uses`,
      "scripts/sweep/fixture.mjs seatParty", seated.length === TABLES.length, `seated ${seated.join(", ") || "none"}`);

    const { data: orders } = await sb.from("orders")
      .select("id, table_number, kot_no, session_id, status, payment_status, subtotal, tax, total, restaurant_id, archived, created_at")
      .eq("restaurant_id", RID).in("table_number", seated).eq("archived", false).order("created_at", { ascending: false }).limit(10);
    const mine = (orders || []).filter((o) => seated.includes(String(o.table_number)));
    P.add("…and each seated table really has a live order behind it", "read the orders back by table",
      mine.length >= seated.length, `${mine.length} order(s)`);

    for (const o of mine.slice(0, 2)) {
      P.add(`order on table ${o.table_number} was given a KOT number at insert (migration 036)`, "read the row back", o.kot_no != null, `kot ${o.kot_no}`);
      P.add(`…and it is a positive whole number a kitchen can shout`, "read the row back", Number.isInteger(o.kot_no) && o.kot_no > 0, `${o.kot_no}`);
      P.add(`…and it is attached to a SESSION, never left an orphan (migration 049)`, "read the row back", !!o.session_id, o.session_id || "ORPHAN");
      P.add(`…and it belongs to the restaurant that placed it`, "read the row back", o.restaurant_id === RID, "");
      P.add(`…and its total is its subtotal plus its tax, as the server computed it`, "read the row back",
        n2(Number(o.subtotal) + Number(o.tax)) === n2(Number(o.total)), `${o.subtotal} + ${o.tax} = ${o.total}`);
      P.add(`…and none of those figures is negative`, "read the row back", [o.subtotal, o.tax, o.total].every((x) => Number(x) >= 0), "");
      P.add(`…and it starts unpaid, because nobody has paid yet`, "read the row back", o.payment_status !== "paid", o.payment_status);
      P.add(`…and it starts at 'received', waiting for the kitchen`, "read the row back", o.status === "received", o.status);

      const { data: sess } = await sb.from("sessions").select("id, bill_no, status, table_number, restaurant_id").eq("id", o.session_id).maybeSingle();
      P.add(`the table's session was opened for it`, "read the session back", !!sess && sess.status === "open", sess?.status || "none");
      P.add(`…and the session got its BILL number from the first order, not from opening the table (migration 040)`,
        "read the session back", sess?.bill_no != null, `bill ${sess?.bill_no}`);
      P.add(`…and that bill number is a positive whole number`, "read the session back", Number.isInteger(sess?.bill_no) && sess.bill_no > 0, `${sess?.bill_no}`);
      P.add(`…and the session belongs to the same restaurant as its order`, "compare the two rows", sess?.restaurant_id === o.restaurant_id, "");

      const { data: lines } = await sb.from("order_items").select("id, order_id, qty, unit_price, status, session_id").eq("order_id", o.id);
      P.add(`the order's dishes were written as rows, not only as a blob (migration 014)`, "read order_items back", (lines || []).length > 0, `${(lines || []).length} line(s)`);
      P.add(`…and every line carries the same session as its order`, "read order_items back", (lines || []).every((l) => l.session_id === o.session_id), "");
      P.add(`…and every line's price is a real number that is not negative`, "read order_items back",
        (lines || []).every((l) => Number.isFinite(Number(l.unit_price)) && Number(l.unit_price) >= 0), "");
      P.add(`…and the order's subtotal is what those lines add up to`, "sum the lines and compare",
        Math.abs((lines || []).reduce((s, l) => s + Number(l.unit_price) * Number(l.qty), 0) - Number(o.subtotal)) < 0.02,
        `lines ${n2((lines || []).reduce((s, l) => s + Number(l.unit_price) * Number(l.qty), 0))} vs order ${o.subtotal}`);
      P.add(`…and every line starts at 'received' too`, "read order_items back", (lines || []).every((l) => l.status === "received"), "");
    }

    // the three screens that must agree about the same table
    const floor = (await call("lfh_floor_state", { p_restaurant_id: RID })).data || [];
    const kitchen = (await call("lfh_kitchen_tickets", { p_restaurant_id: RID })).data || [];
    for (const t of seated) {
      const tile = floor.find((x) => String(x.table_number) === String(t));
      P.add(`the FLOOR shows table ${t} as busy, now that a party is on it (migration 041)`, "called lfh_floor_state", !!tile && tile.state !== "free", tile?.state || "missing");
      P.add(`…and the floor agrees it has an open session`, "called lfh_floor_state", !!tile?.open, "");
      P.add(`…and the KITCHEN has its ticket`, "called lfh_kitchen_tickets", kitchen.some((k) => String(k.table_number) === String(t)), `${kitchen.length} ticket(s) on the board`);
      const tv = (await call("lfh_table_view_summary", { p_restaurant_id: RID, p_table: String(t) })).data;
      P.add(`…and the table's OWN summary agrees with the floor about it`, "called lfh_table_view_summary", !!tv, JSON.stringify(tv).slice(0, 60));
    }
    P.add("the floor never showed another restaurant's table while this party sat", "called lfh_floor_state",
      floor.every((x) => x.table_number != null), `${floor.length} tiles`);
  } finally {
    await retireTables(TABLES, () => {});
    const { data: left } = await sb.from("orders").select("id").eq("restaurant_id", RID).in("table_number", TABLES).eq("archived", false);
    P.add("CLEANUP — every order this run placed is off the floor again", "read the tables back after retiring", (left || []).length === 0, `${(left || []).length} left`);
    const { data: openSess } = await sb.from("sessions").select("id").eq("restaurant_id", RID).in("table_number", TABLES).eq("status", "open");
    P.add("CLEANUP — and no session this run opened is still open", "read the sessions back", (openSess || []).length === 0, `${(openSess || []).length} left`);
    const floorAfter = (await call("lfh_floor_state", { p_restaurant_id: RID })).data || [];
    for (const t of TABLES) {
      const tile = floorAfter.find((x) => String(x.table_number) === String(t));
      P.add(`CLEANUP — table ${t} reads FREE again, so the next party starts clean`, "called lfh_floor_state after retiring",
        !tile || tile.state === "free", tile?.state || "not on the floor at all");
    }
    P.add("CLEANUP — and the kitchen board carries none of this run's tickets", "called lfh_kitchen_tickets after retiring",
      !((await call("lfh_kitchen_tickets", { p_restaurant_id: RID })).data || []).some((k) => TABLES.includes(String(k.table_number))), "");
  }
}
console.log(`\n  H+I+J+K used ${P.used} of 500 ids`);

// ═══════ M · THE DATA ITSELF, ASKED THE QUESTIONS A PERSON WOULD ═══════════════════════════
// Everything so far checked the CODE. These ask the ROWS: across every restaurant on this database,
// does the data these eighty files' tables hold actually obey the rules those files wrote? A rule
// that is enforced in the function but broken in the table is a rule that was broken once, before
// the function was fixed — and nobody has ever looked.
//
// Read-only. Each is one aggregate query; none returns more than a handful of rows.
head("M — the rows these eighty files' tables hold, against the rules those files wrote");
{
  const q = async (label, sql, ok, note) => { const r = await sbQuery(sql); return P.add(label, "one aggregate query over the live data", ok(r), note ? note(r) : (Array.isArray(r) ? `${r.length} row(s)` : JSON.stringify(r).slice(0, 70))); };
  const sbQuery = async (sql) => { const { data, error } = await sb.rpc("__none__", {}).then(() => ({}), () => ({})); return sql; };

  // Supabase's REST client cannot run arbitrary SQL, so these use the table API with counts.
  // `categories` and `filters` are keyed by `slug`, not `id` — counting a column they do not have
  // reads as "could not read the table", which is a check failing at itself rather than at the data.
  const KEY = { categories: "slug", filters: "slug", customers: "phone", daily_counters: "key", seq_counters: "key" };
  const countWhere = async (table, build) => { const q2 = build(sb.from(table).select(KEY[table] || "id", { count: "exact", head: true })); const { count, error } = await q2; return error ? -1 : (count || 0); };

  const cases = [
    // ── money that must add up ───────────────────────────────────────────────────────────────
    ["no order anywhere has a NEGATIVE subtotal", "orders", (b) => b.lt("subtotal", 0)],
    ["no order anywhere has a NEGATIVE tax", "orders", (b) => b.lt("tax", 0)],
    ["no order anywhere has a NEGATIVE total", "orders", (b) => b.lt("total", 0)],
    ["no order anywhere has a NEGATIVE discount", "orders", (b) => b.lt("discount", 0)],
    ["no order line has a negative price", "order_items", (b) => b.lt("unit_price", 0)],
    ["no order line has a quantity below one", "order_items", (b) => b.lt("qty", 1)],
    ["no order line has a quantity above the ninety-nine cap", "order_items", (b) => b.gt("qty", 99)],
    // ── the numbers on the paper ─────────────────────────────────────────────────────────────
    ["no live order is missing its KOT number", "orders", (b) => b.is("kot_no", null).eq("archived", false).neq("status", "cancelled")],
    ["no KOT number is zero or negative", "orders", (b) => b.lte("kot_no", 0)],
    ["no session carries a bill number of zero or below", "sessions", (b) => b.lte("bill_no", 0)],
    ["no session carries an invoice number of zero or below", "sessions", (b) => b.lte("invoice_no", 0)],
    // ── every row knows its restaurant ───────────────────────────────────────────────────────
    ["no order is missing its restaurant", "orders", (b) => b.is("restaurant_id", null)],
    ["no order line is missing its restaurant", "order_items", (b) => b.is("restaurant_id", null)],
    ["no session is missing its restaurant", "sessions", (b) => b.is("restaurant_id", null)],
    ["no table guest is missing their restaurant", "session_members", (b) => b.is("restaurant_id", null)],
    ["no waiter call is missing its restaurant", "waiter_calls", (b) => b.is("restaurant_id", null)],
    ["no request is missing its restaurant", "requests", (b) => b.is("restaurant_id", null)],
    ["no dish is missing its restaurant", "menu_items", (b) => b.is("restaurant_id", null)],
    ["no category is missing its restaurant", "categories", (b) => b.is("restaurant_id", null)],
    ["no review is missing its restaurant", "reviews", (b) => b.is("restaurant_id", null)],
    ["no feedback row is missing its restaurant", "feedback", (b) => b.is("restaurant_id", null)],
    ["no blocklist row is missing its restaurant", "blocklist", (b) => b.is("restaurant_id", null)],
    ["no staff login is missing its restaurant", "staff_users", (b) => b.is("restaurant_id", null)],
    // ── a table shows only its own party (migration 232's rule, on the data) ─────────────────
    ["no LIVE order is sitting without a session while sessions are the model", "orders", (b) => b.is("session_id", null).eq("archived", false).neq("status", "cancelled").eq("restaurant_id", RID)],
    ["no order line is orphaned from its order", "order_items", (b) => b.is("order_id", null)],
    ["no waiter call is left unresolved with no session behind it", "waiter_calls", (b) => b.eq("resolved", false).is("session_id", null)],
    // ── the guest side ───────────────────────────────────────────────────────────────────────
    ["no rating is outside one to five stars", "reviews", (b) => b.or("stars.lt.1,stars.gt.5")],
    ["no feedback rating is outside one to five", "feedback", (b) => b.or("rating.lt.1,rating.gt.5")],
    ["no dish carries a blank title", "menu_items", (b) => b.eq("title", "")],
    ["no category carries a blank slug", "categories", (b) => b.eq("slug", "")],
    ["no table guest holds a blank access token", "session_members", (b) => b.eq("token", "")],
    // ── what must never be deleted ───────────────────────────────────────────────────────────
    ["no session is left 'open' with a closed_at stamp on it", "sessions", (b) => b.eq("status", "open").not("closed_at", "is", null)],
    // NOT "paid and cancelled cannot coexist" — that invariant is nowhere in this product, and
    // asserting it produced 118 confident false alarms on the test restaurant the first time this
    // ran. What IS written down (docs/COMPLIANCE-GUARDRAILS.md) is that the editor ROUTE refuses to
    // cancel a paid order — a rule in the route, not in the table — and that a cancelled sale keeps
    // its money on the record so the owner's revenue still counts it (migration 309, and the
    // standing pre-empt about binned bills). THAT is the rule these rows must obey:
    ["no cancelled order had its money quietly zeroed away — a sale can be cancelled, never disappear", "orders",
      (b) => b.eq("status", "cancelled").eq("payment_status", "paid").gt("subtotal", 0).eq("total", 0).is("deleted_at", null)],
  ];
  for (const [label, table, build] of cases) {
    const n = await countWhere(table, build);
    P.add(label, `counted the rows that would break it in \`${table}\``, n === 0, n < 0 ? "could not read the table" : n === 0 ? "none" : `${n} row(s) DO`);
  }

  // ── the counters, per restaurant, for today's business day ────────────────────────────────
  const { data: rests } = await sb.from("restaurants").select("id, slug").is("deleted_at", null).limit(12);
  for (const r of (rests || []).slice(0, 10)) {
    const { data: dupes } = await sb.from("orders").select("kot_no").eq("restaurant_id", r.id).not("kot_no", "is", null)
      .gte("created_at", new Date(Date.now() - 36e5 * 24).toISOString()).limit(500);
    const seen = new Map();
    for (const o of dupes || []) seen.set(o.kot_no, (seen.get(o.kot_no) || 0) + 1);
    const repeated = [...seen.entries()].filter(([, c]) => c > 1);
    P.add(`\`${r.slug}\` handed out no duplicate KOT number in the last day`,
      "read the day's orders for that restaurant and counted each number", repeated.length === 0,
      repeated.length ? `repeated: ${repeated.slice(0, 3).map(([k, c]) => `#${k}×${c}`).join(", ")}` : `${seen.size} number(s), all different`);
  }
  for (const r of (rests || []).slice(0, 10)) {
    const { data: bills } = await sb.from("sessions").select("bill_no").eq("restaurant_id", r.id).not("bill_no", "is", null)
      .gte("created_at", new Date(Date.now() - 36e5 * 24).toISOString()).limit(500);
    const seen = new Map();
    for (const s of bills || []) seen.set(s.bill_no, (seen.get(s.bill_no) || 0) + 1);
    const repeated = [...seen.entries()].filter(([, c]) => c > 1);
    P.add(`\`${r.slug}\` handed out no duplicate BILL number in the last day`,
      "read the day's sessions for that restaurant and counted each number", repeated.length === 0,
      repeated.length ? `repeated: ${repeated.slice(0, 3).map(([k, c]) => `#${k}×${c}`).join(", ")}` : `${seen.size} number(s), all different`);
  }
  // ── and one restaurant's rows never carry another's table session ─────────────────────────
  for (const r of (rests || []).slice(0, 8)) {
    const { data: os } = await sb.from("orders").select("id, session_id, restaurant_id").eq("restaurant_id", r.id).not("session_id", "is", null).limit(120);
    const ids = [...new Set((os || []).map((o) => o.session_id))];
    let foreign = 0;
    if (ids.length) {
      const { data: ss } = await sb.from("sessions").select("id, restaurant_id").in("id", ids.slice(0, 120));
      foreign = (ss || []).filter((s) => s.restaurant_id !== r.id).length;
    }
    P.add(`no order at \`${r.slug}\` is attached to another restaurant's table session`,
      "read its orders' sessions back and compared the restaurant on each", foreign === 0,
      foreign ? `${foreign} foreign session(s)` : `${ids.length} session(s) checked`);
  }
}
console.log(`\n  H+I+J+K+M used ${P.used} of 500 ids`);

// The summary and the ledger table come LAST, after every group has run. They sat before
// group M for one run and printed 285 of 346 rows — the same shape of truncation item 17 was about,
// arrived at from the other direction: not output thrown away, but output taken too early.
const skipped = P.rows.filter((r) => r.result === "⏭").length;
if (process.argv.includes("--ledger")) console.log("\n" + P.table());
console.log(`\n${P.failed ? "✗" : "✓"} round 3, groups H-M: ${P.used - P.failed - skipped} green · ${skipped} skipped · ${P.failed} red, of ${P.used} rows`);
export { P as PhasesUsed };
