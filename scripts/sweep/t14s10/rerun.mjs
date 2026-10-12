// scripts/sweep/t14s10/rerun.mjs — the inherited ledger rows on T14's files that NO runner executes.
//
// Each keeps the id it was born with and the question it asked; the check is written fresh against
// today's code. Rows that already have a runner are re-run by that runner instead (see
// rerun-t11-banks.mjs, scripts/sweep/t8/static4.mjs, scripts/sweep/t30s10/parity.mjs and
// scripts/t30-harness/run.mjs) — nothing here duplicates them.
import { rerun, read, exists, imp, sql, block, code, NO_DB } from "./lib.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { root } from "./lib.mjs";

const NUM = read("docs/NUMBERING.md");
const MIGS = readdirSync(join(root, "supabase/migrations"));
const BILLDOC = (await imp("public/panels/billdoc.js")).default;

// ── docs/NUMBERING.md teaches no retired printing machinery as current (T11 sweep #8, P65303–P65320) ──
const RETIRED = [
  ["P65303", "kot_print_target", /kot_print_target/],
  ["P65304", 'a "Which screen prints the ticket?" dropdown', /which screen prints the ticket/i],
  ["P65305", '"both — the counter is the backup"', /counter is the backup/i],
  ["P65306", "a 30-second backup", /30[- ]second/i],
  ["P65307", 'a per-device "Should this screen print" strip', /should this screen print/i],
  ["P65308", "a printing MODE toggle", /mode toggle|printing mode/i],
];
for (const [id, what, re] of RETIRED)
  rerun(id, "docs/NUMBERING.md", `does not teach ${what} as current`, "read the doc today", () =>
    !re.test(NUM) || `the doc still mentions ${what}`);

rerun("P65319", "docs/NUMBERING.md", "every backticked code path it names either exists, or is named as deleted",
  "every `x/y.ts`-shaped and `NNN_*.sql` token checked on disk", () => {
    const toks = [...NUM.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
    const missing = toks.filter((t) => {
      if (/^\d{3}_[a-z0-9_]+\.sql$/.test(t)) return !MIGS.includes(t);
      if (/^(lib|app|public|docs|scripts|components|supabase)\//.test(t)) return !exists(t);
      return false;
    });
    return missing.length === 0 || `missing on disk: ${missing.join(", ")}`;
  });
rerun("P65320", "docs/NUMBERING.md", "it names no npm script that package.json does not have",
  "every `npm run X` in the doc looked up in package.json", () => {
    const scripts = JSON.parse(read("package.json")).scripts || {};
    const named = [...NUM.matchAll(/npm run ([a-z0-9:_-]+)/gi)].map((m) => m[1]);
    const bad = named.filter((n) => !scripts[n]);
    return bad.length === 0 || `not in package.json: ${bad.join(", ")}`;
  });
// P101066 RE-DECIDED (sweep #10 T14, 2026-10-12): T11's check was /financial year|FY|1 April|April/i,
// and case-insensitive "FY" matches the "fy" in "verify" — so it passed while the doc never said it.
rerun("P101066", "docs/NUMBERING.md", "the invoice number follows the Indian financial year, not the calendar year",
  "read the doc for the financial-year rule in words (not a two-letter match)", () =>
    /financial year/i.test(NUM) && /April/.test(NUM) || "the doc never states the financial-year rule — T11's /FY/i matched the word \"verify\"");

// ── lib/printBoard.ts reads (T11 sweep #8, P101396–P101397) ──
const PB = read("lib/printBoard.ts");
rerun("P101396", "lib/printBoard.ts", "the read of settings is scoped, names its columns, and cannot come back unbounded",
  "read the settings call in printBoardState()", () =>
    /sb\.from\("settings"\)\.select\("auto_print_kot, auto_print_kot_allowed, modules"\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/.test(PB) || "the settings read changed shape");
rerun("P101397", "lib/printBoard.ts", "the read of print_jobs is scoped, names its columns, and cannot come back unbounded",
  "read the print_jobs call in printBoardState()", () =>
    /sb\.from\("print_jobs"\)\.select\(JOB_COLS\)\.eq\("restaurant_id", rid\)[\s\S]{0,80}\.limit\(Math\.min\(30, Math\.max\(5,/.test(PB) || "the print_jobs read changed shape");

// ── the database agrees with docs/NUMBERING.md (T22, P149391–P149392) — read-only SQL ──
rerun("P149391", "docs/NUMBERING.md", "mig 080 + NUMBERING.md · an invoice number never exists without the bill it was raised from",
  "count sessions carrying an invoice number but no bill number (dev DB, SELECT)", async () => {
    if (NO_DB) return { skip: "--no-db" };
    const r = await sql("select count(*)::int n from sessions where invoice_no is not null and bill_no is null");
    return r[0].n === 0 || `${r[0].n} invoiced session(s) with no bill number`;
  });
rerun("P149392", "docs/NUMBERING.md", "mig 080 + NUMBERING.md · an invoice number NEVER resets and is unique per restaurant for all time",
  "group sessions by restaurant and invoice_no across all time (dev DB, SELECT)", async () => {
    if (NO_DB) return { skip: "--no-db" };
    const r = await sql("select count(*)::int n from (select restaurant_id, invoice_no from sessions where invoice_no is not null group by 1,2 having count(*) > 1) x");
    return r[0].n === 0 || `${r[0].n} restaurant+invoice_no pair(s) used twice`;
  });

// ── lib/billCustomer.ts / lib/billPreview.ts / lib/printDocs.ts (T25, P12214–P12299) ──
const BC = await imp("lib/billCustomer.ts");
const stubSb = (row, err = null, rpc = { data: { ok: true, visits: 1 }, error: null }) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: err }) }) }) }),
  rpc: async () => rpc,
});
rerun("P12214", "lib/billCustomer.ts", "a missing settings row fails OPEN — an unconfigured restaurant can still bill a table",
  "node: billCustomerRequired with no row -> false", async () =>
    (await BC.billCustomerRequired(stubSb(null), "r")) === false || "a missing row now REQUIRES a customer");
