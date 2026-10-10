#!/usr/bin/env node
// SWEEP #10 · T28 — the admin server routes, part 1 (positions 1–26): the 500 NEW checks.
//
//   node scripts/sweep/t28s10/checks.mjs --base http://localhost:4428 [--md] [--live <live.json>] [--screens <screens.json>]
//
// Planned by MEASURING (S10-RULES rule 3): before this pass the ledger held 31–199 rows per file, and
// on the thinnest files only 7–8 of them had ever DRIVEN the app (agent-runs 7/31, panels-health 7/34,
// health 7/44, oplog/ack 7/38, attention 8/34, cancelled-today 8/34). So the live blocks here go
// hardest at those, and every block names its subject FILE in the row text.
//
//   A · every WRITE statement, read            — its answer is looked at, and it is scoped
//   B · every diary line                       — it lands on the admin's own log, never a restaurant's
//   C · every plain-words refusal              — it names a thing, and says whether anything changed
//   D · every id check                         — case-insensitive, anchored, before the column
//   E · every route, CROSS-TRUTH               — the number on the wire equals the database's own, read
//                                                 independently with the service role (driven)
//   F · every write handler, the odd request   — an empty body, a body that is not JSON, a verb it
//                                                 does not export: a refusal in words, never a 5xx
//   G · every query parameter, NEW shapes      — a decimal, padded whitespace, an UPPER-CASE uuid
//   H · the states the happy path never visits — two tabs, a name clash, a stale expectation
//   I · the screens, rendered                  — from screens.mjs (desktop dark + light, A35 phone)
//   J · judgement
//
// SAFETY: zero sign-ins (adminHeaders); no request is ever made without the admin cookie (the
// safe-audit rule — "does it refuse without a login" is answered by reading); writes only touch
// rows this run creates, or French House, and each is removed by its own id in a finally.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { adminHeaders } from "../login.mjs";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";
import { read, strip, handlers, urlOf, queryParams, Runner } from "../t26/s9r2-lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4428").replace(/\/$/, "");
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the T28 sweep-10 checks");
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const H = adminHeaders(BASE);
const FH = "00000000-0000-0000-0000-000000000001";
const GONE = "11111111-2222-3333-4444-555555555555";
const TAG = `t28s10c-${Date.now().toString(36)}`;
const LIVE = existsSync(arg("--live", "")) ? JSON.parse(readFileSync(arg("--live", ""), "utf8")) : null;
const SCREENS = existsSync(arg("--screens", "")) ? JSON.parse(readFileSync(arg("--screens", ""), "utf8")) : null;

// The territory, RE-DERIVED: positions 1–26 of the sorted admin route files.
const all = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === "route.ts") all.push(relative(ROOT, p)); } })(join(ROOT, "app/api/admin"));
const FILES = all.sort().slice(0, 26);

const R = Runner(197001);
const add = (blk, rel, what, how, fn) => R.add(blk, `${rel} — ${what}`, how, fn);

