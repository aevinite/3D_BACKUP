// scripts/sweep/t9s10/rerun-other.mjs — the OLDER ledger rows about my half that the T24 runner
// does not re-execute, re-run under their ORIGINAL ids (sweep #10 T9, 2026-10-09).
//
//   node scripts/sweep/t9s10/rerun-other.mjs            # run, print
//   node scripts/sweep/t9s10/rerun-other.mjs --ledger   # rows for t24-writeback.mjs (matched by id)
//
// Rows whose subject is the OTHER half of the route (the cancel branch, POST /issue, ratings/ack,
// the void door) are deliberately absent: their owner re-runs them.
import { execFileSync } from "node:child_process";
import { check, runAll, src, MC, GC, HC, PC, endpoint, rd, call, world, live, noLive, sql, FRENCH_HOUSE, ROOT, BASE } from "./lib.mjs";
import { readFileSync as RF, writeFileSync as WF } from "node:fs";
import { join } from "node:path";

const panel = rd("public/panels/editor/app.js");
const routeCode = MC;            // my half, comments stripped
const whole = src;               // the whole file, for rows that were always about the whole file
const guard = (script, args = []) => {
  try { execFileSync("node", [script, ...args], { cwd: ROOT, stdio: "pipe", timeout: 240000 }); return { ok: true, code: 0 }; }
  catch (e) { return { ok: false, code: e.status, out: String(e.stdout || "").slice(-400) + String(e.stderr || "").slice(-300) }; }
};

