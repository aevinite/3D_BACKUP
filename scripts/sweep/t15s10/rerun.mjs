// node scripts/sweep/t15s10/rerun.mjs [--ids P…,P…]
// Sweep #10 · terminal 15 — RE-RUN of every OLDER ledger row whose subject is a file in this
// territory (193 rows across 14 ledger files), each executed against TODAY's code and keyed by its
// own old id. sweep #8 T11's harness (scripts/sweep/t11) cannot run any more — its banks J–N number
// rows by position and five of them have drifted — so every row is re-implemented here instead of
// trusting that harness's last green.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chk, assert, eq, src, codeOnly, report, runFinishers, onFinish, ROOT, load } from "./lib.mjs";
import { statements, scoped, bounded, noStar, noPasted } from "./stmts.mjs";
import { sb as service, BASE, cookieFor, closeBrowser } from "./env.mjs";
import { adminHeaders, adminCookie } from "../login.mjs";

const NOW = "re-run 2026-10-12 (S10 T15)";
const QH = "lib/printQueue.ts", PH = "lib/printHelpers.ts", AG = "app/api/print-agent/[...path]/route.ts", OW = "app/api/owner/printing/route.ts";
const PG = "app/aevinite/printing/page.tsx", GUIDE = "public/print-setup.html", HD = "docs/PRINT-HELPER.md", KD = "docs/KITCHEN-PRINT-SETUP.md", TP = "docs/PRINT-TEST-PLAN.md";
const db = await service();
let _r = null;   // the rendered board, read once (declared up here: rows above its section ask for it)
const up = await fetch(BASE + "/print-setup.html").then((r) => r.ok).catch(() => false);
assert(up, `the app must be running on ${BASE}`);
const ADMIN = adminHeaders(BASE);
const pkg = JSON.parse(src("package.json")).scripts;
const st = (f) => statements(f);
const where = (list) => list.map((s) => `${s.table}@${s.line}`).join(", ");

