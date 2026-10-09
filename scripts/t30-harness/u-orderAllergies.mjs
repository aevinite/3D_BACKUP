// Round 3 — lib/orderAllergies.ts, every rule of it: the per-dish mark rule against the loop it
// replaced (git 3d023b7e^, both routes held the same copy), the grouping, the paging, what a failed
// write leaves behind, and that a RETRY finishes the job (item 24). Real file, in-memory database.
import { suite } from "./lib.mjs";
import { W, world } from "./sb.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("lib/orderAllergies.ts", 167301, 80);
const A = await import("@/lib/orderAllergies.ts");
const sb = (await import("./sb.mjs")).supabaseAdmin;
const src = (p) => readFileSync(join(root, p), "utf8");

const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (R, xs) => xs[Math.floor(R() * xs.length)];
const ALG = ["nuts", "dairy", "egg", "gluten", "soy", "fish", "sesame", "other: kiwi"];
const some = (R, max = 3) => [...new Set(Array.from({ length: int(R, 0, max) }, () => pick(R, ALG)))];
const dishOf = (R, i) => ({ id: `d${i}`, order_id: "o", restaurant_id: "R", removed_flag: R() < 0.2, added_allergens: R() < 0.1 ? pick(R, [null, "nuts", 5]) : some(R).map((a) => (R() < 0.3 ? a.toUpperCase() : a)) });
let SEED = 9301;
const prop = async (what, n, make, ok) => { const R = gen(SEED++); let bad = null; for (let i = 0; i < n && !bad; i++) { const x = make(R, i); let r; try { r = await ok(x); } catch (e) { r = "threw: " + e.message; } if (r !== true) bad = { x, r }; }
  t(`${what} — ${n.toLocaleString("en-IN")} random cases`, !bad, bad ? `counter-example ${JSON.stringify(bad.x).slice(0, 140)} → ${String(bad.r).slice(0, 40)}` : ""); };

// THE OLD LOOP, verbatim in meaning (app/api/editor/[...path]/route.ts at 3d023b7e^, lines 4374–4378):
const OLD = (it, addedOW, removedOW) => {
  const mark = new Set((Array.isArray(it.added_allergens) ? it.added_allergens : []).map((x) => String(x).toLowerCase()));
  let rf = !!it.removed_flag;
  for (const s of addedOW) mark.add(s);
  for (const s of removedOW) { if (mark.has(s)) mark.delete(s); else rf = true; }
  return { added_allergens: [...mark], removed_flag: rf };
};
const changeOf = (R) => { const added = some(R), removed = some(R).filter((x) => !added.includes(x)); return { added, removed }; };

// ── the rule ────────────────────────────────────────────────────────────────────────────────────────
await prop("spreadOne gives EXACTLY what the old per-dish loop gave — same marks, same order, same flag", 50000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added, removed }) => JSON.stringify(A.spreadOne(d, added, removed)) === JSON.stringify(OLD(d, added, removed)));
await prop("spreadOne: adding an allergy twice is the same as adding it once", 20000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added }) => { const once = A.spreadOne(d, added, []); return JSON.stringify(A.spreadOne({ ...d, ...once }, added, [])) === JSON.stringify(once); });
await prop("spreadOne never lists an allergy twice on one dish", 20000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added, removed }) => { const m = A.spreadOne(d, added, removed).added_allergens; return new Set(m).size === m.length; });
await prop("spreadOne: every added allergy is on the dish afterwards; every removed one is gone", 20000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added, removed }) => { const m = A.spreadOne(d, added, removed).added_allergens; return added.every((a) => m.includes(a)) && removed.every((r) => !m.includes(r)); });
await prop("spreadOne: a dish's removed-flag can only go up, never down", 20000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added, removed }) => !d.removed_flag || A.spreadOne(d, added, removed).removed_flag === true);
await prop("spreadOne: removing an allergy the dish never carried raises the flag (a real removal the kitchen must see)", 20000, (R, i) => ({ d: { ...dishOf(R, i), added_allergens: [], removed_flag: false }, r: pick(R, ALG) }), ({ d, r }) => A.spreadOne(d, [], [r]).removed_flag === true);
await prop("spreadOne: removing one the dish DID carry (as an addition) only un-marks it, with no flag", 20000, (R, i) => ({ d: { ...dishOf(R, i), added_allergens: [pick(R, ALG)], removed_flag: false } }), ({ d }) => { const o = A.spreadOne(d, [], [d.added_allergens[0]]); return o.removed_flag === false && o.added_allergens.length === 0; });
await prop("spreadOne: existing marks are read lower-case, and junk (null, a number, text) is read as no marks / as text", 5000, (R) => ({ d: { id: "x", added_allergens: pick(R, [null, undefined, 5, "NUTS", ["NUTS", "Egg"]]) } }), ({ d }) => {
  const m = A.spreadOne(d, [], []).added_allergens; return Array.isArray(d.added_allergens) ? m.join() === d.added_allergens.map((x) => String(x).toLowerCase()).join() : m.length === 0; });