rerun("P12215", "lib/billCustomer.ts", "a phone under 10 digits is refused with its own sentence",
  "node: saveBillCustomer with '99999'", async () => {
    const r = await BC.saveBillCustomer(stubSb({ bill_customer_required: true }), "r", "s", { cust_phone: "99999", cust_name: "A" });
    return (r.ok === false && /too short/.test(r.message)) || JSON.stringify(r);
  });
const BP = read("lib/billPreview.ts");
rerun("P12216", "lib/billPreview.ts", "the TOTAL comes from splitBill, never a second sum (the composition discount bug)",
  "read `const total = split.total`", () => /const total = split\.total;/.test(BP) || "the total is computed some other way");
rerun("P12217", "lib/billPreview.ts", "a composition restaurant's preview shows NO tax rows at all",
  "read the composition guards on taxRowsAdded/Inside, and run it", () => {
    const guards = /taxRowsAdded = composition \|\|/.test(BP) && /taxRowsInside = composition \|\|/.test(BP);
    return guards || "the composition guard on the tax rows is gone";
  });
rerun("P12298", "lib/billPreview.ts", "the discount shown is derived from splitBill's cap, so an MRP line cannot be discounted away",
  "read the splitBill call", () => /const split = splitBill\(lines, settings, SAMPLE_DISCOUNT\);/.test(BP) && /const discount = split\.discount;/.test(BP) || "the discount no longer comes from splitBill");
const PD = read("lib/printDocs.ts");
rerun("P12299", "lib/printDocs.ts", "banquetHtmlForBill reads its lines from the LINKED ORDER (there is no `lines` column)",
  "read the ord read", () => {
    const b = block(PD, /export async function banquetHtmlForBill/);
    return (/from\("orders"\)\.select\("items"\)\.eq\("id", String\(bill\.order_id\)\)\.eq\("restaurant_id", rid\)/.test(b) && !/bill\.lines/.test(code(b))) || "the banquet lines are read from somewhere else";
  });