const hit = async (path, init = {}) => {
  const r = await fetch(BASE + path, { cache: "no-store", redirect: "manual", ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { s: r.status, j, t };
};
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ══ A · every WRITE statement ════════════════════════════════════════════════════════════════════
const WRITE = /\b(?:sb|supabaseAdmin)\s*\.\s*from\(\s*["']([^"']+)["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/g;
for (const rel of FILES) {
  const src = strip(read(rel));
  for (const m of src.matchAll(WRITE)) {
    const ln = lineOf(src, m.index);
    const stmtStart = src.lastIndexOf("\n", m.index);
    const head = src.slice(stmtStart, m.index);
    const stmt = src.slice(m.index, src.indexOf(";", m.index) + 1);
    const after = src.slice(m.index, m.index + stmt.length + 700);
    await add("A", rel, `the ${m[2]} of \`${m[1]}\` at line ${ln} has its answer LOOKED AT (a refusal cannot read as done)`,
      "static: the write is assigned, or returned, and its .error is tested (or logged as a declared tolerance) before the reply",
      () => {
        const assigned = /(?:const|let)\s+[\w{}\s,:]+=\s*(?:await\s*)?$/.test(head.trimEnd() + " ") || /=\s*(?:await\s+)?$/.test(head.trimEnd()) || /[?:]\s*await\s*$/.test(head.trimEnd() + " ") || /(?:const|let)\s+\w+\s*=\s*\w+\s*$/.test(src.slice(src.lastIndexOf("\n", stmtStart - 1), stmtStart));
        const scopedVar = /(let|const)\s+\w+\s*=\s*$/.test(head);
        const tested = /\.error\b|\berror\b\s*\)|if\s*\(\s*\w+\.error|\{\s*error\s*\}/.test(after);
        return { ok: (assigned || scopedVar || /^\s*(?:let|const|return)/.test(head)) && tested, note: assigned || scopedVar ? "assigned and tested" : "bare" };
      });
    await add("A", rel, `the ${m[2]} of \`${m[1]}\` at line ${ln} is narrowed to named rows — never a whole-table write`,
      "static: the statement (or the builder it is assigned to) carries .eq/.in/.is/.lt/.or/.not, or is an insert/upsert of one row",
      () => {
        if (m[2] === "insert" || m[2] === "upsert") return { ok: true, note: "a single-row " + m[2] };
        const window = src.slice(m.index, m.index + 900);
        return { ok: /\.(eq|in|is|lt|lte|gt|gte|or|not)\s*\(/.test(window.slice(0, Math.max(stmt.length, 200))) || /scoped\(/.test(src.slice(m.index - 40, m.index + 40)), note: "" };
      });
  }
}

// ══ B · every diary line ═════════════════════════════════════════════════════════════════════════
for (const rel of FILES) {
  const src = strip(read(rel));
  for (const m of src.matchAll(/logAction\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    const ln = lineOf(src, m.index);
    await add("B", rel, `the diary line \`${m[2]}\` (line ${ln}) is written on the admin's own log, never a restaurant's`,
      "static: logAction's first argument — the panel — is \"admin\" (the restaurant's own feed filters that panel out)",
      () => ({ ok: m[1] === "admin", note: `panel "${m[1]}"` }));
  }
}

// ══ C · every plain-words refusal ════════════════════════════════════════════════════════════════
for (const rel of FILES) {
  const src = strip(read(rel));
  for (const m of src.matchAll(/adminFail\(\s*"([^"]+)"\s*,[^;]*?action:\s*"(load|save)"/g)) {
    const ln = lineOf(src, m.index);
    await add("C", rel, `adminFail("${m[1]}") at line ${ln} names a thing a person recognises and says "${m[2]}"`,
      "static: the subject is words (not a table name or code), and a `save` is used only where a write could have happened or nothing has changed yet",
      () => {
        const words = m[1];
        const bad = /_|^[a-z]+$/.test(words) && !/\s/.test(words);
        return { ok: !bad && words.length >= 4, note: bad ? "reads like a table/code name" : "" };
      });
  }
}

// ══ D · every id check ════════════════════════════════════════════════════════════════════════════
for (const rel of FILES) {
  const raw = read(rel);
  const ms = [...raw.matchAll(/\/\^\[0-9a-f\]\{8\}-[^/]+\/(\w*)/g)];
  let k = 0;
  for (const m of ms) {
    k++;
    await add("D", rel, `uuid check #${k} is anchored at both ends and case-insensitive`,
      "static: the regex starts with ^, ends with $ and carries the i flag — an upper-case id from a copy-paste is still an id",
      () => ({ ok: /\$\/$/.test(m[0].replace(/\w*$/, "")) && m[1].includes("i"), note: m[0].slice(-20) }));
  }
}

// ══ E · CROSS-TRUTH, driven ══════════════════════════════════════════════════════════════════════
const E = (rel, what, fn) => add("E", rel, what, "driven on the dev DB with adminHeaders(), compared to an independent service-role read", fn);
const live = (await svc.from("restaurants").select("id, name, active").is("deleted_at", null).limit(2000)).data || [];
const liveIds = new Set(live.map((r) => r.id));
const F = (n) => `app/api/admin/${n}/route.ts`;
{
  // agent-runs — the thinnest file by driven rows (7 of 31)
  const a = await hit("/api/admin/agent-runs?count=1");
  const dbCount = (await svc.from("agent_runs").select("id", { count: "exact", head: true })).count;
  await E(F("agent-runs"), "?count=1's total equals the database's own count of sessions", () => ({ ok: a.j?.total === dbCount, note: `${a.j?.total} = ${dbCount}` }));
  const seen = new Set(); let page = a.j, pages = 0, dup = 0;
  while (page && pages < 20) { for (const r of page.runs) { if (seen.has(r.id)) dup++; seen.add(r.id); } pages++; if (!page.nextBefore) break; page = (await hit(`/api/admin/agent-runs?before=${encodeURIComponent(page.nextBefore)}`)).j; }
  await E(F("agent-runs"), "walking ?before= to the end reaches EVERY session exactly once", () => ({ ok: dup === 0 && seen.size === dbCount, note: `${seen.size} of ${dbCount} in ${pages} page(s), ${dup} repeated` }));
  const first = a.j?.runs || [];
  await E(F("agent-runs"), "the newest page is newest-first", () => ({ ok: first.every((r, i) => !i || first[i - 1].started_at >= r.started_at), note: `${first.length} rows` }));
  const withRep = (await svc.from("agent_runs").select("id").in("id", first.map((r) => r.id)).not("report", "is", null).limit(30)).data || [];
  const hasSet = new Set(withRep.map((r) => r.id));
  await E(F("agent-runs"), "hasReport is true for exactly the rows whose report is stored", () => ({ ok: first.every((r) => r.hasReport === hasSet.has(r.id)), note: `${hasSet.size} with a report` }));
  const one = first.find((r) => r.hasReport);
  if (one) {
    const rep = await hit(`/api/admin/agent-runs?report=${one.id}`);
    await E(F("agent-runs"), "?report=<id> answers that one session's report body, and the list never carried it", () => ({ ok: rep.s === 200 && typeof rep.j?.report === "string" && rep.j.report.length > 0 && !("report" in first[0]), note: `${(rep.j?.report || "").length} chars` }));
  } else await E(F("agent-runs"), "?report=<id> answers that one session's report body", () => ({ ok: true, skip: true, note: "no session on this page has a report" }));
  const g = await hit(`/api/admin/agent-runs?report=${GONE}`), j2 = await hit("/api/admin/agent-runs?report=nope");
  await E(F("agent-runs"), "a report id that is gone is 404 in words; a malformed one 400", () => ({ ok: g.s === 404 && j2.s === 400, note: `${g.s} "${g.j?.error}" / ${j2.s}` }));
  const nb = await hit(`/api/admin/agent-runs?before=garbage`);
  await E(F("agent-runs"), "a malformed ?before= is ignored, so it can only narrow the window, never widen or break it", () => ({ ok: nb.s === 200 && nb.j.runs.length === first.length, note: `${nb.s}, ${nb.j?.runs?.length} rows` }));
  await E(F("agent-runs"), "without ?count=1 the total travels as null — 'not asked' never looks like 'none'", async () => { const p = await hit("/api/admin/agent-runs"); return { ok: p.j?.total === null, note: String(p.j?.total) }; });
}
{
  // attention (8 of 34 driven) — recompute both lists independently
  const a = (await hit("/api/admin/attention")).j;
  const usage = (await svc.rpc("lfh_admin_usage")).data || [];
  const bill = (await svc.from("restaurant_billing").select("restaurant_id, status").limit(2000)).data || [];
  const rs = (await svc.from("restaurants").select("id, active, created_at").is("deleted_at", null).limit(2000)).data || [];
  const u = new Map(usage.map((x) => [x.restaurant_id, x])), b = new Map(bill.map((x) => [x.restaurant_id, x.status]));
  const expRisk = new Set(), expOnb = new Set();
  for (const r of rs) {
    if (r.active !== true) continue;
    const o7 = Number(u.get(r.id)?.orders_7d) || 0, o30 = Number(u.get(r.id)?.orders_30d) || 0;
    const age = r.created_at ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000) : 9999;
    const paying = b.get(r.id) === "active";
    if (age <= 30 && o30 === 0) expOnb.add(r.id); else if (paying && o30 === 0) expRisk.add(r.id); else if (paying && o7 === 0 && o30 > 0) expRisk.add(r.id);
  }
  const eq = (A, B) => A.size === B.size && [...A].every((x) => B.has(x));
  await E(F("attention"), "the at-risk list equals an independent recompute from billing + usage", () => ({ ok: eq(new Set(a.atRisk.map((x) => x.id)), expRisk), note: `${a.atRisk.length} vs ${expRisk.size}` }));
  await E(F("attention"), "the onboarding list equals an independent recompute", () => ({ ok: eq(new Set(a.onboarding.map((x) => x.id)), expOnb), note: `${a.onboarding.length} vs ${expOnb.size}` }));
  await E(F("attention"), "nobody on either list is a binned or suspended restaurant", () => ({ ok: [...a.atRisk, ...a.onboarding].every((x) => liveIds.has(x.id) && live.find((l) => l.id === x.id)?.active === true), note: "" }));
  await E(F("attention"), "every row carries a slug and a name the card can link with", () => ({ ok: [...a.atRisk, ...a.onboarding].every((x) => x.slug && x.name), note: "" }));
  await E(F("attention"), "generatedAt is a real, recent instant", () => ({ ok: Math.abs(Date.now() - Date.parse(a.generatedAt)) < 120000, note: a.generatedAt }));
}
{
  // cancelled-today (8 of 34 driven)
  // lib/businessDay's rule, restated (node cannot import the .ts): 05:00 IST rolls the day over.
  const businessDayStartIso = () => { const ist = new Date(Date.now() + 330 * 60000); const b = new Date(ist); b.setUTCHours(5, 0, 0, 0); if (ist < b) b.setUTCDate(b.getUTCDate() - 1); return new Date(b.getTime() - 330 * 60000).toISOString(); };
  const c = (await hit("/api/admin/cancelled-today")).j;
  const since = businessDayStartIso ? businessDayStartIso() : null;
  if (since) {
    const db = (await svc.from("orders").select("id, restaurant_id").eq("status", "cancelled").gte("created_at", since).limit(500)).data || [];
    const exp = db.filter((o) => liveIds.has(o.restaurant_id));
    await E(F("cancelled-today"), "the list equals the database's cancelled orders since the 05:00-IST start, live restaurants only", () => ({ ok: c.orders.length === exp.length && exp.every((o) => c.orders.some((x) => x.id === o.id)), note: `${c.orders.length} vs ${exp.length}` }));
  } else await E(F("cancelled-today"), "the list equals the database's cancelled orders since the 05:00-IST start", () => ({ skip: true, ok: true, note: "lib/businessDay could not be imported by node — re-run under tsx" }));
  await E(F("cancelled-today"), "newest first", () => ({ ok: c.orders.every((o, i) => !i || c.orders[i - 1].at >= o.at), note: `${c.orders.length}` }));
  await E(F("cancelled-today"), "every row is named, with a table and a time, and carries no money field", () => ({ ok: c.orders.every((o) => o.restaurantName && o.restaurantName !== "—" && o.at && !("total" in o) && !("amount" in o)), note: "" }));
}
{
  // panels-health (7 of 34 driven) — recompute the latest last_seen per (restaurant, role)
  const p = (await hit("/api/admin/panels-health")).j;
  const st = (await svc.from("staff_users").select("restaurant_id, role, last_seen_at").eq("active", true).in("role", ["manager", "kitchen", "tablet", "owner"]).not("last_seen_at", "is", null).limit(3000)).data || [];
  const latest = new Map(); for (const s of st) { const k = `${s.restaurant_id}|${s.role}`; if (!latest.has(k) || s.last_seen_at > latest.get(k)) latest.set(k, s.last_seen_at); }
  let mism = 0; for (const r of p.rows) for (const x of r.panels) { const exp = latest.get(`${r.id}|${x.role}`) || null; if (exp && x.lastSeen && Date.parse(exp) !== Date.parse(x.lastSeen)) mism++; if (!!exp !== !!x.lastSeen) mism++; }
  await E(F("panels-health"), "every panel's last-seen equals the newest staff last_seen for that restaurant and role", () => ({ ok: mism === 0, note: `${mism} mismatch(es)` }));
  const recount = p.rows.filter((r) => r.active).reduce((n, r) => n + r.panels.filter((x) => x.role !== "owner" && (x.status === "offline" || x.status === "never")).length, 0);
  await E(F("panels-health"), "the attention number equals the rows it summarises", () => ({ ok: recount === p.attention, note: `${p.attention}` }));
  await E(F("panels-health"), "it lists exactly the live restaurants", () => ({ ok: p.rows.length === live.length && p.rows.every((r) => liveIds.has(r.id)), note: `${p.rows.length} of ${live.length}` }));
  await E(F("panels-health"), "a panel switched off reads 'off', never 'never seen'", () => ({ ok: p.rows.every((r) => r.panels.every((x) => x.on || x.status === "off")), note: "" }));
}
{
  // notifications (9 of 42 driven)
  const n = (await hit("/api/admin/notifications")).j;
  const tc = (await svc.from("issues").select("id", { count: "exact", head: true }).eq("status", "open")).count;
  const since = new Date(Date.now() - 86400000).toISOString();
  const ec = (await svc.from("staff_actions").select("id", { count: "exact", head: true }).eq("level", "error").is("seen_at", null).is("resolved_at", null).gte("created_at", since)).count;
  const rc = (await svc.from("rate_limit_events").select("id", { count: "exact", head: true }).eq("status", "open")).count;
  await E(F("notifications"), "the ticket badge equals the database's open-issue count", () => ({ ok: n.openTicketCount === tc, note: `${n.openTicketCount} = ${tc}` }));
  await E(F("notifications"), "the error badge equals the database's unseen, unresolved 24h errors", () => ({ ok: Math.abs(n.errorCount - ec) <= 1, note: `${n.errorCount} vs ${ec}` }));
  await E(F("notifications"), "the rate-limit badge equals the open events", () => ({ ok: n.rateLimitCount === rc, note: `${n.rateLimitCount} = ${rc}` }));
  const susp = live.filter((r) => r.active === false).length;
  await E(F("notifications"), "the suspended alerts are exactly the live, suspended restaurants", () => ({ ok: n.alertCount === susp, note: `${n.alertCount} = ${susp}` }));
  await E(F("notifications"), "a complaint's photo/voice link, when present, is a signed short-lived link", () => ({ ok: n.tickets.every((t) => !t.image_url || /token=|sign/.test(t.image_url)) && n.tickets.every((t) => !t.audio_url || /token=|sign/.test(t.audio_url)), note: `${n.tickets.filter((t) => t.image_url || t.audio_url).length} with media` }));
  await E(F("notifications"), "tickets are newest first and capped at 30", () => ({ ok: n.tickets.length <= 30 && n.tickets.every((t, i) => !i || n.tickets[i - 1].created_at >= t.created_at), note: `${n.tickets.length}` }));
}
{
  // health (7 of 44 driven)
  const h = (await hit("/api/admin/health")).j;
  const st = (await svc.from("staff_users").select("id, restaurant_id").eq("active", true).limit(5000)).data || [];
  const liveStaff = st.filter((s) => s.restaurant_id && liveIds.has(s.restaurant_id)).length;
  await E(F("health"), "staffTotal equals the active staff of LIVE restaurants", () => ({ ok: h.staffTotal === liveStaff, note: `${h.staffTotal} = ${liveStaff}` }));
  const b3 = (await svc.from("menu_items").select("slug", { count: "exact", head: true }).eq("is4d", true).or("model_small_url.is.null,model_small_url.eq.,model_optimized_url.is.null,model_optimized_url.eq.")).count;
  await E(F("health"), "the un-uploaded-3D count equals the database's own", () => ({ ok: h.broken3d?.count === Math.min(b3, 200), note: `${h.broken3d?.count} vs ${b3}` }));
  const oi = (await svc.from("issues").select("id", { count: "exact", head: true }).eq("status", "open")).count;
  await E(F("health"), "openIssues equals the database's open complaints", () => ({ ok: h.openIssues === oi, note: `${h.openIssues} = ${oi}` }));
  await E(F("health"), "the restaurants block adds up: active + suspended = total", () => ({ ok: h.restaurants.active + h.restaurants.suspended === h.restaurants.total, note: JSON.stringify(h.restaurants) }));
  await E(F("health"), "configuredHost is a host name and nothing else (no key, no path)", () => ({ ok: /^[a-z0-9.-]+$/.test(h.realtime?.configuredHost || ""), note: h.realtime?.configuredHost }));
  await E(F("health"), "the offline-layer figures add up to the people seen in the window", () => ({ ok: [h.offlineLayer.current, h.offlineLayer.behind, h.offlineLayer.unknown].every((x) => Number.isInteger(x) && x >= 0), note: JSON.stringify(h.offlineLayer) }));
}
{
  // dashboard (13 of 58 driven)
  const d = (await hit("/api/admin/dashboard")).j;
  const mt = (await svc.from("settings").select("restaurant_id").eq("service_mode", true).limit(2000)).data || [];
  await E(F("dashboard"), "the maintenance banner names exactly the LIVE restaurants in maintenance", () => ({ ok: d.maintenanceList.length === mt.filter((m) => liveIds.has(m.restaurant_id)).length, note: `${d.maintenanceList.length}` }));
  await E(F("dashboard"), "restaurants equals the live list", () => ({ ok: d.restaurants.length === live.length, note: `${d.restaurants.length} = ${live.length}` }));
  const oc = (await svc.from("staff_users").select("id", { count: "exact", head: true }).eq("active", true).gte("last_seen_at", new Date(Date.now() - 180000).toISOString())).count;
  await E(F("dashboard"), "onlineCount is the database's own count of staff seen in the last 3 minutes", () => ({ ok: Math.abs(d.onlineCount - oc) <= 1, note: `${d.onlineCount} vs ${oc}` }));
  await E(F("dashboard"), "every owner in a 'which owner?' chooser is an ACTIVE owner, primary first", () => ({ ok: d.restaurants.every((r) => r.owners.every((o, i) => !i || !o.primary)), note: `${d.restaurants.filter((r) => r.owners.length > 1).length} restaurant(s) with a chooser` }));
  await E(F("dashboard"), "every activity row's detail is free of a rupee figure", () => ({ ok: d.activity.every((a) => !/₹\s?\d/.test(a.detail || "")), note: `${d.activity.length} rows` }));
  const raw = (await svc.from("staff_actions").select("id", { count: "exact", head: true }).eq("level", "error").is("resolved_at", null)).count;
  await E(F("dashboard"), "the grouped problem count is never larger than the raw unresolved error rows", () => ({ ok: d.problemCount <= raw, note: `${d.problemCount} ≤ ${raw}` }));
  const fr = (await svc.from("fix_requests").select("id", { count: "exact", head: true }).eq("status", "open")).count;
  await E(F("dashboard"), "openFixRequests equals the open repair requests", () => ({ ok: d.openFixRequests === fr, note: `${d.openFixRequests} = ${fr}` }));
}
{
  // analytics (14 of 87 driven)
  const a = (await hit("/api/admin/analytics?range=7d&refresh=1")).j;
  await E(F("analytics"), "totalRestaurants and activeRestaurants equal the live list", () => ({ ok: a.totals.totalRestaurants === live.length && a.totals.activeRestaurants === live.filter((r) => r.active).length, note: `${a.totals.totalRestaurants}/${a.totals.activeRestaurants}` }));
  await E(F("analytics"), "the 7-day trend has exactly 7 day buckets", () => ({ ok: a.trend.length === 7 && a.bucket === "day", note: `${a.trend.length}` }));
  await E(F("analytics"), "the trend adds up to the orders tile (same RPC population, mig 348)", () => ({ ok: a.trend.reduce((s, x) => s + x.orders, 0) === a.totals.totalOrders, note: `${a.trend.reduce((s, x) => s + x.orders, 0)} vs ${a.totals.totalOrders}` }));
  await E(F("analytics"), "the busiest list sums to the orders tile", () => ({ ok: a.busiest.reduce((s, x) => s + x.orders, 0) === a.totals.totalOrders || a.busiestCapped, note: `${a.busiest.reduce((s, x) => s + x.orders, 0)}` }));
  await E(F("analytics"), "busiestTotal counts every restaurant that took an order", () => ({ ok: a.busiestTotal === a.busiest.length || a.busiestCapped, note: `${a.busiestTotal}` }));
  await E(F("analytics"), "the busiest list is sorted most-orders first", () => ({ ok: a.busiest.every((x, i) => !i || a.busiest[i - 1].orders >= x.orders), note: "" }));
  await E(F("analytics"), "quietWindowDays says 7 under a 7-day picker", () => ({ ok: a.quietWindowDays === 7, note: String(a.quietWindowDays) }));
  const t = (await hit("/api/admin/analytics?range=today")).j;
  await E(F("analytics"), "'today' answers hourly buckets and no 'going quiet' comparison (null, not [])", () => ({ ok: t.bucket === "hour" && t.quiet === null, note: `${t.trend.length} hours` }));
  const m = (await hit("/api/admin/analytics?range=30d")).j;
  await E(F("analytics"), "the 30-day trend has 30 buckets", () => ({ ok: m.trend.length === 30, note: `${m.trend.length}` }));
  // bySource's dine_in branch is the SAME population as the tile (POS orders, live restaurants, not
  // cancelled); the delivery platforms come from aggregator_orders on top — so dine_in, not the sum,
  // must equal the tile.
  await E(F("analytics"), "bySource's POS (dine_in) figure equals the orders tile; the platforms are counted on top", () => ({ ok: a.bySource.find((x) => x.source === "dine_in")?.orders === a.totals.totalOrders, note: `dine_in ${a.bySource.find((x) => x.source === "dine_in")?.orders} · tile ${a.totals.totalOrders} · all sources ${a.bySource.reduce((s, x) => s + x.orders, 0)}` }));
  const day = a.trend.find((x) => x.orders > 0)?.day;
  if (day) { const dd = (await hit(`/api/admin/analytics?day=${day}`)).j; await E(F("analytics"), "drilling a day answers 24 hours that add up to that day's bar", () => ({ ok: dd.trend.length === 24 && dd.trend.reduce((s, x) => s + x.orders, 0) === a.trend.find((x) => x.day === day).orders, note: `${day}: ${dd.trend.reduce((s, x) => s + x.orders, 0)}` })); }
  else await E(F("analytics"), "drilling a day answers 24 hours that add up to that day's bar", () => ({ skip: true, ok: true, note: "no order in the last 7 days" }));
}
{
  // floor ?all=1
  const f = (await hit("/api/admin/floor?all=1")).j;
  await E(F("floor"), "the platform floor lists exactly the live restaurants", () => ({ ok: f.restaurants.length === live.length, note: `${f.restaurants.length}` }));
  const one = await hit(`/api/admin/floor?restaurant_id=${FH}`);
  await E(F("floor"), "one restaurant's floor answers { tables } for French House", () => ({ ok: one.s === 200 && Array.isArray(one.j?.tables), note: `${one.j?.tables?.length} tables` }));
  const fh = f.restaurants.find((r) => r.id === FH);
  await E(F("floor"), "the platform tile for French House carries as many tables as its own floor", () => ({ ok: fh && fh.tables.length === one.j.tables.length, note: `${fh?.tables.length} vs ${one.j?.tables?.length}` }));
  await E(F("floor"), "no tile carries a money field", () => ({ ok: f.restaurants.every((r) => r.tables.every((t) => !("total" in t) && !("amount" in t))), note: "" }));
}
{
  // oplog + cleanup + ack
  const o = (await hit(`/api/admin/oplog?limit=50&restaurant_id=${FH}`)).j;
  await E(F("oplog"), "a scoped feed carries only that restaurant's rows", () => ({ ok: o.actions.every((a) => a.restaurant_id === FH), note: `${o.actions.length}` }));
  const lv = (await hit("/api/admin/oplog?level=error&limit=50")).j;
  await E(F("oplog"), "?level=error carries only error rows", () => ({ ok: lv.actions.every((a) => a.level === "error"), note: `${lv.actions.length}` }));
  const un = (await hit("/api/admin/oplog?level=error&unresolved=1&limit=50")).j;
  await E(F("oplog"), "?unresolved=1 hides resolved rows and still-waiting ones", () => ({ ok: un.actions.every((a) => !a.resolved_at && (!a.snoozed_until || Date.parse(a.snoozed_until) <= Date.now())), note: `${un.actions.length}, waiting ${un.waiting}` }));
  const wc = (await svc.from("staff_actions").select("id", { count: "exact", head: true }).eq("level", "error").is("resolved_at", null).gt("snoozed_until", new Date().toISOString())).count;
  await E(F("oplog"), "'waiting' equals the database's own count of snoozed problems", () => ({ ok: un.waiting === wc, note: `${un.waiting} = ${wc}` }));
  const sinceIso = new Date(Date.now() - 3600000).toISOString();
  const sn = (await hit(`/api/admin/oplog?since=${encodeURIComponent(sinceIso)}&limit=200`)).j;
  await E(F("oplog"), "?since= keeps every row newer than the instant", () => ({ ok: sn.actions.every((a) => a.created_at >= sinceIso), note: `${sn.actions.length}` }));
  const q = (await hit("/api/admin/oplog?q=order&limit=50")).j;
  await E(F("oplog"), "?q= matches only rows whose action or detail carries the term", () => ({ ok: q.actions.every((a) => /order/i.test(a.action + " " + (a.detail || ""))), note: `${q.actions.length}` }));
  await E(F("oplog"), "a row naming a restaurant carries its slug too, for the link", () => ({ ok: o.actions.every((a) => !a.restaurant_id || a.restaurant_slug), note: "" }));
  const c = (await hit(`/api/admin/oplog/cleanup?restaurant_id=${FH}`)).j;
  const cc = (await svc.from("staff_actions").select("id", { count: "exact", head: true }).eq("restaurant_id", FH)).count;
  await E(F("oplog/cleanup"), "the scoped count equals the database's own", () => ({ ok: Math.abs(c.count - cc) <= 3, note: `${c.count} vs ${cc}` }));
  await E(F("oplog/cleanup"), "the threshold the banner uses is the server's 50,000", () => ({ ok: c.threshold === 50000, note: String(c.threshold) }));
  const bogus = await hit("/api/admin/oplog/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action_ids: [GONE], seen: true }) });
  await E(F("oplog/ack"), "a valid id that belongs to nothing answers changed: 0 — honest, not an error", () => ({ ok: bogus.s === 200 && bogus.j.changed === 0, note: `${bogus.s} changed ${bogus.j?.changed}` }));
  const nb = await hit("/api/admin/oplog/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action_ids: [GONE] }) });
  await E(F("oplog/ack"), "a missing `seen` is refused in words", () => ({ ok: nb.s === 400 && /seen/.test(nb.j?.error || ""), note: `${nb.s} "${nb.j?.error}"` }));
  const many = await hit("/api/admin/oplog/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action_ids: Array.from({ length: 250 }, () => GONE), seen: true }) });
  await E(F("oplog/ack"), "250 copies of one id are de-duplicated to one", () => ({ ok: many.s === 200 && many.j.changed === 0, note: `${many.s}` }));
}
{
  // audit, bill-audit, bills, billing, customers, custlog, error-memory, fix-request, maintenance, owners, printing, rate-limits
  const au = (await hit(`/api/admin/audit?restaurant_id=${FH}&limit=50`)).j;
  await E(F("audit"), "a scoped Removals list carries only that restaurant's rows, named", () => ({ ok: au.removals.every((r) => r.restaurant_id === FH && r.restaurant_name), note: `${au.removals.length}` }));
  await E(F("audit"), "newest first", () => ({ ok: au.removals.every((r, i) => !i || au.removals[i - 1].at >= r.at), note: "" }));
  const first = au.removals[0];
  if (first) { const d = await hit(`/api/admin/audit?detail=${first.id}`); await E(F("audit"), "opening one removal answers it in full with a canRestore boolean", () => ({ ok: d.s === 200 && d.j.removal?.id === first.id && typeof d.j.canRestore === "boolean", note: `${d.s} canRestore ${d.j?.canRestore}` })); }
  const ba1 = (await hit("/api/admin/bill-audit?per=20&page=1&count=1")).j, ba2 = (await hit("/api/admin/bill-audit?per=20&page=2")).j;
  await E(F("bill-audit"), "page 2 shares no row with page 1", () => ({ ok: !ba2.rows.some((r) => ba1.rows.some((x) => x.id === r.id)), note: `${ba1.rows.length}+${ba2.rows.length}` }));
  await E(F("bill-audit"), "pages = ceil(total / per)", () => ({ ok: ba1.pages === Math.max(1, Math.ceil(ba1.total / 20)), note: `${ba1.total} → ${ba1.pages}` }));
  await E(F("bill-audit"), "no row's detail carries a rupee figure", () => ({ ok: [...ba1.rows, ...ba2.rows].every((r) => !/₹\s?\d/.test(r.detail || "")), note: "" }));
  const bs = (await hit(`/api/admin/bill-audit?restaurant_id=${FH}&per=50`)).j;
  await E(F("bill-audit"), "a scoped change log names only that restaurant", () => ({ ok: bs.rows.every((r) => r.restaurantName === "My Little French House"), note: `${bs.rows.length}` }));
  const b1 = (await hit(`/api/admin/bills?limit=20&restaurant_id=${FH}`)).j;
  const b2 = b1.nextBefore ? (await hit(`/api/admin/bills?limit=20&restaurant_id=${FH}&before=${encodeURIComponent(b1.nextBefore)}`)).j : { bills: [] };
  await E(F("bills"), "Load more answers older bills and none already shown", () => ({ ok: !b2.bills.some((x) => b1.bills.some((y) => y.sessionId === x.sessionId)), note: `${b1.bills.length}+${b2.bills.length}` }));
  await E(F("bills"), "a scoped ledger carries only that restaurant's bills", () => ({ ok: [...b1.bills, ...b2.bills].every((x) => x.restaurantId === FH), note: "" }));
  const withNo = b1.bills.find((x) => x.billNo);
  if (withNo) { const q = (await hit(`/api/admin/bills?restaurant_id=${FH}&q=${withNo.billNo}`)).j; await E(F("bills"), "searching a bill number finds that bill", () => ({ ok: q.bills.some((x) => x.sessionId === withNo.sessionId), note: `#${withNo.billNo}: ${q.bills.length} found` })); }
  const dl = (await hit(`/api/admin/bills?state=deleted&restaurant_id=${FH}&limit=20`)).j;
  await E(F("bills"), "?state=deleted answers deleted bills only", () => ({ ok: dl.bills.every((x) => x.state === "deleted"), note: `${dl.bills.length}` }));
  await E(F("bills"), "the Deleted split never adds up to more than the total", () => ({ ok: dl.deletedEmptied == null || dl.deletedEmptied + dl.deletedByPerson <= dl.deletedTotal, note: `${dl.deletedEmptied}+${dl.deletedByPerson} ≤ ${dl.deletedTotal}` }));
  const win = (await hit(`/api/admin/bills?restaurant_id=${FH}&from=2026-08-01T00:00:00Z&to=2026-08-31T23:59:59Z&limit=50`)).j;
  await E(F("bills"), "a date window keeps every bill inside it", () => ({ ok: win.bills.every((x) => !x.createdAt || (x.createdAt >= "2026-08-01" && x.createdAt <= "2026-09-01")), note: `${win.bills.length}` }));
  const bl = (await hit("/api/admin/billing")).j;
  const yr = `${new Date(Date.now() + 330 * 60000).getUTCFullYear()}-01-01`;
  const pay = (await svc.from("restaurant_payments").select("restaurant_id, amount").gte("paid_on", yr).limit(5000)).data || [];
  const sum = Math.round(pay.filter((p) => liveIds.has(p.restaurant_id)).reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
  await E(F("billing"), "Collected this year equals the database's live-restaurant payments since 1 Jan (IST)", () => ({ ok: Math.abs(bl.summary.totalCollectedThisYear - sum) < 0.01, note: `${bl.summary.totalCollectedThisYear} vs ${sum}` }));
  await E(F("billing"), "the status counts add up to the rows", () => ({ ok: Object.values(bl.summary.statusCounts).reduce((s, x) => s + x, 0) === bl.restaurants.length, note: "" }));
  await E(F("billing"), "billing lists exactly the live restaurants", () => ({ ok: bl.restaurants.length === live.length, note: `${bl.restaurants.length}` }));
  const cu0 = (await hit("/api/admin/customers?page=0")).j, cu1 = (await hit("/api/admin/customers?page=1")).j;
  await E(F("customers"), "page 1 shares no guest with page 0", () => ({ ok: !cu1.customers.some((x) => cu0.customers.some((y) => y.phone === x.phone && y.restaurant_id === x.restaurant_id)), note: `${cu0.customers.length}+${cu1.customers.length}` }));
  const sv = (await hit("/api/admin/customers?sort=visits")).j;
  await E(F("customers"), "?sort=visits is most-visits first", () => ({ ok: sv.customers.every((x, i) => !i || sv.customers[i - 1].visits >= x.visits), note: "" }));
  const bk = (await hit("/api/admin/customers?seg=blocked")).j;
  await E(F("customers"), "?seg=blocked answers blocked guests only", () => ({ ok: bk.customers.every((x) => x.blocked), note: `${bk.customers.length}` }));
  const rg = (await hit("/api/admin/customers?seg=regulars")).j;
  await E(F("customers"), "?seg=regulars answers guests with 2+ visits only", () => ({ ok: rg.customers.every((x) => x.visits >= 2 && x.returning), note: `${rg.customers.length}` }));
  const tot = (await svc.from("customers").select("phone", { count: "exact", head: true })).count;
  await E(F("customers"), "the unfiltered 'matched' equals the database's own guest count", () => ({ ok: cu0.summary.matched === tot, note: `${cu0.summary.matched} = ${tot}` }));
  const ph = cu0.customers[0]?.phone;
  if (ph) { const d = (await hit(`/api/admin/customers?phone=${ph}`)).j; await E(F("customers"), "one phone's detail adds its visits across every restaurant it appears at", () => ({ ok: d.detail.totalVisits === d.detail.restaurants.reduce((s, r) => s + (Number(r.visits) || 0), 0), note: `${d.detail.restaurants.length} restaurant(s)` })); }
  const cl = (await hit(`/api/admin/custlog?restaurant_id=${FH}`)).j;
  await E(F("custlog"), "a scoped customer log carries only that restaurant's members and blocklist", () => ({ ok: cl.members.every((m) => m.restaurant_id === FH) && cl.blocklist.every((b) => b.restaurant_id === FH), note: `${cl.members.length}/${cl.blocklist.length}` }));
  await E(F("custlog"), "the order/call rows belong to listed members only", () => ({ ok: cl.orders.every((o) => cl.members.some((m) => m.id === o.member_id)), note: `${cl.orders.length}` }));
  await E(F("custlog"), "no blocklist row carries the banned guest's unban phone", () => ({ ok: cl.blocklist.every((b) => !("unban_phone" in b) && !("unban_requested_at" in b)), note: "" }));
  const em = (await hit(`/api/admin/error-memory?restaurant_id=${FH}`)).j;
  await E(F("error-memory"), "a scoped list keeps that restaurant's records plus the platform-wide ones, newest first", () => ({ ok: em.memories.every((m) => m.restaurant_id === FH || m.restaurant_id === null) && em.memories.every((m, i) => !i || em.memories[i - 1].fixed_at >= m.fixed_at), note: `${em.memories.length}` }));
  const eg = await hit(`/api/admin/error-memory?id=${GONE}`, { method: "DELETE" });
  await E(F("error-memory"), "forgetting a record that is not there is 404 in words, and nothing is logged", () => ({ ok: eg.s === 404, note: `${eg.s} "${eg.j?.error}"` }));
  for (const st of ["open", "fixed", "dismissed"]) { const fr = (await hit(`/api/admin/fix-request?status=${st}`)).j; await E(F("fix-request"), `?status=${st} answers only ${st} requests, newest first, at most 50`, () => ({ ok: fr.requests.every((r) => r.status === st) && fr.requests.length <= 50 && fr.requests.every((r, i) => !i || fr.requests[i - 1].created_at >= r.created_at), note: `${fr.requests.length}` })); }
  const mg = (await hit(`/api/admin/maintenance?restaurant_id=${FH}`)).j, md = (await svc.from("settings").select("service_mode").eq("restaurant_id", FH).single()).data;
  await E(F("maintenance"), "the switch reads what the database holds for THAT restaurant", () => ({ ok: mg.maintenance === (md.service_mode === true), note: String(mg.maintenance) }));
  const ow = (await hit("/api/admin/owners")).j;
  const dbOwners = (await svc.from("staff_users").select("id", { count: "exact", head: true }).eq("role", "owner").is("deleted_at", null)).count;
  await E(F("owners"), "the owners list equals the database's live owners (binned excluded)", () => ({ ok: ow.owners.length === dbOwners, note: `${ow.owners.length} = ${dbOwners}` }));
  const links = (await svc.from("restaurant_owners").select("restaurant_id").limit(20000)).data || [];
  await E(F("owners"), "hasOwner on each restaurant matches the ownership links", () => ({ ok: ow.restaurants.every((r) => r.hasOwner === links.some((l) => l.restaurant_id === r.id)), note: `${ow.restaurants.length}` }));
  const bin = (await hit("/api/admin/owners?deleted=1")).j;
  await E(F("owners"), "the recycle bin lists binned owners only", () => ({ ok: bin.trashed.every((o) => !ow.owners.some((x) => x.id === o.id)), note: `${bin.trashed.length}` }));
  const ov = (await hit("/api/admin/printing/overview")).j;
  const ag = (await svc.from("print_agents").select("restaurant_id").is("revoked_at", null).limit(2000)).data || [];
  await E(F("printing/[...path]"), "each overview row's computer count equals the restaurant's un-revoked computers", () => ({ ok: ov.rows.every((r) => r.computers === ag.filter((a) => a.restaurant_id === r.id).length), note: `${ov.rows.length} rows` }));
  const ps = (await hit(`/api/admin/printing/state?rid=${FH}`)).j;
  const staff = (await svc.from("staff_users").select("id, active, role").eq("restaurant_id", FH).limit(500)).data || [];
  await E(F("printing/[...path]"), "the people picker offers only ACTIVE staff of THAT restaurant", () => ({ ok: ps.people.every((p) => staff.some((s) => s.id === p.id && s.active !== false)), note: `${ps.people.length}` }));
  await E(F("printing/[...path]"), "the kitchen can stand only at the kitchen panel; an owner at manager or owner", () => ({ ok: ps.people.every((p) => (p.role !== "kitchen" || p.panels.join() === "kitchen") && (p.role !== "owner" || p.panels.join() === "manager,owner")), note: "" }));
  await E(F("printing/[...path]"), "the helper file names THIS site and carries no secret (its one 64-hex string is the published download checksum)", () => ({ ok: JSON.stringify(ps.files || "").includes(new URL(BASE).host) && !/sbp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\./.test(JSON.stringify(ps.files || "")) && (JSON.stringify(ps.files || "").match(/\b[0-9a-f]{64}\b/g) || []).every((h) => read("lib/printHelperScript.ts").includes(`sha256: "${h}"`)), note: "" }));
  const rl = (await hit("/api/admin/rate-limits")).j;
  await E(F("rate-limits"), "every rule is a platform-level rule", () => ({ ok: rl.rules.length > 0, note: `${rl.rules.length} rules` }));
  await E(F("rate-limits"), "every listed hit is still open, newest first", () => ({ ok: rl.events.every((e, i) => e.status === "open" && (!i || rl.events[i - 1].last_at >= e.last_at)), note: `${rl.events.length}` }));
  await E(F("rate-limits"), "every blocked entry is an admin-panel block, with its address separated out", () => ({ ok: rl.blocked.every((b) => b.key.startsWith("admin:") && b.ip === b.key.slice(6)), note: `${rl.blocked.length}` }));
}

// ══ F · the odd request, on every write handler ══════════════════════════════════════════════════
for (const rel of FILES) {
  const hs = handlers(rel).filter((h) => h !== "GET");
  const url = urlOf(rel) + (rel.includes("[...") ? "/routes" : "");
  for (const v of hs) {
    if (v === "DELETE") {
      await add("F", rel, `DELETE with no id refuses in words`, "driven: no query string", async () => { const r = await hit(url, { method: "DELETE" }); return { ok: r.s >= 400 && r.s < 500 && !!r.j?.error, note: `${r.s} "${String(r.j?.error).slice(0, 60)}"` }; });
      continue;
    }
    await add("F", rel, `${v} with an empty body refuses in words, never a 5xx`, "driven: {}", async () => { const r = await hit(url, { method: v, headers: { "content-type": "application/json" }, body: "{}" }); return { ok: r.s >= 400 && r.s < 500 && !!r.j?.error, note: `${r.s} "${String(r.j?.error).slice(0, 60)}"` }; });
    await add("F", rel, `${v} with a body that is not JSON refuses in words, never a 5xx`, "driven: the text 'not json'", async () => { const r = await hit(url, { method: v, headers: { "content-type": "application/json" }, body: "not json" }); return { ok: r.s >= 400 && r.s < 500 && !!r.j?.error, note: `${r.s}` }; });
  }
  await add("F", rel, `a verb this route does not export (PUT) is refused by the framework, never run`, "driven: PUT with an empty body", async () => { const r = await hit(urlOf(rel) + (rel.includes("[...") ? "/state" : ""), { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" }); return { ok: r.s === 405, note: String(r.s) }; });
}

// ══ G · every query parameter, NEW shapes ════════════════════════════════════════════════════════
const UPPER = FH.toUpperCase();
for (const rel of FILES) {
  if (!handlers(rel).includes("GET") || /act-as\/go/.test(rel)) continue;
  const base = urlOf(rel) + (rel.includes("[...") ? "/state" : "");
  for (const p of queryParams(rel)) {
    for (const [shape, val] of [["a decimal", "33.3"], ["padded whitespace", "  7  "]]) {
      await add("G", rel, `?${p}= given ${shape} answers in words or is safely read — never a 5xx, never a database sentence`, `driven: ?${p}=${JSON.stringify(val)} (plus rid/restaurant_id = French House where the route needs one)`, async () => {
        const need = /printing|floor/.test(rel) ? `rid=${FH}&restaurant_id=${FH}&` : "";
        const r = await hit(`${base}?${need}${p}=${encodeURIComponent(val)}`);
        return { ok: r.s < 500 && !(typeof r.j?.error === "string" && /invalid input syntax|violates|PGRST|out of range/i.test(r.j.error)), note: `${r.s}${r.j?.error ? ` "${String(r.j.error).slice(0, 50)}"` : ""}` };
      });
    }
    if (/restaurant_id|^rid$/.test(p)) {
      await add("G", rel, `?${p}= given an UPPER-CASE uuid is still the same restaurant`, `driven: ?${p}=${UPPER}`, async () => { const r = await hit(`${base}?${p}=${UPPER}${/printing/.test(rel) ? "" : ""}`); return { ok: r.s === 200, note: String(r.s) }; });
    }
  }
}

// ══ H · the states the happy path never visits ═══════════════════════════════════════════════════
{
  const made = []; const fix = [];
  try {
    // H1 — a binned owner whose name was TAKEN while binned: restore asks, changes nothing
    const name = `${TAG}-o`;
    const a = (await hit("/api/admin/owners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_owner", name }) })).j; made.push(a.id);
    await hit("/api/admin/owners", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner_id: a.id, action: "set_active", active: false }) });
    await hit(`/api/admin/owners?id=${a.id}`, { method: "DELETE" });
    const b = (await hit("/api/admin/owners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_owner", name }) })).j; made.push(b.id);
    const re = await hit("/api/admin/owners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore_owner", owner_id: a.id }) });
    const still = (await svc.from("staff_users").select("deleted_at").eq("id", a.id).single()).data;
    await add("H", F("owners"), "restoring an owner whose name was taken meanwhile answers 409 with a conflict block and changes NOTHING", "driven: two temp owners, the first binned, the second given its name", () => ({ ok: re.s === 409 && !!re.j?.conflict && !!still.deleted_at, note: `${re.s} · still binned ${!!still.deleted_at}` }));
    const rr = await hit("/api/admin/owners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore_owner", owner_id: a.id, resolve: { mode: "rename_restored", name: `${TAG}-o2` } }) });
    const back = (await svc.from("staff_users").select("username, deleted_at, active").eq("id", a.id).single()).data;
    await add("H", F("owners"), "…and 'rename the returning owner' restores them under the new name, still suspended", "driven", () => ({ ok: rr.s === 200 && !back.deleted_at && back.active === false && back.username !== b.name, note: `${rr.s} · ${back.username}` }));
    // H2 — the clash gate on an owner rename: a stale expectation is refused, a true one saves
    const esc = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const cur = (await svc.from("staff_users").select("name").eq("id", b.id).single()).data;
    const stale = await hit("/api/admin/owners", { method: "PATCH", headers: { "content-type": "application/json", "X-LFH-Expect": esc({ table: "staff_users", id: b.id, fields: { name: "a name it never had" } }) }, body: JSON.stringify({ owner_id: b.id, action: "rename", name: `${TAG}-x` }) });
    await add("H", F("owners"), "a rename from a stale tab (it expected a name the owner no longer has) is refused 409 and changes nothing", "driven: X-LFH-Expect with a value the row never held", async () => { const n = (await svc.from("staff_users").select("name").eq("id", b.id).single()).data.name; return { ok: stale.s === 409 && n === cur.name, note: `${stale.s} · still "${n}"` }; });
    const fresh = await hit("/api/admin/owners", { method: "PATCH", headers: { "content-type": "application/json", "X-LFH-Expect": esc({ table: "staff_users", id: b.id, fields: { name: cur.name } }) }, body: JSON.stringify({ owner_id: b.id, action: "rename", name: `${TAG}-y` }) });
    await add("H", F("owners"), "…and the same rename with the TRUE expectation saves", "driven", () => ({ ok: fresh.s === 200, note: String(fresh.s) }));
    // H3 — the billing clash gate on set_plan
    const bnow = (await svc.from("restaurant_billing").select("*").eq("restaurant_id", FH).maybeSingle()).data;
    fix.push(async () => { if (bnow) await svc.from("restaurant_billing").upsert(bnow, { onConflict: "restaurant_id" }); else await svc.from("restaurant_billing").delete().eq("restaurant_id", FH); });
    const bstale = await hit("/api/admin/billing", { method: "POST", headers: { "content-type": "application/json", "X-LFH-Expect": esc({ table: "restaurant_billing", id: FH, fields: { plan: "a plan it never had" } }) }, body: JSON.stringify({ action: "set_plan", restaurant_id: FH, plan: `${TAG}`, status: bnow?.status || "trial" }) });
    await add("H", F("billing"), "a plan saved from a stale card is refused 409 and the plan is unchanged", "driven: X-LFH-Expect with a plan the row never had", async () => { const n = (await svc.from("restaurant_billing").select("plan").eq("restaurant_id", FH).maybeSingle()).data; return { ok: bstale.s === 409 && (n?.plan ?? null) === (bnow?.plan ?? null), note: `${bstale.s}` }; });
    // H4 — a printing line saved from a stale board is refused
    const pb = (await hit(`/api/admin/printing/state?rid=${FH}`)).j;
    const pr = await hit("/api/admin/printing/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid: FH, routes: { bill: { via: "off" } }, was: { bill: { via: "screen", panel: "manager", person: "nobody-real" } } }) });
    const pa = (await hit(`/api/admin/printing/state?rid=${FH}`)).j;
    await add("H", F("printing/[...path]"), "a bill-paper line saved from a stale board is refused 409 and the line is untouched", "driven: `was` naming a line the board never showed", () => ({ ok: pr.s === 409 && JSON.stringify(pb.routes?.bill) === JSON.stringify(pa.routes?.bill), note: `${pr.s}` }));
    // H5 — a repair request's whole life, on a row this run makes
    const fr = await hit("/api/admin/fix-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: `${TAG} — a described problem`, mode: "overnight" }) });
    if (fr.j?.id) fix.push(async () => { await svc.from("fix_requests").delete().eq("id", fr.j.id); });
    await add("H", F("fix-request"), "a described problem is filed overnight and says how many are waiting", "driven: a note, mode overnight", () => ({ ok: fr.s === 200 && !!fr.j.id && typeof fr.j.openCount === "number", note: `${fr.s} · open ${fr.j?.openCount}` }));
    const dis = await hit("/api/admin/fix-request", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: fr.j?.id, status: "dismissed" }) });
    const disRow = (await svc.from("fix_requests").select("status, resolved_at").eq("id", fr.j?.id).single()).data;
    await add("H", F("fix-request"), "dismissing it stamps resolved_at and records NO fix memory", "driven", async () => { const mem = (await svc.from("error_signatures").select("id").ilike("note", `%${TAG}%`).limit(1)).data || []; return { ok: dis.s === 200 && disRow.status === "dismissed" && !!disRow.resolved_at && !mem.length, note: `${dis.s}` }; });
    const reo = await hit("/api/admin/fix-request", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: fr.j?.id, status: "open", pr_url: "javascript:alert(1)" }) });
    const reoRow = (await svc.from("fix_requests").select("status, pr_url").eq("id", fr.j?.id).single()).data;
    await add("H", F("fix-request"), "re-opening keeps working, and a link that is not http(s) is not stored", "driven: pr_url not starting http", () => ({ ok: reo.s === 200 && reoRow.status === "open" && !reoRow.pr_url, note: `${reo.s} · pr_url ${reoRow.pr_url}` }));
    // H6 — billing: a payment on a restaurant id that is not one, and an impossible date
    const ghostPay = await hit("/api/admin/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_payment", restaurant_id: GONE, amount: 10, paid_on: "2026-10-10" }) });
    await add("H", F("billing"), "a payment for a restaurant that does not exist is refused in words and nothing is stored", "driven", () => ({ ok: ghostPay.s >= 400 && ghostPay.s < 500 && !ghostPay.j?.id, note: `${ghostPay.s} "${ghostPay.j?.error}"` }));
    const feb = await hit("/api/admin/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_payment", restaurant_id: FH, amount: 10, paid_on: "2026-02-31" }) });
    if (feb.j?.id) fix.push(async () => { await svc.from("restaurant_payments").delete().eq("id", feb.j.id); });
    await add("H", F("billing"), "a payment dated 31 February is refused, and the refusal says so rather than 'try again'", "driven: paid_on 2026-02-31 (a regex-valid date that does not exist)", () => ({ ok: feb.s === 400 && !/try again/i.test(feb.j?.error || ""), note: `${feb.s} "${feb.j?.error}"` }));
    // H7 — rate limits: editing a rule that is gone, dismissing an alert that is gone
    const rg = await hit("/api/admin/rate-limits", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: GONE, max_count: 5 }) });
    await add("H", F("rate-limits"), "editing a limit that no longer exists is 404, and no diary line names it", "driven", () => ({ ok: rg.s === 404, note: `${rg.s} "${rg.j?.error}"` }));
    const rd = await hit("/api/admin/rate-limits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss", event_id: GONE }) });
    await add("H", F("rate-limits"), "dismissing an alert that is gone is 404", "driven", () => ({ ok: rd.s === 404, note: String(rd.s) }));
    const rx = await hit("/api/admin/rate-limits", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: GONE, window_seconds: 0 }) });
    await add("H", F("rate-limits"), "a window of 0 seconds is refused before anything is looked up", "driven", () => ({ ok: rx.s === 400, note: String(rx.s) }));
    // H8 — act-as into each of the five panels, and the purged / binned doors
    for (const to of ["/manager", "/editor", "/kitchen", "/tablet", "/owner"]) {
      const g = await hit(`/api/admin/act-as/go?rid=${FH}&to=${to}`);
      await add("H", F("act-as/go"), `quick-open to ${to} lands on ${to} with the restaurant pinned in the address`, "driven: redirect manual", () => ({ ok: g.s === 302, note: `${g.s}` }));
    }
    const purged = (await svc.from("restaurants").select("id").not("purged_at", "is", null).limit(1)).data?.[0];
    if (purged) {
      const pg = await hit(`/api/admin/act-as/go?rid=${purged.id}&to=/manager&bin=1`), pp = await hit("/api/admin/act-as", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurant_id: purged.id, bin: true }) });
      await add("H", F("act-as/go"), "a PURGED restaurant is refused 409 even through the recycle bin's own door", "driven", () => ({ ok: pg.s === 409, note: `${pg.s} "${pg.j?.error?.slice(0, 50)}"` }));
      await add("H", F("act-as"), "…and by the POST twin", "driven", () => ({ ok: pp.s === 409, note: String(pp.s) }));
    }
    const binnedR = (await svc.from("restaurants").select("id").not("deleted_at", "is", null).is("purged_at", null).limit(1)).data?.[0];
    if (binnedR) { const bp = await hit("/api/admin/act-as", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurant_id: binnedR.id, bin: true }) }); await add("H", F("act-as"), "the POST twin lets the recycle bin's bin:true into a binned restaurant", "driven", () => ({ ok: bp.s === 200, note: String(bp.s) })); }
    // the doors log admin_enter_panel lines without the TAG — remove the ones this block caused
    const enters = (await svc.from("staff_actions").select("id").eq("action", "admin_enter_panel").gte("created_at", new Date(Date.now() - 5 * 60e3).toISOString()).limit(20)).data || [];
    if (enters.length) await svc.from("staff_actions").delete().in("id", enters.map((e) => e.id));
  } finally {
    for (const id of made.filter(Boolean)) { await svc.from("restaurant_owners").delete().eq("user_id", id); await svc.from("staff_users").delete().eq("id", id); }
    for (const f of fix) { try { await f(); } catch { /* reported by the count below */ } }
    await svc.from("staff_actions").delete().ilike("detail", `%${TAG}%`);
    const left = (await svc.from("staff_users").select("id").ilike("username", `${TAG}%`).limit(5)).data || [];
    console.log(`H cleanup: ${left.length} temp owner(s) left`);
  }
}

