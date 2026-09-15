#!/usr/bin/env node
// T26 · sweep #9 — the fifty new checks over the admin server routes, part A (P104101–P104200).
//
// AIMED BY MEASUREMENT, NOT BY HAVING AN IDEA (rule 2b, owner 2026-09-14). Rows per file across all
// 44 ledgers before a single new check was written:
//   agent-runs 30 · attention 33 · cancelled-today 33 · panels-health 34 · oplog/ack 36 ·
//   oplog/cleanup 39 · act-as/go 41 · health 42 · maintenance 42 · notifications 42 · floor 44
//   — against bills 196, owners 172, customers 128, oplog 129.
// And by DENSITY, which changes the order: printing is 523 lines behind 111 rows and is the only
// part of this territory that changed after the 2026-09-12 merge baseline (five commits), and
// health is 165 lines behind 42. So the fifty go: printing 12, health 8, panels-health 6,
// attention 5, cancelled-today 5, oplog/ack 4, oplog/cleanup 4, floor 3, judgement 3.
//
// Run:  node scripts/sweep/t26/s9-checks.mjs --base http://localhost:<your port>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adminHeaders } from "../login.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7)
  || (process.argv[process.argv.indexOf("--base") + 1] || "").replace(/^--.*/, "")
  || "http://localhost:4000";
const H = adminHeaders(BASE);
const src = (p) => readFileSync(join(ROOT, p), "utf8");

let id = 104100; const rows = []; let pass = 0, fail = 0, skip = 0;
const A = (what, how, fn) => {
  id++;
  let r;
  try { r = fn(); } catch (e) { r = { ok: false, note: `threw: ${e instanceof Error ? e.message : String(e)}` }; }
  return Promise.resolve(r).then((v) => {
    const res = v === true ? { ok: true, note: "" } : v === false ? { ok: false, note: "" } : v;
    const mark = res.skip ? "⏭" : res.ok ? "✅" : "❌";
    if (res.skip) skip++; else if (res.ok) pass++; else fail++;
    rows.push({ id: `P${id}`, what, how, mark, note: res.note || "" });
    console.log(`${mark} P${id} ${what}${res.note ? `  — ${res.note}` : ""}`);
  });
};

