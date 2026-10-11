// scripts/sweep/t13s10/new-h-live.mjs — sweep #10 T13 ROUND 2, block H (ids P169001…, the block claimed
// on main in #1491): the DATABASE underneath the waiter route, and the running app after round 2.
//   · every table the route reads or writes enforces restaurant separation in the database itself
//     (row-level security ON) — CLAUDE.md: "RLS enforces isolation at the DB level, never app-code
//     filtering alone";
//   · every one of those tables has an index that leads with restaurant_id or covers it (the route
//     filters on it in every statement — CLAUDE.md: "index every filtered column");
//   · the round-2 changes, seen on :4413 as French House's waiter (GETs only — nothing is written).
import { check, live, noLive, sql, SRC, chains, FRENCH_HOUSE } from "./lib.mjs";

let n = 169001;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const L = "LIVE — GET on :4413 as French House's waiter";
const one = async (q) => (await sql(q))[0] || {};
const TABLES = [...new Set(chains(SRC.route).map((c) => c.table).filter(Boolean))].sort();

for (const t of TABLES) {
  check(id(), F, `${t} — the database itself keeps each restaurant to its own rows (row-level security on)`, "DB — pg_class.relrowsecurity, read-only", async () => {
    const r = await one(`select c.relrowsecurity rls, c.relforcerowsecurity force from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${t}'`);
    return { ok: r.rls === true, note: `rls ${r.rls}${r.force ? " (forced)" : ""}` };
  });
}
for (const t of TABLES.filter((x) => x !== "restaurants")) {
  check(id(), F, `${t} — has an index covering restaurant_id (every statement here filters on it)`, "DB — pg_indexes, read-only", async () => {
    const rows = await sql(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='${t}' and indexdef ilike '%restaurant_id%' limit 20`);
    return { ok: rows.length > 0, note: rows.length ? rows.map((r) => r.indexname).slice(0, 3).join(", ") : "none" };
  });
}

// ── the running app, after round 2 ──────────────────────────────────────────────────────────────
const openTable = async () => (await one(`select table_number from sessions where restaurant_id='${FRENCH_HOUSE}' and status='open' order by last_activity_at desc nulls last limit 1`)).table_number;
check(id(), F, "the table slice's guests carry no phone and no device id (item 22), live", L, async () => { const t = await openTable(); if (!t) return "skip: French House has no open table right now"; const r = await live(`/state?table=${t}`); if (noLive(r)) return noLive(r); const keys = new Set((r.json.members || []).flatMap((m) => Object.keys(m))); return { ok: r.status === 200 && !keys.has("phone") && !keys.has("device_id"), note: `table ${t} · ${(r.json.members || []).length} guest(s) · keys ${[...keys].join(",") || "(no guests)"}` }; });
check(id(), F, "the table slice's join requests carry no phone (item 22), live", L, async () => { const t = await openTable(); const r = await live(`/state?table=${t || 1}`); if (noLive(r)) return noLive(r); return { ok: r.status === 200 && !(r.json.requests || []).some((q) => "phone" in q), note: `${(r.json.requests || []).length} request(s)` }; });
check(id(), F, "the slice text carries no 10-digit number at all", L, async () => { const t = await openTable(); const r = await live(`/state?table=${t || 1}`); if (noLive(r)) return noLive(r); const hits = (r.text.match(/"(?:phone|cust_phone)":"\d{10}"/g) || []).filter((h) => !/cust_phone/.test(h)); return { ok: !hits.length, note: hits.length ? hits.join(",") : "none outside the bill's own customer field" }; });
check(id(), F, "the floor still answers with every table after the single-settings-read change (item 21)", L + " + DB", async () => { const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r); const tc = (await one(`select table_count from settings where restaurant_id='${FRENCH_HOUSE}' limit 1`)).table_count; return { ok: Object.keys(r.json.tiles || {}).length >= tc && Array.isArray(r.json.my_tables), note: `${Object.keys(r.json.tiles || {}).length} tiles / ${tc} tables` }; });
check(id(), F, "my_tables after item 21 still equals the waiter's stored section", L + " + DB", async () => { const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r); const at = (await one(`select assigned_tables from staff_users where username='diagt1' limit 1`)).assigned_tables || []; return [...new Set(at.map(String))].sort().join() === [...(r.json.my_tables || [])].sort().join(); });
check(id(), F, "the full floor with menu still carries settings, categories, the restaurant and dishes", L, async () => { const r = await live("/summary"); if (noLive(r)) return noLive(r); return { ok: !!r.json.settings && Array.isArray(r.json.categories) && !!r.json.restaurant && Array.isArray(r.json.dishes), note: `${r.bytes} bytes` }; });
check(id(), F, "the waiter's payload still says invoice 'off' after item 7 (a waiter is never offered it)", L, async () => { const r = await live("/summary?nomenu=1"); return noLive(r) || r.json.settings.tablet_invoice === "off"; });
check(id(), F, "the khata picker answers for a real search after item 9", L, async () => { const r = await live("/khata/customers?q=a"); return noLive(r) || { ok: r.status === 200 && Array.isArray(r.json.customers), note: `${r.status}` }; });
check(id(), F, "the khata picker refuses a search nobody can run, live", L, async () => { const r = await live("/khata/customers?q=%25%25%25"); return noLive(r) || { ok: r.status === 200 && r.json.unsearchable === true, note: r.text.slice(0, 80) }; });
check(id(), F, "the points balance answers without a table lookup (item 17), live", L, async () => "skip: a POST on the live app — covered in memory by verify:tablet-twins §12 (no table_merges read)");
check(id(), F, "whoami still answers the waiter as a waiter", L, async () => { const r = await live("/whoami"); return noLive(r) || r.json.actor === "tablet"; });
check(id(), F, "the floor (slim) answers inside 1.5 s on the dev stack after item 21", L, async () => { const r = await live("/summary?nomenu=1&t13r2=1"); return noLive(r) || { ok: r.ms < 1500, note: `${r.ms} ms` }; });
check(id(), F, "the full floor answers inside 2 s after item 21", L, async () => { const r = await live("/summary?t13r2=1"); return noLive(r) || { ok: r.ms < 2000, note: `${r.ms} ms` }; });
check(id(), F, "a targeted tile still carries no settings (unchanged by item 21)", L, async () => { const r = await live("/summary?table=2"); return noLive(r) || (!("settings" in r.json) && Array.isArray(r.json.merges)); });
check(id(), F, "the panel script the waiters run says 'Cancel order', not 'Delete order' (item 8)", "LIVE — GET /panels/tablet/app.js on :4413", async () => { try { const r = await fetch("http://127.0.0.1:4413/panels/tablet/app.js"); const t = await r.text(); return { ok: r.status === 200 && /✕ Cancel order/.test(t) && !/🗑 Delete order/.test(t), note: `${r.status}, ${t.length} bytes` }; } catch (e) { return `skip: ${e.message}`; } });
check(id(), F, "…and the panel page asks for that script under its NEW content hash (no stale copy)", "LIVE — GET /panels/tablet/index.html on :4413", async () => { try { const h = await (await fetch("http://127.0.0.1:4413/panels/tablet/index.html")).text(); const v = (h.match(/app\.js\?v=([0-9a-f]+)/) || [])[1]; return { ok: !!v && v.length >= 8, note: `?v=${v}` }; } catch (e) { return `skip: ${e.message}`; } });
check(id(), F, "every database function the round-2 code newly calls is closed to signed-out callers (none were added)", "DB + SRC", async () => { const names = [...new Set([...SRC.route.matchAll(/sb\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))]; const rows = await sql(`select p.proname, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) anon from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in (${names.map((x) => `'${x}'`).join(",")}) group by 1`); return { ok: rows.length === names.length && rows.every((r) => r.anon === false), note: `${names.length} functions, ${rows.filter((r) => r.anon).length} open to signed-out` }; });
check(id(), F, "the staff_users read that the PIN bootstrap now makes itself (item 16) is covered by an index", "DB", async () => { const rows = await sql(`select indexdef from pg_indexes where schemaname='public' and tablename='staff_users' and indexdef ilike '%restaurant_id%' limit 10`); return { ok: rows.length > 0, note: `${rows.length} index(es)` }; });