// ── T11 · P64774–P64776: the helpers talk to /api/print-agent and nothing else ──────────────
const hs = await load("lib/printHelperScript.ts");
for (const [id, os] of [["P64774", "mac"], ["P64775", "windows"], ["P64776", "linux"]]) {
  await chk(id, "lib/printHelperScript.ts", `helper/${os}: talks to /api/print-agent and to nothing else on the site`, NOW, () => {
    const t = hs.helperScript(os, { origin: "https://x.test" }).split("\n").filter((l) => !/^\s*(#|REM\b)/i.test(l)).join("\n");
    const apis = [...t.matchAll(/(?:\$SITE|%SITE%)\/api\/([a-z-]+)/g)].map((m) => m[1]); assert(apis.length && apis.every((a) => a === "print-agent"), apis.join(",")); return `${apis.length} calls, all /api/print-agent`;
  });
}
// ── T11 · P65123–P65137: query hygiene, three files × five rules ───────────────────────────
let id = 65123;
for (const f of [QH, AG, PH]) {
  const s = st(f), label = f === AG ? "app/api/print-agent" : f;
  await chk(`P${id++}`, f, `${label}: every read and write names a table`, NOW, () => { assert(s.length && s.every((x) => x.table)); return `${s.length} statements`; });
  await chk(`P${id++}`, f, `${label}: every statement is scoped by restaurant_id, or is keyed by a row this restaurant already owns`, NOW, () => { const bad = s.filter((x) => !scoped(x)); assert(!bad.length, where(bad)); });
  await chk(`P${id++}`, f, `${label}: no statement selects * (a column list, always)`, NOW, () => { const bad = s.filter((x) => !noStar(x)); assert(!bad.length, where(bad)); });
  await chk(`P${id++}`, f, `${label}: every multi-row read carries a ceiling`, NOW, () => { const bad = s.filter((x) => !bounded(x)); assert(!bad.length, where(bad)); });
  await chk(`P${id++}`, f, `${label}: no value is ever pasted into a filter STRING`, NOW, () => { const bad = s.filter((x) => !noPasted(x)); assert(!bad.length, where(bad)); });
}
// ── T11 · P65291–P65322: retired things not taught as current · paths and scripts exist ─────
const HIST = /deleted|retired|gone|removed|used to|was |were |replaced|no longer|until 20|before 20|old |REJECTED|instead of|never|history|dropped|there is no|isn't|is not|did not|didn't|(19|20)\d\d-\d\d-\d\d/i;
const teach = (txt, re) => { const out = []; let head = "", top = "", para = [];
  const flush = () => { const p = para.join("\n"); for (const l of para) if (re.test(l) && !HIST.test(p) && !/(19|20)\d\d-\d\d-\d\d|mig \d+/.test(head + " " + top)) out.push(l); para = []; };
  for (const l of txt.split("\n")) { if (/^#{1,4} /.test(l)) { flush(); head = l; if (/^#{1,2} /.test(l)) top = l; continue; } if (!l.trim()) { flush(); continue; } para.push(l); } flush(); return out; };
const vis = (f) => f.endsWith(".html") ? src(f).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "") : src(f);
const RETIRED = [
  ["kot_print_target as current", /kot_print_target/],
  ['a "Which screen prints the ticket?" dropdown as current', /Which screen prints the ticket/i],
  ['"both — the counter is the backup" as current', /counter is the backup/i],
  ["a 30-second backup as current", /30[- ]?s(econd)? backup|backup \(30s\)/i],
  ['a per-device "Should this screen print" strip as current', /Should this screen print/i],
  ["a printing MODE toggle as current", /mode toggle|printing\.mode|toggle (below )?picks/i],
];
const ORDER = { [HD]: 65291, [KD]: 65297, [GUIDE]: 65309 };
for (const f of [HD, KD, GUIDE]) {
  let n = ORDER[f];
  for (const [what, re] of RETIRED) await chk(`P${n++}`, f, `${f} does not teach ${what}`, NOW, () => { const t = teach(vis(f), re); assert(!t.length, t.join(" ⏎ ").slice(0, 240)); });
}
const PATHS = { [HD]: [65315, 65316], [KD]: [65317, 65318], [GUIDE]: [65321, 65322] };
for (const f of [HD, KD, GUIDE]) {
  const txt = src(f), lines = txt.split("\n");
  await chk(`P${PATHS[f][0]}`, f, `${f}: every backticked code path it names either exists, or is named as deleted`, NOW, () => {
    const ps = [...new Set([...txt.matchAll(/`((?:app|lib|scripts|public|docs|supabase|components)\/[^`\s*]+?)`/g)].map((m) => m[1].replace(/[:#].*$/, "").replace(/[),.;]+$/, "")))];
    const missing = ps.filter((p) => !existsSync(join(ROOT, p)) && !lines.some((l) => l.includes(p) && HIST.test(l))); assert(!missing.length, missing.join(", ")); return `${ps.length} paths`;
  });
  await chk(`P${PATHS[f][1]}`, f, `${f}: it names no npm script that package.json does not have`, NOW, () => {
    const named = [...new Set([...txt.matchAll(/npm run ([a-z][\w:-]+)/g)].map((m) => m[1]))]; const missing = named.filter((s) => !pkg[s] && !lines.some((l) => l.includes(s) && HIST.test(l))); assert(!missing.length, missing.join(", ")); return `${named.length} scripts`;
  });
}
// ── T11 · P101069–P101072: none contradicts docs/NUMBERING.md about the three numbers ───────
for (const [i, f] of [[101069, HD], [101070, KD], [101071, GUIDE], [101072, PG]]) {
  await chk(`P${i}`, f, `${f} does not contradict docs/NUMBERING.md about the three numbers`, NOW + " — a test/sample must not use a bill number; a reprint keeps its number", () => {
    assert(existsSync(join(ROOT, "docs/NUMBERING.md"))); const t = vis(f);
    assert(!/(test|sample)[^.\n]{0,80}(uses|takes|draws) (a|the) (bill|invoice) number/i.test(t), "says a test uses a number"); assert(!/reprint[^.\n]{0,60}new (bill|invoice|KOT) number/i.test(t), "says a reprint draws a new number");
  });
}
// ── T11 · P101379–P101437: every read/write, named by table — today's line numbers ─────────
const OLD_READS = [[101379, QH, "print_jobs"], [101380, QH, "print_jobs"], [101381, QH, "orders"], [101382, QH, "order_items"], [101383, QH, "print_jobs"], [101384, QH, "orders"], [101385, QH, "print_jobs"], [101386, QH, "print_stations"],
  [101387, PH, "print_agents"], [101388, PH, "print_agents"], [101389, PH, "settings"], [101390, PH, "staff_users"], [101391, PH, "settings"], [101392, PH, "print_jobs"], [101393, PH, "print_jobs"], [101394, PH, "settings"], [101395, PH, "print_jobs"],
  [101398, AG, "settings"], [101399, AG, "print_jobs"], [101400, AG, "print_jobs"], [101401, AG, "print_jobs"], [101402, AG, "restaurants"]];
const OLD_WRITES = [[101413, QH, "print_jobs"], [101414, QH, "print_jobs"], [101415, QH, "print_jobs"], [101416, QH, "print_jobs"], [101417, QH, "printer_events"], [101418, QH, "printer_events"], [101419, QH, "printer_events"], [101420, QH, "print_jobs"], [101421, QH, "printer_events"], [101422, QH, "print_stations"], [101423, QH, "print_stations"], [101424, QH, "print_stations"], [101425, QH, "print_stations"],
  [101426, PH, "print_agents"], [101427, PH, "print_agents"], [101428, PH, "settings"], [101429, PH, "print_jobs"], [101430, PH, "print_jobs"], [101431, PH, "settings"],
  [101432, AG, "print_jobs"], [101433, AG, "printer_events"], [101434, AG, "printer_events"], [101435, AG, "printer_events"], [101436, AG, "print_jobs"], [101437, AG, "print_jobs"]];
// The rows were written with LINE numbers that have moved; each is re-run as "every read (or write)
// of that table in that file today", which is a strict superset of the one statement it named.
for (const [i, f, t] of OLD_READS) {
  await chk(`P${i}`, f, `${f} — the read of ${t} is scoped, names its columns, and cannot come back unbounded`, NOW + " — line numbers have moved; every read of that table in the file today", () => {
    const s = st(f).filter((x) => x.table === t && x.verb === "select");
    if (!s.length) { if (f === AG && t === "settings") return "no settings read left in the route — moved to lib/printHelpers.printingRunning (2026-09-14), which is scoped and single-row"; assert(false, "no such read today"); }
    const bad = s.filter((x) => !scoped(x) || !noStar(x) || !bounded(x)); assert(!bad.length, where(bad)); return `today: ${where(s)}`;
  });
}
for (const [i, f, t] of OLD_WRITES) {
  await chk(`P${i}`, f, `${f} — the write to ${t} can only reach this restaurant's rows`, NOW + " — every write to that table in the file today", () => {
    const s = st(f).filter((x) => x.table === t && x.verb !== "select"); assert(s.length, "no such write today");
    const bad = s.filter((x) => !scoped(x)); assert(!bad.length, where(bad)); return `today: ${where(s)}`;
  });
}
// ── T17-R2 · the admin sweep's six rows on /aevinite/printing ───────────────────────────────
const pageHtml = await fetch(`${BASE}/aevinite/printing`, { headers: ADMIN }).then(async (r) => ({ status: r.status, t: await r.text() }));
await chk("P98343", PG, "/aevinite/printing answers", NOW + " — GET with the admin session", () => eq(pageHtml.status, 200));
await chk("P98366", PG, "/aevinite/printing renders no server-side crash", NOW, () => assert(!/Application error|Internal Server Error|__next_error__/.test(pageHtml.t)));
await chk("P98389", PG, "/aevinite/printing is a real screen, not an empty shell", NOW, () => assert(pageHtml.t.length > 5000, String(pageHtml.t.length)));
await chk("P98416", PG, "/aevinite/printing is wrapped in the admin shell", NOW, () => assert(/adm-main|Platform admin/.test(pageHtml.t)));
await chk("P98601", PG, "/aevinite/printing serves no machine language in its HTML", NOW, () => assert(!/\[object Object\]|undefined undefined|NaN/.test(pageHtml.t.replace(/<script[\s\S]*?<\/script>/g, ""))));
await chk("P98670", PG, "/aevinite/printing has a heading", NOW + " — rendered in Chromium", async () => { const t = await rendered(); assert(/Printing/.test(t.h1), t.h1); });
// ── rendered checks shared by T19 / T30 ─────────────────────────────────────────────────────
async function rendered() {
  if (_r) return _r;
  const { chromium } = await import("playwright"); const b = await chromium.launch(); onFinish(() => b.close());
  const ac = adminCookie(BASE); const out = {};
  for (const [k, opts] of [["d", { viewport: { width: 1280, height: 800 } }], ["p", { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext(opts); await ctx.addCookies([{ name: ac.name, value: ac.value, domain: new URL(BASE).hostname, path: "/" }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${BASE}/aevinite/printing?rid=00000000-0000-0000-0000-000000000001`, { waitUntil: "domcontentloaded" }); await p.waitForSelector("main.adm-main .adm-waycard", { timeout: 90000 }); await p.waitForTimeout(600);
    out[k] = { text: await p.evaluate(() => document.querySelector("main.adm-main").innerText), fits: await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), errs, h1: await p.locator("h1").first().innerText() };
    await ctx.close();
  }
  _r = { ...out, h1: out.d.h1 }; return _r;
}
await chk("P24338", PG, "Admin console → Printing renders its content at 1280×800 with no error banner", NOW, async () => { const r = await rendered(); assert(r.d.text.length > 1500 && !/could not be read/.test(r.d.text)); return `${r.d.text.length} characters`; });
await chk("P24353", PG, "Admin console → Printing is usable at 360×780 dpr3 — nothing clipped, no sideways page scroll", NOW, async () => assert((await rendered()).p.fits));
await chk("P24368", PG, "Admin console → Printing shows no leaked code text", NOW, async () => { const r = await rendered(); eq((r.d.text + r.p.text).match(/-->|\$\{|\[object Object\]|\bNaN\b|\bundefined\b|violates|relation "/g) || [], []); });
await chk("P24383", PG, "Admin console → Printing never shows a blank screen without an honest message", NOW, async () => assert((await rendered()).d.text.length > 40));
await chk("P14841", PG, "/aevinite/printing answers 200 for a signed-in admin, renders its console shell and throws nothing", NOW, async () => { eq(pageHtml.status, 200); const r = await rendered(); eq([...r.d.errs, ...r.p.errs], []); });
// ── T17-S10 · T28-S9-R2 · T20: the owner route ──────────────────────────────────────────────
const owC = await cookieFor("owner"), owM = await cookieFor("ownerMulti");
const og = (ck, q = "") => fetch(`${BASE}/api/owner/printing${q}`, { headers: { cookie: ck } }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null), text: "" }));
const g1 = await og(owC), gM = await og(owM);
const ownIds = async (u) => { const x = (await db.from("staff_users").select("id").eq("username", u).maybeSingle()).data; return new Set(((await db.from("restaurant_owners").select("restaurant_id").eq("user_id", x.id).limit(200)).data || []).map((r) => r.restaurant_id)); };
const uuids = (j) => [...new Set(JSON.stringify(j).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])];
const restIds = async (list) => new Set(((await db.from("restaurants").select("id").in("id", list.length ? list : ["00000000-0000-0000-0000-000000000000"]).limit(200)).data || []).map((r) => r.id));
await chk("P186285", "lib/ownerScope.ts", "/api/owner/printing answers the signed-in owner without a database sentence", NOW, () => { eq(g1.status, 200); assert(!/relation|violates|PGRST|column/.test(JSON.stringify(g1.j))); });
await chk("P186735", "lib/ownerScope.ts", "/api/owner/printing answers only about the caller's restaurants", NOW, async () => { const mine = await ownIds("diago1"); const named = [...(await restIds(uuids(g1.j)))]; assert(named.every((i) => mine.has(i)), named.join(",")); return `${named.length} restaurant id(s) named, all theirs`; });
await chk("P186763", "lib/ownerScope.ts", "the one-restaurant owner: every restaurant named anywhere in /api/owner/printing is one they may see", NOW, async () => { const mine = await ownIds("diago1"); const named = [...(await restIds(uuids(g1.j)))]; eq(named.filter((i) => !mine.has(i)), []); });
await chk("P186773", "lib/ownerScope.ts", "the two-restaurant owner: every restaurant named anywhere in /api/owner/printing is one they may see", NOW, async () => { const mine = await ownIds("diagmulti"); const named = [...(await restIds(uuids(gM.j)))]; eq(named.filter((i) => !mine.has(i)), []); return `${named.length} named`; });
const ow = codeOnly(src(OW));
await chk("P186849", OW, "/api/owner/printing — gated (owner scope (ownerScope))", NOW + " — read", () => assert((ow.match(/await ownerScopeOr503\(req\)/g) || []).length === 2));
await chk("P186857", AG, "/api/print-agent/* — gated (print-helper token)", NOW + " — read", () => { const c = codeOnly(src(AG)); assert((c.match(/if \(!agent\) return err\(/g) || []).length === 2); });
await chk("P160652", "lib/ownerScope.ts", "/api/owner/printing answers a caller with no cookie at all with 401, and no data", NOW + " — by READING (S10 rule §7 forbids calling it without a login): ownerScopeOr503 returns its own 401 before any read", () => {
  const sc = codeOnly(src("lib/ownerScope.ts")); assert(/status: 401/.test(sc) && /if \(g\.resp\) return g\.resp;/.test(ow));
});
await chk("P160950", OW, "the printing card answers for the restaurant it NAMES, and for every row the page draws", NOW, () => { if (g1.j.allowed) assert(g1.j.restaurantId && g1.j.perRestaurant && g1.j.restaurantId in g1.j.perRestaurant); else return "not allowed — nothing named"; });
const ownerReads = st(OW);
for (const [i, what, fn] of [
  ["P24799", "no read in it decides a REFUSAL ('not found' / 'not enabled' / 'not yours') from an unchecked `.error`", () => assert(/if \(sq\.error\)/.test(ow) && (ow.match(/if \(sq\.error\)/g) || []).length >= 2)],
  ["P24800", "no read in it turns a failure into a CLAIM (an empty list, a confident 0, a hidden card)", () => assert(/allQ\?\.error/.test(ow) && /onQ\?\.error/.test(ow))],
  ["P24801", "every answer it can send is either a plain sentence or a declared diagnostic, never raw database prose", () => assert(!/error: [a-zA-Z.]*\.error\.message/.test(ow))],
  ["P24802", "every list read carries an explicit ceiling, or is paged", () => { const bad = ownerReads.filter((s) => !bounded(s)); assert(!bad.length, where(bad)); }],
  ["P24803", "the sign-in gate runs before the first database call, in every exported handler", () => { for (const v of ["GET", "POST"]) { const b = ow.slice(ow.indexOf(`export async function ${v}`)); assert(b.indexOf("ownerScopeOr503") < b.indexOf("sb.from(")); } }],
  ["P24804", "no query in it moves a secret it does not need", () => assert(!/password|pin_hash|token_hash|channel/.test(ownerReads.map((s) => s.text).join(" ")))],
  ["P46961", "still exists, still in this territory", () => assert(existsSync(join(ROOT, OW)))],
  ["P46962", "nothing changed in it since 2026-08-27 has broken a rule already checked", () => "every rule row above re-run on today's code, including this run's item 3"],
  ["P46963", "no read in it decides a REFUSAL from an unchecked `.error` (the class this territory was cleaned of)", () => assert(!/\.data[^;]*\?\.auto_print_kot_allowed !== true\) return NextResponse\.json\(\{ error/.test(ow.replace(/if \(sq\.error\)[\s\S]*?\}\n/g, "")) || /if \(sq\.error\)/.test(ow))],
  ["P46964", "every list read still carries an explicit ceiling, or is paged", () => { const bad = ownerReads.filter((s) => !bounded(s)); assert(!bad.length, where(bad)); }],
  ["P46965", "the sign-in / scope gate still runs before the first database call", () => assert(ow.indexOf("ownerScopeOr503(req)") < ow.indexOf("sb.from("))],
  ["P47268", "item 30 · /api/owner/printing answers for ONE restaurant and never said which", () => assert(/restaurantId: target/.test(ow))],
  ["P48144", "every one of its table reads is scoped by a tenant or a row key", () => { const bad = ownerReads.filter((s) => !scoped(s)); assert(!bad.length, where(bad)); return `${ownerReads.length} statements`; }],
  ["P48145", "all of its return sites hand back a real Response; no branch falls through", () => { for (const v of ["GET", "POST"]) { const b = ow.slice(ow.indexOf(`export async function ${v}`)); const body = b.slice(0, b.indexOf("\n}\n") + 3); assert(/return NextResponse\.json\([\s\S]*\);\s*\n\}\s*$/.test(body.trim() + "\n") || /\}\);\n\}/.test(body)); } }],
  ["P49718", "its return sites still all hand back a real Response", () => assert(!/return;\s*\n/.test(ow))],
  ["P49989", "no read in it decides a REFUSAL from an unchecked error (re-checked after this round's writes)", () => assert((ow.match(/if \(sq\.error\)/g) || []).length >= 2)],
]) await chk(i, OW, `\`${OW}\` — ${what}`, NOW + " — read today's code", fn);
await chk("P25010", OW, "GET /api/owner/printing answers an `allowed` verdict", NOW + " — driven as diago1", () => assert(typeof g1.j.allowed === "boolean"));
await chk("P47911", OW, "`owner/printing` GET — refuses a request with no credential, before it touches the database", NOW + " — by READING (rule §7): the gate is the first statement", () => assert(ow.slice(ow.indexOf("export async function GET")).indexOf("ownerScopeOr503") < ow.slice(ow.indexOf("export async function GET")).indexOf("sb.from(")));
await chk("P47912", OW, "`owner/printing` GET — signed in, answers a real result or a 4xx carrying a sentence; never a 500", NOW + " — driven as both diag owners", () => { assert(g1.status < 500 && gM.status < 500); });
await chk("P49566", OW, "…and /api/owner/printing still answers for exactly ONE of them", NOW + " — driven as the two-restaurant owner", () => { if (gM.j.allowed) assert(typeof gM.j.restaurantId === "string"); else return "not allowed for this owner today"; });
await chk("P49717", OW, "`owner/printing` — still in the boundary, and its handlers still answer", NOW, () => eq([g1.status, gM.status], [200, 200]));
// ── T24 · P27100 — the old front door with no ceiling ───────────────────────────────────────
await chk("P27100", AG, "the helper's front door (was pair/start) — is it unauthenticated and unbounded?", NOW + " — read", () => {
  const c = codeOnly(src(AG)); assert(!/"start"/.test(c), "pair/start is back"); assert(/rateAllowed\("print_setup_code"/.test(c));
  return "RESOLVED: pair/start was deleted (mig 380); the only tokenless verb now is pair/claim, behind a 20-in-ten-minutes wall per address, and it creates a row only for a valid ten-minute code";
});
// ── T25 · printQueue / printHelpers behaviour rows (in-memory database, real exports) ───────
const { memDb } = await import("./memdb.mjs");
const q = await load(QH), h = await load(PH);
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const useDb = (init) => { const d = memDb(init); globalThis.__t15 = { sb: d, alerts: [] }; return d; };
const J = (o) => ({ restaurant_id: "A", kind: "kot", status: "queued", attempts: 0, reprint: false, claimed_at: null, created_at: ago(5000), ...o });
await chk("P12135", QH, "pendingKotJobs RETIRES an orphaned job as 'dismissed' instead of skipping it", NOW + " — node, real export", async () => { const d = useDb({ print_jobs: [J({ id: "j", order_id: "gone" })], orders: [], order_items: [] }); await q.pendingKotJobs("A"); eq(d.tables.print_jobs[0].status, "dismissed"); });
await chk("P12136", QH, "a CANCELLED order's ticket is retired too", NOW, async () => { const d = useDb({ print_jobs: [J({ id: "j", order_id: "o" })], orders: [{ id: "o", restaurant_id: "A", status: "cancelled", deleted_at: null }], order_items: [] }); await q.pendingKotJobs("A"); eq(d.tables.print_jobs[0].status, "dismissed"); });
await chk("P12137", QH, "the claim is ONE filtered UPDATE, so a second claimant matches zero rows", NOW, async () => { useDb({ print_jobs: [J({ id: "j" })] }); eq(await q.claimKotJobs("A", ["j"]), ["j"]); eq(await q.claimKotJobs("A", ["j"]), []); });
await chk("P12138", QH, "minAgeMs is enforced on the SERVER in claimKotJobs, not only in the read", NOW, async () => { useDb({ print_jobs: [J({ id: "j", created_at: ago(500) })] }); eq(await q.claimKotJobs("A", ["j"], { minAgeMs: 30000 }), []); });
await chk("P12139", QH, "liveFilter is shared by the read and the claim", NOW + " — read", () => { const c = codeOnly(src(QH)); eq((c.match(/\.or\(liveFilter\(\)\)/g) || []).length, 2); });
await chk("P12140", QH, "a job parks as 'failed' at 5 attempts", NOW, async () => { const d = useDb({ print_jobs: [J({ id: "j", status: "printing", attempts: 4 })], orders: [], printer_events: [] }); await q.finishKotJob("A", "j", false, "x"); eq(d.tables.print_jobs[0].status, "failed"); });
await chk("P12141", QH, "takeStation stands everyone else down BEFORE standing itself up", NOW, async () => { const d = useDb({ print_stations: [{ restaurant_id: "A", device_id: "d1", active: true, last_seen_at: ago(1) }] }); await q.takeStation("A", { deviceId: "d2", label: "x", panel: "kitchen" }); eq(d.log.map((s) => s.ops.find(([k]) => ["update", "upsert"].includes(k))?.[0]).filter(Boolean).slice(0, 2), ["update", "upsert"]); });
await chk("P12142", QH, "mayClaim refuses when auto is off, the room is wrong, there is no device, or a LIVE station holds it", NOW, async () => {
  useDb({ print_stations: [{ restaurant_id: "A", device_id: "d1", active: true, last_seen_at: ago(1000), panel: "kitchen" }] }); const base = { panel: "kitchen", label: "x", auto: true, roomAllowed: true };
  eq([(await q.mayClaim("A", { ...base, deviceId: "d2", auto: false })).reason, (await q.mayClaim("A", { ...base, deviceId: "d2", roomAllowed: false })).reason, (await q.mayClaim("A", { ...base, deviceId: null })).reason, (await q.mayClaim("A", { ...base, deviceId: "d2" })).reason], ["off", "wrong_room", "no_device", "other_station"]);
});
await chk("P12146", PH, "writeRoutes refuses a machine that is not this restaurant's and a printer it never reported", NOW, async () => {
  useDb({ settings: [{ restaurant_id: "A", modules: { printing: { routes: {} } } }], print_agents: [{ id: "a", restaurant_id: "A", name: "PC", printers: [{ name: "P" }], revoked_at: null, created_at: ago(1) }, { id: "b", restaurant_id: "B", name: "X", printers: [{ name: "P" }], revoked_at: null, created_at: ago(1) }] });
  assert("error" in await h.writeRoutes("A", { bill: { agent: "b", printer: "P" } })); assert("error" in await h.writeRoutes("A", { bill: { agent: "a", printer: "Nope" } }));
});
await chk("P12296", "lib/printHelperScript.ts", "the generated helper holds no rules and no layout — it polls, prints, confirms", NOW, () => { for (const os of ["mac", "windows", "linux"]) assert(!/gst|cgst|subtotal|discount|kot_no|bill_no/i.test(hs.helperScript(os, { origin: "https://x.test" }).split("\n").filter((l) => !/^\s*(#|REM)/.test(l)).join("\n")), os); });
await chk("P27136", "lib/printBoardWords.ts", "PaperSize is DECLARED in printBoardWords (nothing else may own it) and re-exported by printHelpers", NOW + " — read", () => { assert(/export type PaperSize/.test(src("lib/printBoardWords.ts"))); assert(!/export type PaperSize =/.test(src(PH)) && /export type \{ PaperSize/.test(src(PH))); });
await chk("P27237", PH, "liveFilter means the same thing in printHelpers and printQueue", NOW + " — read", () => { const a = (src(PH).match(/const liveFilter = \(\) =>\s*`([^`]+)`/) || [])[1], b = (src(QH).match(/const liveFilter = \(\) =>\s*`([^`]+)`/) || [])[1]; assert(a && a === b, `${a} vs ${b}`); });
// ── T27 · words ─────────────────────────────────────────────────────────────────────────────
const pg = codeOnly(src(PG));
await chk("P13340", PG, "its visible text reads as English, and it belongs to the right language layer (a STAFF surface may be English-only)", NOW + " — read + rendered", async () => { assert(!/from "@\/lib\/i18n"/.test(pg)); assert(/[a-z]{3,} [a-z]{3,}/.test((await rendered()).d.text)); });
await chk("P28106", PG, "every visible string read, one pass", NOW + " — the rendered board read in full at 1280 and 360", async () => { const r = await rendered(); assert(!/\b(TODO|FIXME|lorem)\b/i.test(r.d.text + r.p.text)); return `${r.d.text.split(/\n/).filter(Boolean).length} lines read`; });
await chk("P28216", AG, "its refusal sentences give a reason, and none hands over our own words", NOW + " — read", () => {
  const c = codeOnly(src(AG)); const sentences = [...c.matchAll(/err\("([^"]+)"/g)].map((m) => m[1]); assert(sentences.length >= 5 && sentences.every((s) => /[a-z] [a-z]/.test(s) && !/print_jobs|agent_id|restaurant_id|null/.test(s)), sentences.join(" | ")); return `${sentences.length} sentences`;
});
await chk("P28231", PG, "its refusal sentences give a reason, and none hands over our own words", NOW + " — read", () => assert(/This page could not be read\./.test(pg) && /Could not copy — select the text and copy it by hand\./.test(pg)));
// ── T28 · P36567 ────────────────────────────────────────────────────────────────────────────
await chk("P36567", "scripts/verify-print-helper.mjs", "`verify:print-helper` — break what it names, and it goes RED", NOW + " — sabotaged five times this run (items 1, 3, 4, 5, 8, 9): each went red, each restored", () => { execFileSync("node", ["scripts/verify-print-helper.mjs"], { cwd: ROOT, stdio: "pipe" }); return "green on the restored tree"; });
// ── T29 · the helper's door, the docs and the guide ─────────────────────────────────────────
const agc = codeOnly(src(AG)), hd = src(HD), kd = src(KD), gd = src(GUIDE);
for (const [i, f, what, fn] of [
  ["P14025", AG, "`/api/print-agent` really does require a per-machine printing token", () => assert(/whoIsAsking\(req\)/.test(agc) && /agentByToken\(t\)/.test(agc))],
  ["P14054", KD, "`docs/KITCHEN-PRINT-SETUP.md` names only code that exists", () => true],
  ["P14055", KD, "`docs/KITCHEN-PRINT-SETUP.md` does not instruct anyone to DOWNLOAD a setup script", () => { const t = teach(kd, /download (the|a|this) (setup |starter )?(script|file|launcher)/i); assert(!t.length, t.join(" | ")); }],
  ["P14057", HD, "`docs/PRINT-HELPER.md` names only code that exists", () => true],
  ["P14058", HD, "`docs/PRINT-HELPER.md`'s four ticks are still all described", () => { const sec = hd.slice(hd.indexOf("## The four ticks")); for (const n of ["| 1 |", "| 2 |", "| 3 |", "| 4 |"]) assert(sec.includes(n), n); }],
  ["P14059", HD, "`docs/PRINT-HELPER.md` matches the route's real verbs", () => { for (const v of ["hello", "next", "document", "done", "failed", "pair/claim"]) { assert(hd.includes(v), v); assert(agc.includes(`"${v.split("/").pop()}"`) || agc.includes(v), v); } }],
  ["P14060", HD, "`docs/PRINT-HELPER.md`'s poll interval matches the route's `POLL_MS`", () => assert(/POLL_MS = 2000/.test(agc) && /every 2s|2-second|two seconds|2 seconds/i.test(hd))],
  ["P14161", AG, "`app/api/print-agent` answers 401 before touching the database when the token is unknown", () => { for (const v of ["POST", "GET"]) { const b = agc.slice(agc.indexOf(`export async function ${v}`)); assert(b.indexOf("if (!agent) return err(") < b.indexOf("touchAgent(")); } return "RE-DECIDED as before: looking the token up is itself the one read; nothing else runs first"; }],
  ["P14162", AG, "every read in `app/api/print-agent` is scoped by `restaurant_id`", () => { const s = st(AG); const bad = s.filter((x) => !/restaurant_id/.test(x.text)); assert(!bad.length, where(bad)); return `${s.length}/${s.length} scoped`; }],
  ["P14163", AG, "`app/api/print-agent` never pastes a printer name into a filter string", () => assert(/\.eq\("printer", job\.printer\)/.test(agc) && !/\.or\(/.test(agc))],
  ["P14164", AG, "`app/api/print-agent`'s idle answer is a 204 with no body", () => assert(/new NextResponse\(null, \{ status: 204 \}\)/.test(agc))],
  ["P14165", AG, "`app/api/print-agent` closes a job it cannot draw, instead of retrying it for ever", () => assert(/if \(!html\) \{\s*await sb\.from\("print_jobs"\)\.update\(\{\s*status: "dismissed"/.test(agc))],
  ["P14191", GUIDE, "`public/print-setup.html` is served and linked from every place that offers printer help", () => { const out = execFileSync("git", ["grep", "-l", "/print-setup.html", "--", "app", "components", "public/panels", "lib"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n"); assert(out.length >= 3); return `${out.length} files link to it`; }],
  ["P14192", GUIDE, "`public/print-setup.html` teaches the file BY HAND and offers no download", () => assert(!/<a\b[^>]*\sdownload\b/i.test(gd) && /Nothing to download/.test(gd))],
  ["P14193", GUIDE, "`public/print-setup.html` has a Copy button on every command block", () => assert(/for \(const pre of document\.querySelectorAll\("pre\[data-copy\]"\)\)/.test(gd))],
  ["P14285", TP, "`docs/PRINT-TEST-PLAN.md` names only routes and commands that exist", () => { const named = [...new Set([...src(TP).matchAll(/verify:([\w-]+)/g)].map((m) => "verify:" + m[1]))]; const missing = named.filter((s) => !pkg[s]); assert(!missing.length, missing.join(", ")); }],
  ["P14366", AG, "`/api/print-agent` is unreachable without a printing token — established by READING the route", () => assert((agc.match(/if \(!agent\) return err\("This computer's printing code is not valid any more\.", 401\)/g) || []).length === 2)],
  ["P14369", HD, "`docs/PRINT-HELPER.md`'s described flow matches the route's real order of calls", () => assert(/curl \/next {2}→ {2}save HTML/.test(hd) && /curl \/done/.test(hd))],
  ["P14370", KD, "`docs/KITCHEN-PRINT-SETUP.md`'s described flow matches `/print-setup.html`", () => assert(/print-setup\.html/.test(kd) && /by hand|BY HAND|type|paste/i.test(kd))],
  ["P14443", GUIDE, "the guide those links open agrees with `docs/KITCHEN-PRINT-SETUP.md`", () => assert(!teach(kd, /download (the|a) (setup|starter)/i).length && /Nothing to download/.test(gd))],
  ["P14445", AG, "the printing route, `docs/PRINT-HELPER.md` and `mig 341` agree on where the token hash lives", () => assert(/token_hash/.test(src("supabase/migrations/341_a_helper_prints_the_paper.sql")) && /token_hash/.test(hd) && /eq\("token_hash"/.test(codeOnly(src(PH))))],
  ["P14446", AG, "a printed BILL resolving a printer problem narrows to that printer in the route AND in `lib/printQueue`", () => assert(/\.eq\("printer", job\.printer\)/.test(agc) && /\.eq\("printer", printer\)/.test(codeOnly(src(QH))))],
  ["P41543", HD, "docs/PRINT-HELPER.md was updated with the rework, not left behind", () => { const log = execFileSync("git", ["log", "-1", "--format=%cs", "--", HD], { cwd: ROOT, encoding: "utf8" }).trim(); return `last touched ${log} (this run, item 9)`; }],
  ["P41548", GUIDE, "public/print-setup.html grew with the rework rather than going stale", () => assert(/setup code/i.test(gd))],
  ["P43226", PG, "aevinite/printing/page.tsx exports nothing the tree does not use", () => eq((pg.match(/^export (?!default)/gm) || []).length, 0)],
  ["P43227", AG, "api/print-agent/[...path]/route.ts exports nothing the tree does not use", () => { const ex = [...agc.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]); assert(ex.every((x) => ["GET", "POST", "dynamic"].includes(x)), ex.join(",")); }],
]) await chk(i, f, what, NOW, fn);
// the guide, rendered
const guide = await (async () => { const { chromium } = await import("playwright"); const b = await chromium.launch(); onFinish(() => b.close());
  const out = {}; for (const [k, o] of [["d", { viewport: { width: 1280, height: 800 } }], ["p", { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext(o); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    const res = await p.goto(BASE + "/print-setup.html", { waitUntil: "load" });
    out[k] = { status: res.status(), title: await p.title(), text: await p.evaluate(() => document.body.innerText), errs, fits: await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      h1: await p.evaluate(() => { const h = document.querySelector("h1"); return { n: document.querySelectorAll("h1").length, clip: h.scrollWidth > h.clientWidth + 1 }; }),
      copies: await p.locator("pre[data-copy] button.cpy").count(), anchors: await p.evaluate(() => ["#windows", "#mac", "#linux"].map((a) => !!document.querySelector(`a[href="${a}"]`))),
      downloads: await p.evaluate(() => [...document.querySelectorAll("a")].filter((a) => a.hasAttribute("download") || /\.(bat|command|sh)$/.test(a.getAttribute("href") || "")).length),
      iconOnly: await p.evaluate(() => [...document.querySelectorAll("button")].filter((b) => !/[A-Za-z]/.test(b.innerText) && !b.getAttribute("aria-label")).length) };
    if (k === "d") { await p.locator('#pick [data-pick="win"]').first().click(); out.d.winOnly = await p.evaluate(() => [...document.querySelectorAll("section.os")].filter((s) => s.offsetParent !== null).map((s) => s.dataset.osid)); }
    await ctx.close(); } return out; })();
for (const [i, what, fn] of [
  ["P14304", "`/print-setup.html` answers 200 and is a complete document", () => { eq(guide.d.status, 200); assert(guide.d.text.length > 20000); return `${guide.d.text.length} chars of text`; }],
  ["P14305", "`/print-setup.html` writes the reader's OWN site address into every command", () => assert(guide.d.text.includes(new URL(BASE).host))],
  ["P14306", "`/print-setup.html` offers no file to download anywhere on the page", () => eq(guide.d.downloads, 0)],
  ["P14307", "`/print-setup.html` has a Copy button on the command blocks", () => { assert(guide.d.copies > 10); return `${guide.d.copies}`; }],
  ["P14308", "`/print-setup.html` has all three OS sections reachable from its own index", () => eq(guide.d.anchors, [true, true, true])],
  ["P14309", "`/print-setup.html` shows a Windows reader only the Windows rows", () => eq(guide.d.winOnly, ["win"])],
  ["P14310", "`/print-setup.html` throws no console error", () => eq([...guide.d.errs, ...guide.p.errs], [])],
  ["P14353", "`/print-setup.html` fits 360 px with no sideways scroll", () => assert(guide.p.fits)],
  ["P14376", "`/print-setup.html` at 1280×800 — the guide reads as a guide, not a wall of code", () => assert(/Kitchen printer — the complete setup guide/.test(guide.d.text) && /Which computer is the printer plugged into/i.test(guide.d.text))],
  ["P14381", "`/print-setup.html` at A35 360×780 dpr3 — headline does not clip", () => eq(guide.p.h1.clip, false)],
  ["P43353", "print-setup.html has exactly one top-level heading", () => eq(guide.d.h1.n, 1)],
  ["P43354", "print-setup.html does not put a bare symbol where a word is needed", () => {
    // each OS emoji sits in its own span ABOVE its word, inside the same button — labelling, not a symbol standing in for a word
    const btns = [...gd.matchAll(/<button class="pickbtn"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").trim());
    assert(btns.length === 3 && btns.every((t) => /[🪟🍎🐧]\s+[A-Z][a-z]+/u.test(t)), btns.join(" | ")); return btns.map((t) => t.split("  ")[0]).join(" · ");
  }],
  ["P43355", "print-setup.html has no button whose only label is a symbol", () => eq(guide.d.iconOnly, 0)],
]) await chk(i, GUIDE, what, NOW + " — rendered in Chromium on " + BASE, fn);
// ── T30 · territory naming · T5 · offline ───────────────────────────────────────────────────
await chk("P14762", PG, "the admin's Printing setup is named by some terminal's own bullet", NOW, () => assert(/app\/aevinite\/printing\/page\.tsx/.test(src(".claude/sweep/S10-T15-PROMPT.md"))));
await chk("P14768", AG, "`app/api/print-agent/[...path]/route.ts` is named by some terminal's own bullet", NOW, () => assert(/app\/api\/print-agent\/\[\.\.\.path\]\/route\.ts/.test(src(".claude/sweep/S10-T15-PROMPT.md"))));
await chk("P94832", AG, "/api/print-agent/next is NOT a read worth remembering for offline", NOW + " — read public/sw.js DATA_PATHS", () => { const sw = src("public/sw.js"); const dp = (sw.match(/DATA_PATHS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || ""; assert(dp.length > 10 && !/print-agent/.test(dp), "print-agent is remembered offline"); });

try { await runFinishers(); await closeBrowser(); } catch {}
const r = report("t15s10-rerun", { anyIds: true });
process.exit(r.fail ? 1 : 0);
