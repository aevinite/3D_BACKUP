// Round 4 · B — THE DATABASE'S OWN ANSWERS, asked directly (the waiter bell calls lfh_call_waiter_table
// straight from the phone, so the function's answer is the one a diner meets).
//
// Every call runs through inTx() (./db.mjs): inside one transaction that is always rolled back, so an order
// or a call that IS accepted is placed, read back, and then never existed — no order, session, waiter call,
// rate-limit counter or queued notification survives. Nothing here is written to French House for real.
import { check, real } from "./h4.mjs";
import { inTx, lit, sql, FH_ID } from "./db.mjs";

let FH = null, DISH = null, OPTDISH = null, OTHER = null, RATE = null, TC = null;
async function ctx() {
  if (FH) return;
  FH = await FH_ID();
  const dishes = await sql(`select id, price, options, tax_mode from menu_items where restaurant_id='${FH}' and not open_price and not ('hidden'=any(tags)) and not ('sold-out'=any(tags)) order by id limit 40`);
  DISH = dishes.find((d) => !Array.isArray(d.options) || !d.options.length);
  OPTDISH = dishes.find((d) => Array.isArray(d.options) && d.options.some((g) => (g.choices || []).some((c) => Number(c.price) > 0)));
  OTHER = (await sql(`select id from menu_items where restaurant_id <> '${FH}' and id not in (select id from menu_items where restaurant_id='${FH}') limit 1`))[0]?.id;
  RATE = Number((await sql(`select lfh_effective_tax_rate('${FH}') r`))[0].r);
  TC = Number((await sql(`select table_count from settings where restaurant_id='${FH}'`))[0].table_count);
}
const items = (arr) => `${lit(JSON.stringify(arr))}::jsonb`;
const order = (t, its, rid) => `lfh_place_order_public(${lit(t)}, ${items(its)}, '{}', '${rid || FH}')`;
const call = (t, note, rid) => `lfh_call_waiter_table(${lit(t)}, ${lit(note)}, '${rid || FH}')`;
const READ_ORDER = `SELECT row_to_json(o) INTO x FROM (SELECT table_number, subtotal, tax, total, status, items, session_id FROM orders WHERE id = (r->>'order_id')::uuid) o;`;
const READ_CALL = `SELECT row_to_json(c) INTO x FROM (SELECT table_number, note FROM waiter_calls WHERE restaurant_id = '__FH__' ORDER BY created_at DESC, id DESC LIMIT 1) c;`;
const readCall = () => READ_CALL.replace("__FH__", FH);

// ── the table, written every way a phone, a keyboard or a hand-made request could write it ────────────
// [as typed, what the floor would call it — null when it is not a table at all]
const SPELLINGS = [
  ["7", "7"], ["07", "7"], ["007", "7"], [" 7", "7"], ["7 ", "7"], [" 7 ", "7"], ["1", "1"], ["30", "30"],
  ["0", null], ["00", null], ["-1", null], ["+7", null], ["7.0", null], ["7.5", null], ["1e1", null], ["0x7", null],
  ["", null], [" ", null], ["\t7", null], ["7\n", null], ["seven", null], ["7A", null], ["A7", null], ["7 7", null],
  ["٧", null], ["۷", null], ["७", null], ["૭", null], ["７", null], ["𝟕", null], ["⁷", null], ["Ⅶ", null],
  ["1234567890", null], ["9999999999", null], ["½", null], ["7;", null], ["'7'", null], ["7--", null],
];
// a table above the floor plan is refused with the sentence that names the real tables
const ABOVE = [["31", 31], ["99", 99], ["100", 100], ["999999999", 999999999], ["0031", 31]];