// ── T17 P23604 — the blocklist read keeps the two unban columns ─────────────────────────────────
check("P23604", "Item 7 · the manager panel's own blocklist read KEEPS those two columns", "read GET /users",
  () => /from\("blocklist"\)\.select\("[^"]*unban_phone, unban_requested_at"\)/.test(endpoint("users")));

// ── T19 P09466 — the manager's Activity log never carries the admin's own rows ─────────────────
check("P09466", "The admin activity feed shows admin-panel rows that the manager's own feed does not", "driven live: GET /api/editor/oplog as French House's manager — no row from the admin/owner panels",
  async () => { const r = await live("/oplog"); const s = noLive(r); if (s) return s;
    const bad = (r.json || []).filter((x) => ["admin", "owner", "db"].includes(x.panel));
    return { ok: r.status === 200 && Array.isArray(r.json) && bad.length === 0, note: `${(r.json || []).length} rows, ${bad.length} from admin/owner/db (the admin console's own feed is the admin's — not read here)` }; });

// ── T23 ─────────────────────────────────────────────────────────────────────────────────────────
check("P11429", "238 the manager floor and the waiter tablet read the SAME summary function", "read both routes + lib/floorSummary.ts",
  () => { const tab = rd("app/api/tablet/[...path]/route.ts");
    return /sharedFloorSummary\(`floor:\$\{rid\}`/.test(endpoint("summary")) && /lfh_table_view_summary/.test(endpoint("summary"))
      && /sharedFloorSummary/.test(tab) && /lfh_table_view_summary/.test(tab); });
check("P11452", "331 the manager, the tablet and the admin console all reach the invoice through the one RPC", "grep the routes for lfh_issue_invoice",
  () => { const tab = rd("app/api/tablet/[...path]/route.ts"); const n = [...new Set(whole.match(/lfh_generate_invoice/g) || [])];
    const t = [...new Set(tab.match(/lfh_generate_invoice/g) || [])];
    const admin = (() => { try { return execFileSync("grep", ["-rl", "lfh_generate_invoice", "app/api/admin"], { cwd: ROOT }).toString().trim().split("\n").filter(Boolean); } catch { return []; } })();
    return { ok: n.length === 1 && t.length === 1, note: `editor + tablet both call lfh_generate_invoice; admin files naming it: ${admin.length}` }; });
check("P11456", "332 the verifier is reachable and says what it checked", "read GET /zreport + drive it live",
  async () => { if (!/lfh_verify_bill_chain/.test(endpoint("zreport"))) return { ok: false, note: "zreport no longer calls the verifier" };
    const r = await live("/zreport"); const s = noLive(r); if (s) return s;
    const c = r.json && r.json.chain;
    return { ok: !!c && typeof c.ok === "boolean" && ("bills" in c || "error" in c), note: c ? `chain ok=${c.ok}, ${c.bills ?? "?"} bills checked, ${c.noteCount ?? 0} notes` : "no chain" }; });

// ── T25 ─────────────────────────────────────────────────────────────────────────────────────────
check("P12033", "EVERY write handler under app/api/editor and app/api/tablet calls invalidateFloor(rid)", "npm run verify:floor",
  () => { const g = guard("scripts/verify-floor-share.mjs"); return { ok: g.ok, note: g.ok ? "verify:floor green" : g.out }; });
check("P12322", "The manager panel's floor read answers under the 8s statement ceiling", "time GET /api/editor/all live",
  async () => { const r = await live("/all"); const s = noLive(r); if (s) return s; return { ok: r.status === 200 && r.ms < 8000, note: `${r.status} in ${r.ms} ms` }; });
check("P12323", "A whole-floor refetch twice within 1.5s costs ONE database call (sharedFloorSummary)", "driven in memory: GET /summary twice, count lfh_table_view_summary calls",
  async () => { const G = await world({ rpc: { lfh_table_view_summary: { tiles: {}, order_count: 0 } } });
    await call("GET", "summary"); await call("GET", "summary");
    const n = G.RPCS.filter((c) => c.name === "lfh_table_view_summary").length;
    return { ok: n === 1, note: `${n} call(s) for two reads` }; });

// ── T27 P28194 — refusal sentences give a reason and never hand over our own words ──────────────
check("P28194", "`app/api/editor/[...path]/route.ts` — its refusal sentences give a reason, and none hands over our own words", "read every err(\"…\") in my half (lines 1–end of table-sections)",
  () => { const msgs = [...MC.matchAll(/err\(\s*(["`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
    const jargon = msgs.filter((m) => /\b(uuid|rpc|postgrest|supabase|null|undefined|row-level|jsonb?|schema|sql)\b/i.test(m));
    return { ok: msgs.length >= 30 && jargon.length === 0, note: `${msgs.length} sentences in this half (207 is the whole file's count, half of it is the other terminal's); jargon: ${jargon.join(" | ") || "none"}` }; });

// ── T28 — each guard that names this route goes RED when what it names is broken ─────────────────
// Sabotage in the WORKTREE copy only, restored with git in a finally — never in the shared folder.
const ROUTE = "app/api/editor/[...path]/route.ts";
const sab = (id, name, script, from, to) => check(id, `\`verify:${name}\` — break what it names in \`app/api/editor/[...path]/route.ts\`, and it goes RED`,
  "replace the token it asserts on (worktree copy only), run the guard, restore with git",
  () => {
    const p = join(ROOT, ROUTE); const orig = RF(p, "utf8");
    if (!orig.includes(from)) return { ok: false, note: `the token ${JSON.stringify(from).slice(0, 60)} is gone — re-derive the sabotage` };
    const before = guard(script);
    try { WF(p, orig.replace(from, to)); const after = guard(script); return { ok: before.ok && !after.ok, note: `green before: ${before.ok} · red when broken: ${!after.ok}` }; }
    // Restored from the copy taken above — never `git checkout`, which would also throw away this
    // terminal's own uncommitted fixes in the same file.
    finally { WF(p, orig); }
  });
sab("P36563", "one-bill-delete", "scripts/verify-one-bill-delete.mjs", "return !g.user; // the Aevidine admin console only", "return true; // the Aevidine admin console only");
sab("P36566", "print-queue", "scripts/verify-print-queue.mjs", "async function counterPrintTarget(", "async function printTargetForCounter(");
sab("P36568", "xray", "scripts/verify-xray-marks.mjs", "tabsTint: managerTabsOff(r?.access_config),", "tabs_tint: managerTabsOff(r?.access_config),");
sab("P36570", "manager-gates", "scripts/verify-manager-gates.mjs", 'if (p === "zreport") {\n      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");', 'if (p === "zreport") {\n      if (false) return permDenied("view the dashboard");');
sab("P36588", "retention", "scripts/verify-retention-lock.mjs", "if (r.error) return { locked: true, at: null };", "if (r.error) return { locked: false, at: null };");

// ── T30 ─────────────────────────────────────────────────────────────────────────────────────────
const SHARED = /net_amount|disc_gross|netOf|splitBill|billMoney|billTaxOf|discountBaseOf|lfh_\w+|rpc\(/g;
check("P14520", "the manager panel's money calls read money through a shared definition rather than their own arithmetic — `app/api/editor/[...path]/route.ts`", "grep my half for a shared definition (expect ≥1)",
  () => { const n = (MC.match(SHARED) || []).length; return { ok: n >= 1, note: `${n} shared-definition reference(s) in this half` }; });
check("P14540", "`app/api/editor/[...path]/route.ts` reads order money through a shared definition and does NOT subtract a discount by hand", "grep for a shared definition (≥1) and for a hand-rolled `total - disc` (0)",
  () => { const n = (whole.match(SHARED) || []).length; const hand = (strip2(whole).match(/\btotal\s*-\s*disc\b/g) || []).length;
    return { ok: n >= 1 && hand === 0, note: `${n} shared-definition reference(s), ${hand} hand-rolled subtractions` }; });
function strip2(t) { return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }
check("P14611", "`lib/menuDataServer.ts` — the guest menu bundle has a named invalidator and this route's writes call it", "read the module + grep this route",
  () => /export (const|function) menuTag/.test(rd("lib/menuDataServer.ts")) && /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(HC));
check("P14937", "END TO END — a dish price edited through this route busts menuTag(rid) and the DB publishes the breadcrumb", "read bustMenuCache + its callers; the DB trigger on menu_items",
  async () => { const callers = (whole.match(/bustMenuCache\(rid\)/g) || []).length;
    const t = await sql(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'public.menu_items'::regclass AND NOT tgisinternal`);
    return { ok: callers >= 2 && Number(t[0].n) >= 1, note: `${callers} bustMenuCache(rid) call(s); ${t[0].n} trigger(s) on menu_items` }; });
check("P29646", "printer_events is written only when a person or the helper reports/resolves a problem — never on a heartbeat", "grep this half for a printer_events write",
  () => { const w = (MC.match(/from\("printer_events"\)\.(insert|update|upsert)/g) || []).length; const r = (MC.match(/from\("printer_events"\)\.select/g) || []).length;
    return { ok: w === 0 && r >= 1, note: `this half READS printer_events ${r}× and writes it ${w}×` }; });
check("P29716", "the manager panel's POST goes through a wrapper that drops this restaurant's shared floor snapshot after the write", "read the POST export",
  () => /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "editor"\);/.test(whole));
check("P29717", "the manager panel ALSO drops it at the START of the write", "read postImpl's preamble",
  () => { const i = PC.indexOf("invalidateFloor(rid);"), j = PC.indexOf("const { path = [] } = await ctx.params;"); return { ok: i > 0 && i < j, note: `${(whole.match(/invalidateFloor\(/g) || []).length} invalidateFloor call site(s) in the file` }; });
check("P29718", "the manager panel's POST is wrapped in withIdempotency, so a retry after a timeout cannot double-apply", "read the POST export",
  () => /export const POST = withIdempotency\(/.test(whole));
check("P29719", "the manager panel's whole-floor read is SHARED, and its targeted ?table=N refetch is not", "read GET /summary",
  () => /tbl\s*\?\s*await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)\s*:\s*await sharedFloorSummary\(/.test(endpoint("summary")));
check("P29720", "the manager panel never writes into the shared floor object — it spreads into a new one", "read GET /summary's return",
  () => /return ok\(\{\s*\.\.\.\(data \|\|/.test(endpoint("summary")) && !/data\.\w+\s*=/.test(strip2(endpoint("summary"))));
check("P29721", "the manager panel emits its breadcrumbs through the DATABASE trigger, not by hand", "grep the file for a hand-written realtime_events insert",
  () => !/from\("realtime_events"\)\.insert/.test(whole));
check("P29723", "the manager panel's refusals carry a reason the panel can branch on", "count reason codes beside errors in the file",
  () => { const n = (whole.match(/\b(reason|code|why)\s*[:=]\s*["'`]?[a-z_]{4,}/g) || []).length; return { ok: n >= 10, note: `${n} reason code(s) in the file` }; });
check("P29764", "the owner changing a dish price reaches the staff panels and the guest phones", "the owner Menu screen embeds this panel; the write lands in menu_items, whose trigger publishes",
  async () => { const t = await sql(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'public.menu_items'::regclass AND NOT tgisinternal`);
    return { ok: /TABLES[\s\S]{0,80}items: \{ name: "menu_items"/.test(HC) && Number(t[0].n) >= 1, note: `${t[0].n} trigger(s) on menu_items` }; });
check("P29765", "the owner changing a dish price busts the server-side cache sitting in front of that breadcrumb", "read bustMenuCache",
  () => /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(HC) && /invalidateFloor\(rid\)/.test(PC));
check("P29802", "the manager panel strips the private settings column before sending a settings row to the panel", "read GET /all + drive it live",
  async () => { if (!/panelSafeSettings\(must\(settings\)\)/.test(endpoint("all"))) return false;
    const r = await live("/all"); const s = noLive(r); if (s) return s;
    return { ok: r.status === 200 && r.json && r.json.settings && !("platform_channels" in r.json.settings), note: `settings carries ${Object.keys(r.json?.settings || {}).length} keys, platform_channels absent` }; });
check("P29906", "`app/api/editor/[...path]/route.ts` writes the guest menu's tables — and purges the guest menu's 24h bundle", "grep for revalidateTag(menuTag(rid))",
  () => /revalidateTag\(menuTag\(rid\)/.test(whole));

// ── T5 P02441 — the discount cap is the server's too ─────────────────────────────────────────────
check("P02441", "the manager's discount is capped by the SERVER too", "lib/discountCap.ts exports overDiscountCap and this route calls it",
  () => /export function overDiscountCap/.test(rd("lib/discountCap.ts")) && /overDiscountCap\(/.test(whole));

// ── T8 ──────────────────────────────────────────────────────────────────────────────────────────
check("P03785", "The lookup is a scoped, column-named, row-capped read", "read GET /customer-search + drive it live",
  async () => { if (!/p_restaurant_id: rid, p_prefix: q, p_limit: CUSTOMER_SEARCH_ROWS/.test(endpoint("customer-search"))) return false;
    const r = await live("/customer-search?q=987"); const s = noLive(r); if (s) return s;
    return { ok: r.status === 200 && Array.isArray(r.json.matches) && r.json.matches.length <= 12 && typeof r.json.whole === "boolean", note: `${r.json.matches.length} match(es), whole=${r.json.whole}` }; });
check("P61822", "the API family is still /api/editor — the redirect never renamed it", "the route file exists where the panel calls it",
  () => /fetch\(\s*["'`]\/api\/editor/.test(panel) || /API\s*=\s*["'`]\/api\/editor/.test(panel) || panel.includes('"/api/editor"'));
check("P62381", "the manager panel's API family is /api/editor, and it exists", "the route file is on disk and exports GET/POST/PATCH/DELETE",
  () => /export async function GET\(/.test(whole) && /export const POST =/.test(whole) && /export const PATCH =/.test(whole) && /export const DELETE =/.test(whole));

// ── T17-S10 P186829 ─────────────────────────────────────────────────────────────────────────────
check("P186829", "`app/api/editor/[...path]/route.ts` — /api/editor/* — gated (staff role (requireRole))", "read gate() and the first line of every method",
  () => /const g = await requireRole\(req, "manager"\)/.test(HC) && count2(whole, /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/g) === 4);
function count2(t, re) { return (t.match(re) || []).length; }

// ── T6 P59779–P59829 — every path the panel calls is one this route dispatches ──────────────────
// The rows are about the PANEL's calls meeting the ROUTE's dispatcher. Re-derived from today's
// panel, so a call that has since moved shows up rather than passing on yesterday's list.
const T6 = [
  ["P59779", "DELETE", "/"], ["P59780", "DELETE", "/blocklist/"], ["P59781", "DELETE", "/items/"], ["P59782", "DELETE", "/orders/"],
  ["P59783", "GET", "/all"], ["P59784", "GET", "/audit?detail="], ["P59785", "GET", "/audit?limit=200"], ["P59786", "GET", "/calls"],
  ["P59787", "GET", "/customer-recognize?phone="], ["P59788", "GET", "/gst-report?month="], ["P59789", "GET", "/khata"], ["P59790", "GET", "/khata/customers?q="],
  ["P59791", "GET", "/onhouse?days=30"], ["P59792", "GET", "/orders"], ["P59793", "GET", "/orders?bills=1"], ["P59794", "GET", "/orders?history=1"],
  ["P59795", "GET", "/printing/state"], ["P59796", "GET", "/ratings"], ["P59797", "GET", "/sessions"], ["P59798", "GET", "/staff-risk?range="],
  ["P59799", "GET", "/stats?range="], ["P59800", "GET", "/summary"], ["P59801", "GET", "/zreport"], ["P59802", "PATCH", "/calls/"],
  ["P59803", "PATCH", "/orders/"], ["P59804", "POST", "/"], ["P59805", "POST", "/audit/classify"], ["P59806", "POST", "/blocklist"],
  ["P59807", "POST", "/customer-capture"], ["P59808", "POST", "/items"], ["P59809", "POST", "/items/"], ["P59810", "POST", "/khata/pay"],
  ["P59811", "POST", "/members/"], ["P59812", "POST", "/orders/"], ["P59813", "POST", "/orders/${id}/allergies"], ["P59814", "POST", "/orders/delete"],
  ["P59815", "POST", "/platform/${o.id}/pay"], ["P59816", "POST", "/platform/${o.id}/printed"], ["P59817", "POST", "/print/send"], ["P59818", "POST", "/printing/"],
  ["P59819", "POST", "/ratings/ack"], ["P59820", "POST", "/requests/"], ["P59821", "POST", "/sessions/"], ["P59822", "POST", "/sessions/${printedSid}/bill-printed"],
  ["P59823", "POST", "/sessions/${sess.id}/close"], ["P59824", "POST", "/settings"], ["P59825", "POST", "/table-sections"], ["P59826", "POST", "/tables/${tnum}/pay-split"],
  ["P59827", "POST", "/tables/${t}/khata"], ["P59828", "POST", "/tables/${t}/on-the-house"], ["P59829", "POST", "/tables/${t}/tag"],
];
for (const [id, verb, p] of T6) {
  const seg = p.replace(/^\//, "").split(/[/?]/)[0];
  check(id, `the panel's ${verb} ${p} names a path app/api/editor answers`, "take the first static segment and look for it in the route's dispatcher (re-derived from today's panel)",
    () => {
      if (!seg) return { ok: true, note: "the bare path — the dispatcher answers on the kind in the body (TABLES map)" };
      const inRoute = whole.includes(`"${seg}"`);
      const inPanel = panel.includes(`"/${seg}`) || panel.includes(`\`/${seg}`) || panel.includes(`'/${seg}`);
      return { ok: inRoute, note: `route mentions "${seg}"${inPanel ? "" : " · the panel no longer calls it this way"}` };
    });
}

const ARGV = process.argv.slice(2);
await runAll({ ledger: ARGV.includes("--ledger"), quiet: ARGV.includes("--quiet") });
process.exit(0);
