// Round 3 (owner, 2026-10-09: "do all") — items 15–18 and 21, checked from the files (no database).
import { suite } from "./lib.mjs";
import { W, world } from "./sb.mjs";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("round 3 (items 15–18, 21)", 168941, 50);
const src = (p) => readFileSync(join(root, p), "utf8");
const ED = src("app/api/editor/[...path]/route.ts"), TB = src("app/api/tablet/[...path]/route.ts");
// ── item 16: one write per distinct result, errors surfaced, one shared copy ──
const A = await import("@/lib/orderAllergies.ts");
const sb = (await import("./sb.mjs")).supabaseAdmin;
t("item 16: spreadOne adds a new allergy to a dish's marks (lower-cased)", JSON.stringify(A.spreadOne({ id: "a", added_allergens: ["Nuts"] }, ["dairy"], [])) === '{"added_allergens":["nuts","dairy"],"removed_flag":false}');
t("item 16: removing an allergy the dish carried takes it off; removing one it did NOT carry raises removed_flag", (() => { const a = A.spreadOne({ id: "a", added_allergens: ["nuts"] }, [], ["nuts"]); const b = A.spreadOne({ id: "b", added_allergens: [] }, [], ["gluten"]); return a.added_allergens.length === 0 && a.removed_flag === false && b.removed_flag === true; })());
t("item 16: a dish already flagged stays flagged; junk marks are read as text", A.spreadOne({ id: "a", removed_flag: true, added_allergens: "x" }, [], []).removed_flag === true);
t("item 16: dishes that end with the same marks are grouped into ONE write", (() => { const g = A.groupSpread([{ id: "1" }, { id: "2" }, { id: "3", added_allergens: ["egg"] }], ["nuts"], []); return g.length === 2 && g.find((x) => x.ids.length === 2) && g.find((x) => x.ids[0] === "3"); })());
t("item 16: a null dish or one without an id is skipped", A.groupSpread([null, { added_allergens: [] }, { id: "1" }], ["x"], []).reduce((a, g) => a + g.ids.length, 0) === 1);
world({ order_items: [{ id: "1", order_id: "o", restaurant_id: "R", added_allergens: [] }, { id: "2", order_id: "o", restaurant_id: "R", added_allergens: [] }, { id: "3", order_id: "o", restaurant_id: "R", added_allergens: ["egg"] }, { id: "4", order_id: "o", restaurant_id: "OTHER", added_allergens: [] }] });
{ const n = await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []);
  t("item 16: a ticket of three dishes is written in TWO updates (it used to be three), scoped to the restaurant", n === 2 && W.WRITES.filter((w) => w.table === "order_items").length === 2 && W.WRITES.every((w) => w.filters.some((f) => f[1] === "restaurant_id" && f[2] === "R")));
  t("item 16: every dish of THIS restaurant got the mark; another restaurant's dish on the same order id did not", W.FIX.order_items.filter((r) => r.restaurant_id === "R").every((r) => r.added_allergens.includes("nuts")) && W.FIX.order_items.find((r) => r.id === "4").added_allergens.length === 0); }
world({ order_items: [] });
t("item 16: nothing added or removed → no read and no write", (await A.spreadOrderAllergies(sb, "R", "o", [], [])) === 0 && W.READS.length === 0 && W.WRITES.length === 0);
world({ order_items: [{ id: "1", order_id: "o", restaurant_id: "R" }] }); W.FAIL["order_items:update"] = { code: "23514", message: "violates check constraint" };
{ let threw = null; try { await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []); } catch (e) { threw = e; }
  t("item 16: a failed dish write now THROWS with its code kept (it used to be ignored and the screen said 'saved')", threw && threw.code === "23514"); }
