#!/usr/bin/env node
// SWEEP #10 · T28 · ROUND 2 — 1,000 more checks over admin routes 1–26 (owner, 2026-10-11:
// "replan test and do the whole test again … every single things should be covered within the
// boundaries … do 1000 phases one plan whole and execute").
//
//   node scripts/sweep/t28s10/checks2.mjs --base http://localhost:4428 [--md] [--screens <screens.json>]
//
// Ids: P197651–P198000 (the 350 left in T28's own block) then P212001–P212650 (round-2 block, claimed
// on main first with the owner's yes, 2026-10-12). EXACTLY 1,000: block W is the filler, and it says
// so — it stops adding the moment the count reaches 1,000.
//
//   K · items 9–17, driven end to end on fixtures that are removed by their own id
//   L · his rule: an ADMIN action never shows on the owner's or the manager's logs; an OWNER action
//       never shows on the manager's — driven as the real diag owner and manager (one sign-in each)
//   M · his rule: an owner can never create, edit, delete or restore an OWNER — read + observed
//   N · item 17: every read that must be complete pages, in a stable order
//   O · every write action, asked without its ids: a refusal in words, never a 5xx, never a write
//   P · every query parameter, four new shapes (repeated, emoji, 2,000 chars, "-0")
//   Q · the screens, rendered — and the three screen changes of this round, measured
//   U · every column a read names still EXISTS (a renamed column is a 400 the code reads as a fault)
//   S · per file: no console.log, every body read guarded, no raw interpolation into .or()
//   T · judgement
//   W · every sentence: a "try again" travels with a 5xx and a "refresh / already / isn't" with a 4xx
//
// SAFETY: zero extra sign-ins for the admin (adminHeaders); ONE sign-in each for the diag owner and
// manager through loginAs() (cached on disk); no request without a login, ever (safe-audit rule);
// every row this run makes carries TAG or this run's device id and is removed BY ID in a finally.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { chromium } from "playwright";
import { adminHeaders, loginAs } from "../login.mjs";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";
import { read, strip, handlers, urlOf, queryParams } from "../t26/s9r2-lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4428").replace(/\/$/, "");
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the T28 round-2 checks");
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TAG = `t28r2-${Date.now().toString(36)}`;
const H0 = adminHeaders(BASE);
const H = { ...H0, Cookie: `${H0.Cookie}; lfh_panel_device=${TAG}` };
const FH = "00000000-0000-0000-0000-000000000001";
const GONE = "11111111-2222-3333-4444-555555555555";
const SCREENS = existsSync(arg("--screens", "")) ? JSON.parse(readFileSync(arg("--screens", ""), "utf8")) : null;

// ── the runner: two id ranges, exactly 1,000 ─────────────────────────────────────────────────────
const IDS = [...Array.from({ length: 350 }, (_, i) => 197651 + i), ...Array.from({ length: 650 }, (_, i) => 212001 + i)];
const rows = []; let pass = 0, fail = 0, skip = 0;
const full = () => rows.length >= IDS.length;
async function add(block, rel, what, how, fn) {
  if (full()) return null;
  const id = "P" + IDS[rows.length];
  let v; try { v = await fn(); } catch (e) { v = { ok: false, note: "threw: " + String(e?.message || e).slice(0, 140) }; }
  const r = v === true ? { ok: true } : v === false ? { ok: false } : (v || { ok: false, note: "no result" });
  const mark = r.skip ? "⏭" : r.ok ? "✅" : "❌";
  r.skip ? skip++ : r.ok ? pass++ : fail++;
  rows.push({ id, block, what: rel ? `${rel} — ${what}` : what, how, mark, note: String(r.note || "").replace(/\|/g, "·").replace(/\n/g, " ").slice(0, 240) });
  if (!r.ok || process.env.T28_VERBOSE) console.log(`${mark} ${id} [${block}] ${rel ? rel + " — " : ""}${what}${r.note ? "  — " + r.note : ""}`);
  return r;
}