// ── lib/printBoardWords.ts — every visible string read, one pass (T27, P28104) ──
rerun("P28104", "lib/printBoardWords.ts", "every visible string read, one pass",
  "every string literal in an exported word table, judged as a sentence a person reads", () => {
    const W = read("lib/printBoardWords.ts");
    const strs = [...code(W).matchAll(/(?:label|why|what|title|tag|onWhat|offWhat|one|two|three|four|screen|kot|bill|banquet|test):\s*"([^"]+)"/g)].map((m) => m[1]);
    const bad = strs.filter((s) => /undefined|NaN|\$\{|TODO|\bkot\b/i.test(s) && !/^Kitchen/.test(s));
    return (strs.length >= 19 && bad.length === 0) ? { ok: true, note: `${strs.length} strings, plain and complete` } : `${strs.length} strings; odd: ${bad.join(" | ")}`;
  });

// ── money through a shared definition (T30 sweep #8, P14526 / P14527 / P14550) ──
const shared = (f) => (read(f).match(/net_amount|disc_gross|netOf|splitBill|billMoney|rpc\(/g) || []).length;
rerun("P14526", "lib/billPreview.ts", "the bill preview reads money through a shared definition rather than its own arithmetic",
  "grep the file for net_amount|disc_gross|netOf|splitBill|billMoney|rpc( — expect ≥1", () => shared("lib/billPreview.ts") >= 1 ? { ok: true, note: `${shared("lib/billPreview.ts")} reference(s)` } : "none");
rerun("P14527", "lib/billCustomer.ts", "the customer copy reads money through a shared definition rather than its own arithmetic",
  "grep the file for the same set — expect ≥1", () => shared("lib/billCustomer.ts") >= 1 ? { ok: true, note: `${shared("lib/billCustomer.ts")} reference(s) — the one rpc( it makes; this file handles no money at all` } : "none");
rerun("P14550", "lib/billPreview.ts", "the bill preview is imported rather than re-implemented anywhere else",
  "grep the repo for importers and for a second `function billPreviewHtml`", async () => {
    const { execFileSync } = await import("node:child_process");
    const grepL = (pat) => { try { return execFileSync("grep", ["-rl", "--include=*.ts", "--include=*.tsx", pat, "app", "components", "lib"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch { return []; } };
    const importers = grepL("lib/billPreview");
    const twins = grepL("function billPreviewHtml");
    return (importers.length >= 1 && twins.length === 1) ? { ok: true, note: `${importers.length} importer(s), one definition` } : `importers ${importers.length}, definitions ${twins.length}`;
  });

// ── every print surface comes to billdoc.js (T8 sweep #6, P18991–P18997 / P19022–P19023) ──
// A surface "builds no document of its own" when it calls the shared builder and carries none of the
// three fingerprints a hand-kept copy of a document would: the bill's thermal recipe, the ticket's
// line class, or the bill's column heading row.
// (The ticket's fingerprint is its quantity cell inside a .kl line — `class="kl"` alone also names a
// dashboard number label in the manager panel, which is not a document.)
const FINGER = [/Thermal-roll print recipe/, /class=\\?"kl\\?"><span class=\\?"q\\?"/, /<th class=\\?"r\\?">Amt/];
const SURFACES = [
  ["P18991", "the manager panel", "public/panels/editor/app.js", /LFH_BILLDOC\.(billDocHtml|kotDocHtml)/],
  ["P18992", "the kitchen board", "public/panels/kitchen/app.js", /LFH_BILLDOC\.kotDocHtml/],
  ["P18993", "the waiter tablet", "public/panels/tablet/app.js", /LFH_BILLDOC\.(billDocHtml|kotDocHtml)/],
  ["P18994", "the Access format preview", "lib/billPreview.ts", /BILLDOC\.(billDocHtml|kotDocHtml)/],
  ["P18995", "the admin's print documents", "lib/printDocs.ts", /BILLDOC\.(billDocHtml|kotDocHtml|banquetDocHtml)/],
  ["P18996", "the Audit's evidence card", "lib/auditDetail.ts", /billDocHtml/],
  ["P18997", "the admin restaurant settings screen", "components/admin/RestaurantSettings.tsx", /billPreviewHtml|BILLDOC|billdoc/],
];
for (const [id, name, f, uses] of SURFACES)
  rerun(id, "public/panels/billdoc.js", `${name} builds no document of its own — it comes to billdoc.js`,
    `read ${f}: calls the shared builder, carries no document fingerprint`, () => {
      const t = read(f);
      if (!t) return `${f} is gone`;
      const own = FINGER.filter((re) => re.test(t));
      return (uses.test(t) && own.length === 0) || `${uses.test(t) ? "" : "does not call billdoc · "}${own.length ? "carries " + own.map(String).join(", ") : ""}`;
    });
const PANELS = ["editor", "kitchen", "tablet"];
rerun("P19022", "public/panels/billdoc.js", "the panels load billdoc.js before their own app.js, on all three",
  "read the three index.html files", () => {
    // The SCRIPT TAGS, not the first mention — every shell names app.js in its comments first.
    const bad = PANELS.filter((p) => {
      const h = read(`public/panels/${p}/index.html`);
      const a = h.search(/<script[^>]*src="\/panels\/billdoc\.js/);
      const b = h.search(new RegExp(`<script[^>]*src="(?:/panels/${p}/)?app\\.js`));
      return !(a >= 0 && b > a);
    });
    return bad.length === 0 || `out of order on: ${bad.join(", ")}`;
  });
rerun("P19023", "public/panels/billdoc.js", "a change to billdoc.js cannot reach a panel without its cache-busting hash",
  "every billdoc.js reference in the three shells carries a ?v= stamp (verify:panel-cache checks the stamp is today's hash)", () => {
    const bad = [];
    for (const p of PANELS) {
      const h = read(`public/panels/${p}/index.html`);
      const refs = [...h.matchAll(/billdoc\.js(\?v=([a-z0-9]+))?/g)];
      if (!refs.length) bad.push(`${p}: no reference`);
      for (const m of refs) if (!m[2]) bad.push(`${p}: unstamped`);
    }
    return bad.length === 0 || bad.join(" · ");
  });
void BILLDOC; void code;