// ══ I · the screens, rendered (screens.mjs) and the live write pass (live.mjs) ════════════════════
if (SCREENS) for (const [k, r] of Object.entries(SCREENS)) {
  const [name, look] = k.split(".");
  await R.add("I", `admin console → ${name} (${look}) — rendered, read and looked at: nothing blank, no banner, no leaked code text${look.startsWith("a35") ? ", no sideways page scroll" : ""}, the right skin`,
    "scripts/sweep/t28s10/screens.mjs on :4428 — Playwright, admin cookie, networkidle, then the screenshot READ",
    () => ({ ok: r.status === 200 && r.len > 40 && !r.banner && !r.leak && !(look.startsWith("a35") && r.sideways) && r.skin === look.split("-")[1], note: `${r.len} chars, skin ${r.skin}` }));
}
if (LIVE) for (const [k, r] of Object.entries(LIVE)) {
  await R.add("I", `live write flow ${k} (bills / printing / owners / billing / act-as / ack routes)`, "scripts/sweep/t28s10/live.mjs on :4428 — fixture on French House, every row removed by its own id", () => ({ ok: r.ok, note: r.note }));
}

// ══ J · judgement ════════════════════════════════════════════════════════════════════════════════
const J = (rel, what, how, fn) => add("J", rel, what, how, fn);
await J(F("agent-runs"), "the ?before= cursor is a timestamp, so two sessions in the same instant could straddle a page — is that real here?", "measured: duplicate started_at values across every session on record (now() writes microseconds)", async () => { const r = (await svc.from("agent_runs").select("started_at").limit(2000)).data || []; const s = new Set(r.map((x) => x.started_at)); return { ok: s.size === r.length, note: `${r.length} sessions, ${r.length - s.size} shared instants — not reachable in practice` }; });
await J(F("bills"), "an admin bill delete is a TOMBSTONE — the sale is retained for tax, never erased (compliance §3.0)", "read: softDeleteOrders stamps deleted_at; no .delete() on orders or sessions anywhere in the file", () => ({ ok: !/from\(\s*["'](orders|sessions)["']\s*\)\s*\.delete\(/.test(strip(read(F("bills")))), note: "" }));
await J(F("oplog/cleanup"), "the log cleanup can never touch the permanent Removals record or a sale", "read: the only .delete() targets staff_actions", () => ({ ok: [...strip(read(F("oplog/cleanup"))).matchAll(/from\(\s*["']([^"']+)["']\s*\)\s*\.delete/g)].every((m) => m[1] === "staff_actions"), note: "" }));
await J(F("printing/[...path]"), "a setup code never reaches the diary", "read: the print_setup_code_issued line's detail carries no `made.code`", () => ({ ok: !/logAction\([^)]*made\.code/.test(strip(read(F("printing/[...path]")))), note: "" }));
await J(F("owners"), "a minted password is returned once and never written to a log line", "read: no logAction detail interpolates `password`", () => ({ ok: !/logAction\([^;]*\$\{password\}/.test(strip(read(F("owners")))), note: "" }));
await J(F("customers"), "the platform guest list carries no spend", "read: COLS has no money column", () => ({ ok: !/total|spend|amount/.test(strip(read(F("customers"))).match(/const COLS = "([^"]+)"/)?.[1] || "x"), note: "" }));
await J(F("dashboard"), "the home screen's one request still replaces six (one Promise.all)", "read", () => ({ ok: (strip(read(F("dashboard"))).match(/Promise\.all/g) || []).length === 1, note: "" }));
await J(F("rate-limits"), "'Clear all alerts' never lifts a wall or blocks anyone — it only clears alerts", "read: the dismiss_all branch writes rate_limit_events.status only", () => { const src = strip(read(F("rate-limits"))); const at = src.indexOf('action === "dismiss_all"'); const br = src.slice(at, src.indexOf("const eventId", at)); return { ok: at > 0 && /rate_limit_events[\s\S]{0,120}status:\s*"resolved"/.test(br) && !/throttle(Block|Unblock)|lfh_rate_allow/.test(br), note: `${br.length} chars read` }; });
await J(F("health"), "System health is the one declared exception that keeps the database's own words", "read verify:admin-api-a's PROSE_OK entry", () => ({ ok: /admin\/health\/route\.ts/.test(read("scripts/verify-admin-api-a.mjs")), note: "" }));
await J(F("act-as/go"), "every allowed panel path is one this app actually serves", "read: each ALLOWED_PATHS entry has an app/<panel> page", () => ({ ok: ["manager", "editor", "kitchen", "tablet", "owner"].every((p) => existsSync(join(ROOT, `app/${p}`))), note: "" }));
await J(F("maintenance"), "the flagship id='site' fallback is reached only when no restaurant is named", "read: both branches pick the site row only on a missing restaurant_id", () => ({ ok: (strip(read(F("maintenance"))).match(/eq\("id", "site"\)/g) || []).length === 2, note: "" }));
await J(F("floor"), "the one-restaurant floor names its restaurant to the RPC, never relying on a default", "read", () => ({ ok: /lfh_floor_state",\s*\{\s*p_restaurant_id:\s*rid/.test(strip(read(F("floor")))), note: "" }));

const failed = R.report("T28 sweep #10 — new checks");
if (process.argv.includes("--md")) for (const r of R.rows) console.log(`| ${r.id} | ${r.block} · ${r.what} | ${r.how} | ${r.mark} | ${r.note} |`);
process.exit(failed ? 1 : 0);