await prop("spreadOne is pure — it never changes the dish it is given", 10000, (R, i) => ({ d: dishOf(R, i), ...changeOf(R) }), ({ d, added, removed }) => { const before = JSON.stringify(d); A.spreadOne(d, added, removed); return JSON.stringify(d) === before; });

// ── the grouping ────────────────────────────────────────────────────────────────────────────────────
await prop("groupSpread: every dish with an id is in exactly ONE group", 20000, (R) => ({ ds: Array.from({ length: int(R, 0, 40) }, (_, i) => dishOf(R, i)), ...changeOf(R) }), ({ ds, added, removed }) => {
  const ids = A.groupSpread(ds, added, removed).flatMap((g) => g.ids); return ids.length === ds.length && new Set(ids).size === ids.length; });
await prop("groupSpread: every dish in a group ends with exactly that group's marks", 20000, (R) => ({ ds: Array.from({ length: int(R, 0, 40) }, (_, i) => dishOf(R, i)), ...changeOf(R) }), ({ ds, added, removed }) => {
  const byId = new Map(ds.map((d) => [d.id, d])); return A.groupSpread(ds, added, removed).every((g) => g.ids.every((id) => JSON.stringify(A.spreadOne(byId.get(id), added, removed)) === JSON.stringify(g.patch))); });
await prop("groupSpread: one group per DISTINCT result — never two groups writing the same marks", 20000, (R) => ({ ds: Array.from({ length: int(R, 0, 40) }, (_, i) => dishOf(R, i)), ...changeOf(R) }), ({ ds, added, removed }) => {
  const g = A.groupSpread(ds, added, removed); return new Set(g.map((x) => JSON.stringify(x.patch))).size === g.length; });
await prop("groupSpread: a list with holes (null, no id, an empty id) skips them and keeps the rest", 5000, (R) => ({ ds: [...Array.from({ length: int(R, 1, 8) }, (_, i) => dishOf(R, i)), null, {}, { id: "" }, undefined] }), ({ ds }) => A.groupSpread(ds, ["nuts"], []).flatMap((g) => g.ids).length === ds.filter((d) => d && d.id).length);
t("groupSpread of nothing (null / an empty list) is no groups", A.groupSpread(null, ["x"], []).length === 0 && A.groupSpread([], ["x"], []).length === 0);

// ── the database side ───────────────────────────────────────────────────────────────────────────────
const orderOf = (R) => { const n = int(R, 0, 30); const ds = Array.from({ length: n }, (_, i) => dishOf(R, i)); const others = Array.from({ length: int(R, 0, 3) }, (_, i) => ({ ...dishOf(R, 100 + i), restaurant_id: "OTHER" }));
  const otherOrder = Array.from({ length: int(R, 0, 3) }, (_, i) => ({ ...dishOf(R, 200 + i), order_id: "o2" })); return { ds, others, otherOrder, ...changeOf(R) }; };
await prop("spreadOrderAllergies leaves every dish of the order exactly as spreadOne says — and touches no other order or restaurant", 3000, orderOf, async ({ ds, others, otherOrder, added, removed }) => {
  world({ order_items: [...ds, ...others, ...otherOrder] }); const before = JSON.stringify([...others, ...otherOrder]);
  await A.spreadOrderAllergies(sb, "R", "o", added, removed);
  const now = new Map(W.FIX.order_items.map((r) => [r.id, r])); const untouched = JSON.stringify([...others, ...otherOrder].map((r) => now.get(r.id)));
  return (!added.length && !removed.length) || (ds.every((d) => { const want = A.spreadOne(d, added, removed); const got = now.get(d.id); return JSON.stringify(got.added_allergens) === JSON.stringify(want.added_allergens) && got.removed_flag === want.removed_flag; }) && untouched === before) || "wrong dish state"; });
await prop("…in exactly one write per distinct result, each scoped to the restaurant", 3000, orderOf, async ({ ds, added, removed }) => {
  world({ order_items: ds }); const n = await A.spreadOrderAllergies(sb, "R", "o", added, removed); const w = W.WRITES.filter((x) => x.table === "order_items");
  const want = !added.length && !removed.length ? 0 : A.groupSpread(ds, added, removed).length;
  return (n === want && w.length === want && w.every((x) => x.filters.some((f) => f[0] === "eq" && f[1] === "restaurant_id" && f[2] === "R") && x.filters.some((f) => f[0] === "in" && f[1] === "id"))) || `${n} writes, wanted ${want}`; });