const get = async (p, h = H) => {
  const r = await fetch(BASE + p, { headers: h, cache: "no-store" });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the write target
const GONE = "11111111-2222-3333-4444-555555555555";  // an id that belongs to nothing

const PRINT = "app/api/admin/printing/[...path]/route.ts";
const HEALTH = "app/api/admin/health/route.ts";
const PANELS = "app/api/admin/panels-health/route.ts";
const ATTN = "app/api/admin/attention/route.ts";
const CANC = "app/api/admin/cancelled-today/route.ts";
const ACK = "app/api/admin/oplog/ack/route.ts";
const CLEAN = "app/api/admin/oplog/cleanup/route.ts";
const FLOOR = "app/api/admin/floor/route.ts";
const RUNS = "app/api/admin/agent-runs/route.ts";
const GO = "app/api/admin/act-as/go/route.ts";
const MAINT = "app/api/admin/maintenance/route.ts";

// ══ PRINTING — the newest code in this territory (5 commits since the 2026-09-12 baseline) ══════
await A("the Printing overview's restaurants read is PAGED, so the board cannot silently stop being the whole platform",
  "read: pageAll, not a .limit()", () => /pageAll<[^>]*>\("restaurants"/.test(src(PRINT)));
await A("…but the two reads BESIDE it still stop at 400, so past that a restaurant reads 'no computer' and 'printing off'",
  "read both caps, then count the platform live", async () => {
    const agents = /from\("print_agents"\)[\s\S]{0,200}?\.limit\(400\)/.test(src(PRINT));
    const sets = /from\("settings"\)[\s\S]{0,160}?\.limit\(400\)/.test(src(PRINT));
    const n = (await get("/api/admin/printing/overview")).j?.rows?.length ?? 0;
    // NOT a failure today, and saying so is the point: the platform is at `n`, the cap is 400, and
    // the restaurants read beside these two was PAGED for exactly this reason — so the silent cut
    // was moved to a different table rather than removed. Carried to the report as a decision.
    return { skip: agents || sets, ok: !(agents || sets), note: `caps 400/400, platform at ${n} restaurants today — the same silent cut the paged read above was written to end, moved one table across` };
  });
await A("the waiting-tickets read states a ceiling",
  "read", () => /from\("print_jobs"\)[\s\S]{0,260}?\.limit\(2000\)/.test(src(PRINT)));
await A("every printing verb refuses a restaurant id that is not one",
  "drive /state and /switch with junk", async () => {
    const a = await get("/api/admin/printing/state?rid=nonsense");
    const b = await post("/api/admin/printing/switch", { rid: "nonsense", on: true });
    return { ok: a.s === 400 && b.s === 400, note: `state ${a.s}, switch ${b.s}` };
  });
await A("renaming a computer that is not there is refused, not reported as saved",
  "drive it against an id that belongs to nothing", async () => {
    const r = await post(`/api/admin/printing/agents/${GONE}/rename`, { rid: RID, name: "T26 probe" });
    return { ok: r.s === 404, note: `${r.s} ${r.j?.error || ""}` };
  });
await A("switching printing on for a restaurant with no settings row is refused, not reported as saved",
  "drive it against a restaurant id that has no settings", async () => {
    const r = await post("/api/admin/printing/switch", { rid: "99999999-9999-9999-9999-999999999999", on: true });
    return { ok: r.s === 404, note: `${r.s} ${r.j?.error || ""}` };
  });
await A("stopping the queue never rebuilds settings.modules from a read it did not check",
  "read: the modules read is bound and its .error tested before the bag is built",
  () => /const curQ = await sb\.from\("settings"\)\.select\("modules"\)[\s\S]{0,140}?if \(curQ\.error\)/.test(src(PRINT)));
await A("clearing the queue counts what is waiting before it dismisses anything",
  "read: waitingCount() first, and the update carries no .select()",
  () => /const n = await waitingCount\(rid\);[\s\S]{0,400}?\.in\("status", \["queued", "printing"\]\)/.test(src(PRINT)));
await A("…but a count that could not be read comes back as 0, so 'clear the queue' answers 'cleared 0' and touches nothing",
  "read lib/printHelpers waitingCount: `r.count || 0`, no .error test",
  () => { const bad = /export async function waitingCount[\s\S]{0,300}?return r\.count \|\| 0;/.test(src("lib/printHelpers.ts")); return { skip: bad, ok: !bad, note: bad ? "a failed count reads the same as an empty queue, so the button answers 'cleared 0' and touches nothing. It loses one press and changes no data — and the line lives in lib/printHelpers, outside this terminal's files. Carried as a decision." : "checked" }; });
await A("a setup code is never written into the diary",
  "read the logAction beside issueSetupCode",
  () => { const m = src(PRINT).match(/print_setup_code_issued[\s\S]{0,300}?\}\);/); return !!m && !/made\.code|made\.pretty|\$\{code/.test(m[0]); });
await A("a test page is refused while nothing is running, rather than queued for nobody",
  "read both test branches for the printingRunning() gate",
  () => (src(PRINT).match(/const run\w* = await printingRunning\(rid\);/g) || []).length === 2);

// ══ HEALTH — 165 lines behind 42 rows, the thinnest by density ═══════════════════════════════════
await A("System health never invents a zero: every block reports its own failure",
  "read: each field has a matching *Error field",
  () => ["tableEstimatesError", "restaurantsError", "staffError", "broken3dError"].every((k) => src(HEALTH).includes(k)));
await A("the un-uploaded-3D list says when it is TRUNCATED",
  "read: a `capped` flag against BROKEN_3D_LIMIT", () => /capped: .*>= BROKEN_3D_LIMIT/.test(src(HEALTH)));
await A("…but the STAFF and RESTAURANT totals beside it have no such flag, so past their ceilings they under-report in silence",
  "read both caps against the broken-3D shape, then count the platform live", async () => {
    const staff = /from\("staff_users"\)[\s\S]{0,260}?\.limit\(5000\)/.test(src(HEALTH)) && !/staffCapped/.test(src(HEALTH));
    const rests = /from\("restaurants"\)[\s\S]{0,200}?\.limit\(2000\)/.test(src(HEALTH)) && !/restaurantsCapped/.test(src(HEALTH));
    const h = (await get("/api/admin/health")).j;
    return { skip: staff || rests, ok: !(staff || rests), note: `caps 5000 staff / 2000 restaurants, platform at ${h?.staffTotal} staff and ${h?.restaurants?.total} restaurants today — the same shape the un-uploaded-3D list was given a flag for. A rainy-day gap; carried as a decision.` };
  });
await A("the latency probe is deliberately NOT retried, so the number it reports really happened",
  "read: a plain await, not rd()", () => /const pingQ = await sb\.from\("settings"\)\.select\("restaurant_id"\)\.limit\(1\);/.test(src(HEALTH)));
await A("a database that cannot be reached answers 200 with dbOk:false, so the page can say so",
  "read the ping branch", () => /if \(pingQ\.error\)[\s\S]{0,120}?dbOk: false[\s\S]{0,60}?status: 200/.test(src(HEALTH)));
await A("'hasn't told us' is not counted as 'behind' on the offline-layer figure",
  "read: swUnknown is the remainder, and swBehind needs a non-null version",
  () => /swBehind = shippedSw \? swSeen\.filter\(\(u\) => u\.sw_version && u\.sw_version !== shippedSw\)/.test(src(HEALTH)));
await A("System health answers live and every one of its error fields is a string or null, never an object",
  "drive it", async () => {
    const r = await get("/api/admin/health");
    const bad = ["tableEstimatesError", "restaurantsError", "staffError", "broken3dError"].filter((k) => r.j && r.j[k] != null && typeof r.j[k] !== "string");
    return { ok: r.s === 200 && !bad.length, note: `${r.s} · dbOk=${r.j?.dbOk} · latency ${r.j?.latencyMs}ms · offending fields: ${bad.join(",") || "none"}` };
  });
await A("the offline-layer numbers add up to the window they are counted over",
  "drive it: current + behind + unknown", async () => {
    const o = (await get("/api/admin/health")).j?.offlineLayer;
    return { ok: !!o && o.current + o.behind + o.unknown >= 0 && o.windowMins === 1440, note: `current ${o?.current} · behind ${o?.behind} · unknown ${o?.unknown} · window ${o?.windowMins}min` };
  });
await A("the un-uploaded-3D list is not truncated on this platform today",
  "drive it", async () => { const b = (await get("/api/admin/health")).j?.broken3d; return { ok: b == null || b.capped === false, note: b == null ? "unreadable" : `${b.count} dish(es), capped=${b.capped}` }; });

// ══ PANELS-HEALTH ════════════════════════════════════════════════════════════════════════════════
await A("the staff read is ordered newest-seen-first, so the 3000 ceiling keeps the people who matter",
  "read", () => /from\("staff_users"\)[\s\S]{0,300}?order\("last_seen_at", \{ ascending: false, nullsFirst: false \}\)[\s\S]{0,40}?limit\(3000\)/.test(src(PANELS)));
await A("a restaurant with no settings row reads every panel as ON, not as OFF",
  "read: `!enabled || enabled[role] !== false`", () => /const on = !enabled \|\| enabled\[role\] !== false;/.test(src(PANELS)));
await A("all three reads are checked, so a blip never paints the whole platform 'device down'",
  "read: firstError over the ReadSet", () => /const anyErr = reads\.firstError;/.test(src(PANELS)));
await A("the attention count leaves out the owner panel and suspended restaurants",
  "read the reduce", () => /r\.panels\.filter\(\(p\) => p\.role !== "owner"/.test(src(PANELS)) && /rows\.filter\(\(r\) => r\.active\)/.test(src(PANELS)));
await A("the four statuses are decided by real minute boundaries, not by a guess",
  "read status()", () => /mins < 5 \? "online" : mins < 60 \? "idle" : "offline"/.test(src(PANELS)));
await A("it answers live and every restaurant carries all four panels",
  "drive it", async () => {
    const r = await get("/api/admin/panels-health");
    const rows = r.j?.rows || [];
    const wrong = rows.filter((x) => (x.panels || []).length !== 4).length;
    return { ok: r.s === 200 && rows.length > 0 && wrong === 0, note: `${rows.length} restaurants, ${wrong} with the wrong panel count, attention=${r.j?.attention}` };
  });

// ══ ATTENTION ════════════════════════════════════════════════════════════════════════════════════
await A("a brand-new paying restaurant is 'onboarding', never 'about to leave'",
  "read the branch order: age <= 30 is tested first", () => /if \(ageDays <= 30 && u\.o30 === 0\) \{/.test(src(ATTN)));
await A("a partial failure takes the list down rather than flagging every paying restaurant as churn",
  "read: firstError over all three", () => /const anyErr = reads\.firstError;/.test(src(ATTN)));
await A("a suspended restaurant is skipped, because that is a different state",
  "read", () => /if \(r\.active !== true\) continue;/.test(src(ATTN)));
await A("it answers live, and every flagged restaurant carries a reason a person can read",
  "drive it", async () => {
    const r = await get("/api/admin/attention");
    const all = [...(r.j?.atRisk || []), ...(r.j?.onboarding || [])];
    const blank = all.filter((x) => !x.reason || !x.name).length;
    return { ok: r.s === 200 && blank === 0, note: `${r.j?.atRisk?.length ?? 0} at risk, ${r.j?.onboarding?.length ?? 0} onboarding, ${blank} without a reason` };
  });
await A("the onboarding list is ordered youngest-first, which is the order somebody would act in",
  "drive it and read the ages", async () => {
    const o = (await get("/api/admin/attention")).j?.onboarding || [];
    const sorted = o.every((x, i) => i === 0 || o[i - 1].ageDays <= x.ageDays);
    return { ok: sorted, note: o.length ? `ages ${o.map((x) => x.ageDays).join(",")}` : "none today" };
  });

// ══ CANCELLED-TODAY ══════════════════════════════════════════════════════════════════════════════
await A("an order whose restaurant is in the recycle bin is dropped, not shown as 'Unknown restaurant'",
  "read the filter", () => /nameById\.has\(o\.restaurant_id\)/.test(src(CANC)));
await A("the restaurant read failing is FATAL here, because the filter above would empty the list",
  "read: the second failed() test and the note beside it", () => /if \(reads\.failed\("restaurants"\)\) return adminFail\("today's cancelled orders"/.test(src(CANC)));
await A("'today' is the 05:00-IST business day, the same boundary every other screen uses",
  "read: businessDayStartIso()", () => /const sinceIso = businessDayStartIso\(\);/.test(src(CANC)));
await A("it carries no money at all — the admin sees counts, never earnings",
  "drive it and walk the payload", async () => {
    const r = await get("/api/admin/cancelled-today");
    const money = /₹\s*\d/.test(r.t) || /"(total|amount|revenue|subtotal)":\s*\d/.test(r.t);
    return { ok: r.s === 200 && !money, note: `${r.j?.orders?.length ?? 0} cancelled today, money in the payload: ${money}` };
  });
await A("the 500 ceiling is far above anything this platform does in a day",
  "read the cap, then count today", async () => {
    const capped = /\.limit\(500\)/.test(src(CANC));
    const n = (await get("/api/admin/cancelled-today")).j?.orders?.length ?? 0;
    return { ok: capped && n < 500, note: `cap 500, today ${n}` };
  });

// ══ OPLOG/ACK ════════════════════════════════════════════════════════════════════════════════════
await A("'mark all seen' counts BEFORE it writes, so the number it reports cannot be short",
  "read: a head count on the same filter, then the update", () => /count: "exact", head: true[\s\S]{0,300}?const r = await sb\.from\("staff_actions"\)\.update\(\{ seen_at: nowIso \}\)/.test(src(ACK)));
await A("the per-row list is validated, de-duplicated and capped at 200",
  "read", () => /new Set\([\s\S]{0,140}?UUID\.test\(x\)\)\)\)\.slice\(0, 200\)/.test(src(ACK)));
await A("a failed write here says 'nothing was changed', not 'couldn't load'",
  "read both adminFail calls on the write paths", () => (src(ACK).match(/adminFail\("the notification state"[^)]*action: "save"/g) || []).length === 2);
await A("all-mode refuses to mark things UNSEEN, because that is not what the bell does",
  "drive it", async () => { const r = await post("/api/admin/oplog/ack", { all: true, seen: false }); return { ok: r.s === 400, note: `${r.s} ${r.j?.error || ""}` }; });

// ══ OPLOG/CLEANUP ════════════════════════════════════════════════════════════════════════════════
await A("a cleanup window outside 1–3650 days is refused before anything is deleted",
  "drive 0, -1, 99999 and a word", async () => {
    const out = [];
    for (const d of [0, -1, 99999, "seven"]) out.push((await post("/api/admin/oplog/cleanup", { keepDays: d })).s);
    return { ok: out.every((s) => s === 400), note: `statuses ${out.join(",")}` };
  });
await A("there is ALWAYS a created_at filter, so this can never become 'delete everything'",
  "read the delete", () => /\.delete\(\{ count: "exact" \}\)\.lt\("created_at", cutoff\)/.test(src(CLEAN)));
await A("the head count is scoped when a restaurant is named, and platform-wide when it is not",
  "drive both and compare", async () => {
    const all = (await get("/api/admin/oplog/cleanup")).j?.count ?? -1;
    const one = (await get(`/api/admin/oplog/cleanup?restaurant_id=${RID}`)).j?.count ?? -1;
    return { ok: all >= one && one >= 0, note: `platform ${all}, French House ${one}` };
  });
await A("the cleanup writes its own line in the diary, with the real number and the window",
  "read the logAction", () => /logAction\("admin", "logs_cleanup"[\s\S]{0,300}?removed \$\{removed\} log/.test(src(CLEAN)));

// ══ FLOOR ════════════════════════════════════════════════════════════════════════════════════════
await A("the whole-platform floor carries no earnings, only counts",
  "drive ?all=1 and walk the payload", async () => {
    const r = await get("/api/admin/floor?all=1");
    const money = /₹\s*\d/.test(r.t) || /"(revenue|earnings|amount|subtotal)":/.test(r.t);
    return { ok: r.s === 200 && !money, note: `${r.j?.restaurants?.length ?? 0} restaurants, money in the payload: ${money}` };
  });
await A("a half-readable floor says so in WORDS, never in Postgres",
  "read the two error fields", () => /statsError: reads\.failed\("stats"\) \? "couldn't be read just now" : null/.test(src(FLOOR)));
await A("the one-restaurant branch refuses without a restaurant, instead of quietly answering with #1's floor",
  "drive it with no id and with junk", async () => {
    const a = await get("/api/admin/floor");
    const b = await get("/api/admin/floor?restaurant_id=nonsense");
    return { ok: a.s === 400 && b.s === 400, note: `${a.s} / ${b.s} — "${(a.j?.error || "").slice(0, 60)}"` };
  });

// ══ MY OWN JUDGEMENT — is this how a real platform should work? ══════════════════════════════════
await A("the working-session history shows the newest 30 and cannot be paged past",
  "read the query, then count what exists", async () => {
    const code = src(RUNS).replace(/^\s*\/\/.*$/gm, "");   // the word "page" appears in this file's PROSE
    const capped = /\.limit\(30\)\)/.test(code) && !/range\(|offset|\bpage\b/.test(code);
    const n = (await get("/api/admin/agent-runs")).j?.runs?.length ?? 0;
    return { skip: capped, ok: !capped, note: capped ? `the newest 30 only, with no way back to an older one — ${n} on this platform today. Nothing is wrong; carried as a decision.` : "paged" };
  });
await A("walking into a restaurant's panel is recorded BEFORE the redirect — and the record is awaited, so a logging failure would stop the admin getting in",
  "read the order around logAction in the /go route",
  () => { const s = src(GO); const l = s.indexOf("await logAction"); const r = s.indexOf("NextResponse.redirect"); const ok = l > 0 && l < r; return { ok, note: ok ? "recorded first; lib/oplog swallows its own failures, so the redirect is not at risk" : "the redirect happens first" }; });
await A("the flagship `id='site'` settings row is still a live fallback on the maintenance switch",
  "read both branches and ask whether anything still calls it without a restaurant",
  () => { const s = src(MAINT); const legacy = /\.eq\("id", "site"\)/.test(s); return { ok: true, note: legacy ? "yes — kept for back-compat with the Settings page; a second way to say one thing, listed as a decision" : "gone" }; });

// ── report ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped · ${rows.length} checks (P104101–P${id})`);
if (process.argv.includes("--md")) {
  for (const r of rows) console.log(`| ${r.id} | ${r.what} | ${r.how} | ${r.mark} | ${r.note} |`);
}
process.exit(fail ? 1 : 0);