world({ order_items: [] }); W.FAIL["order_items:select"] = { code: "57014", message: "timeout" };
{ let threw = null; try { await A.spreadOrderAllergies(sb, "R", "o", ["nuts"], []); } catch (e) { threw = e; } t("item 16: a failed read of the dishes throws too (the route answers busy, not 'saved')", threw && threw.code === "57014"); }
t("item 16: BOTH routes call the one shared helper", /await spreadOrderAllergies\(sb, rid, b, addedOW, removedOW\);/.test(ED) && /await spreadOrderAllergies\(sb, rid, b, addedOW, removedOW\);/.test(TB));
t("item 16: neither route still updates order_items one dish at a time in that handler", ![ED, TB].some((s) => /for \(const it of items\) \{\s*\n\s*const mark = new Set/.test(s)));
// ── item 17: the live floor names its columns ──
t("item 17: the manager's live order list names its columns (no select(\"*\") on orders left in the editor route)", !/from\("orders"\)\.select\([^)]*"\*"/.test(ED) && /select\(billsMode \? BILLS_COLS : FLOOR_COLS\)/.test(ED));
{ const cols = ((ED.match(/const FLOOR_COLS: string = "([^"]+)"/) || [])[1] || "").split(",");
  t("item 17: FLOOR_COLS keeps everything the board needs (id, items, money, status, payment, session, KOT, tax split)", ["id", "items", "subtotal", "tax", "total", "discount", "status", "payment_status", "session_id", "kot_no", "table_number", "archived", "tax_rate", "taxable_base", "nontax_amount", "mrp_amount", "deleted_at", "khata_at"].every((c) => cols.includes(c)), cols.length + " columns");
  t("item 17: …and drops the seven the panel never reads", ["edited_at", "khata_customer_id", "deleted_by", "deleted_by_id", "delete_reason", "disc_gross", "net_amount"].every((c) => !cols.includes(c)));
  const panel = ["public/panels/editor/app.js", "public/panels/billdoc.js", "public/panels/realtime.js"].map(src).join("\n");
  t("item 17: none of the dropped columns is read anywhere in the manager panel's code", ["edited_at", "khata_customer_id", "deleted_by_id", "delete_reason", "disc_gross", "net_amount"].every((c) => !new RegExp("\\b" + c + "\\b").test(panel))); }
// ── item 18: a restaurant's tax rate is a rate ──
{ const mig = existsSync(join(root, "supabase/migrations/415_a_restaurant_tax_rate_must_be_a_rate.sql")) ? src("supabase/migrations/415_a_restaurant_tax_rate_must_be_a_rate.sql") : "";
  t("item 18: migration 415 adds settings_tax_rate_is_a_rate, the same 0..0.5 range as orders", /ADD CONSTRAINT settings_tax_rate_is_a_rate\s*\n\s*CHECK \(tax_rate IS NULL OR \(tax_rate >= 0 AND tax_rate <= 0\.5\)\)/.test(mig));
  t("item 18: …idempotently (IF NOT EXISTS) and without rewriting any data", /IF NOT EXISTS/.test(mig) && !/\bUPDATE\b|\bDELETE\b/i.test(mig.replace(/--.*$/gm, ""))); }
t("item 18: the admin route clamps a typed rate to the same 0..0.5 (it allowed up to 1, then every order was refused)", /v >= 0 && v <= 0\.5 \? v : null/.test(src("app/api/admin/restaurants/settings/route.ts")));
{ const D = await import("@/lib/dbRefusal.ts");
  t("item 18: a refused tax rate reads as a sentence that says how to write it ('5% is 0.05')", /5% is 0\.05/.test(D.refusalMessage({ code: "23514", message: 'new row for relation "settings" violates check constraint "settings_tax_rate_is_a_rate"' })));
  t("item 18: every constraint lib/dbRefusal names in plain words is really defined by a migration", (() => { const keys = [...src("lib/dbRefusal.ts").matchAll(/^\s{2}(\w+_\w+): "/gm)].map((m) => m[1]).filter((k) => !/^LFH/.test(k)); const all = readdirSync(join(root, "supabase/migrations")).map((f) => src(`supabase/migrations/${f}`)).join("\n"); return keys.length >= 3 && keys.every((k) => all.includes(k)); })()); }
// ── item 15: an owner route never keeps only .data from a read it did not check ──
{ const files = []; (function w(d) { for (const e of readdirSync(join(root, d))) { const p = join(d, e); if (statSync(join(root, p)).isDirectory()) w(p); else if (e === "route.ts") files.push(p); } })("app/api/owner");
  const offenders = [];
  for (const f of files) { const lines = src(f).split("\n"); lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    if (/\(await sb\.(from|rpc)\([^;]*\)\)\.data/.test(l) || (/\(await sb\.(from|rpc)\(/.test(l) && /\)\)\.data/.test(lines.slice(i, i + 3).join(" ")))) offenders.push(`${f}:${i + 1}`);
    const m = l.match(/const (\w+) = await sb\.(from|rpc)\(/); if (m && !new RegExp(`\\b${m[1]}\\.error\\b`).test(lines.slice(i, i + 60).join("\n"))) offenders.push(`${f}:${i + 1}`);
  }); }
  t(`item 15: across all ${files.length} owner routes, no read keeps only .data without looking at .error (a failed read is never 'empty' or 'not found')`, files.length >= 10 && !offenders.length, offenders.join(", ")); }
for (const [f, re, what] of [["app/api/owner/settings/route.ts", /if \(rowQ\.error\) return dbFail\("owner\/settings password"/, "the owner's own password change answers busy, not 'Account not found'"],
  ["app/api/owner/staff/route.ts", /if \(existingQ\.error\) return bad\(BUSY_MESSAGE, 503\);/, "cancelling a pay entry answers busy, not 'doesn't exist'"],
  ["app/api/owner/staff/route.ts", /if \(dupQ\.error\) return bad\(BUSY_MESSAGE, 503\);/, "adding a person answers busy, not 'the name is free'"],
  ["app/api/owner/staff/route.ts", /if \(clashQ\.error\) return bad\(BUSY_MESSAGE, 503\);/, "renaming a person answers busy, not 'the name is free'"],
  ["app/api/owner/reports/route.ts", /if \(namesQ\.error\) return dbFail\("owner\/reports inventory names"/, "the group inventory report fails honestly instead of nameless rows"],
  ["app/api/owner/printing/route.ts", /onQ!\.error \? scoped/, "printing status skips the filter on a failed read instead of raising a false 'tickets are waiting' alarm"]]) {
  t(`item 15: ${what}`, re.test(src(f)));
}