await prop("every read is scoped to the order AND the restaurant, ordered, and no bigger than one page", 2000, orderOf, async ({ ds, added, removed }) => {
  world({ order_items: ds }); await A.spreadOrderAllergies(sb, "R", "o", added.length || removed.length ? added : ["nuts"], removed);
  return W.READS.every((r) => r.table === "order_items" && r.filters.some((f) => f[1] === "order_id" && f[2] === "o") && r.filters.some((f) => f[1] === "restaurant_id" && f[2] === "R")); });
t("PAGE is 500 dishes", A.PAGE === 500);
for (const n of [0, 1, 499, 500, 501, 1000, 1234]) {
  world({ order_items: Array.from({ length: n }, (_, i) => ({ id: `d${String(i).padStart(5, "0")}`, order_id: "o", restaurant_id: "R", added_allergens: [] })) });
  const writes = await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []);
  const reads = W.READS.length, want = Math.floor(n / 500) + 1;
  t(`paging: an order of ${n} dishes is read in ${want} page(s) and EVERY dish is marked (a single .limit(500) would have missed ${Math.max(0, n - 500)})`, reads === want && W.FIX.order_items.every((d) => d.added_allergens.includes("nuts")) && writes === (n ? 1 : 0), `${reads} reads, ${W.FIX.order_items.filter((d) => d.added_allergens.includes("nuts")).length}/${n} marked`);
}
world({ order_items: Array.from({ length: 700 }, (_, i) => ({ id: `d${i}`, order_id: "o", restaurant_id: "R", added_allergens: [] })) }); W.FAIL_NTH["order_items:select"] = { at: 2, mode: { code: "57014", message: "statement timeout" } };
{ let e = null; try { await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []); } catch (x) { e = x; }
  t("a failed SECOND page throws (code kept) and writes NOTHING — no dish is half-marked from half a read", e && e.code === "57014" && W.WRITES.length === 0); }
world({ order_items: [{ id: "a", order_id: "o", restaurant_id: "R" }] }); W.FAIL["order_items:select"] = "nodata";
t("a read that answers with no data and no error is read as no dishes (no write, no throw)", (await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], [])) === 0 && W.WRITES.length === 0);

// ── a failed write, and the retry (item 24) ─────────────────────────────────────────────────────────
const twoGroups = () => [{ id: "a", order_id: "o", restaurant_id: "R", added_allergens: [] }, { id: "b", order_id: "o", restaurant_id: "R", added_allergens: ["egg"] }, { id: "c", order_id: "o", restaurant_id: "R", added_allergens: [] }];
for (const at of [1, 2]) {
  world({ order_items: twoGroups() }); W.FAIL_NTH["order_items:update"] = { at, mode: { code: "40001", message: "could not serialize access" } };
  let e = null; try { await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []); } catch (x) { e = x; }
  t(`write ${at} of 2 fails → it throws with the code kept, so the route answers "busy" and never "saved"`, e && e.code === "40001");
  W.FAIL_NTH = {}; await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []);
  t(`…and the RETRY (same change, because the order's line was not saved yet) marks every dish — the end state equals a clean run (write ${at} failed)`, W.FIX.order_items.every((d) => d.added_allergens.includes("nuts")) && W.FIX.order_items.find((d) => d.id === "b").added_allergens.includes("egg"));
}
await prop("ANY failed write, then a retry, ends with every dish's marks exactly as one clean run leaves them", 2000, (R) => ({ ...orderOf(R), at: int(R, 1, 4) }), async ({ ds, added, removed, at }) => {
  if (!added.length && !removed.length) return true;
  world({ order_items: ds }); await A.spreadOrderAllergies(sb, "R", "o", added, removed); const clean = new Map(W.FIX.order_items.map((r) => [r.id, r.added_allergens.join()]));
  world({ order_items: ds }); W.FAIL_NTH["order_items:update"] = { at, mode: { code: "08006", message: "connection failure" } };
  try { await A.spreadOrderAllergies(sb, "R", "o", added, removed); } catch { /* the route answers busy; the person taps save again */ }
  W.FAIL_NTH = {}; await A.spreadOrderAllergies(sb, "R", "o", added, removed);
  return W.FIX.order_items.every((r) => clean.get(r.id) === r.added_allergens.join()) || "marks differ after a retry"; });
{ const routes = [["app/api/editor/[...path]/route.ts", "the manager route"], ["app/api/tablet/[...path]/route.ts", "the waiter-tablet route"]];
  for (const [f, who] of routes) {
    const s = src(f); const at = s.indexOf("await spreadOrderAllergies(sb, rid, b, addedOW, removedOW);"); const reason = s.lastIndexOf("Say why the allergy is changing", at);
    const lineSave = s.indexOf('must(await sb.from("orders").update({ allergies, edited_at: nowIso() })', reason);
    t(`${who}: the reason is demanded FIRST, then the dishes are marked, then the order's line is saved (item 24 — a retry can finish the job)`, at > 0 && reason > 0 && reason < at && lineSave > at && lineSave - at < 400, `${reason} < ${at} < ${lineSave}`);
  } }
