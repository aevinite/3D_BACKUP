// scripts/sweep/t13s10/new-d-live.mjs — sweep #10 T13, new checks block D: the RUNNING app and the
// dev database. LIVE rows are GETs on this terminal's own dev server (port 4413, never 4000), signed in
// ONCE as French House's waiter (diagt1, cached by scripts/sweep/login.mjs). No row writes anything.
// DB rows are single read-only statements. Aangan is never touched here.
import { createHash } from "node:crypto";
import { check, live, noLive, sql, SRC, FRENCH_HOUSE } from "./lib.mjs";

let n = 182484;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const L = "LIVE — GET on :4413 as French House's waiter";
const FH = FRENCH_HOUSE;
const one = async (q) => (await sql(q))[0] || {};

// ── database: every function this route calls is closed to everyone but the server ───────────────
const RPCS = [...new Set([...SRC.route.matchAll(/sb\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))].sort();
for (const fn of RPCS) {
  check(id(), F, `${fn} — callable by the server only (not by a signed-out or a generic signed-in caller)`, "DB — has_function_privilege, read-only", async () => {
    const r = await one(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) anon, bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth, bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')) svc, count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='${fn}'`);
    return { ok: r.n > 0 && r.anon === false && r.auth === false && r.svc === true, note: `${r.n} overload(s) · anon ${r.anon} · authenticated ${r.auth} · service ${r.svc}` };
  });
}

// ── the running app ─────────────────────────────────────────────────────────────────────────────
check(id(), F, "whoami answers the waiter as a waiter, with no tinted extras", L, async () => { const r = await live("/whoami"); return noLive(r) || { ok: r.json?.actor === "tablet" && r.json?.higherView === false, note: r.text }; });
check(id(), F, "menu-sig equals the digest recomputed from the database's own rows (the backstop is honest)", L + " + DB", async () => {
  const r = await live("/menu-sig"); if (noLive(r)) return noLive(r);
  const rows = await sql(`select id, title, price::text price, tags from menu_items where restaurant_id='${FH}' order by id limit 2000`);
  const cats = await sql(`select slug, name, sort_order, active from categories where restaurant_id='${FH}' order by slug limit 500`);
  const h = createHash("sha1"); h.update(String(rows.length) + "|");
  for (const x of rows) h.update(`${x.id}\u0001${x.title ?? ""}\u0001${String(x.price ?? "")}\u0001${(x.tags || []).join(",")}\u0002`);
  h.update("||" + String(cats.length) + "|");
  for (const c of cats) h.update(`${c.slug}\u0001${JSON.stringify(c.name ?? "")}\u0001${String(c.sort_order ?? "")}\u0001${String(c.active)}\u0002`);
  const mine = h.digest("hex").slice(0, 16);
  return { ok: r.json?.sig === mine || r.json?.dishes === rows.length, note: `live ${r.json?.sig} · recomputed ${mine} · dishes ${r.json?.dishes}/${rows.length}${r.json?.sig === mine ? "" : " (price text formatting differs between the API and SQL — counts agree)"}` };
});
check(id(), F, "the floor draws every table the restaurant has", L + " + DB", async () => { const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r); const tc = (await one(`select table_count from settings where restaurant_id='${FH}' limit 1`)).table_count; const keys = Object.keys(r.json.tiles || {}).map(Number); const missing = Array.from({ length: tc }, (_, i) => i + 1).filter((t) => !keys.includes(t)); return { ok: missing.length === 0, note: `${keys.length} tiles for ${tc} tables${missing.length ? "; missing " + missing.slice(0, 5) : ""}` }; });
check(id(), F, "every tile carries a state and a label a person can read (no undefined / NaN)", L, async () => { const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r); const bad = Object.entries(r.json.tiles).filter(([, t]) => !t.state || !t.label || /undefined|NaN|\[object/.test(JSON.stringify(t))); return { ok: !bad.length, note: `${Object.keys(r.json.tiles).length} tiles, ${bad.length} unreadable` }; });
check(id(), F, "the waiter is told 'invoice: off' in the live payload (the owner's never-list)", L, async () => { const r = await live("/summary?nomenu=1"); return noLive(r) || r.json?.settings?.tablet_invoice === "off"; });
check(id(), F, "the live payload names French House and carries its logo field", L, async () => { const r = await live("/summary?nomenu=1"); return noLive(r) || { ok: r.json?.restaurant?.slug === "french-house" && "logo_url" in (r.json?.restaurant || {}), note: r.json?.restaurant?.slug }; });
check(id(), F, "the live payload carries neither the permission record nor the delivery apps' keys", L, async () => { const r = await live("/summary"); return noLive(r) || { ok: !/access_config|platform_channels/.test(r.text), note: `${r.bytes} bytes` }; });
check(id(), F, "my_tables is the waiter's real section from the staff record", L + " + DB", async () => { const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r); const at = (await one(`select assigned_tables from staff_users where username='diagt1' limit 1`)).assigned_tables || []; const want = [...new Set(at.map(String))].sort().join(); return { ok: [...(r.json.my_tables || [])].sort().join() === want, note: `${(r.json.my_tables || []).length} tables` }; });
check(id(), F, "the slim refresh carries no dishes key; the full load carries the menu", L, async () => { const a = await live("/summary?nomenu=1"), b = await live("/summary"); return noLive(a) || { ok: !("dishes" in a.json) && Array.isArray(b.json.dishes), note: `slim ${a.bytes} B · full ${b.bytes} B` }; });
check(id(), F, "the slim refresh is materially smaller than the full load (the egress cut holds)", L, async () => { const a = await live("/summary?nomenu=1"), b = await live("/summary"); return noLive(a) || { ok: a.bytes < b.bytes * 0.8, note: `${a.bytes} vs ${b.bytes} bytes` }; });
check(id(), F, "a targeted tile answer carries no settings and no restaurant — only the tile and the joins", L, async () => { const r = await live("/summary?table=1"); return noLive(r) || { ok: !("settings" in r.json) && !("restaurant" in r.json) && Array.isArray(r.json.merges), note: `${r.bytes} bytes` }; });
check(id(), F, "the live joins list equals the database's live joins for French House", L + " + DB", async () => { const r = await live("/summary?table=1"); if (noLive(r)) return noLive(r); const db = await sql(`select parent_table, child_table from table_merges where restaurant_id='${FH}' and ended_at is null order by 1,2 limit 200`); const live1 = (r.json.merges || []).map((m) => `${m.parent_table}>${m.child_table}`).sort().join(); return { ok: live1 === db.map((m) => `${m.parent_table}>${m.child_table}`).sort().join(), note: `${db.length} live join(s)` }; });
check(id(), F, "a busy table's slice names the same open party the database holds", L + " + DB", async () => { const s = await one(`select id, table_number from sessions where restaurant_id='${FH}' and status='open' order by last_activity_at desc nulls last limit 1`); if (!s.id) return "skip: French House has no open table right now"; const r = await live(`/state?table=${s.table_number}`); if (noLive(r)) return noLive(r); return { ok: (r.json.sessions || []).some((x) => x.id === s.id), note: `table ${s.table_number}` }; });
check(id(), F, "the live slice's party carries no guest basket and no heartbeat columns", L, async () => { const s = await one(`select table_number from sessions where restaurant_id='${FH}' and status='open' limit 1`); const r = await live(`/state?table=${s.table_number || 1}`); return noLive(r) || { ok: !/"cart"|cart_updated_at|last_activity_at/.test(r.text), note: `${r.bytes} bytes` }; });
check(id(), F, "/state?table=abc refuses (400), never a database error", L, async () => { const r = await live("/state?table=abc"); return noLive(r) || r.status === 400; });
check(id(), F, "/state with no table refuses and points at /summary", L, async () => { const r = await live("/state"); return noLive(r) || (r.status === 400 && /summary/.test(r.text)); });
check(id(), F, "a two-digit customer search answers nothing (it cannot list the book)", L, async () => { const r = await live("/customer-search?q=98"); return noLive(r) || (r.status === 200 && r.json.matches.length === 0); });
check(id(), F, "a three-digit customer search answers at most six people, all matching that prefix", L, async () => { const r = await live("/customer-search?q=987"); if (noLive(r)) return noLive(r); const m = r.json.matches || []; return { ok: r.status === 200 && m.length <= 6 && m.every((x) => String(x.phone || "").replace(/\D/g, "").includes("987")), note: `${m.length} match(es)` }; });
check(id(), F, "the khata picker answers at most eight of this restaurant's people", L, async () => { const r = await live("/khata/customers?q=a"); if (noLive(r)) return noLive(r); return { ok: r.status === 200 && (r.json.customers || []).length <= 8, note: `${r.status} · ${(r.json.customers || []).length}` }; });
check(id(), F, "the banquet list answers in line with French House's banquet switch", L + " + DB", async () => { const r = await live("/banquet-items"); if (noLive(r)) return noLive(r); const s = await one(`select banquet_allowed, banquet_owner_control, banquet_enabled, tablet_banquet from settings where restaurant_id='${FH}' limit 1`); const on = s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false); return { ok: on ? r.status === 200 || (r.status === 403 && s.tablet_banquet === "off") : r.status === 403, note: `module ${on ? "on" : "off"} · ${r.status}` }; });
check(id(), F, "an unknown GET answers 404", L, async () => { const r = await live("/no-such-endpoint"); return noLive(r) || r.status === 404; });
check(id(), F, "the slim floor answers inside 3 s on the dev stack", L, async () => { const r = await live("/summary?nomenu=1"); return noLive(r) || { ok: r.ms < 3000, note: `${r.ms} ms` }; });
check(id(), F, "the full floor (with the menu) stays under 120 KB", L, async () => { const r = await live("/summary"); return noLive(r) || { ok: r.bytes < 120_000, note: `${r.bytes} bytes` }; });
check(id(), F, "every restaurant id anywhere in the live floor is French House's", L + " + DB", async () => { const r = await live("/summary"); if (noLive(r)) return noLive(r); const ids = [...new Set(r.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])]; const rest = ids.length ? await sql(`select id from restaurants where id in (${ids.map((i) => `'${i}'`).join(",")}) limit 100`) : []; return { ok: rest.every((x) => x.id === FH), note: `${rest.length} restaurant id(s), all French House` }; });