check("R4-B01", "B", "the waiter bell's database answer for 38 ways of writing a table: a real table is rung under the floor's own name for it, anything else is refused in words — never a database error", async () => {
  await ctx(); const bad = [];
  for (const [t, want] of SPELLINGS) {
    const { r, x } = await inTx(call(t, `r4-${Math.random()}`), readCall());
    if (r.__err) { bad.push(`${JSON.stringify(t)} → database error ${r.__err}`); continue; }
    if (want === null) { if (r.ok !== false || !["unknown_table", "no_table"].includes(r.reason)) bad.push(`${JSON.stringify(t)} accepted (${JSON.stringify(r)})`); }
    else if (r.ok !== true || x?.table_number !== want) bad.push(`${JSON.stringify(t)} → ${JSON.stringify(r)} stored ${x?.table_number}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 4).join(" · ") || `${SPELLINGS.length} spellings, each answered as the floor would` };
});
check("R4-B02", "B", "the same 38 ways for a guest order: placed on the floor's own table name, or refused in words — never a database error", async () => {
  await ctx(); const bad = [];
  for (const [t, want] of SPELLINGS) {
    const { r, x } = await inTx(order(t, [{ id: DISH.id, qty: 1 }]), READ_ORDER);
    if (r.__err) { bad.push(`${JSON.stringify(t)} → database error ${r.__err}`); continue; }
    if (want === null) { if (r.ok !== false || r.reason !== "unknown_table") bad.push(`${JSON.stringify(t)} accepted (${JSON.stringify(r).slice(0, 60)})`); }
    else if (r.ok !== true || x?.table_number !== want) bad.push(`${JSON.stringify(t)} → ${JSON.stringify(r).slice(0, 60)} stored ${x?.table_number}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 4).join(" · ") || `${SPELLINGS.length} spellings, each answered as the floor would` };
});
check("R4-B03", "B", "a table above French House's floor (31, 99, 100, 999999999, 0031) is refused for a call AND an order with the sentence naming tables 1–30", async () => {
  await ctx(); const bad = [];
  for (const [t, n] of ABOVE) for (const [k, q] of [["call", call(t, null)], ["order", order(t, [{ id: DISH.id }])]]) {
    const { r } = await inTx(q);
    const want = `Table ${n} doesn't exist — tables are 1–${TC}.`;
    if (r.ok !== false || r.reason !== "unknown_table" || r.error !== want) bad.push(`${k} ${t}: ${JSON.stringify(r).slice(0, 90)}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${ABOVE.length * 2} refusals, each naming tables 1–${TC}` };
});
check("R4-B04", "B", "the door and the database agree on every spelling: whatever guestTable() makes of it, the database stores exactly that (or both refuse)", async () => {
  await ctx(); const { guestTable } = await real("lib/planTable.ts").catch(() => ({}));
  if (!guestTable) return "skip: lib/planTable.ts cannot load outside the app (its database import)";
  const bad = [];
  for (const [t] of [...SPELLINGS, ...ABOVE]) {
    const g = guestTable(t); if (g === null) continue;   // the door refuses first; the database is never asked
    const { r, x } = await inTx(order(g, [{ id: DISH.id }]), READ_ORDER);
    const above = Number(g) > TC;
    if (above ? r.reason !== "unknown_table" : (r.ok !== true || x?.table_number !== g)) bad.push(`${JSON.stringify(t)} → door "${g}" → ${JSON.stringify(r).slice(0, 60)} ${x?.table_number ?? ""}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || "door and database read every spelling the same way" };
});
check("R4-B05", "B", "a restaurant that does not exist: the call and the order are refused in words, not a database error (item 45)", async () => {
  await ctx(); const dead = "00000000-0000-4000-8000-00000000dead";
  const a = (await inTx(call("5", null, dead))).r, b = (await inTx(order("5", [{ id: DISH.id }], dead))).r;
  return { ok: a.ok === false && a.reason === "unknown_restaurant" && b.ok === false && !b.__err && !a.__err, note: `call ${JSON.stringify(a)} · order ${JSON.stringify(b)}` };
});

// ── quantities: what the database charges for, whatever number arrives ──────────────────────────────
const QTY = [[1, 1], [2, 2], [99, 99], [100, 99], [5000, 99], [0, 1], [-3, 1], ["3", 3], [" 4 ", 4], [null, 1], ["", 1], [undefined, 1]];
check("R4-B06", "B", "a dish's quantity: 1–99 charged as sent, above 99 charged 99, nothing / 0 / negative charged 1 — subtotal = price × quantity every time", async () => {
  await ctx(); const bad = []; const unit = Number(String(DISH.price).replace(/[^0-9.]/g, ""));
  for (const [q, want] of QTY) {
    const line = q === undefined ? { id: DISH.id } : { id: DISH.id, qty: q };
    const { r, x } = await inTx(order("29", [line]), READ_ORDER);
    if (r.ok !== true) { bad.push(`qty ${JSON.stringify(q)} → ${JSON.stringify(r).slice(0, 80)}`); continue; }
    const st = x.items[0].qty, sub = Number(x.subtotal);
    if (st !== want || Math.abs(sub - Math.round(unit * want * 100) / 100) > 0.001) bad.push(`qty ${JSON.stringify(q)}: stored ${st}, subtotal ${sub} (want ${want} × ${unit})`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${QTY.length} quantities, each charged as the rule says` };
});
check("R4-B07", "B", "a quantity the database cannot read as a whole number (1.5, \"2.0\", \"1e3\", 3000000000) is a database ERROR — which is why the guest door refuses it first (item 44)", async () => {
  await ctx(); const out = [];
  for (const q of [1.5, "2.0", "1e3", 3000000000]) { const { r } = await inTx(order("29", [{ id: DISH.id, qty: q }])); out.push(`${JSON.stringify(q)}:${r.__err || r.reason || "ok"}`); }
  // this is the database's behaviour, recorded: every one of these must be stopped at the door (see R4-A and the
  // in-memory door check R4-C) — if this ever starts answering in words instead, the door's rule may relax
  return { ok: out.every((s) => /22P02|22003/.test(s)), note: out.join(" · ") };
});

// ── what the order is priced at: the menu's price, never the phone's ─────────────────────────────────
check("R4-B08", "B", "the phone's own 'price' on a line is ignored — an order is priced from the menu, even when the phone says ₹0 or ₹99,999", async () => {
  await ctx(); const bad = []; const unit = Number(String(DISH.price).replace(/[^0-9.]/g, ""));
  for (const p of ["0", "0.01", "99999", "-5", "abc"]) {
    const { r, x } = await inTx(order("29", [{ id: DISH.id, qty: 1, price: p }]), READ_ORDER);
    if (r.ok !== true || Math.abs(Number(x.subtotal) - unit) > 0.001) bad.push(`price ${p} → ${x?.subtotal}`);
  }
  return { ok: !bad.length, note: bad.join(" · ") || `5 invented prices, every order priced at the menu's ₹${unit}` };
});
check("R4-B09", "B", "tax and total: total = subtotal + tax, tax = subtotal × French House's own rate, to the paisa, for 1–6 dishes", async () => {
  await ctx(); const bad = [];
  for (let n = 1; n <= 6; n++) {
    const { r, x } = await inTx(order("29", Array.from({ length: n }, (_, i) => ({ id: DISH.id, qty: i + 1 }))), READ_ORDER);
    if (r.ok !== true) { bad.push(`${n} lines → ${JSON.stringify(r)}`); continue; }
    const s = Number(x.subtotal), t = Number(x.tax), tot = Number(x.total);
    if (DISH.tax_mode && DISH.tax_mode !== "default") return `skip: the plain dish has its own tax mode (${DISH.tax_mode})`;
    if (Math.abs(tot - (s + t)) > 0.001 || Math.abs(t - Math.round(s * RATE * 100) / 100) > 0.001) bad.push(`${n} lines: ${s} + ${t} = ${tot} at rate ${RATE}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 2).join(" · ") || `6 orders, each total = subtotal + ${RATE * 100}% tax to the paisa` };
});
check("R4-B10", "B", "a dish with a priced option: the option's price comes from the menu, an option the menu does not have adds nothing, and the stored line names what was chosen", async () => {
  await ctx(); if (!OPTDISH) return "skip: French House has no dish with a priced option";
  const g = OPTDISH.options.find((x) => (x.choices || []).some((c) => Number(c.price) > 0)); const c = g.choices.find((y) => Number(y.price) > 0);
  const base = Number(String(OPTDISH.price).replace(/[^0-9.]/g, ""));
  const a = await inTx(order("29", [{ id: OPTDISH.id, qty: 1, options: [{ group: g.name, label: c.label, price: 0 }] }]), READ_ORDER);
  const b = await inTx(order("29", [{ id: OPTDISH.id, qty: 1, options: [{ group: g.name, label: "No such choice", price: 500 }] }]), READ_ORDER);
  const okA = a.r.ok && Math.abs(Number(a.x.subtotal) - (base + Number(c.price))) < 0.01 && a.x.items[0].options?.[0]?.label === c.label;
  const okB = b.r.ok && Math.abs(Number(b.x.subtotal) - base) < 0.01 && !b.x.items[0].options;
  return { ok: okA && okB, note: `"${c.label}" +₹${c.price}: stored ${a.x?.subtotal} · an unknown choice: stored ${b.x?.subtotal} (base ${base})` };
});
check("R4-B11", "B", "a dish this restaurant does not sell, an empty basket, or no basket: refused in words (unknown_item / empty_order), never placed", async () => {
  await ctx(); const out = [];
  for (const [k, its] of [["another restaurant's dish", [{ id: OTHER || "nope" }]], ["a made-up dish", [{ id: "r4-no-such-dish" }]], ["empty", []]]) {
    const { r } = await inTx(order("29", its)); out.push([k, r]);
  }
  const { r: nul } = await inTx(`lfh_place_order_public('29', NULL, '{}', '${FH}')`); out.push(["no basket", nul]);
  const bad = out.filter(([, r]) => r.ok !== false || r.__err || !["unknown_item", "empty_order"].includes(r.reason));
  return { ok: !bad.length, note: out.map(([k, r]) => `${k}: ${r.reason || r.__err}`).join(" · ") };
});
check("R4-B12", "B", "a dish switched to sold-out, hidden or staff-priced a moment ago is refused for a guest (sold_out / hidden_item / staff_priced_item)", async () => {
  await ctx(); const out = [];
  const { inTxPrep } = await import("./db.mjs");
  for (const [k, set, want] of [["sold out", `tags = array_append(tags, 'sold-out')`, "sold_out"], ["hidden", `tags = array_append(tags, 'hidden')`, "hidden_item"], ["staff-priced", `open_price = true`, "staff_priced_item"]]) {
    // the dish is changed INSIDE the same rolled-back transaction: the real menu is never touched
    const { r } = await inTxPrep(`UPDATE menu_items SET ${set} WHERE id = ${lit(DISH.id)} AND restaurant_id = '${FH}';`, order("29", [{ id: DISH.id }]));
    out.push([k, r, want]);
  }
  const bad = out.filter(([, r, w]) => r.reason !== w);
  return { ok: !bad.length, note: out.map(([k, r]) => `${k}: ${r.reason || r.__err || "placed"}`).join(" · ") };
});
check("R4-B13", "B", "two guest orders on one table in one go share ONE party (session), and a follow-up to an accepted order is accepted by itself", async () => {
  await ctx();
  const { inTxPrep } = await import("./db.mjs");
  const r = await inTxPrep(
    `PERFORM ${order("28", [{ id: DISH.id }])};`,
    order("28", [{ id: DISH.id, qty: 2 }]),
    `SELECT json_agg(json_build_object('s', session_id, 'st', status) ORDER BY created_at) INTO x FROM orders WHERE restaurant_id='${FH}' AND table_number='28' AND created_at >= now();`);
  const rows = r.x || []; const sessions = new Set(rows.map((o) => o.s));
  const r2 = await inTxPrep(
    `p := ${order("27", [{ id: DISH.id }])}; UPDATE orders SET status='preparing' WHERE id = (p->>'order_id')::uuid;`,
    order("27", [{ id: DISH.id }]), READ_ORDER);
  return { ok: rows.length === 2 && sessions.size === 1 && !sessions.has(null) && r2.x?.status === "preparing", note: `${rows.length} orders, ${sessions.size} party · follow-up after an accepted order: ${r2.x?.status}` };
});
check("R4-B14", "B", "the bell's own limits, in one go on one table: the same request twice in 6 s rings once (already_sent), and a 7th different request is held back (capped)", async () => {
  await ctx(); const { inTxPrep } = await import("./db.mjs");
  const dup = await inTxPrep(`PERFORM ${call("26", "Water")};`, call("26", "Water"));
  const prep = ["Water", "Bill", "Napkins", "Help", "Menu", "Cutlery"].map((n) => `PERFORM ${call("26", n)};`).join("\n");
  const cap = await inTxPrep(prep, call("26", "Ice"), `SELECT count(*)::text::json INTO x FROM waiter_calls WHERE restaurant_id='${FH}' AND table_number='26' AND NOT resolved;`);
  const okCap = cap.r.reason === "capped" || cap.r.reason === "rate_limited";
  return { ok: dup.r.reason === "already_sent" && okCap, note: `repeat: ${dup.r.reason} · 7th: ${cap.r.reason} with ${cap.x} waiting` };
});
check("R4-B15", "B", "a call's note is stored as sent, trimmed, and an empty note is no note", async () => {
  await ctx(); const out = [];
  for (const [n, want] of [["Water", "Water"], ["  Bill  ", "Bill"], ["", null], ["   ", null], ["पानी", "पानी"]]) {
    const { r, x } = await inTx(call("25", n), readCall()); out.push(r.ok === true && x?.note === want ? null : `${JSON.stringify(n)} → ${JSON.stringify(x?.note)}`);
  }
  const bad = out.filter(Boolean); return { ok: !bad.length, note: bad.join(" · ") || "5 notes stored as the waiter should read them" };
});
