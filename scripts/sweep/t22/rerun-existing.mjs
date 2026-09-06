#!/usr/bin/env node
// scripts/sweep/t22/rerun-existing.mjs — SWEEP #8 · TERMINAL 22, STAGE 0.
//
// RE-RUN THE ROWS THAT ALREADY EXIST, BEFORE WRITING A NEW ONE. The ledger is 47,228 numbered
// checks and it returns nothing unless a later run re-executes the part that covers its files.
// This file re-runs every row in `.claude/sweep/LEDGER/T*.md` whose SUBJECT is one of terminal 22's
// six files, and prints `<id> <✅|❌|⏭> <note>` so the result can be written back into the row it
// came from, in the file it lives in.
//
// WHAT IS DELIBERATELY NOT HERE. Rows about `/api/admin/bill-audit` and `/api/admin/bills` — the
// ROUTES behind these screens — are not this terminal's files; whoever owns `/api/admin/*` re-runs
// those. Two terminals editing one row is how three ledger collisions have already happened.
//
// Run: node --experimental-strip-types scripts/sweep/t22/rerun-existing.mjs --base http://localhost:4322
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
registerHooks({ resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) { let p = join(root, spec.slice(2));
    if (!existsSync(p)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + e)) { p += e; break; }
    return next(pathToFileURL(p).href, ctx); }
  return next(spec, ctx);
} });
const env = Object.fromEntries(read(".env.local").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--base", "http://localhost:4000") || "").replace(/\/$/, "");
const ADMIN_COOKIE = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");

const BL = await import("@/lib/billLedger.ts");
const LT = await import("@/lib/logTrail.ts");
const LEDGER_PAGE = read("app/aevinite/bill-audit/page.tsx");
const CHANGES_PAGE = read("app/aevinite/bill-audit/changes/page.tsx");
const LOGS_PAGE = read("app/aevinite/logs/page.tsx");
const BLSRC = read("lib/billLedger.ts");
const LTSRC = read("lib/logTrail.ts");
const COMPLIANCE = read("docs/COMPLIANCE-GUARDRAILS.md");
const SHARED = read("components/admin/shared.tsx");
const BILLS_ROUTE = read("app/api/admin/bills/route.ts");
const AUDIT_ROUTE = read("app/api/admin/bill-audit/route.ts");

const out = [];
const ok = (id, note) => out.push([id, "✅", note || ""]);
const bad = (id, note) => out.push([id, "❌", note || ""]);
const skip = (id, note) => out.push([id, "⏭", note || ""]);
const t = (id, cond, note) => (cond ? ok(id, note) : bad(id, note));

// ── the live pages, read once each ───────────────────────────────────────────────────────────────
let page = {};
let live = true;
try {
  const { chromium } = await import("playwright");
  const br = await chromium.launch();
  const grab = async (path, w, h, skin) => {
    const c = await br.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    await c.addCookies([{ name: "lfh_staff_auth", value: ADMIN_COOKIE.split("=")[1], url: BASE },
      { name: "aevidine_skin", value: skin, url: BASE }]);
    const p = await c.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    const reqs = [];
    p.on("request", (r) => reqs.push(r.url()));
    let status = 0;
    try { const r = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }); status = r ? r.status() : 0; } catch {}
    await p.waitForTimeout(2500);
    const d = await p.evaluate(() => ({
      text: document.body.innerText || "",
      h1: document.querySelector("h1")?.textContent || "",
      docScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      boxes: [...document.querySelectorAll(".adm-logwrap, .adm-card")].filter((x) => x.scrollWidth > x.clientWidth + 2).length,
      activeSeverity: [...document.querySelectorAll('[aria-label="Filter by severity"] button')].filter((b) => b.className.includes("active")).map((b) => b.textContent.trim()),
      searchValue: document.querySelector('[aria-label="Search the log"]')?.value ?? null,
      chips: [...document.querySelectorAll(".blz-chip")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      restOptions: [...document.querySelectorAll('select[aria-label="Restaurant"] option')].length,
      links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      tabs: [...(document.querySelector(".adm-tabs")?.querySelectorAll("button") || [])].map((b) => b.textContent.trim()),
    }));
    await c.close();
    return { status, errs, reqs, ...d };
  };
  page["bills"] = await grab("/aevinite/bill-audit", 1440, 900, "dark");
  page["bills390"] = await grab("/aevinite/bill-audit", 390, 844, "dark");
  page["billsLight"] = await grab("/aevinite/bill-audit", 1440, 900, "light");
  page["changes"] = await grab("/aevinite/bill-audit/changes", 1440, 900, "dark");
  page["changes390"] = await grab("/aevinite/bill-audit/changes", 390, 844, "dark");
  page["changesLight"] = await grab("/aevinite/bill-audit/changes", 1440, 900, "light");
  page["logs"] = await grab("/aevinite/logs", 1440, 900, "dark");
  page["logs390"] = await grab("/aevinite/logs", 390, 844, "dark");
  page["logsLight"] = await grab("/aevinite/logs", 1440, 900, "light");
  page["logsErr"] = await grab("/aevinite/logs?level=error", 1440, 900, "dark");
  page["logsQ"] = await grab("/aevinite/logs?q=printer", 1440, 900, "dark");
  const rid = (await (await fetch(BASE + "/api/admin/bills?limit=5", { headers: { cookie: ADMIN_COOKIE } })).json())
    .restaurants?.[0]?.id;
  page["logsRid"] = rid ? await grab("/aevinite/logs?restaurant_id=" + rid, 1440, 900, "dark") : null;
  await br.close();
} catch (e) { live = false; console.error("live pages unavailable:", e.message); }
const api = async (p) => { const r = await fetch(BASE + p, { headers: { cookie: ADMIN_COOKIE }, cache: "no-store" }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const bills = live ? (await api("/api/admin/bills?limit=200")).json : null;
const changes = live ? (await api("/api/admin/bill-audit?page=1&count=1")).json : null;
const noLeak = (txt) => !["undefined", "NaN", "[object Object]", "${", "-->"].some((x) => txt.includes(x));

// ═══ T5 ═══
t("P35192", /table_reopened:/.test(LTSRC) && /table_reopened:/.test(SHARED) && /table_reopened: "Reopened the table/.test(read("public/panels/editor/app.js")),
  "all three maps still carry it · logTrail places it at Orders & bills › Reopen the table");
// ═══ T8 ═══
t("P03710", /A sale can be cancelled\. A sale can never disappear/.test(COMPLIANCE) && /Soft-delete/.test(COMPLIANCE) && !/\.delete\(\)/.test(BILLS_ROUTE),
  "§3.0 unchanged; the admin's own delete is still a soft delete");
t("P03965", /const live = orders\.filter\(\(o\) => !o\.deleted_at\)/.test(BLSRC) && /neq\("status", "cancelled"\)|status !== "cancelled"/.test(read("public/panels/billdoc.js") + read("public/panels/editor/app.js")),
  "the ledger drops soft-deleted orders; the printed bill drops cancelled + soft-deleted");
// ═══ T9 ═══
t("P44599", LT.placeOf("order_tip").area === "Orders & bills" && LT.placeOf("order_tip").screen === "Settle the bill",
  "order_tip → Orders & bills › Settle the bill");
// ═══ T12 ═══
t("P20739", LT.placeOf("rating_handled").area === "Guests" && LT.placeOf("customer_erase").area === "Guests" && /export function trailOf/.test(LTSRC),
  "both present — Guests › Ratings and Guests › Guest list");
{
  // The row was ❌ in sweep #6: the admin's log page rendered an actor without a raw-id guard.
  const raw = live && page.logs ? (page.logs.text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) || []) : [];
  t("P21013", live && raw.length === 0,
    live ? `REGRESSION CLOSED: no uuid is rendered on /aevinite/logs (${page.logs.text.length} characters read)` : "the app was not up");
}
// ═══ T17 ═══
t("P08061", /const \[opsErr, setOpsErr\] = useState\(false\)/.test(LOGS_PAGE) && /onClick=\{onRetry\}>Retry/.test(LOGS_PAGE), "Retry present");
t("P08062", /const \[audErr, setAudErr\] = useState\(false\)/.test(LOGS_PAGE) && /Couldn&rsquo;t load the removals record/.test(LOGS_PAGE), "Retry present");
t("P08063", /const \[custErr, setCustErr\] = useState\(false\)/.test(LOGS_PAGE) && /Couldn&rsquo;t load the customer log/.test(LOGS_PAGE), "Retry present");
t("P08251", live && page.logs.h1.replace(/\s+/g, " ").trim() === "Audit & logs", live ? `h1 reads "${page.logs.h1}"` : "the app was not up");
t("P08274", /r\.amount != null \? inr\(parseFloat\(String\(r\.amount\)\) \|\| 0\) : ""/.test(LOGS_PAGE) && /No ₹ spend here/.test(LOGS_PAGE),
  "the removal amount is part of the deletion record; the Customers tab shows no spend");
t("P08303", live && page.logs.errs.length === 0 && page.logs.status === 200, live ? `HTTP ${page.logs.status}, ${page.logs.errs.length} page error(s)` : "the app was not up");
skip("P08313", "dev-server double-mount makes a raw request COUNT meaningless (the row says so); the shape is asserted by P08314");
{
  const calls = live && page.logsRid ? page.logsRid.reqs.filter((u) => u.includes("/api/admin/oplog")) : [];
  const unscoped = calls.filter((u) => !u.includes("restaurant_id="));
  t("P08314", live && page.logsRid && calls.length > 0 && unscoped.length === 0,
    live && page.logsRid ? `${calls.length} oplog call(s), ${unscoped.length} unscoped` : "no restaurant to scope to");
}
t("P08315", live && page.logsErr.activeSeverity.length === 1 && /Errors/.test(page.logsErr.activeSeverity[0]),
  live ? `active: ${page.logsErr.activeSeverity.join("|")}` : "the app was not up");
t("P08316", live && page.logsQ.searchValue === "printer", live ? `search box holds "${page.logsQ.searchValue}"` : "the app was not up");
t("P08382", live && !page.logs.docScrollX && page.logs.boxes === 0, live ? `${page.logs.boxes} box(es) wider than the screen` : "the app was not up");
t("P08383", live && !page.logs390.docScrollX && page.logs390.boxes === 0,
  live ? `EXPECTATION MOVED ON: the 92px panel column no longer exists at 390px — the row now STACKS (item 4 this run). ${page.logs390.boxes} box(es) over-wide` : "the app was not up");
t("P08384", live && !page.logs390.docScrollX, live ? "the controls wrap; the page does not scroll sideways" : "the app was not up");
t("P08385", live && page.logs390.boxes === 0, live ? "inside" : "the app was not up");
t("P08386", /const showRed = isErr && !isResolved && !waitingUntil/.test(LOGS_PAGE) && /opacity: isResolved \? 0\.62 : 1/.test(LOGS_PAGE) && /textDecoration: isResolved \? "line-through"/.test(LOGS_PAGE),
  "an unresolved error is tinted and left-barred; a resolved one is muted and struck through");
t("P08387", /<div>What was removed<\/div><div>Why · by whom<\/div><div>When<\/div>/.test(LOGS_PAGE), "the three heads read What / Why · by whom / When");
t("P08388", /className="adm-logwrap aud-stack">/.test(LOGS_PAGE.slice(LOGS_PAGE.indexOf("function AudTable("))) , "aud-stack holds");
t("P08389", /Keep the Audit for/.test(LOGS_PAGE) && !/adm-warn/.test(LOGS_PAGE.slice(LOGS_PAGE.indexOf("Keep the Audit for") - 900, LOGS_PAGE.indexOf("Keep the Audit for"))),
  "neutral — a policy control, not a warning card");
t("P08390", live && page.logs390.boxes === 0,
  live ? "IMPROVED this run (item 4): the five-column Customers grid now stacks on a phone with a word in front of each cell" : "the app was not up");
t("P08391", live && page.logsLight.status === 200 && page.logsLight.errs.length === 0 && /color-mix\(in srgb, var\(--adm-danger\) 12%/.test(LOGS_PAGE),
  live ? "the light skin renders; the error tint is a 12% mix, not a flat red" : "the app was not up");
// ═══ T18 (the SCREENS only — its rows about /api/admin/bill-audit are that route's owner's) ═══
t("P08503", !/supabaseAdmin|lib\/supabaseAdmin/.test(LEDGER_PAGE + CHANGES_PAGE + LOGS_PAGE), "no server-only import on any of the three screens");
t("P08511", /Amounts shown for oversight/.test(LEDGER_PAGE), "the subtitle still says why");
skip("P08513", "T18's own territory list, not this terminal's six files");
t("P08515", /href="\/aevinite\/bill-audit\/changes"/.test(LEDGER_PAGE) && /href="\/aevinite\/bill-audit"/.test(CHANGES_PAGE), "both directions present");
t("P08899", BL.netOf({ net_amount: 472.5, total: 525, discount: 50, tax_rate: null }) === 472.5 && /ORDER_COLS = "[^"]*net_amount/.test(BILLS_ROUTE),
  "netOf returns the stored net; ORDER_COLS and MONEY_COLS both select it");
t("P08911", live && page.bills.status === 200 && page.bills.errs.length === 0, live ? `HTTP ${page.bills.status}, ${page.bills.errs.length} page error(s)` : "the app was not up");
{
  const acts = [...(AUDIT_ROUTE.match(/const BILL_ACTIONS = \[([\s\S]*?)\];/) || [, ""])[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const shared = [...(SHARED.match(/export const ACT_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/) || [, ""])[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
  const local = [...(CHANGES_PAGE.match(/const ACT: Record<string, \{ t: string; risk: boolean \}> = \{([\s\S]*?)\n\};/) || [, ""])[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
  const lost = acts.filter((a) => !local.includes(a) && !shared.includes(a));
  t("P08956", acts.length > 10 && lost.length === 0, `${acts.length} codes the endpoint can send · without words: ${lost.join(", ") || "none"}`);
}
t("P08971", live && page.changes.status === 200 && page.changes.errs.length === 0 && page.changesLight.errs.length === 0,
  live ? `dark ${page.changes.errs.length} error(s), light ${page.changesLight.errs.length}` : "the app was not up");
t("P23672", BL.netOf({ net_amount: 100, total: 999, disc_gross: 1 }) === 100, "the stored net wins, no arithmetic");
t("P50493", live && page.bills.h1.trim() === "Bills", live ? `reload lands on "${page.bills.h1}"` : "the app was not up");
t("P50494", live && page.changes.h1.replace(/\s+/g, " ").trim() === "Bills · Change log", live ? `reload lands on "${page.changes.h1}"` : "the app was not up");
t("P50980", live && page.bills.links.every((h) => !/^https?:/.test(h)), live ? `${page.bills.links.length} link(s), all relative` : "the app was not up");
t("P50981", live && page.changes.links.every((h) => !/^https?:/.test(h)), live ? `${page.changes.links.length} link(s), all relative` : "the app was not up");
t("P50983", live && page.bills.status === 200 && page.bills.h1.trim().length > 0, live ? `"${page.bills.h1}"` : "the app was not up");
t("P50984", live && page.changes.status === 200 && page.changes.h1.trim().length > 0, live ? `"${page.changes.h1}"` : "the app was not up");
t("P50986", live && page.logs.status === 200 && page.logs.h1.trim().length > 0, live ? `"${page.logs.h1}"` : "the app was not up");
t("P51387", /const del = b\.state === "deleted"/.test(LEDGER_PAGE) && /\{del && \(/.test(LEDGER_PAGE),
  "the banner is gated on b.state, not on deletedAt/deletedBy");
// ═══ T19 (the SCREENS only) ═══
t("P09380", live && page.logs.tabs.length === 3 && /Operations/.test(page.logs.tabs[0]), live ? `tabs: ${page.logs.tabs.join(" · ")}` : "the app was not up");
t("P09381", live && page.bills.chips.length === 7 && page.bills.chips.some((c) => /^Deleted/.test(c)) && page.bills.restOptions > 1,
  live ? `${page.bills.chips.length} chips · ${page.bills.restOptions} restaurant options` : "the app was not up");
t("P09382", live && changes && (changes.rows || []).every((r) => r.restaurantName && r.action), live ? `${(changes?.rows || []).length} rows, each named` : "the app was not up");
t("P09394", live && !page.logs390.docScrollX && page.logs390.boxes === 0, live ? `${page.logs390.boxes} over-wide box(es)` : "the app was not up");
t("P09395", live && !page.bills390.docScrollX && page.bills390.boxes === 0, live ? `${page.bills390.boxes} over-wide box(es)` : "the app was not up");
t("P09396", live && !page.changes390.docScrollX && page.changes390.boxes === 0, live ? `${page.changes390.boxes} over-wide box(es)` : "the app was not up");
{
  const chip = live ? (page.bills.chips.find((c) => /^Deleted/.test(c)) || "") : "";
  const n = Number((chip.match(/(\d[\d,]*)$/) || [, ""])[1].replace(/,/g, ""));
  t("P09404", live && bills && n === bills.deletedTotal, live ? `chip "${chip}" · deletedTotal ${bills?.deletedTotal}` : "the app was not up");
}
t("P09405", live && bills && page.bills.restOptions === (bills.restaurants || []).length + 1,
  live ? `${page.bills.restOptions} options for ${(bills?.restaurants || []).length} live restaurants (+ "All")` : "the app was not up");
t("P09406", live && changes && (changes.rows || []).filter((r) => r.restaurantName === "—").length === 0,
  live ? `0 of ${(changes?.rows || []).length} read "—"` : "the app was not up");
t("P09419", /r\.amount != null \? inr\(/.test(LOGS_PAGE), "the Removals rows show the amount removed — the admin's oversight view");
t("P09420", /redactMoney/.test(AUDIT_ROUTE) && /redactMoney/.test(read("app/api/admin/oplog/route.ts")), "the activity feed's rupees are stripped server-side");
t("P09425", live && page.billsLight.status === 200 && /hue-ink/.test(LEDGER_PAGE) && /\["--hue" as string\]/.test(LEDGER_PAGE),
  live ? "the light skin renders; the chip tone travels as --hue so globals.css can darken it" : "the app was not up");
t("P24328", live && page.logs.status === 200 && !/Something went wrong/.test(page.logs.text), live ? "no error banner" : "the app was not up");
t("P24329", live && page.bills.status === 200 && !/Something went wrong/.test(page.bills.text), live ? "no error banner" : "the app was not up");
t("P24330", live && page.changes.status === 200 && !/Something went wrong/.test(page.changes.text), live ? "no error banner" : "the app was not up");
t("P24343", live && !page.logs390.docScrollX && page.logs390.boxes === 0, live ? "nothing clipped, no sideways scroll" : "the app was not up");
t("P24344", live && !page.bills390.docScrollX && page.bills390.boxes === 0, live ? "nothing clipped, no sideways scroll" : "the app was not up");
t("P24345", live && !page.changes390.docScrollX && page.changes390.boxes === 0, live ? "nothing clipped, no sideways scroll" : "the app was not up");
t("P24358", live && noLeak(page.logs.text) && !/\\u[0-9a-f]{4}/.test(page.logs.text), live ? "clean" : "the app was not up");
t("P24359", live && noLeak(page.bills.text) && !/\\u[0-9a-f]{4}/.test(page.bills.text),
  live ? "clean — and item 1 THIS RUN removed a literal \\u2014 the All chip's tooltip was printing" : "the app was not up");
t("P24360", live && noLeak(page.changes.text) && !/\\u[0-9a-f]{4}/.test(page.changes.text), live ? "clean" : "the app was not up");
t("P24373", live && page.logs.text.replace(/\s+/g, "").length > 400, live ? `${page.logs.text.length} characters` : "the app was not up");
t("P24374", live && page.bills.text.replace(/\s+/g, "").length > 400, live ? `${page.bills.text.length} characters` : "the app was not up");
t("P24375", live && page.changes.text.replace(/\s+/g, "").length > 400, live ? `${page.changes.text.length} characters` : "the app was not up");
// ═══ T24 · lib/logTrail.ts ═══
{
  const written = [...new Set([...execSync(`grep -rhoE '(logAction|await log|logRow)\\(\\s*"[a-z]+",\\s*"[a-z0-9_]+"' ${root}/app ${root}/lib 2>/dev/null || true`,
    { encoding: "utf8", maxBuffer: 1 << 26 }).matchAll(/"([a-z0-9_]+)"\s*$/gm)].map((m) => m[1]))];
  const lost = written.filter((c) => { const p = LT.placeOf(c); return p.area === "System" && p.screen === "Other"; });
  t("P11654", written.length > 100 && lost.length === 0, `${written.length} codes at write sites · unplaced: ${lost.join(", ") || "none"}`);
}
t("P11655", LT.placeOf("no_such_action").area === "System" && LT.placeOf("no_such_action").screen === "Other", "honest, not invented");
t("P11656", (() => { for (const v of [null, undefined, "", "   ", 42, {}]) LT.placeOf(v); return true; })(), "never throws");
t("P11657", LT.placeOf("order_place").screen === "Take order", "the explicit entry wins over the ^order_ prefix");
t("P11658", LT.placeOf("order_something_new").screen === "Billing" && LT.placeOf("table_something_new").screen === "Tables", "first match wins");
t("P11659", LT.panelName("editor") === "Manager panel", "editor → Manager panel");
t("P11660", LT.panelName("warehouse") === "Warehouse" && LT.panelName(null) === "Unknown panel", "prints itself capitalised");
t("P11661", LT.targetOf({ table_number: "5", detail: 'x "y"', order_id: "abcdefgh" }) === "Table 5", "table_number wins");
t("P11662", LT.targetOf({ table_number: "Terrace" }) === "Terrace", "a named table prints as it stands");
t("P11663", LT.targetOf({ detail: 'created manager "ravi"' }) === "ravi", "the quoted run becomes the target");
t("P11664", LT.targetOf({ detail: "admin deleted bill #212" }) === "Bill #212", "Bill #212");
t("P11665", LT.targetOf({ order_id: "abcdef12-3456" }) === "Order abcdef12", "first eight characters");
t("P11666", LT.trailOf({ panel: "manager", action: "order_place" }).crumbs.length === 3, "a missing restaurant is dropped, not blank");
t("P11667", LT.trailOf({ panel: "manager", action: "order_place", table_number: "5" }).short === "Take order · Table 5", "screen · target");
t("P11668", !/^\s*import\s/m.test(LTSRC), "no imports at all");
t("P11746", LT.AREAS.every((a) => !/_/.test(a) && /^[A-Z]/.test(a)), LT.AREAS.join(" · "));
t("P11997", /✅ \*\*BUILT\*\*/.test(COMPLIANCE) && !/NOT BUILT YET/.test(COMPLIANCE) && existsSync(join(root, "supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql")),
  "§3.0b rule 11 still reads BUILT, and migration 365 is still on disk — the T24 fix has held");
// ═══ T25 · lib/billLedger.ts ═══
const O = (o = {}) => ({ id: "o1", session_id: "s1", total: null, discount: null, tax_rate: null, net_amount: null, disc_gross: null,
  status: "served", payment_status: "pending", payment_method: null, khata_at: null, deleted_at: null, deleted_by: null, delete_reason: null, ...o });
const S = (s = {}) => ({ id: "s1", status: "closed", bill_no: null, invoice_no: null, invoice_voided: null, table_number: null,
  restaurant_id: "r1", opened_at: null, closed_at: null, created_at: null, deleted_at: null, deleted_by: null, delete_reason: null, ...s });
t("P12117", BL.netOf(O({ net_amount: 472.5, total: 525, discount: 50, tax_rate: null })) === 472.5, "472.5");
t("P12118", BL.netOf(O({ total: 525, disc_gross: 52.5 })) === 472.5, "472.5");
t("P12119", BL.deriveBillState(S({ deleted_at: "x" }), [O({ payment_status: "paid" })]) === "deleted", "deleted wins");
t("P12120", BL.deriveBillState(S({ status: "open" }), [O({ payment_status: "paid" })]) === "running", "running");
t("P12121", BL.deriveBillState(S(), [O({ khata_at: "x" }), O({ id: "o2", payment_method: "On the house" }), O({ id: "o3", payment_status: "paid" })]) === "khata"
  && BL.deriveBillState(S(), [O({ payment_method: "On the house" }), O({ id: "o2", payment_status: "paid" })]) === "onhouse"
  && BL.deriveBillState(S(), [O({ payment_status: "paid" })]) === "settled"
  && BL.deriveBillState(S(), [O()]) === "cancelled", "khata > onhouse > settled > cancelled");
t("P12122", BL.lossOfClosedUnpaid([O({ status: "served" })], new Map()) === "yes", "yes");
t("P12123", BL.lossOfClosedUnpaid([O({ status: "cancelled" })], new Map()) === "unknown", "unknown");
t("P12124", BL.lossOfClosedUnpaid([O({ status: "received" })], new Map()) === "no", "no");
{
  const del = BL.rollUpBill(S({ deleted_at: "x" }), [O({ net_amount: 100, deleted_at: "x" }), O({ id: "o2", net_amount: 50, deleted_at: "x" })], "R");
  const liveB = BL.rollUpBill(S(), [O({ net_amount: 100, payment_status: "paid" }), O({ id: "o2", net_amount: 50, deleted_at: "x" })], "R");
  t("P12125", del.amount === 150 && liveB.amount === 100, `deleted ₹${del.amount} · live ₹${liveB.amount}`);
}
// ═══ T27 ═══
{
  // JUDGED, NOT GREPPED — which is what this row's own note asks for. Every hit is READ. The two in
  // lib/logTrail.ts are `targetOf()`'s sniffs on a log DETAIL: they pick a LABEL to print ("ravi",
  // "Bill #212") and decide no behaviour at all, and the file documents the caution. A third hit
  // anywhere, or either of these moving into a branch that changes what the app DOES, is the fault.
  const files = { "app/aevinite/bill-audit/page.tsx": LEDGER_PAGE, "app/aevinite/bill-audit/changes/page.tsx": CHANGES_PAGE,
    "app/aevinite/logs/page.tsx": LOGS_PAGE, "lib/billLedger.ts": BLSRC, "lib/logTrail.ts": LTSRC };
  const hits = [];
  for (const [f, src] of Object.entries(files))
    for (const m of src.matchAll(/\b(?:error|err|msg|message|reason|detail)\b[^\n]{0,40}\.(?:includes|match|test|startsWith)\(/g))
      hits.push(`${f}: ${m[0].trim()}`);
  const known = hits.filter((h) => h.startsWith("lib/logTrail.ts: ") && /detail \|\| ""\)\.match\($/.test(h));
  t("P13298", hits.length === known.length && known.length === 2,
    `${hits.length} hit(s), all READ: both are targetOf()'s label sniffs on a recorded detail — they choose a word to PRINT and branch on nothing. Unaccounted: ${hits.filter((h) => !known.includes(h)).join(" | ") || "none"}`);
}
t("P13300", !/\$\{[^}]*\bid\b[^}]*\}/.test(LOGS_PAGE.replace(/href=\{[^}]*\}/g, "")), "every hit is a query-string parameter or a <select value>, none reaches rendered text");
t("P13330", live && page.changes.text.length > 0 && !/lib\/i18n/.test(CHANGES_PAGE), live ? "still a staff/admin surface — English-only by decision" : "the app was not up");
t("P13331", live && page.bills.text.length > 0 && !/lib\/i18n/.test(LEDGER_PAGE), live ? "still a staff/admin surface — English-only by decision" : "the app was not up");
t("P13337", live && page.logs.text.length > 0 && !/lib\/i18n/.test(LOGS_PAGE), live ? "still a staff/admin surface — English-only by decision" : "the app was not up");
t("P28230", /Couldn&rsquo;t load the operations log/.test(LOGS_PAGE) && /Couldn&rsquo;t load the removals record/.test(LOGS_PAGE) && /Couldn&rsquo;t load the customer log/.test(LOGS_PAGE),
  "all three name what went wrong and offer Retry; none hands over a database sentence");
t("P28314", !/\$\{[^}]*\bid\b[^}]*\}/.test(LOGS_PAGE.replace(/href=\{[^}]*\}/g, "").replace(/trail=" \+ [^;]*/g, "")) && (live ? !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.test(page.logs.text) : true),
  "zero hits, and nothing uuid-shaped is on the rendered page either");
t("P28368", /Saved — the Audit is kept for \$\{years\} year/.test(LOGS_PAGE), "a complete sentence a person can read");
t("P28369", /Removed \$\{n\.toLocaleString\("en-IN"\)\} old/.test(LOGS_PAGE), "a complete sentence a person can read");
t("P28370", /Sent to Claude — it'll be looked at overnight/.test(LOGS_PAGE), "a complete sentence a person can read");
// ═══ T28 ═══
skip("P36584", "a sabotage row against verify:admin-money — re-run by that guard's owner; verify:admin-money itself was run GREEN this session against :4322");
// ═══ T29 ═══
{
  const req = read(".claude/REQUESTS.md");
  const line = (req.match(/^.*Logs: show restaurant name per entry.*$/m) || [""])[0];
  t("P14135", /restaurant_name/.test(LOGS_PAGE) && line.length > 0, `it shipped; the REQUESTS.md row reads: ${line.trim().slice(0, 80) || "(row not found)"}`);
}
{
  const sites = (LOGS_PAGE.match(/restaurant_name \?/g) || []).length;
  t("P14430", sites >= 3, `${sites} render site(s) on the admin log page, each with a store icon`);
}
// ═══ T30 ═══
t("P14501", /const netAmount = \(o: MoneyCols\) => netOf\(/.test(BILLS_ROUTE), "netAmount is a one-line alias for netOf, not a second definition");
t("P14502", /if \(o\.net_amount != null && Number\.isFinite\(Number\(o\.net_amount\)\)\) return Number\(o\.net_amount\)/.test(BLSRC), "the first branch returns the stored net");
t("P14503", /if \(o\.disc_gross != null/.test(BLSRC), "the second branch subtracts disc_gross");
t("P14505", /SUM\(o\.net_amount\)|sum\(o\.net_amount\)/i.test(execSync(`grep -rh "net_amount" ${root}/supabase/migrations | head -200 || true`, { encoding: "utf8" })) && BL.netOf(O({ net_amount: 5 })) === 5,
  "one stored net: the owner's report SUMs net_amount and netOf() returns it");
{
  const r = live ? await fetch(BASE + "/api/admin/bills?limit=500&state=deleted", { headers: { cookie: ADMIN_COOKIE } }).then((x) => x.json()) : null;
  t("P14506", live && r && r.deletedTotal > 0 && /Z-report \/ dashboards must include voids and deleted bills/.test(COMPLIANCE),
    live ? `STILL REQUIRED — ${r?.deletedTotal} binned bills are on this database and the rule is still written in §4. Do NOT "fix" this.` : "the app was not up");
}
{
  const importers = execSync(`grep -rl 'from "@/lib/billLedger"' ${root}/app ${root}/lib ${root}/components 2>/dev/null || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const second = execSync(`grep -rl "function deriveBillState" ${root}/app ${root}/lib ${root}/components 2>/dev/null || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  t("P14548", second.length === 1 && importers.length >= 1, `${importers.length} importer(s), 1 definition`);
}
t("P14828", live && page.bills.status === 200 && page.bills.errs.length === 0 && /Aevidine/.test(page.bills.text), live ? `HTTP 200, 0 page errors, console shell present` : "the app was not up");
t("P14830", live && page.logs.status === 200 && page.logs.errs.length === 0 && /Aevidine/.test(page.logs.text), live ? `HTTP 200, 0 page errors, console shell present` : "the app was not up");
t("P14867", live && page.changes.status === 200 && page.changes.errs.length === 0 && page.changes390.errs.length === 0,
  live ? `HTTP 200 at 1440 and 390, 0 page errors at both` : "the app was not up");
t("P14931", /rollUpBill\(s,/.test(BILLS_ROUTE) && /deriveBillState/.test(BLSRC) && /counts\.deleted = reads\.count\("deletedCount"\)/.test(BILLS_ROUTE),
  "every row is built through the one library; live and deleted counts are reported separately");
t("P14977", /Z-report \/ dashboards must include voids and deleted bills/.test(COMPLIANCE) && /CGST §132/.test(COMPLIANCE),
  "it looks wrong and it is REQUIRED — the rule and its citation are both still in the doc");
t("P14993", /Do not "fix" this|DO NOT "fix"|do NOT "fix"/i.test(read(".claude/sweep/LEDGER/INDEX.md")) || /do NOT "fix"/i.test(read(".claude/sweep/LEDGER/T30.md")),
  "re-affirmed: the standing pre-empt still carries the warning in those words");
{
  const mgr = read("app/api/editor/[...path]/route.ts");
  const hits = [...mgr.matchAll(/^.*delete_bill.*$/gm)].map((m) => m[0].trim());
  const nonComment = hits.filter((h) => !/^\s*(\/\/|\*)/.test(h));
  t("P29829", /canDeleteBill/.test(mgr) && nonComment.length === 0 && /cancel is the only route/i.test(COMPLIANCE),
    `READ THE SENTENCE, NOT THE PATH SCAN: ${hits.length} delete_bill hit(s), ${nonComment.length} outside a comment`);
}
t("P29830", /Z-report \/ dashboards must include voids and deleted bills/.test(COMPLIANCE), "STANDING PRE-EMPT — do not 'fix' the owner revenue figure that includes binned bills");
t("P29845", /export async function logAction/.test(read("lib/oplog.ts")) && /recordRemoval/.test(BILLS_ROUTE), "every money endpoint writes through logAction / recordRemoval");
{
  const panels = execSync(`grep -rn 'from("staff_actions")' ${root}/app/api/editor ${root}/app/api/owner 2>/dev/null | grep -i "delete" || true`, { encoding: "utf8" }).trim();
  t("P29854", panels.length === 0 && /non-disableable/.test(COMPLIANCE), `no delete on staff_actions from a restaurant's routes; the doc still calls the log non-disableable`);
}

out.sort((a, b) => a[0].localeCompare(b[0]));
for (const [id, mark, note] of out) console.log(`${id}\t${mark}\t${note}`);
const nbad = out.filter((r) => r[1] === "❌").length;
console.log(`\n${out.length} rows re-run · ${out.filter((r) => r[1] === "✅").length} ✅ · ${nbad} ❌ · ${out.filter((r) => r[1] === "⏭").length} ⏭`);
process.exit(0);