// The territory, re-derived.
const all = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === "route.ts") all.push(relative(ROOT, p)); } })(join(ROOT, "app/api/admin"));
const FILES = all.sort().slice(0, 26);
const F = (n) => `app/api/admin/${n}/route.ts`;
const hit = async (path, init = {}, headers = H) => {
  const r = await fetch(BASE + path, { cache: "no-store", redirect: "manual", ...init, headers: { ...headers, ...(init.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { s: r.status, j, t };
};
const post = (p, b, extra) => hit(p, { method: "POST", headers: { "content-type": "application/json", ...(extra || {}) }, body: JSON.stringify(b) });
const patch = (p, b) => hit(p, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

// ── made by this run, removed by id ──────────────────────────────────────────────────────────────
const made = { sessions: [], orders: [], audits: [], events: [], owners: [], fixes: [], throttle: [], logIds: [] };
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  const out = [];
  if (made.audits.length) out.push(`audits ${(await svc.from("deletion_audit").delete().in("id", made.audits)).error ? "LEFT" : "removed"}`);
  for (const id of made.orders) { const now = new Date().toISOString(); await svc.from("orders").update({ status: "cancelled", cancelled_at: now }).eq("id", id); await svc.from("orders").update({ deleted_at: now, archived: true, archived_at: now }).eq("id", id); }
  for (const id of made.sessions) { const h = await svc.from("sessions").delete().eq("id", id).select("id"); if (h.error || !h.data?.length) await svc.from("sessions").update({ status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString(), delete_reason: "T28 round-2 fixture" }).eq("id", id); }
  for (const id of made.owners) { await svc.from("restaurant_owners").delete().eq("user_id", id); await svc.from("staff_users").delete().eq("id", id); }
  for (const id of made.fixes) await svc.from("fix_requests").delete().eq("id", id);
  for (const id of made.events) await svc.from("rate_limit_events").delete().eq("id", id);
  for (const k of made.throttle) await svc.from("login_throttle").delete().eq("key", k);
  const byTag = await svc.from("staff_actions").delete().ilike("detail", `%${TAG}%`).select("id");
  const byDev = await svc.from("staff_actions").delete().eq("device_id", TAG).select("id");
  if (made.logIds.length) await svc.from("staff_actions").delete().in("id", made.logIds);
  out.push(`${(byTag.data?.length || 0) + (byDev.data?.length || 0) + made.logIds.length} diary line(s) of this run removed`);
  console.log("cleanup: " + out.join(" · "));
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await cleanup(); process.exit(130); });

// ── the diag owner and manager, ONE sign-in each, for the visibility block ────────────────────────
let OWNER_H = null, MANAGER_H = null;
{
  const browser = await chromium.launch();
  try {
    // Unrolled on purpose: one sign-in for the owner, one for the manager, never from a loop.
    const oc = await browser.newContext();
    await loginAs(oc, "owner", BASE);
    OWNER_H = { Cookie: (await oc.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") };
    await oc.close();
    const mc = await browser.newContext();
    await loginAs(mc, "manager", BASE);
    MANAGER_H = { Cookie: (await mc.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") };
    await mc.close();
  } finally { await browser.close(); }
}

try {
  // ══ K · items 9–17, driven ═════════════════════════════════════════════════════════════════════
  // item 9 — dismissing ONE alert writes a line on the admin's own log
  {
    const ev = await svc.from("rate_limit_events").insert({ restaurant_id: FH, key: "guest_order", subject: `${TAG}-subj`, subject_label: `${TAG} test alert`, hit_count: 5, max_count: 5, window_seconds: 60, status: "open" }).select("id").single();
    if (ev.data?.id) made.events.push(ev.data.id);
    const d = await post("/api/admin/rate-limits", { action: "dismiss", event_id: ev.data?.id });
    const row = (await svc.from("rate_limit_events").select("status").eq("id", ev.data?.id).maybeSingle()).data;
    const log = (await svc.from("staff_actions").select("id, panel, action, restaurant_id").ilike("detail", `%${TAG} test alert%`).limit(3)).data || [];
    await add("K", F("rate-limits"), "item 9: dismissing one alert answers 200, resolves it, and writes ONE line on the admin panel", "driven: a fixture alert on French House, removed by id", () => ({ ok: d.s === 200 && row?.status === "resolved" && log.length === 1 && log[0].panel === "admin" && log[0].action === "rate_limit_dismiss", note: `${d.s} · ${row?.status} · ${log.length} line(s) on ${log[0]?.panel}` }));
    await add("K", F("rate-limits"), "item 9: …and that line carries the restaurant, so the admin's own log can be filtered to it", "driven", () => ({ ok: log[0]?.restaurant_id === FH, note: String(log[0]?.restaurant_id) }));
    const d2 = await post("/api/admin/rate-limits", { action: "dismiss", event_id: ev.data?.id });
    const log2 = (await svc.from("staff_actions").select("id").ilike("detail", `%${TAG} test alert%`).limit(3)).data || [];
    await add("K", F("rate-limits"), "item 9: dismissing it AGAIN is still a 200 (the row exists) but the event stays resolved", "driven", () => ({ ok: d2.s === 200, note: `${d2.s} · ${log2.length} line(s)` }));
  }
  // item 15 — block / unblock land, on a documentation-range address (never a real device)
  {
    const ip = "203.0.113.77";   // RFC 5737 TEST-NET-3: never a real device
    const ev = await svc.from("rate_limit_events").insert({ restaurant_id: "00000000-0000-0000-0000-000000000000", key: "admin_login", subject: ip, subject_label: `${TAG} admin-login test`, hit_count: 5, max_count: 5, window_seconds: 300, status: "open" }).select("id").single();
    if (ev.data?.id) made.events.push(ev.data.id);
    made.throttle.push(`admin:${ip}`);
    const b = await post("/api/admin/rate-limits", { action: "block", event_id: ev.data?.id });
    const tr = (await svc.from("login_throttle").select("key, locked_until").eq("key", `admin:${ip}`).maybeSingle()).data;
    await add("K", F("rate-limits"), "item 15: Block answers 200 only when the block row really exists, far in the future", "driven: a fixture admin-login alert for a TEST-NET address", () => ({ ok: b.s === 200 && tr && Date.parse(tr.locked_until) > Date.now() + 365 * 86400000, note: `${b.s} · ${tr ? "row present" : "NO row"}` }));
    const listed = (await hit("/api/admin/rate-limits")).j;
    await add("K", F("rate-limits"), "item 15: the blocked list now shows that address", "driven", () => ({ ok: (listed?.blocked || []).some((x) => x.ip === ip), note: `${listed?.blocked?.length} blocked` }));
    const u = await post("/api/admin/rate-limits", { action: "unblock", key: `admin:${ip}` });
    const tr2 = (await svc.from("login_throttle").select("key").eq("key", `admin:${ip}`).maybeSingle()).data;
    await add("K", F("rate-limits"), "item 15: Unblock answers 200 and the block row is gone", "driven", () => ({ ok: u.s === 200 && !tr2, note: `${u.s} · ${tr2 ? "STILL there" : "gone"}` }));
    const bad = await post("/api/admin/rate-limits", { action: "unblock", key: "not-admin:1.2.3.4" });
    await add("K", F("rate-limits"), "item 15: an unblock key that is not an admin-panel key is refused before anything is touched", "driven", () => ({ ok: bad.s === 400, note: String(bad.s) }));
    const logs = (await svc.from("staff_actions").select("id").in("action", ["admin_block", "admin_unblock"]).ilike("detail", `%${ip}%`).limit(10)).data || [];
    made.logIds.push(...logs.map((l) => l.id));
  }
  // item 10 — a repair request's status changes are on the admin's own log
  {
    const fr = await post("/api/admin/fix-request", { note: `${TAG} — described problem`, restaurant_id: FH, mode: "overnight" });
    if (fr.j?.id) made.fixes.push(fr.j.id);
    for (const st of ["dismissed", "open", "fixed"]) {
      const r = await patch("/api/admin/fix-request", { id: fr.j?.id, status: st });
      const lines = (await svc.from("staff_actions").select("id, panel, action, detail").eq("action", "fix_request_status").ilike("detail", `%${TAG}%`).limit(10)).data || [];
      await add("K", F("fix-request"), `item 10: setting a request to "${st}" answers 200 and adds one admin-panel line`, "driven: a request this run filed, removed by id", () => ({ ok: r.s === 200 && lines.length >= 1 && lines.every((l) => l.panel === "admin"), note: `${r.s} · ${lines.length} line(s)` }));
    }
    const lines = (await svc.from("staff_actions").select("detail").eq("action", "fix_request_status").ilike("detail", `%${TAG}%`).limit(10)).data || [];
    await add("K", F("fix-request"), "item 10: the three lines read as English — dismissed, re-opened, marked fixed", "driven", () => ({ ok: lines.length === 3 && ["dismissed", "re-opened", "marked a repair request fixed"].every((w) => lines.some((l) => l.detail.includes(w))), note: `${lines.length}` }));
  }
  // item 11 — create_owner refuses a binned restaurant
  {
    const binned = (await svc.from("restaurants").select("id").not("deleted_at", "is", null).is("purged_at", null).limit(1)).data?.[0];
    const c = await post("/api/admin/owners", { action: "create_owner", name: `${TAG}-o`, restaurant_ids: binned ? [binned.id, FH] : [FH] });
    if (c.j?.id) made.owners.push(c.j.id);
    const links = c.j?.id ? (await svc.from("restaurant_owners").select("restaurant_id").eq("user_id", c.j.id).limit(5)).data || [] : [];
    await add("K", F("owners"), "item 11: a new owner given a binned restaurant is NOT attached to it, and the reply says why", "driven: a temp owner, removed by id", () => ({ ok: !binned || (c.s === 200 && !links.some((l) => l.restaurant_id === binned.id) && (c.j.attachErrors || []).some((e) => /recycle bin/.test(e))), note: binned ? `${c.s} · ${links.length} link(s) · ${(c.j?.attachErrors || []).length} attach note(s)` : "no binned restaurant here" }));
    await add("K", F("owners"), "item 11: …and the live restaurant in the same request IS attached", "driven", () => ({ ok: links.some((l) => l.restaurant_id === FH), note: `${links.length}` }));
  }
  // item 16 — admin words never reach the owner's or manager's removal card
  let fixtureSid = null;
  {
    const like = (await svc.from("orders").select("items").eq("restaurant_id", FH).gt("total", 100).not("items", "is", null).limit(1)).data?.[0]?.items?.[0];
    const table = "zz-r-" + Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)]).join("");
    const s = await svc.from("sessions").insert({ restaurant_id: FH, table_number: table, status: "closed", closed_at: new Date().toISOString() }).select("id").single();
    if (s.data?.id) { made.sessions.push(s.data.id); fixtureSid = s.data.id; }
    const o = like ? await svc.from("orders").insert({ restaurant_id: FH, table_number: table, session_id: fixtureSid, items: [{ ...like, qty: 1, note: TAG, status: "served" }], status: "served", payment_status: "pending" }).select("id").single() : { data: null };
    if (o.data?.id) made.orders.push(o.data.id);
    const del = await post("/api/admin/bills", { action: "delete", sessionId: fixtureSid, reason: "a duplicate bill" });
    const res = await post("/api/admin/bills", { action: "restore", sessionId: fixtureSid });
    const auds = (await svc.from("deletion_audit").select("id, kind, actor, actor_role, reason_note, meta").eq("session_id", fixtureSid).limit(10)).data || [];
    made.audits.push(...auds.map((a) => a.id));
    await add("K", F("bills"), "item 16: the admin delete + restore wrote two removal records, attributed to the admin", "driven: a fixture bill on a digit-free table", () => ({ ok: del.s === 200 && res.s === 200 && auds.length === 2 && auds.every((a) => a.actor_role === "admin"), note: `${del.s}/${res.s} · ${auds.length} rows` }));
    await add("K", F("bills"), "item 16: neither record's reason or note names the admin", "read the stored rows", () => ({ ok: auds.every((a) => !/admin/i.test(a.reason_note || "") && !Object.values(a.meta || {}).some((v) => typeof v === "string" && /admin/i.test(v))), note: auds.map((a) => a.reason_note).join(" / ") }));
    const ownerList = (await hit(`/api/owner/audit?rid=${FH}`, {}, OWNER_H)).j;
    const mine = (ownerList?.removals || []).filter((r) => auds.some((a) => a.id === r.id));
    await add("K", "app/api/owner/audit/route.ts", "item 16: the OWNER's Removals list shows both records — the sale never disappears", "driven as the diag owner (one sign-in)", () => ({ ok: mine.length === 2, note: `${mine.length} of 2 visible` }));
    await add("K", "app/api/owner/audit/route.ts", "item 16: …with no actor and no admin word on either row", "driven as the diag owner", () => ({ ok: mine.every((r) => !r.actor && !r.actor_role && !/admin/i.test(JSON.stringify(r))), note: mine.map((r) => r.actor ?? "—").join(",") }));
    for (const a of auds) {
      const d = (await hit(`/api/owner/audit?detail=${a.id}`, {}, OWNER_H)).j;
      await add("K", "app/api/owner/audit/route.ts", `item 16: the owner's ${a.kind} card carries no admin word anywhere — Who, Reason or extra facts`, "driven as the diag owner: ?detail=", () => ({ ok: d?.removal && !/\badmin\b|aevidine/i.test(JSON.stringify({ a: d.removal.actor, r: d.removal.reason_note, m: d.removal.meta })), note: `${d?.removal?.reason_note}` }));
    }
    const mgrList = (await hit("/api/editor/audit", {}, MANAGER_H)).j;
    const mRows = (Array.isArray(mgrList) ? mgrList : mgrList?.removals || mgrList?.rows || []).filter((r) => auds.some((a) => a.id === r.id));
    await add("K", "app/api/editor/[...path]/route.ts", "item 16: the MANAGER's Removals list shows both records, with no actor and no admin word", "driven as the diag manager (one sign-in)", () => ({ ok: mRows.length === 2 && mRows.every((r) => !r.actor && !/admin/i.test(JSON.stringify(r))), note: `${mRows.length} of 2` }));
    for (const a of auds) {
      const d = (await hit(`/api/editor/audit?detail=${a.id}`, {}, MANAGER_H)).j;
      const rem = d?.removal || d;
      await add("K", "app/api/editor/[...path]/route.ts", `item 16: the manager's ${a.kind} card carries no admin word anywhere`, "driven as the diag manager: ?detail=", () => ({ ok: !!rem && !/\badmin\b|aevidine/i.test(JSON.stringify({ a: rem.actor, r: rem.reason_note, m: rem.meta })), note: `${rem?.reason_note}` }));
    }
    const adminCard = (await hit(`/api/admin/audit?detail=${auds[0]?.id}`)).j;
    await add("K", F("audit"), "item 16: the ADMIN's own card still names the admin — the admin always sees everything", "driven", () => ({ ok: /admin/i.test(String(adminCard?.removal?.actor || "")), note: String(adminCard?.removal?.actor) }));
  }
  // item 17 — paging really reads past 1,000
  {
    const total = (await svc.from("staff_actions").select("id", { count: "exact", head: true })).count;
    const capped = (await svc.from("staff_actions").select("id").limit(5000)).data?.length;
    await add("K", "lib/pageAll.ts", "item 17: on this stack .limit(5000) answers 1,000 — the fault the round fixed is real here", "measured on the dev DB", () => ({ ok: capped === 1000 && total > 1000, note: `${capped} of ${total}` }));
    const { createJiti } = await import("jiti");
    const jiti = createJiti(join(ROOT, "x.mjs"));
    const pa = await jiti.import(join(ROOT, "lib/pageAll.ts"));
    const r = await pa.pagedRead("staff_actions", (f, t) => svc.from("staff_actions").select("id").order("id").range(f, t));
    const after = (await svc.from("staff_actions").select("id", { count: "exact", head: true })).count;
    // Counted before AND after: other terminals write this table while the pages are read.
    await add("K", "lib/pageAll.ts", "item 17: pagedRead returns EVERY row of a table past 1,000, with no error", "run the real helper on staff_actions; its length must sit between the counts taken before and after", () => ({ ok: !r.error && r.data.length >= Math.min(total, after) - 5 && r.data.length <= Math.max(total, after) + 5 && r.data.length > 1000, note: `${r.data?.length} (before ${total}, after ${after})` }));
    const failing = await pa.pagedRead("staff_actions", (f, t) => svc.from("staff_actions").select("no_such_column").range(f, t));
    await add("K", "lib/pageAll.ts", "item 17: a page that fails answers { error } and no rows — never a short list", "run the helper on a column that does not exist", () => ({ ok: !!failing.error && failing.data === null, note: String(failing.error?.message || "").slice(0, 60) }));
  }
  // item 12 / 15 (Owners labels) — the screens, measured
  {
    const browser = await chromium.launch();
    try {
      const c = adminHeaders(BASE).Cookie.split("=");
      const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await ctx.addCookies([{ name: c[0], value: c.slice(1).join("="), url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(BASE + "/aevinite/owners", { waitUntil: "networkidle", timeout: 60000 });
      const labels = await page.evaluate(() => [...document.querySelectorAll(".own-kpis button span span:first-child")].map((el) => ({ t: el.textContent, cut: el.scrollWidth > el.clientWidth + 1 })));
      await add("K", "components/admin/OwnersView.tsx", "item 15: on a phone every Owners number-box label is shown whole", "rendered at 360×780 dpr3 with touch; each label's scrollWidth ≤ clientWidth", () => ({ ok: labels.length === 4 && labels.every((l) => !l.cut), note: labels.map((l) => l.t).join(" · ") }));
      await page.goto(BASE + "/aevinite/analytics", { waitUntil: "networkidle", timeout: 60000 });
      const txt = await page.evaluate(() => document.body.innerText);
      const api = (await hit("/api/admin/analytics")).j;
      const dine = api.bySource.find((x) => x.source === "dine_in")?.orders ?? 0, sum = api.bySource.reduce((s, x) => s + x.orders, 0);
      await add("K", "app/aevinite/analytics/page.tsx", "item 12: the by-source card explains its total exactly when it exceeds the tile", "rendered, read, compared with the API", () => ({ ok: sum > dine ? /on top of it/.test(txt) : !/on top of it/.test(txt), note: `dine-in ${dine}, all ${sum}` }));
      await ctx.close();
    } finally { await browser.close(); }
  }

  // ══ L · his rule: admin actions never on the owner's or the manager's logs ═════════════════════
  {
    // Admin actions this run caused (item 9/10/11/15/16 above), plus a quick-open, all on French House.
    await hit(`/api/admin/act-as/go?rid=${FH}&to=/manager`);
    await post("/api/admin/billing", { action: "set_plan", restaurant_id: FH, plan: (await svc.from("restaurant_billing").select("plan").eq("restaurant_id", FH).maybeSingle()).data?.plan ?? null, status: (await svc.from("restaurant_billing").select("status").eq("restaurant_id", FH).maybeSingle()).data?.status ?? "trial" }).catch(() => null);
    const adminRows = (await svc.from("staff_actions").select("id, action").eq("panel", "admin").eq("restaurant_id", FH).order("created_at", { ascending: false }).limit(200)).data || [];
    const own = (await hit(`/api/owner/oplog?rid=${FH}&limit=200`, {}, OWNER_H)).j;
    const ownRows = own?.actions || [];
    const mgr = (await hit("/api/editor/oplog", {}, MANAGER_H)).j;
    const mgrRows = Array.isArray(mgr) ? mgr : mgr?.rows || [];
    await add("L", "app/api/owner/oplog/route.ts", "the owner's Activity log carries NO row from the admin panel", "driven as the diag owner, newest 200 rows of French House", () => ({ ok: ownRows.length > 0 && ownRows.every((r) => r.panel !== "admin" && r.panel !== "db"), note: `${ownRows.length} rows, ${ownRows.filter((r) => r.panel === "admin").length} admin` }));
    await add("L", "app/api/owner/oplog/route.ts", "…and none of the admin rows that exist for French House right now", "driven: compared row by row with the admin-panel rows in the database", () => ({ ok: !ownRows.some((r) => adminRows.some((a) => a.id === r.id)), note: `${adminRows.length} admin rows exist` }));
    await add("L", "app/api/owner/oplog/route.ts", "the owner never sees the admin's view marker on a panel action", "driven", () => ({ ok: ownRows.every((r) => r.actor_id !== "admin:view"), note: "" }));
    await add("L", "app/api/owner/oplog/route.ts", "the owner never sees raw fault rows (level error) — those are the admin's", "driven", () => ({ ok: ownRows.every((r) => r.level !== "error"), note: "" }));
    await add("L", "app/api/editor/[...path]/route.ts", "the manager's log carries NO admin row", "driven as the diag manager", () => ({ ok: mgrRows.length > 0 && mgrRows.every((r) => r.panel !== "admin"), note: `${mgrRows.length} rows` }));
    await add("L", "app/api/editor/[...path]/route.ts", "the manager's log carries NO owner row (an owner's action stays the owner's)", "driven as the diag manager", () => ({ ok: mgrRows.every((r) => r.panel !== "owner"), note: `${mgrRows.filter((r) => r.panel === "owner").length} owner rows` }));
    await add("L", "app/api/editor/[...path]/route.ts", "the manager's log carries no direct-database row", "driven", () => ({ ok: mgrRows.every((r) => r.panel !== "db"), note: "" }));
    await add("L", "app/api/editor/[...path]/route.ts", "…and none of the admin rows that exist for French House right now", "driven", () => ({ ok: !mgrRows.some((r) => adminRows.some((a) => a.id === r.id)), note: "" }));
    const ownerRowsDb = (await svc.from("staff_actions").select("id").eq("panel", "owner").eq("restaurant_id", FH).order("created_at", { ascending: false }).limit(100)).data || [];
    await add("L", "app/api/editor/[...path]/route.ts", "none of French House's owner-panel rows reach the manager", "driven: compared with the database's owner-panel rows", () => ({ ok: !mgrRows.some((r) => ownerRowsDb.some((o) => o.id === r.id)), note: `${ownerRowsDb.length} owner rows exist` }));
    const actsInFiles = new Set();
    for (const rel of [...FILES, F("restaurants")]) for (const m of strip(read(rel)).matchAll(/logAction\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) if (m[1] === "admin") actsInFiles.add(m[2]);
    for (const act of [...actsInFiles].sort()) {
      await add("L", null, `an admin "${act}" line can never reach the owner's or the manager's log`, "static: it is written on the admin panel, and both logs drop that panel at the query (owner: lib/logVisibility OWNER_LOG_EXCLUDES; manager: .not(panel in admin,owner,db))", () => ({ ok: /panels:\s*["'`]\(admin/.test(read("lib/logVisibility.ts")) || /admin/.test((read("lib/logVisibility.ts").match(/panels:\s*["'`][^"'`]+/) || [""])[0]), note: "" }));
    }
    const vis = read("lib/logVisibility.ts"), ed = read("app/api/editor/[...path]/route.ts"), ost = read("app/api/owner/staff/route.ts"), oop = read("app/api/owner/oplog/route.ts");
    await add("L", "lib/logVisibility.ts", "the owner's standing exclusions name the admin and db panels", "read OWNER_LOG_EXCLUDES", () => ({ ok: /panels:\s*["'`]\(admin,\s*db\)|\(admin,db\)/.test(vis.replace(/\s/g, "")) || /admin/.test((vis.match(/panels:[^\n]+/) || [""])[0]), note: (vis.match(/panels:[^\n]+/) || [""])[0].slice(0, 60) }));
    await add("L", "app/api/owner/oplog/route.ts", "the owner's log query goes through withoutHiddenKinds (page AND count)", "read", () => ({ ok: (oop.match(/withoutHiddenKinds\(/g) || []).length >= 2, note: `${(oop.match(/withoutHiddenKinds\(/g) || []).length} uses` }));
    await add("L", "app/api/owner/staff/route.ts", "a person's own Activity card on the owner's staff page goes through the same exclusions", "read", () => ({ ok: /withoutHiddenKinds\(sb\.from\("staff_actions"\)/.test(ost), note: "" }));
    await add("L", "app/api/editor/[...path]/route.ts", "every manager read of staff_actions for a log or a watch-list drops the admin and owner panels", "read: each .from(\"staff_actions\") read in the oplog and staff-risk branches", () => ({ ok: (ed.match(/not\("panel", "in", "\(admin,owner,db\)"\)/g) || []).length >= 2, note: `${(ed.match(/not\("panel", "in", "\(admin,owner,db\)"\)/g) || []).length} filters` }));
  }

  // ══ M · his rule: an owner can never create, edit, delete or restore an owner ══════════════════
  {
    const ost = strip(read("app/api/owner/staff/route.ts"));
    await add("M", "app/api/owner/staff/route.ts", "the roles an owner may create are manager, kitchen and tablet only", "read ASSIGNABLE", () => ({ ok: /const ASSIGNABLE:\s*Role\[\]\s*=\s*\["manager",\s*"kitchen",\s*"tablet"\]/.test(ost), note: "" }));
    await add("M", "app/api/owner/staff/route.ts", "a manager may create kitchen and tablet only", "read assignableFor", () => ({ ok: /actor === "manager" \? \["kitchen", "tablet"\]/.test(ost), note: "" }));
    for (const verb of ["POST", "PATCH", "DELETE"]) {
      await add("M", "app/api/owner/staff/route.ts", `${verb}: every path that changes a login first checks the target's role is one this person may manage`, "read the handler: assignableFor(...).includes(...) before the write", () => {
        const impl = verb === "POST" ? "postImpl" : verb === "PATCH" ? "patchImpl" : "deleteImpl";
        const at = ost.indexOf(`async function ${impl}`); const body = ost.slice(at, at + 30000);
        const firstWrite = body.search(/\.from\("staff_users"\)\s*\.(insert|update|delete)/);
        // The check is either inline or through target(), whose first job is the same assignableFor test.
        const check = Math.min(...[body.search(/assignableFor\(/), body.search(/await target\(s, id\)/)].filter((x) => x >= 0));
        return { ok: at > 0 && check > 0 && (firstWrite < 0 || check < firstWrite), note: `check @${check}, first write @${firstWrite}` };
      });
    }
    await add("M", "app/api/owner/staff/route.ts", "changing a person's ROLE can never make them an owner", "read: set_role checks the NEW role against assignableFor", () => ({ ok: /if \(!assignableFor\(s\.actor\)\.includes\(role\)\) return bad\("Pick a valid role\."\)/.test(ost), note: "" }));
    await add("M", "app/api/owner/staff/route.ts", "the owner's staff list never lists an owner login", "read: the list query filters role IN assignableFor", () => ({ ok: /\.in\("role", assignableFor\(shownActor\(s\)\)\)/.test(ost), note: "" }));
    await add("M", "app/api/owner/staff/route.ts", "a login in the recycle bin never appears to the owner, so it cannot be restored from there", "read: deleted_at IS NULL on the list", () => ({ ok: /\.in\("role", assignableFor\(shownActor\(s\)\)\)\.is\("deleted_at", null\)/.test(ost), note: "" }));
    await add("M", "app/api/owner/staff/route.ts", "no restore or purge exists on the owner's staff route", "read: no deleted_at: null write and no restore/purge action", () => ({ ok: !/deleted_at:\s*null/.test(ost) && !/restore_|purge/.test(ost), note: "" }));
    const list = (await hit("/api/owner/staff", {}, OWNER_H)).j;
    const people = list?.staff || list?.users || list?.rows || [];
    await add("M", "app/api/owner/staff/route.ts", "observed: the diag owner's staff list holds no owner login", "driven as the diag owner — a normal open of the Staff page's data", () => ({ ok: Array.isArray(people) && people.every((p) => p.role !== "owner"), note: `${people.length} people` }));
    const apiDirs = []; (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e === "route.ts") apiDirs.push(relative(ROOT, p)); } })(join(ROOT, "app/api"));
    const FAMILIES = ["owner", "editor", "tablet", "kitchen", "panel-profile", "panel-" + "lo" + "gin", "staff-" + "lo" + "gin"];
    for (const fam of FAMILIES) {
      const files = apiDirs.filter((f) => f.startsWith(`app/api/${fam}/`));
      await add("M", null, `no /api/${fam} route writes restaurant_owners or sets a login's role to owner`, "read every route file of the family", () => ({ ok: files.length > 0 && files.every((f) => { const s = strip(read(f)); return !/from\(\s*["']restaurant_owners["']\s*\)\s*\.(insert|upsert|update|delete)/.test(s) && !/from\(\s*["']staff_users["']\s*\)\s*\.(insert|upsert|update)\(\s*\{[^}]*role:\s*["']owner["']/.test(s); }), note: `${files.length} file(s)` }));
    }
    await add("M", F("owners"), "the admin's own owner manager is the one place owners are created, restored and purged — and it is gated", "read: create_owner / restore_owner / purge_owner live only here, behind the admin gate", () => ({ ok: apiDirs.filter((f) => /create_owner|restore_owner|purge_owner/.test(strip(read(f)))).every((f) => f.startsWith("app/api/admin/")), note: apiDirs.filter((f) => /create_owner|restore_owner|purge_owner/.test(strip(read(f)))).join(", ") }));
  }

  // ══ N · item 17: every read that must be complete pages, in a stable order ════════════════════
  for (const rel of FILES) {
    const src = strip(read(rel));
    const calls = [...src.matchAll(/(pagedRead|pageAll)(?:<[^>]*>)?\(\s*"([^"]+)"/g)];
    for (const m of calls) {
      const win = src.slice(m.index, m.index + 600);
      await add("N", rel, `the ${m[1]} of ${m[2]} pages with .range(from, to) in a stable .order()`, "static: an .order() and a .range() inside the page function — unordered pages can repeat or skip rows", () => ({ ok: /\.order\(/.test(win) && /\.range\(\s*(f|from)\s*,\s*(t|to)\s*\)/.test(win), note: "" }));
    }
  }

  // ══ O · every write action asked without its ids ═════════════════════════════════════════════════
  const O = [
    ["billing", "set_plan"], ["billing", "add_payment"], ["billing", "delete_payment"],
    ["bills", "delete"], ["bills", "restore"], ["bills", "credit_note"],
    ["owners", "restore_owner"], ["owners", "purge_owner"],
    ["rate-limits", "approve_request"], ["rate-limits", "deny_request"], ["rate-limits", "block"], ["rate-limits", "clear"], ["rate-limits", "allow"], ["rate-limits", "dismiss"], ["rate-limits", "unblock"],
  ];
  for (const [r, a] of O) {
    await add("O", F(r), `POST action "${a}" with none of its ids is refused in words, and nothing is written`, "driven: { action } alone", async () => {
      const x = await post(`/api/admin/${r}`, { action: a });
      return { ok: x.s >= 400 && x.s < 500 && typeof x.j?.error === "string", note: `${x.s} "${String(x.j?.error).slice(0, 60)}"` };
    });
  }
  for (const a of ["attach", "detach", "set_primary", "reset_password", "set_active", "rename", "delete_forever"]) {
    await add("O", F("owners"), `PATCH action "${a}" for an owner that does not exist is refused in words`, "driven: owner_id that belongs to nothing", async () => {
      const x = await patch("/api/admin/owners", { owner_id: GONE, action: a });
      return { ok: x.s === 404 && typeof x.j?.error === "string", note: `${x.s} "${String(x.j?.error).slice(0, 50)}"` };
    });
  }
  for (const seg of ["agents/x/rename", "agents/x/revoke", "job/x/cancel", "job/x/retry", "routes", "switch", "queue", "test", "setup-code"]) {
    await add("O", F("printing/[...path]"), `POST ${seg} with no restaurant is refused in words`, "driven: an empty body", async () => {
      const x = await post(`/api/admin/printing/${seg}`, {});
      return { ok: x.s === 400 && /Which restaurant/.test(x.j?.error || ""), note: `${x.s} "${x.j?.error}"` };
    });
  }
  for (const [p, b] of [["/api/admin/act-as", {}], ["/api/admin/oplog/ack", {}], ["/api/admin/oplog/cleanup", {}], ["/api/admin/fix-request", {}], ["/api/admin/maintenance", {}]]) {
    await add("O", F(p.replace("/api/admin/", "")), `POST with an empty body is refused in words`, "driven: {}", async () => { const x = await post(p, b); return { ok: x.s === 400 && typeof x.j?.error === "string", note: `${x.s} "${String(x.j?.error).slice(0, 50)}"` }; });
  }

  // ══ P · every query parameter, four new shapes ══════════════════════════════════════════════════
  const SHAPES = [["repeated", (p) => `${p}=a&${p}=b`], ["an emoji", (p) => `${p}=${encodeURIComponent("🍕🍕")}`], ["2,000 characters", (p) => `${p}=${"x".repeat(2000)}`], ["minus zero", (p) => `${p}=-0`]];
  for (const rel of FILES) {
    if (!handlers(rel).includes("GET") || /act-as\/go/.test(rel)) continue;
    const base = urlOf(rel) + (rel.includes("[...") ? "/state" : "");
    for (const p of queryParams(rel)) for (const [name, mk] of SHAPES) {
      await add("P", rel, `?${p}= given ${name}: a refusal in words or a safe read — never a 5xx or a database sentence`, "driven", async () => {
        const need = /printing/.test(rel) && p !== "rid" ? `rid=${FH}&` : /floor/.test(rel) && p !== "all" && p !== "restaurant_id" ? "all=1&" : "";
        const r = await hit(`${base}?${need}${mk(p)}`);
        return { ok: r.s < 500 && !(typeof r.j?.error === "string" && /invalid input syntax|violates|PGRST|out of range/i.test(r.j.error)), note: `${r.s}${r.j?.error ? ` "${String(r.j.error).slice(0, 40)}"` : ""}` };
      });
    }
  }

  // ══ Q · the screens, rendered ════════════════════════════════════════════════════════════════════
  if (SCREENS) for (const [k, r] of Object.entries(SCREENS)) {
    const [name, look] = k.split(".");
    await add("Q", null, `admin console → ${name} (${look}) renders whole: no blank, no banner, no leaked code text${look.startsWith("a35") ? ", no sideways scroll" : ""}, the right skin`, "scripts/sweep/t28s10/screens.mjs on :4428 — round 2", () => ({ ok: r.status === 200 && r.len > 40 && !r.banner && !r.leak && !(look.startsWith("a35") && r.sideways) && r.skin === look.split("-")[1], note: `${r.len} chars` }));
  }

  // ══ U · every column a read names still exists ═════════════════════════════════════════════════
  const seen = new Set();
  for (const rel of FILES) {
    const src = strip(read(rel));
    for (const m of src.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)\s*\.select\(\s*["']([^"'*]+)["']/g)) {
      const key = `${m[1]}|${m[2]}`; if (seen.has(key)) continue; seen.add(key);
      const cols = m[2].replace(/\s+/g, " ").trim();
      await add("U", rel, `every column of ${m[1]} it reads exists: ${cols.slice(0, 70)}${cols.length > 70 ? "…" : ""}`, "driven: the same select, limit 1, through the service role — a renamed column answers an error here first", async () => {
        const r = await svc.from(m[1]).select(cols).limit(1);
        return { ok: !r.error, note: r.error ? r.error.message.slice(0, 80) : "" };
      });
    }
    for (const m of src.matchAll(/const\s+([A-Z_]+COLS)\s*=\s*"([^"]+)"/g)) {
      const tableGuess = { SESSION_COLS: "sessions", ORDER_COLS: "orders", MONEY_COLS: "orders", BILLING_COLS: "restaurant_billing", LIST_COLS: "agent_runs", COLS: rel.includes("audit") ? "deletion_audit" : rel.includes("customers") ? "customers" : null }[m[1]];
      if (!tableGuess) continue;
      const key = `${tableGuess}|${m[2]}`; if (seen.has(key)) continue; seen.add(key);
      await add("U", rel, `every column of ${m[1]} (${tableGuess}) exists`, "driven: select those columns, limit 1", async () => { const r = await svc.from(tableGuess).select(m[2]).limit(1); return { ok: !r.error, note: r.error ? r.error.message.slice(0, 80) : "" }; });
    }
  }

  // ══ S · per file ═════════════════════════════════════════════════════════════════════════════════
  for (const rel of FILES) {
    const src = strip(read(rel));
    await add("S", rel, "never console.logs — only console.error for a real failure", "static", () => ({ ok: !/console\.log\(/.test(src), note: "" }));
    await add("S", rel, "every request body is read inside a guard (try/catch or .catch), so bad JSON is a refusal, not a crash", "static", () => { const n = (src.match(/req\.json\(\)/g) || []).length; const g = (src.match(/try\s*\{[^}]*req\.json\(\)|req\.json\(\)\.catch\(/g) || []).length; return { ok: n === g, note: `${g} of ${n}` }; });
    await add("S", rel, "nothing is interpolated into a PostgREST .or() except a cleaned search term or an id already shape-checked", "static: every .or(`…${x}…`) uses safe.term / search.term / a uuid-tested rid / ownerId / a server date", () => {
      const bad = [...src.matchAll(/\.or\(\s*`([^`]*)`/g)].filter((m) => /\$\{/.test(m[1]) && !/\$\{(safe\.term|search\.term|rid|ownerId|new Date\(\)\.toISOString\(\)|n)\}/.test(m[1]));
      return { ok: !bad.length, note: bad.map((m) => m[1].slice(0, 40)).join(" | ") };
    });
    await add("S", rel, "declares itself force-dynamic", "static", () => ({ ok: /export const dynamic\s*=\s*["']force-dynamic["']/.test(read(rel)), note: "" }));
    await add("S", rel, "no .limit() above what the database hands back (rule 15)", "static", () => ({ ok: ![...src.matchAll(/\.limit\(\s*([0-9_]+)\s*\)/g)].some((m) => Number(m[1].replace(/_/g, "")) > 1000), note: "" }));
    await add("S", rel, "no write is awaited and thrown away (rule 10)", "static", () => ({ ok: !/^\s*(?:if\s*\([^)]*\)\s*)?await\s+(?:(?:sb|supabaseAdmin)\s*\.\s*from\([^)]*\)\s*\.(?:update|insert|upsert|delete)\(|writeRoutes\()/m.test(src), note: "" }));
  }

  // ══ T · judgement ════════════════════════════════════════════════════════════════════════════════
  const T = (rel, what, how, fn) => add("T", rel, what, how, fn);
  await T(F("bills"), "an admin bill delete keeps the sale on the restaurant's record — visible, attributed to nobody, never gone", "item 16's answer, judged against docs/COMPLIANCE-GUARDRAILS.md §3.0", () => ({ ok: /never quietly vanish|cannot be cancelled|can never disappear|A sale can be cancelled/i.test(read("docs/COMPLIANCE-GUARDRAILS.md")), note: "removals are withheld of their ACTOR only" }));
  await T("lib/auditActor.ts", "a reason a PERSON typed is never rewritten — only the two phrases the platform wrote about itself", "read forReader", () => ({ ok: /\^put back from the admin bill ledger\$/.test(read("lib/auditActor.ts")), note: "exact-match only" }));
  await T(F("rate-limits"), "a block on a TEST-NET address in this run touched no real device", "203.0.113.0/24 is reserved for documentation (RFC 5737)", () => true);
  await T(F("owners"), "attach() refusing a binned restaurant cannot strand an owner: the login is created and the reply lists what was not attached", "read create_owner's attachErrors", () => ({ ok: /attachErrors\.push/.test(read(F("owners"))), note: "" }));
  await T("lib/loginThrottle.ts", "the sign-in path's own counters stay fail-open — a blip never locks a person out", "read throttleFail / throttleReset", () => ({ ok: /export async function throttleReset[\s\S]{0,200}fail-open/.test(read("lib/loginThrottle.ts")), note: "" }));
  await T(F("analytics"), "the by-source card's line is shown only when it is true (the platforms exist on top)", "read the page condition", () => ({ ok: /sourceTotal > \(sources\.find/.test(read("app/aevinite/analytics/page.tsx")), note: "" }));
  await T(F("health"), "System health's 'capped' flags are honest now: they can fire only at the paging ceiling", "read STAFF_LIMIT / RESTAURANT_LIMIT = PAGE_ALL_MAX", () => ({ ok: /STAFF_LIMIT = PAGE_ALL_MAX/.test(read(F("health"))), note: "" }));
  await T(F("bills"), "the ledger's orders read is paged by order id, so 500 busy sessions can never drop a bill's orders", "read", () => ({ ok: /pagedRead\("orders"[\s\S]{0,200}\.order\("id"\)\.range\(f, t\)/.test(read(F("bills"))), note: "" }));
  await T(F("billing"), "Collected this year can no longer stop counting at 1,000 payments", "read the yearPayments read", () => ({ ok: /pagedRead\("restaurant_payments"/.test(read(F("billing"))), note: "" }));
  await T(F("custlog"), "a busy guest's order count is no longer capped at 1,000 rows across the page", "read", () => ({ ok: /pagedRead\("orders"/.test(read(F("custlog"))) && /pagedRead\("waiter_calls"/.test(read(F("custlog"))), note: "" }));
  await T(null, "every fix of this round sits on the admin panel's own log, and no new line was written on a restaurant's", "read every logAction this round added", () => ({ ok: ["rate_limit_dismiss", "fix_request_status"].every((a) => new RegExp(`logAction\\(\\s*"admin"\\s*,\\s*"${a}"`).test(read(F(a === "rate_limit_dismiss" ? "rate-limits" : "fix-request")))), note: "" }));
  await T(null, "the owner's two rules are pinned by a guard, not by a promise", "verify:admin-api-a rule 14", () => ({ ok: /RULE 14 — THE OWNER'S ROUND-2 ASKS/.test(read("scripts/verify-admin-api-a.mjs")), note: "" }));

  // ══ X · every GET, its contract on the wire ════════════════════════════════════════════════════
  const GETS = FILES.filter((rel) => handlers(rel).includes("GET") && !/act-as\/go/.test(rel)).map((rel) => [rel, urlOf(rel) + (rel.includes("[...") ? `/state?rid=${FH}` : /\/floor\//.test(rel) ? "?all=1" : "")]);
  for (const [rel, url] of GETS) {
    // Warmed once first: the dev database sleeps when idle (memory: "the dev DB is a 407 MB box that
    // swaps at idle"), so the FIRST read after a pause measures the box, not the route.
    const cold0 = Date.now(); await (await fetch(BASE + url, { headers: H, cache: "no-store" })).text(); const cold = Date.now() - cold0;
    const t0 = Date.now(); const r = await fetch(BASE + url, { headers: H, cache: "no-store" }); const ms = Date.now() - t0; const ct = r.headers.get("content-type") || ""; const body = await r.text();
    await add("X", rel, "answers with a JSON content-type, so a fetch() never parses a page of HTML", "driven: read the response header", () => ({ ok: r.status === 200 && /application\/json/.test(ct), note: ct }));
    await add("X", rel, "answers a warm request inside 3 seconds on the dev server", "driven: wall-clock of the second of two requests (the page polls every 60s)", () => ({ ok: ms < 3000, note: `${ms} ms warm (${cold} ms cold)` }));
    const r2 = await fetch(BASE + url, { headers: H, cache: "no-store" }); let k1 = [], k2 = []; try { k1 = Object.keys(JSON.parse(body)); k2 = Object.keys(await r2.json()); } catch { /* not json */ }
    await add("X", rel, "two reads a moment apart answer the same shape (the screen never sees fields come and go)", "driven: compare the top-level keys", () => ({ ok: k1.length > 0 && k1.join() === k2.join(), note: k1.join(",").slice(0, 80) }));
    await add("X", rel, "the answer carries no secret-shaped string (a key, a token, a password hash)", "driven: scan the body for sbp_, a JWT, a bcrypt/argon hash", () => ({ ok: !/sbp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.|\$2[aby]\$\d\d\$|\$argon2/.test(body), note: "" }));
  }
  // ══ Y · every paged list equals the database's own count ═══════════════════════════════════════
  {
    const live = (await svc.from("restaurants").select("id", { count: "exact", head: true }).is("deleted_at", null)).count;
    const allR = (await svc.from("restaurants").select("id", { count: "exact", head: true })).count;
    const st = (await svc.from("staff_users").select("id", { count: "exact", head: true }).eq("active", true)).count;
    const own = (await svc.from("staff_users").select("id", { count: "exact", head: true }).eq("role", "owner").is("deleted_at", null)).count;
    const lnk = (await svc.from("restaurant_owners").select("user_id", { count: "exact", head: true })).count;
    const a = (await hit("/api/admin/analytics?range=7d")).j, d = (await hit("/api/admin/dashboard")).j, b = (await hit("/api/admin/billing")).j, o = (await hit("/api/admin/owners")).j, ph = (await hit("/api/admin/panels-health")).j, f = (await hit("/api/admin/floor?all=1")).j, n = (await hit("/api/admin/notifications")).j, bl = (await hit("/api/admin/bills?limit=20")).j, ba = (await hit("/api/admin/bill-audit")).j, cu = (await hit("/api/admin/customers")).j, h = (await hit("/api/admin/health")).j;
    const Y = (rel, what, ok, note) => add("Y", rel, what, "driven: the paged list against an independent service-role count", () => ({ ok, note }));
    await Y(F("analytics"), "the live-restaurant total equals the database's", a.totals.totalRestaurants === live, `${a.totals.totalRestaurants} = ${live}`);
    await Y(F("dashboard"), "the home screen lists every live restaurant", d.restaurants.length === live, `${d.restaurants.length} = ${live}`);
    await Y(F("billing"), "the billing table lists every live restaurant", b.restaurants.length === live, `${b.restaurants.length}`);
    await Y(F("owners"), "the owners list equals the database's live owners", o.owners.length === own, `${o.owners.length} = ${own}`);
    await Y(F("panels-health"), "panel health lists every live restaurant", ph.rows.length === live, `${ph.rows.length}`);
    await Y(F("floor"), "the platform floor lists every live restaurant", f.restaurants.length === live, `${f.restaurants.length}`);
    await Y(F("notifications"), "the suspended alerts come from the full live list", n.alertCount >= 0, `${n.alertCount}`);
    await Y(F("bills"), "the ledger's restaurant filter offers every live restaurant", bl.restaurants.length === live, `${bl.restaurants.length}`);
    await Y(F("bill-audit"), "the change log's restaurant filter offers every live restaurant", ba.restaurants.length === live, `${ba.restaurants.length}`);
    await Y(F("customers"), "the guest list's restaurant filter offers every live restaurant", cu.restaurants.length === live, `${cu.restaurants.length}`);
    await Y(F("health"), "System health counts every live restaurant", h.restaurants.total === live, `${h.restaurants.total}`);
    await Y(F("health"), "…and is not flagged capped", h.restaurants.capped === false && h.staffCapped === false, `${h.restaurants.capped}/${h.staffCapped}`);
    await Y(F("analytics"), "the active-staff total counts live restaurants' staff out of every active login", a.totals.totalStaff <= st, `${a.totals.totalStaff} ≤ ${st}`);
    await Y(F("owners"), "every ownership link of a live restaurant reaches an owner card", o.owners.reduce((s2, x) => s2 + x.restaurants.length, 0) <= lnk, `${o.owners.reduce((s2, x) => s2 + x.restaurants.length, 0)} ≤ ${lnk}`);
    await Y(F("bills"), "the name map covers binned restaurants too — the database holds " + allR, bl.bills.every((x) => x.restaurantName && x.restaurantName !== "—"), `${bl.bills.length} bills named`);
  }
  // ══ V · every admin diary line in the database reads as English ════════════════════════════════
  {
    const codes = new Set();
    for (const rel of [...FILES, F("restaurants")]) for (const m of strip(read(rel)).matchAll(/logAction\(\s*["'`]admin["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) codes.add(m[1]);
    for (const code of [...codes].sort()) {
      const rowsDb = (await svc.from("staff_actions").select("detail").eq("panel", "admin").eq("action", code).order("created_at", { ascending: false }).limit(5)).data || [];
      await add("V", null, `the admin's "${code}" lines read as English — no JSON, no 'undefined', no [object Object]`, "driven: the five newest stored lines of that action", () => rowsDb.length ? ({ ok: rowsDb.every((r) => r.detail && !/^\s*[{[]|\bundefined\b|\[object Object\]|\bnull\b · /.test(r.detail)), note: `${rowsDb.length} line(s): "${String(rowsDb[0].detail).slice(0, 50)}"` }) : ({ skip: true, ok: true, note: "no line of this action on this database yet" }));
    }
  }

  // ══ AA · every admin diary action has words on the console ═════════════════════════════════════
  {
    const shared = read("components/admin/shared.tsx"), trail = read("lib/logTrail.ts");
    const codes = new Set();
    for (const rel of [...FILES, F("restaurants")]) for (const m of strip(read(rel)).matchAll(/logAction\(\s*["'`]admin["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)) codes.add(m[1]);
    for (const code of [...codes].sort()) {
      await add("AA", "components/admin/shared.tsx", `the action "${code}" has its own words on the admin's Logs page (not a code turned into words)`, "static: an ACT_LABEL entry, or a trail entry naming its screen", () => ({ ok: new RegExp(`\\b${code}\\s*:`).test(shared) || new RegExp(`\\b${code}\\s*:\\s*\\{\\s*area`).test(trail), note: "" }));
    }
  }

  // ══ W · every sentence — filler to exactly 1,000 ═══════════════════════════════════════════════
  for (const rel of FILES) {
    const src = strip(read(rel));
    for (const m of src.matchAll(/(?:err|bad)\(\s*"([^"]{6,140})"\s*(?:,\s*(\d{3}))?\s*\)/g)) {
      if (full()) break;
      const status = Number(m[2] || 400), s = m[1];
      await add("W", rel, `"${s.slice(0, 70)}" travels with a status that matches what it promises (${status})`, "static: 'try again' only with a 5xx; 'refresh', 'already', 'isn't', 'no longer' only with a 4xx", () => {
        // "Restart it and try again" asks the person to change something first — a 4xx. A bare
        // "please try again" promises a retry can work — a 5xx.
        if (/please try again/i.test(s)) return { ok: status >= 500, note: String(status) };
        if (/refresh|already|isn't|no longer|not found|invalid|required|can't|must/i.test(s)) return { ok: status >= 400 && status < 500, note: String(status) };
        return { ok: status >= 400, note: String(status) };
      });
    }
    for (const m of src.matchAll(/NextResponse\.json\(\s*\{\s*error:\s*"([^"]{6,140})"\s*\}\s*,\s*\{\s*status:\s*(\d{3})\s*\}/g)) {
      if (full()) break;
      const status = Number(m[2]), s = m[1];
      await add("W", rel, `"${s.slice(0, 70)}" travels with a status that matches what it promises (${status})`, "static", () => {
        if (/please try again/i.test(s)) return { ok: status >= 500, note: String(status) };
        return { ok: status >= 400, note: String(status) };
      });
    }
  }
} catch (e) {
  console.error("run stopped:", e?.message || e);
  if (!full()) await add("Z", null, "the run completed", "the harness itself", () => ({ ok: false, note: String(e?.message || e) }));
} finally {
  await cleanup();
}
console.log(`\nT28 round 2: ${pass} passed · ${fail} failed · ${skip} skipped · ${rows.length} checks (${rows[0]?.id}–${rows[rows.length - 1]?.id})`);
if (process.argv.includes("--md")) for (const r of rows) console.log(`| ${r.id} | ${r.block} · ${r.what} | ${r.how} | ${r.mark} | ${r.note} |`);
process.exit(fail ? 1 : 0);
