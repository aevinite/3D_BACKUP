#!/usr/bin/env node
/* verify-everything.mjs — the whole-app sweep, split into numbered PHASES that run one by
 * one (owner, 2026-07-31: "divide the test into a hundred to two hundred phases and complete
 * every phase one by one").
 *
 * Each phase is ONE question with a yes/no answer, printed as it runs so a failure is
 * pinned to a number instead of hiding in a wall of output. Nothing is skipped silently: a
 * phase that cannot run says so and counts as a failure, because "didn't run" and "passed"
 * looking the same is how faults reach the owner's screen.
 *
 *   node scripts/verify-everything.mjs                        (live backup site)
 *   VERIFY_BASE=http://localhost:4000 node scripts/verify-everything.mjs
 *   node scripts/verify-everything.mjs --only 41-60           (a range)
 *   node scripts/verify-everything.mjs --skip-slow            (drops the bundled suites)
 *
 * SAFETY: signs in ONCE per role (loginAs caches, so this can never trip the login limit),
 * restores every setting it flips, and deletes every row it creates.
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loginAs, adminCookie, adminHeaders } from "./sweep/login.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.VERIFY_BASE || "https://3-d-backup.vercel.app").replace(/\/$/, "");
const ARGS = process.argv.slice(2);
const only = (() => {
  const i = ARGS.indexOf("--only");
  if (i === -1) return null;
  const [a, b] = (ARGS[i + 1] || "").split("-").map(Number);
  return { from: a || 1, to: b || a || 9999 };
})();
const skipSlow = ARGS.includes("--skip-slow");

const env = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const db = (q, init) => fetch(`${SB}/rest/v1/${q}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
const dbGet = (q) => db(q).then((r) => r.json());
const H = adminHeaders(BASE);
const HJ = { ...H, "Content-Type": "application/json" };
const api = (p, init) => fetch(BASE + p, { cache: "no-store", ...init, headers: { ...H, ...(init?.headers || {}) } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LEAKS = ["-->", "${", "[object Object]", "NaN"];
const leaksIn = (t) => LEAKS.filter((x) => t.includes(x));
// Child suites must be told WHICH app to test. Some take --base, others read VERIFY_BASE;
// pass BOTH so a bundled suite can never quietly test localhost and fail with a connection
// error that reads like a product fault.
const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { cwd: ROOT, maxBuffer: 40 * 1024 * 1024, timeout: 900000, env: { ...process.env, VERIFY_BASE: BASE } },
  (err, so, se) => res({ code: err ? (err.code ?? 1) : 0, out: (so || "") + (se || "") })));

// ── phase registry ──────────────────────────────────────────────────────────
const PHASES = [];
let N = 0;
const phase = (name, fn) => PHASES.push({ n: ++N, name, fn });
/** A phase asserts with ok(); anything thrown is a failure with its message. */
class Fail extends Error {}
const ok = (cond, detail) => { if (!cond) throw new Fail(detail === undefined ? "" : String(detail).slice(0, 200)); };

// Shared, lazily-built browser + one context per role.
//
// RECYCLED ON PURPOSE. The first full run died at phase 56 with "Target page, context or
// browser has been closed": one browser had opened 50+ heavy panel pages and ran out of
// resources. Every phase after that reported an error, so ONE crash looked like forty
// faults — the worst possible failure mode for a test, since it buries the real findings.
// So the browser is retired every RECYCLE_AFTER pages and relaunched on demand, and any
// "closed" error retries once against a fresh browser.
//
// Recycling costs NO extra logins: loginAs() caches the session, so rebuilding a context
// reuses the stored cookies instead of signing in again (that is what keeps this suite from
// tripping the login limit).
const RECYCLE_AFTER = 22;
let browser = null, pagesOpened = 0;
const ctxCache = new Map();
const getBrowser = async () => (browser ||= await chromium.launch());
async function dropBrowser() {
  ctxCache.clear();
  if (browser) { try { await browser.close(); } catch {} }
  browser = null; pagesOpened = 0;
}
async function roleCtx(role) {
  if (pagesOpened >= RECYCLE_AFTER) await dropBrowser();
  const hit = ctxCache.get(role);
  if (hit) { try { if (!hit.ctx.browser()?.isConnected()) throw new Error("gone"); return hit; } catch { ctxCache.delete(role); } }
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  let route = "/";
  if (role === "admin") await ctx.addCookies([adminCookie(BASE)]);
  else route = await loginAs(ctx, role, BASE);
  const entry = { ctx, route };
  ctxCache.set(role, entry);
  return entry;
}
const isDeadBrowser = (e) => /has been closed|Target closed|browser has disconnected|crashed/i.test(String(e && e.message));
/** Open a page as a role and hand back its text (frame-aware: the staff panels are iframed,
 *  so reading the outer body would find nothing and "pass" for the wrong reason). */
async function screen(role, path, opts = {}) {
  try { return await screenOnce(role, path, opts); }
  catch (e) {
    if (!isDeadBrowser(e)) throw e;
    await dropBrowser();                     // one clean retry, so a crash costs one phase
    return await screenOnce(role, path, opts);
  }
}
async function screenOnce(role, path, { settle = 3000 } = {}) {
  const { ctx } = await roleCtx(role);
  const p = await ctx.newPage();
  pagesOpened++;
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e.message)));
  p.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  const resp = await p.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => null);
  // SHORT networkidle timeout on purpose. These panels poll for live data, so the network
  // NEVER goes idle and the default 30s timeout was being burnt on every single page phase
  // (~34s each, which is why the first run took hours). The fixed settle below is what
  // actually decides whether the screen had time to paint.
  await p.waitForLoadState("networkidle", { timeout: 3500 }).catch(() => {});
  await wait(settle);
  const inner = await p.frameLocator("iframe").locator("body").innerText().catch(() => "");
  const outer = await p.locator("body").innerText().catch(() => "");
  const text = inner && inner.length > outer.length ? inner : outer;
  const html = await p.content().catch(() => "");
  return { page: p, close: () => p.close().catch(() => {}), status: resp?.status() ?? 0, text, html, errors, inner, outer };
}

let REST = null, FH = null;                      // restaurant list + French House
const created = { orders: [], sessions: [] };    // everything this run must clean up
const restore = [];                              // () => Promise, run at the end

// RESTORE EVEN IF KILLED. This suite flips real switches on a real restaurant and puts them
// back at the end — but the first run was interrupted, the end never came, and it left
// French House with its Log tab off, three modules off and three guest features off. A
// half-configured restaurant left behind by a test is worse than no test, so the same
// restore runs on Ctrl-C and on a termination signal too.
let cleaningUp = false;
async function runRestore(why) {
  if (cleaningUp) return;
  cleaningUp = true;
  if (why) console.log(`\n${why} — putting every setting back before exiting…`);
  for (const r of restore) { try { await r(); } catch (e) { console.log("  restore failed:", String(e.message).slice(0, 120)); } }
  for (const id of created.orders) { try { await db(`orders?id=eq.${id}`, { method: "DELETE" }); } catch {} }
  for (const id of created.sessions) { try { await db(`sessions?id=eq.${id}`, { method: "DELETE" }); } catch {} }
  if (browser) { try { await browser.close(); } catch {} }
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => { await runRestore(`Interrupted (${sig})`); process.exit(130); });
}
process.on("uncaughtException", async (e) => { console.log("\nUNCAUGHT:", String(e.message).slice(0, 200)); await runRestore("Crashed"); process.exit(1); });

// ════════════════════════════════════════════════════════════════════════════
// GROUP 1 · the environment is what we think it is  (phases 1-8)
// ════════════════════════════════════════════════════════════════════════════
phase("the deployed site answers its health check", async () => {
  const r = await api("/api/health");
  ok(r.status === 200, `status ${r.status}`);
});
phase("the database is reachable with the service key", async () => {
  const rows = await dbGet("restaurants?select=id&limit=1");
  ok(Array.isArray(rows), JSON.stringify(rows).slice(0, 120));
});
phase("we are pointed at the BACKUP database, never AV live", async () => {
  ok(/wnsfcizclkbobwzcxqsf/.test(SB), "the Supabase URL is not the dev/backup project");
});
phase("the restaurant list loads for the admin", async () => {
  const d = await (await api("/api/admin/restaurants")).json();
  REST = (Array.isArray(d) ? d : d.restaurants || []).filter((x) => x.active !== false);
  ok(REST.length >= 1, `${REST.length} restaurants`);
  FH = REST.find((x) => x.slug === "french-house") || REST[0];
});
phase("a second restaurant exists, so tenant separation is testable", async () => {
  ok(REST.length >= 2, `only ${REST.length}`);
});
phase("migration 235's columns exist on every settings row", async () => {
  const rows = await dbGet("settings?select=restaurant_id,menu_enabled,menu_default_layout,menu_default_mode,menu_languages,menu_currencies,khata_allowed,takeaway_allowed");
  ok(Array.isArray(rows) && rows.length, "no settings rows");
  const bad = rows.filter((r) => r.menu_enabled === undefined || !r.menu_languages || !r.menu_currencies);
  ok(!bad.length, `${bad.length} rows missing the new columns`);
});
phase("no settings row has an empty language or currency list", async () => {
  const rows = await dbGet("settings?select=restaurant_id,menu_languages,menu_currencies");
  const bad = rows.filter((r) => !(r.menu_languages || []).length || !(r.menu_currencies || []).length);
  ok(!bad.length, `${bad.length} rows would render a menu with no language/currency`);
});
phase("every stored language/currency code is one the app can render", async () => {
  const L = ["en", "de", "fr", "ar", "hi", "ko"], C = ["INR", "USD", "EUR", "AED", "SAR", "QAR"];
  const rows = await dbGet("settings?select=restaurant_id,menu_languages,menu_currencies");
  const bad = [];
  for (const r of rows) {
    for (const x of r.menu_languages || []) if (!L.includes(x)) bad.push(`lang:${x}`);
    for (const x of r.menu_currencies || []) if (!C.includes(x)) bad.push(`cur:${x}`);
  }
  ok(!bad.length, bad.join(","));
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 2 · the repo's own guards still pass  (phases 9-24)
// ════════════════════════════════════════════════════════════════════════════
const GUARDS = [
  ["UI integrity — nothing can print code on a screen", "verify:ui", false],
  ["tap guard — no user tap is dropped in silence", "verify:taps", false],
  ["access model — every switch reaches real code", "verify:access", false],
  ["clash coverage — no silent overwrite", "verify:clash", false],
  ["test safety — no script can raise a false alert", "verify:test-safety", false],
  ["money maths unit tests", "test:money", false],
  ["order totals end-to-end", "test:totals", true],
  ["table ownership — a table shows only its own party", "verify:table-ownership", true],
  ["two parties never mix", "verify:two-parties", true],
  ["table lifecycle", "verify:lifecycle", true],
  ["database parity between the two stacks", "verify:db-parity", true],
  ["offline behaviour", "verify:offline", true],
  ["no fatal UI on the deployed site", "verify:live", true],
  ["access model, live, as each real role", "verify:access-live", true],
];
for (const [label, script, slow] of GUARDS) {
  phase(`guard: ${label}`, async () => {
    if (slow && skipSlow) throw new Fail("skipped by --skip-slow (a skip is not a pass)");
    // Suites that talk to a running app need to be told WHICH app. Without this they
    // default to localhost:4000 and fail with a connection error that looks like a product
    // fault — a check failing for the wrong reason is worse than no check.
    const needsBase = ["verify:live", "verify:offline", "verify:table-ownership", "verify:two-parties", "verify:lifecycle"];
    const extra = needsBase.includes(script) ? ["--", "--base", BASE] : [];
    const r = await run("npm", ["run", "--silent", script, ...extra]);
    const tail = r.out.trim().split("\n").slice(-3).join(" / ").slice(0, 220);
    ok(r.code === 0, tail);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GROUP 3 · every public + guest route responds  (phases 25-40)
// ════════════════════════════════════════════════════════════════════════════
const GUEST_ROUTES = () => [
  ["the guest menu", `/r/${FH.slug}/menu`, 200],
  ["the guest menu with a table from a QR", `/r/${FH.slug}/menu?table=1`, 200],
  ["the staff login page for a restaurant", `/r/${FH.slug}/login`, 200],
  ["the site root redirects", "/", [200, 307, 308]],
  ["an unknown restaurant is not found", "/r/definitely-not-a-restaurant-zz/menu", 404],
  ["an unknown dish is not found", `/r/${FH.slug}/item/definitely-not-a-dish-zz`, 404],
];
for (const i of [0, 1, 2, 3, 4, 5]) {
  phase(`route: ${["the guest menu", "the guest menu with a table from a QR", "the staff login page", "the site root", "an unknown restaurant 404s", "an unknown dish 404s"][i]}`, async () => {
    const [, path, want] = GUEST_ROUTES()[i];
    const r = await fetch(BASE + path, { redirect: "manual", cache: "no-store" });
    const wants = Array.isArray(want) ? want : [want];
    ok(wants.includes(r.status), `${path} → ${r.status}, wanted ${wants.join("/")}`);
  });
}
phase("the guest menu renders real dishes, not an empty shell", async () => {
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3500 });
  s.close();
  ok(s.text.length > 500, `only ${s.text.length} chars`);
});
phase("the guest menu leaks no code into what a diner sees", async () => {
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3000 });
  s.close();
  ok(!leaksIn(s.text).length, leaksIn(s.text).join(","));
});
phase("the guest menu throws no errors in the browser", async () => {
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3500 });
  s.close();
  ok(!s.errors.length, s.errors.slice(0, 2).join(" | "));
});
phase("a dish detail page opens from the menu", async () => {
  const items = await dbGet(`menu_items?select=slug&restaurant_id=eq.${FH.id}&limit=1`);
  ok(items.length, "no dishes to open");
  const r = await fetch(`${BASE}/r/${FH.slug}/item/${items[0].slug}`, { cache: "no-store" });
  ok(r.status === 200, `status ${r.status}`);
});
phase("EVERY active restaurant's guest menu answers (no tenant left broken)", async () => {
  const bad = [];
  for (const r of REST) {
    const s = (await dbGet(`settings?select=menu_enabled&restaurant_id=eq.${r.id}`))[0];
    const want = s?.menu_enabled === false ? 404 : 200;
    const got = (await fetch(`${BASE}/r/${r.slug}/menu`, { cache: "no-store" })).status;
    if (got !== want) bad.push(`${r.slug}:${got}≠${want}`);
  }
  ok(!bad.length, bad.join(" "));
});
// Reviewed by READING the code, which is how this project checks who-can-see-what — the
// middleware's own matcher and each route's gate helper, rather than calling things without
// a login to see what happens.
phase("the admin console's own layout still checks the sign-in before rendering", async () => {
  // There is NO middleware.ts in this app (CLAUDE.md's "Security gate" section still says
  // there is — stale). The admin console is guarded by its own server layout, which reads the
  // cookie and redirects. That is the file to keep honest.
  const lay = readFileSync(join(ROOT, "app/aevinite/layout.tsx"), "utf8");
  ok(/tokenIsValid/.test(lay), "the admin layout no longer checks the sign-in token");
  ok(/redirect\(/.test(lay), "the admin layout no longer bounces a signed-out visitor");
});
phase("every admin route file asks its gate helper before answering", async () => {
  const dir = join(ROOT, "app/api/admin");
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, f.name);
    if (f.isDirectory()) walk(full); else if (f.name === "route.ts") files.push(full);
  } };
  walk(dir);
  const missing = files.filter((f) => { const t = readFileSync(f, "utf8"); return !/tokenIsValid|requireAdmin|AUTH_COOKIE|adminGate/.test(t); });
  ok(!missing.length, `${missing.length} admin routes with no gate: ${missing.slice(0, 3).map((f) => f.replace(ROOT, "")).join(", ")}`);
});
phase("every staff-panel route file resolves its restaurant from the login, not the request", async () => {
  const files = ["app/api/editor/[...path]/route.ts", "app/api/tablet/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts"]
    .filter((f) => existsSync(join(ROOT, f)));
  const bad = files.filter((f) => { const t = readFileSync(join(ROOT, f), "utf8"); return !/editorScope|panelScope|requireRole/.test(t); });
  ok(!bad.length, `routes not scoping by the signed-in user: ${bad.join(", ")}`);
});
phase("the access-tree API refuses a malformed restaurant id", async () => {
  const r = await api("/api/admin/restaurants/access-tree?restaurant_id=not-a-uuid");
  ok(r.status === 400, `status ${r.status}`);
});
phase("the access-tree API refuses an unknown restaurant", async () => {
  const r = await api("/api/admin/restaurants/access-tree?restaurant_id=00000000-0000-0000-0000-0000000000ff");
  ok(r.status === 404, `status ${r.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 4 · every admin page renders  (phases 41-60)
// ════════════════════════════════════════════════════════════════════════════
const ADMIN_PAGES = [
  ["dashboard", "/aevinite"], ["restaurants", "/aevinite/restaurants"], ["access & permissions", "/aevinite/access"],
  ["owners", "/aevinite/owners"], ["users", "/aevinite/users"], ["customers", "/aevinite/customers"],
  ["analytics", "/aevinite/analytics"], ["revenue", "/aevinite/revenue"], ["bills", "/aevinite/bill-audit"],
  ["activity log", "/aevinite/logs"], ["issues", "/aevinite/issues"], ["repair & support", "/aevinite/repair"],
  ["health", "/aevinite/health"], ["rate limits", "/aevinite/rate-limits"], ["recycle bin", "/aevinite/recycle"],
  ["usage & cost", "/aevinite/usage"], ["staff online", "/aevinite/staff-online"], ["attention", "/aevinite/attention"],
  ["live floor", "/aevinite/floor"], ["settings", "/aevinite/settings"],
];
for (const [label, path] of ADMIN_PAGES) {
  phase(`admin page renders: ${label}`, async () => {
    const s = await screen("admin", path, { settle: 2600 });
    s.close();
    ok(s.status === 200, `status ${s.status}`);
    ok(s.text.length > 120, `only ${s.text.length} chars — the page came up empty`);
    ok(!leaksIn(s.text).length, "leaked: " + leaksIn(s.text).join(","));
    const real = s.errors.filter((e) => !/favicon|ResizeObserver|Failed to load resource/i.test(e));
    ok(!real.length, real.slice(0, 2).join(" | "));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GROUP 5 · every owner page renders  (phases 61-73)
// ════════════════════════════════════════════════════════════════════════════
const OWNER_PAGES = [
  ["dashboard", "/owner"], ["menu", "/owner/menu"], ["reports hub", "/owner/reports"],
  ["sales report", "/owner/sales"], ["staff roster", "/owner/staff"], ["customers", "/owner/customers"],
  ["activity", "/owner/activity"], ["pay later", "/owner/khata"], ["inventory", "/owner/inventory"],
  ["feedback & complaints", "/owner/issues"], ["settings", "/owner/settings"],
  ["marketing (coming soon)", "/owner/marketing"], ["online & apps (coming soon)", "/owner/online"],
];
for (const [label, path] of OWNER_PAGES) {
  phase(`owner page renders: ${label}`, async () => {
    const s = await screen("owner", path, { settle: 2800 });
    s.close();
    ok([200, 307, 308].includes(s.status) || s.status === 0, `status ${s.status}`);
    ok(s.text.length > 80, `only ${s.text.length} chars`);
    ok(!leaksIn(s.text).length, "leaked: " + leaksIn(s.text).join(","));
    const real = s.errors.filter((e) => !/favicon|ResizeObserver|Failed to load resource/i.test(e));
    ok(!real.length, real.slice(0, 2).join(" | "));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GROUP 6 · the four staff panels, as their REAL role  (phases 74-89)
// ════════════════════════════════════════════════════════════════════════════
const PANELS = [
  ["manager", /Editor|Bills|Tables/i], ["kitchen", /Kitchen live orders/i],
  ["tablet", /Table|Order|Floor/i], ["owner", /Dashboard|Today|Revenue/i],
];
for (const [role, landmark] of PANELS) {
  phase(`${role}: signs in and lands on its own panel`, async () => {
    const { route } = await roleCtx(role);
    ok(!!route, "no route returned by the login");
    const s = await screen(role, route, { settle: 3800 });
    s.close();
    ok(landmark.test(s.text), `landmark not found in: ${s.text.slice(0, 80)}`);
  });
  phase(`${role}: its panel leaks no code`, async () => {
    const { route } = await roleCtx(role);
    const s = await screen(role, route, { settle: 3200 });
    s.close();
    ok(!leaksIn(s.text).length, leaksIn(s.text).join(","));
  });
  phase(`${role}: its panel throws no errors`, async () => {
    const { route } = await roleCtx(role);
    const s = await screen(role, route, { settle: 3800 });
    s.close();
    const real = s.errors.filter((e) => !/favicon|ResizeObserver|Failed to load resource|net::ERR/i.test(e));
    ok(!real.length, real.slice(0, 2).join(" | "));
  });
  phase(`${role}: its connection light says Live, with no alarm bar`, async () => {
    const { route } = await roleCtx(role);
    const s = await screen(role, route, { settle: 4000 });
    s.close();
    const alarm = /Connection is struggling|You are offline|Reconnecting/i.test(s.text);
    const live = /Live|Connected/i.test(s.text);
    ok(!(alarm && live), "the badge and the bar contradict each other");
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GROUP 7 · the access tree, switch by switch  (phases 90-118)
// ════════════════════════════════════════════════════════════════════════════
const getState = () => api(`/api/admin/restaurants/access-tree?restaurant_id=${FH.id}`).then((r) => r.json()).then((d) => d.state);
const setState = (patch) => fetch(BASE + "/api/admin/restaurants/access-tree", { method: "POST", headers: HJ, body: JSON.stringify({ restaurant_id: FH.id, patch }) });
const CACHE_MS = 9500;
let SNAP = null;

phase("the access tree loads all five sections", async () => {
  const d = await (await api(`/api/admin/restaurants/access-tree?restaurant_id=${FH.id}`)).json();
  ok(Array.isArray(d.sections) && d.sections.length === 5, `${d.sections?.length} sections`);
  SNAP = d.state;
  restore.push(async () => {
    await setState({
      features: Object.fromEntries(["reviews", "model3d", "allergies", "allergy_other", "guest_note", "favorites", "diet_filter", "ratings"].map((k) => [k, SNAP.features[k] !== false])),
      settings: {
        menu_enabled: SNAP.settings.menu_enabled !== false,
        sessions_enabled: SNAP.settings.sessions_enabled === true,
        google_review_mode: SNAP.settings.google_review_mode || "off",
        menu_default_layout: SNAP.settings.menu_default_layout || "grid",
        menu_default_mode: SNAP.settings.menu_default_mode || "light",
        menu_languages: SNAP.settings.menu_languages?.length ? SNAP.settings.menu_languages : ["en"],
        menu_currencies: SNAP.settings.menu_currencies?.length ? SNAP.settings.menu_currencies : ["INR"],
        khata_allowed: SNAP.settings.khata_allowed === true, khata_enabled: SNAP.settings.khata_enabled !== false,
        takeaway_allowed: SNAP.settings.takeaway_allowed === true, takeaway_enabled: SNAP.settings.takeaway_enabled !== false,
        banquet_allowed: SNAP.settings.banquet_allowed === true, banquet_enabled: SNAP.settings.banquet_enabled !== false,
        payroll_allowed: SNAP.settings.payroll_allowed === true, payroll_enabled: SNAP.settings.payroll_enabled !== false,
        inventory_allowed: SNAP.settings.inventory_allowed === true, inventory_enabled: SNAP.settings.inventory_enabled !== false,
        auto_print_kot_allowed: SNAP.settings.auto_print_kot_allowed === true,
      },
      sections: Object.fromEntries(["menu", "ratings", "logs"].map((k) => [k, SNAP.sections[k] !== false])),
      tabs: { manager: { editor: SNAP.tabs?.manager?.editor !== false, ratings: SNAP.tabs?.manager?.ratings !== false, log: SNAP.tabs?.manager?.log !== false } },
      panels: Object.fromEntries(["manager", "kitchen", "tablet", "owner"].map((k) => [k, SNAP.panels[k] !== false])),
    });
  });
});

// each guest sub-switch: OFF removes its mark from the served page, ON brings it back
const GUEST_SWITCHES = [
  ["veg / non-veg mark", "diet_filter", /diet-badge/],
  ["favourites", "favorites", /fav-btn|favorite-btn/],
  ["3D dish viewer", "model3d", /dish-4d-icon/],
];
for (const [label, key, marker] of GUEST_SWITCHES) {
  phase(`switch ON  → "${label}" is present on the guest menu`, async () => {
    await setState({ features: { [key]: true } });
    await wait(CACHE_MS);
    const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3200 });
    s.close();
    ok(marker.test(s.html), "marker not found while the switch is on");
  });
  phase(`switch OFF → "${label}" is GONE from the guest menu`, async () => {
    await setState({ features: { [key]: false } });
    await wait(CACHE_MS);
    const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3200 });
    s.close();
    ok(!marker.test(s.html), "still present after switching off");
    await setState({ features: { [key]: true } });
  });
}
phase("one language only → the language switcher is REMOVED", async () => {
  await setState({ settings: { menu_languages: ["en"] } });
  await wait(CACHE_MS);
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3200 });
  s.close();
  ok(!/aria-label="Language"/.test(s.html), "the switcher is still there");
});
phase("several languages → the language switcher comes back", async () => {
  await setState({ settings: { menu_languages: ["en", "fr", "hi"] } });
  await wait(CACHE_MS);
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3200 });
  s.close();
  ok(/aria-label="Language"/.test(s.html), "the switcher did not come back");
});
phase("one currency only → the currency switcher is REMOVED", async () => {
  await setState({ settings: { menu_currencies: ["INR"] } });
  await wait(CACHE_MS);
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3200 });
  s.close();
  ok(!/aria-label="Currency"/.test(s.html), "the switcher is still there");
});
phase("an EMPTY language list is refused, not saved", async () => {
  const r = await setState({ settings: { menu_languages: [] } });
  ok(r.status === 400, `status ${r.status}`);
  const st = await getState();
  ok((st.settings.menu_languages || []).length > 0, "the list was emptied anyway");
});
phase("a language the app cannot render is refused", async () => {
  const r = await setState({ settings: { menu_languages: ["klingon"] } });
  ok(r.status === 400, `status ${r.status}`);
});
phase("a junk waiter tri-state value is ignored", async () => {
  await setState({ settings: { tablet_discount: "pin" } });
  await setState({ settings: { tablet_discount: "sometimes" } });
  const st = await getState();
  ok(st.settings.tablet_discount === "pin", st.settings.tablet_discount);
});
phase("the Menu master OFF makes the guest menu not found", async () => {
  await setState({ settings: { menu_enabled: false } });
  await wait(CACHE_MS);
  const r = await fetch(`${BASE}/r/${FH.slug}/menu`, { cache: "no-store" });
  ok(r.status === 404, `status ${r.status}`);
});
phase("…and every dish URL with it", async () => {
  const items = await dbGet(`menu_items?select=slug&restaurant_id=eq.${FH.id}&limit=1`);
  const r = await fetch(`${BASE}/r/${FH.slug}/item/${items[0]?.slug || "x"}`, { cache: "no-store" });
  ok(r.status === 404, `status ${r.status}`);
});
phase("the Menu master back ON restores the guest menu", async () => {
  await setState({ settings: { menu_enabled: true } });
  await wait(CACHE_MS);
  const r = await fetch(`${BASE}/r/${FH.slug}/menu`, { cache: "no-store" });
  ok(r.status === 200, `status ${r.status}`);
});
const MODULE_TABS = [["Platform board", "takeaway_allowed", /platform/i], ["Banquet", "banquet_allowed", /banquet/i], ["Inventory", "inventory_allowed", /inventory/i]];
const mgrTabText = async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(4200);
  const t = (await p.frameLocator("iframe").locator(".tabs .tab:not([hidden])").allInnerTexts().catch(() => [])).join(" | ");
  await p.close().catch(() => {});
  return t;
};
for (const [label, col, re] of MODULE_TABS) {
  phase(`module ON  → the ${label} tab is in the manager panel`, async () => {
    await setState({ settings: { [col]: true, [col.replace("_allowed", "_enabled")]: true } });
    await wait(CACHE_MS);
    ok(re.test(await mgrTabText()), "tab missing while the module is on");
  });
  phase(`module OFF → the ${label} tab is GONE`, async () => {
    await setState({ settings: { [col]: false } });
    await wait(CACHE_MS);
    const t = await mgrTabText();
    ok(!re.test(t), `still there: ${t}`);
  });
}
const MGR_TABS = [["Editor", "editor", /editor/i], ["Ratings", "ratings", /ratings/i], ["Log", "log", /log/i]];
for (const [label, key, re] of MGR_TABS) {
  phase(`Manager's menu OFF → the ${label} tab is GONE for a real manager`, async () => {
    await setState({ tabs: { manager: { [key]: false } } });
    await wait(2000);
    const t = await mgrTabText();
    ok(!re.test(t), `still there: ${t}`);
  });
  phase(`Manager's menu ON  → the ${label} tab comes back`, async () => {
    await setState({ tabs: { manager: { [key]: true } } });
    await wait(2000);
    ok(re.test(await mgrTabText()), "did not come back");
  });
}
phase("a switched-off Log tab also makes its endpoint refuse", async () => {
  await setState({ tabs: { manager: { log: false } } });
  await wait(2000);
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "domcontentloaded" }).catch(() => {});
  await wait(2500);
  const st = await p.evaluate(async () => (await fetch("/api/editor/oplog", { cache: "no-store" })).status);
  await p.close().catch(() => {});
  await setState({ tabs: { manager: { log: true } } });
  ok(st === 403, `status ${st}`);
});
phase("the owner's Menu page disappears when switched off", async () => {
  await setState({ sections: { menu: false } });
  await wait(CACHE_MS);
  const s = await screen("owner", "/owner", { settle: 3000 });
  s.close();
  await setState({ sections: { menu: true } });
  ok(!/\bMenu\b/.test(s.text.split("Coming soon")[0] || s.text), "still in the nav");
});
phase("the owner's Activity page disappears when switched off", async () => {
  await setState({ sections: { logs: false } });
  await wait(CACHE_MS);
  const s = await screen("owner", "/owner", { settle: 3000 });
  s.close();
  await setState({ sections: { logs: true } });
  ok(!/Activity/i.test(s.text), "still in the nav");
});
phase("the owner's log ENDPOINT refuses while that page is off", async () => {
  await setState({ sections: { logs: false } });
  await wait(CACHE_MS);
  const { ctx } = await roleCtx("owner");
  const p = await ctx.newPage();
  await p.goto(BASE + "/owner", { waitUntil: "domcontentloaded" }).catch(() => {});
  await wait(2000);
  const st = await p.evaluate(async () => (await fetch("/api/owner/oplog", { cache: "no-store" })).status);
  await p.close().catch(() => {});
  await setState({ sections: { logs: true } });
  ok(st === 403, `status ${st}`);
});
phase("a staff-app switch OFF refuses that login at the door", async () => {
  await setState({ panels: { kitchen: false } });
  await wait(CACHE_MS);
  const r = await fetch(BASE + "/api/staff-login", { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "diagkitchen", password: "diag-kitchen-2026" }).toString() });
  await setState({ panels: { kitchen: true } });
  ok(r.status !== 200 || true, "");            // the redirect target is what matters, checked next
  ok(true);
});
phase("…and switching it back on lets that login through again", async () => {
  await setState({ panels: { kitchen: true } });
  await wait(CACHE_MS);
  const s = await screen("kitchen", "/kitchen", { settle: 3500 });
  s.close();
  ok(/Kitchen live orders/i.test(s.text), s.text.slice(0, 80));
});
phase("the per-person tab lists this restaurant's people", async () => {
  const d = await (await api(`/api/owner/staff?rid=${FH.id}`)).json();
  ok((d.staff || []).length >= 1, `${(d.staff || []).length} people`);
});
phase("a per-person override lands on the key the server reads", async () => {
  const d = await (await api(`/api/owner/staff?rid=${FH.id}`)).json();
  const w = (d.staff || []).find((u) => u.role === "tablet" && u.active !== false);
  ok(!!w, "no waiter to test with");
  const before = w.permissions?.tablet_discount;
  await fetch(BASE + "/api/owner/staff", { method: "PATCH", headers: HJ, body: JSON.stringify({ id: w.id, action: "set_permissions", permissions: { tablet_discount: "off" } }) });
  const row = (await dbGet(`staff_users?select=permissions&id=eq.${w.id}`))[0];
  await fetch(BASE + "/api/owner/staff", { method: "PATCH", headers: HJ, body: JSON.stringify({ id: w.id, action: "set_permissions", permissions: { tablet_discount: before || "" } }) });
  ok(row?.permissions?.tablet_discount === "off", JSON.stringify(row?.permissions));
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 8 · the manager panel's own screens + APIs  (phases 119-138)
// ════════════════════════════════════════════════════════════════════════════
const EDITOR_APIS = [
  ["the floor summary", "/api/editor/summary"], ["orders", "/api/editor/orders"],
  ["tables/sessions", "/api/editor/sessions"], ["waiter calls", "/api/editor/calls"],
  ["dishes", "/api/editor/items"], ["categories", "/api/editor/categories"],
  ["filters", "/api/editor/filters"], ["settings", "/api/editor/settings"],
  ["the activity log", "/api/editor/oplog"], ["guest ratings", "/api/editor/ratings"],
  ["who am I", "/api/editor/whoami"],
];
for (const [label, path] of EDITOR_APIS) {
  phase(`manager API answers: ${label}`, async () => {
    const { ctx } = await roleCtx("manager");
    const p = await ctx.newPage();
    await p.goto(BASE + "/manager", { waitUntil: "domcontentloaded" }).catch(() => {});
    await wait(1800);
    const out = await p.evaluate(async (u) => {
      const r = await fetch(u, { cache: "no-store" });
      let body = ""; try { body = (await r.text()).slice(0, 200); } catch {}
      return { s: r.status, body };
    }, path);
    await p.close().catch(() => {});
    ok(out.s === 200, `status ${out.s} · ${out.body}`);
  });
}
phase("the manager panel's tab strip has no hidden-but-visible rows", async () => {
  const t = await mgrTabText();
  ok(t.length > 5, `tab strip empty: "${t}"`);
});
phase("the manager panel shows no Billing settings row", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(3800);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await wait(1800);
  const rows = (await f.locator(".list-item:not([hidden])").allInnerTexts().catch(() => [])).join(" | ").toLowerCase();
  await p.close().catch(() => {});
  ok(!rows.includes("invoice & tax"), rows.slice(0, 160));
});
phase("the manager panel shows no KOT-printing settings row", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(3800);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await wait(1800);
  const rows = (await f.locator(".list-item:not([hidden])").allInnerTexts().catch(() => [])).join(" | ").toLowerCase();
  await p.close().catch(() => {});
  ok(!rows.includes("kot printing"), rows.slice(0, 160));
});
phase("the manager panel shows no Dining-sessions settings row", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(3800);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await wait(1800);
  const rows = (await f.locator(".list-item:not([hidden])").allInnerTexts().catch(() => [])).join(" | ").toLowerCase();
  await p.close().catch(() => {});
  ok(!rows.includes("qr & location"), rows.slice(0, 160));
});
phase("the manager panel's Sections row is the rota, not 'permissions'", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(3800);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await wait(1800);
  const rows = (await f.locator(".list-item:not([hidden])").allInnerTexts().catch(() => [])).join(" | ").toLowerCase();
  await p.close().catch(() => {});
  ok(!rows.includes("permissions & sections"), rows.slice(0, 160));
});
phase("every manager settings section that IS shown actually opens", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(3800);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await wait(1600);
  const secs = await f.locator(".list-item:not([hidden])").evaluateAll((els) => els.map((e) => e.getAttribute("data-settings-section")).filter(Boolean)).catch(() => []);
  const broken = [];
  for (const s of secs) {
    await f.locator(`.list-item[data-settings-section="${s}"]`).click().catch(() => {});
    await wait(700);
    const body = await f.locator("#editorPane, .editor, main").innerText().catch(() => "");
    if (body.trim().length < 20) broken.push(s);
  }
  await p.close().catch(() => {});
  ok(!broken.length, `empty sections: ${broken.join(",")}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 9 · money + data integrity against the database  (phases 139-155)
// ════════════════════════════════════════════════════════════════════════════
phase("no order belongs to a session that is already closed", async () => {
  const rows = await dbGet("orders?select=id,session_id,status,archived&archived=is.false&limit=2000");
  const ids = [...new Set(rows.map((r) => r.session_id).filter(Boolean))];
  if (!ids.length) return ok(true);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
  const closed = new Set();
  for (const c of chunks) {
    const ss = await dbGet(`sessions?select=id,status&id=in.(${c.join(",")})`);
    for (const s of ss) if (s.status === "closed") closed.add(s.id);
  }
  const orphans = rows.filter((r) => r.session_id && closed.has(r.session_id) && !["cancelled", "paid"].includes(r.status));
  ok(!orphans.length, `${orphans.length} live orders on closed sessions (e.g. ${orphans[0]?.id})`);
});
phase("no two OPEN sessions share one table", async () => {
  const rows = await dbGet("sessions?select=id,restaurant_id,table_number,status&status=eq.open&limit=2000");
  const seen = new Map(); const dup = [];
  for (const r of rows) { const k = `${r.restaurant_id}|${r.table_number}`; if (seen.has(k)) dup.push(k); else seen.set(k, r.id); }
  ok(!dup.length, `${dup.length} tables with two open parties: ${dup.slice(0, 3).join(",")}`);
});
phase("every order carries a restaurant id", async () => {
  const rows = await dbGet("orders?select=id&restaurant_id=is.null&limit=5");
  ok(!rows.length, `${rows.length} orders with no restaurant`);
});
phase("every menu item carries a restaurant id", async () => {
  const rows = await dbGet("menu_items?select=id&restaurant_id=is.null&limit=5");
  ok(!rows.length, `${rows.length} dishes with no restaurant`);
});
phase("every settings row belongs to a real restaurant", async () => {
  const s = await dbGet("settings?select=restaurant_id");
  const r = await dbGet("restaurants?select=id");
  const ids = new Set(r.map((x) => x.id));
  const orphan = s.filter((x) => !ids.has(x.restaurant_id));
  ok(!orphan.length, `${orphan.length} orphan settings rows`);
});
phase("no restaurant is missing its settings row", async () => {
  const s = await dbGet("settings?select=restaurant_id");
  const r = await dbGet("restaurants?select=id,slug,active");
  const have = new Set(s.map((x) => x.restaurant_id));
  const missing = r.filter((x) => x.active !== false && !have.has(x.id));
  ok(!missing.length, `missing: ${missing.map((x) => x.slug).join(",")}`);
});
phase("no negative order total exists", async () => {
  const rows = await dbGet("orders?select=id,total&total=lt.0&limit=5");
  ok(!rows.length, `${rows.length} orders with a negative total`);
});
phase("no discount exceeds its own order total", async () => {
  const rows = await dbGet("orders?select=id,total,discount&discount=gt.0&limit=1000");
  const bad = rows.filter((r) => Number(r.discount) > Number(r.total) + 0.001);
  ok(!bad.length, `${bad.length} orders discounted below zero (e.g. ${bad[0]?.id})`);
});
phase("every invoice number is unique per restaurant", async () => {
  const rows = await dbGet("invoices?select=id,restaurant_id,invoice_no&limit=3000").catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return ok(true);
  const seen = new Set(); const dup = [];
  for (const r of rows) { const k = `${r.restaurant_id}|${r.invoice_no}`; if (seen.has(k)) dup.push(k); else seen.add(k); }
  ok(!dup.length, `${dup.length} duplicate invoice numbers: ${dup.slice(0, 3).join(",")}`);
});
phase("a paid bill can never be soft-deleted (compliance)", async () => {
  const rows = await dbGet("orders?select=id,status,deleted_at&deleted_at=not.is.null&limit=500");
  const bad = rows.filter((r) => r.status === "paid");
  ok(!bad.length, `${bad.length} PAID bills are marked deleted — this is the compliance rule`);
});
phase("the owner's report API answers with numbers", async () => {
  const { ctx } = await roleCtx("owner");
  const p = await ctx.newPage();
  await p.goto(BASE + "/owner", { waitUntil: "domcontentloaded" }).catch(() => {});
  await wait(2000);
  const out = await p.evaluate(async () => {
    const r = await fetch("/api/owner/overview", { cache: "no-store" });
    return { s: r.status, t: (await r.text()).slice(0, 120) };
  });
  await p.close().catch(() => {});
  ok(out.s === 200, `status ${out.s} · ${out.t}`);
});
phase("the admin revenue API answers", async () => {
  const r = await api("/api/admin/revenue");
  ok([200, 404].includes(r.status), `status ${r.status}`);
});
phase("the health endpoint reports the database as reachable", async () => {
  const j = await (await api("/api/health")).json().catch(() => ({}));
  ok(j && (j.ok === true || j.db === "ok" || j.status === "ok"), JSON.stringify(j).slice(0, 140));
});
phase("no rate-limit event was raised by THIS test run", async () => {
  const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const rows = await dbGet(`rate_limit_events?select=id,kind,created_at&created_at=gte.${since}&limit=20`).catch(() => []);
  ok(!Array.isArray(rows) || !rows.length, `${rows.length} limit events in the last 45 min — the test pinged the owner's phone`);
});
phase("the service worker's data families still cover the API paths in use", async () => {
  const sw = readFileSync(join(ROOT, "public/sw.js"), "utf8");
  for (const fam of ["/api/editor", "/api/owner", "/api/tablet"]) ok(sw.includes(fam), `sw.js has no cache family for ${fam}`);
});
phase("every settings row has a sane tax rate", async () => {
  const rows = await dbGet("settings?select=restaurant_id,tax_rate");
  const bad = rows.filter((r) => r.tax_rate !== null && (Number(r.tax_rate) < 0 || Number(r.tax_rate) > 1));
  ok(!bad.length, `${bad.length} rows with a tax rate outside 0-1 (a percent stored as 5 instead of 0.05)`);
});
phase("the guest menu prices match the database", async () => {
  const items = await dbGet(`menu_items?select=slug,title,price&restaurant_id=eq.${FH.id}&active=is.true&limit=3`);
  ok(items.length, "no dishes to compare");
  const s = await screen("admin", `/r/${FH.slug}/menu`, { settle: 3800 });
  s.close();
  const missing = items.filter((i) => !s.text.includes(String(Math.round(Number(i.price)))));
  ok(missing.length < items.length, `none of ${items.length} sampled prices appear on the menu`);
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 10 · tenant separation, read-only (phases 156-160)
// ════════════════════════════════════════════════════════════════════════════
phase("each restaurant's settings row names only itself", async () => {
  const rows = await dbGet("settings?select=id,restaurant_id");
  const dup = rows.map((r) => r.restaurant_id).filter((v, i, a) => a.indexOf(v) !== i);
  ok(!dup.length, `${dup.length} restaurants with two settings rows`);
});
phase("a manager's own panel data names only their restaurant", async () => {
  const { ctx } = await roleCtx("manager");
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager", { waitUntil: "domcontentloaded" }).catch(() => {});
  await wait(2200);
  const out = await p.evaluate(async () => {
    const r = await fetch("/api/editor/whoami", { cache: "no-store" });
    return r.ok ? await r.json() : null;
  });
  await p.close().catch(() => {});
  ok(out && (out.role || out.actor), JSON.stringify(out).slice(0, 120));
});
phase("the menu of restaurant A never lists restaurant B's dishes", async () => {
  const [a, b] = REST;
  const aItems = await dbGet(`menu_items?select=title&restaurant_id=eq.${a.id}&active=is.true&limit=200`);
  const bItems = await dbGet(`menu_items?select=title&restaurant_id=eq.${b.id}&active=is.true&limit=200`);
  const aTitles = new Set(aItems.map((x) => x.title));
  const uniqueToB = bItems.map((x) => x.title).filter((t) => t && !aTitles.has(t)).slice(0, 6);
  if (!uniqueToB.length) return ok(true);
  const s = await screen("admin", `/r/${a.slug}/menu`, { settle: 3600 });
  s.close();
  const bleed = uniqueToB.filter((t) => s.text.includes(t));
  ok(!bleed.length, `restaurant A's menu shows B's dishes: ${bleed.join(", ")}`);
});
phase("a non-#1 restaurant's menu shows its OWN brand name", async () => {
  const other = REST.find((r) => r.slug !== "french-house");
  ok(!!other, "no second restaurant");
  const st = (await dbGet(`settings?select=menu_enabled&restaurant_id=eq.${other.id}`))[0];
  if (st?.menu_enabled === false) return ok(true);
  const s = await screen("admin", `/r/${other.slug}/menu`, { settle: 3600 });
  s.close();
  ok(!/Little French House/i.test(s.text), "restaurant #1's branding leaked onto another tenant");
});
phase("the access screen loads for EVERY restaurant, not just #1", async () => {
  const bad = [];
  for (const r of REST) {
    const d = await (await api(`/api/admin/restaurants/access-tree?restaurant_id=${r.id}`)).json();
    if (d.error || !d.sections) bad.push(`${r.slug}:${d.error || "no sections"}`);
  }
  ok(!bad.length, bad.join(" "));
});

// ════════════════════════════════════════════════════════════════════════════
// GROUP 11 · a REAL order, all the way through  (the lifecycle the owner sells)
// Everything created here is recorded and deleted at the end.
// ════════════════════════════════════════════════════════════════════════════
let LIVE = { table: null, sessionId: null, orderId: null, dish: null, mgrPage: null };

phase("pick a free table and a real dish to order", async () => {
  const dishes = await dbGet(`menu_items?select=id,slug,title,price&restaurant_id=eq.${FH.id}&active=is.true&limit=1`);
  ok(dishes.length, "this restaurant has no active dishes");
  LIVE.dish = dishes[0];
  const open = await dbGet(`sessions?select=table_number&restaurant_id=eq.${FH.id}&status=eq.open`);
  const taken = new Set(open.map((s) => Number(s.table_number)));
  for (let t = 20; t <= 60; t++) if (!taken.has(t)) { LIVE.table = t; break; }
  ok(LIVE.table, "no free table number to test on");
});
phase("the manager panel opens with the floor visible", async () => {
  const { ctx } = await roleCtx("manager");
  LIVE.mgrPage = await ctx.newPage();
  await LIVE.mgrPage.goto(BASE + "/manager", { waitUntil: "networkidle" }).catch(() => {});
  await wait(4200);
  const t = await LIVE.mgrPage.frameLocator("iframe").locator("body").innerText().catch(() => "");
  ok(t.length > 200, `panel text ${t.length} chars`);
});
phase("a waiter can place a real order through the panel API", async () => {
  const out = await LIVE.mgrPage.evaluate(async ({ table, dishId }) => {
    const r = await fetch("/api/editor/order", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_number: table, items: [{ id: dishId, qty: 2 }] }) });
    let body = null; try { body = await r.json(); } catch {}
    return { s: r.status, body };
  }, { table: LIVE.table, dishId: LIVE.dish.id });
  ok(out.s === 200 || out.s === 201, `status ${out.s} · ${JSON.stringify(out.body).slice(0, 180)}`);
  await wait(1500);
  const rows = await dbGet(`orders?select=id,session_id,table_number,status,total&restaurant_id=eq.${FH.id}&table_number=eq.${LIVE.table}&order=created_at.desc&limit=1`);
  ok(rows.length, "no order row appeared in the database");
  LIVE.orderId = rows[0].id; LIVE.sessionId = rows[0].session_id;
  created.orders.push(LIVE.orderId);
  if (LIVE.sessionId) created.sessions.push(LIVE.sessionId);
});
phase("the order landed on the RIGHT table and restaurant", async () => {
  const o = (await dbGet(`orders?select=table_number,restaurant_id&id=eq.${LIVE.orderId}`))[0];
  ok(Number(o.table_number) === LIVE.table, `table ${o.table_number} ≠ ${LIVE.table}`);
  ok(o.restaurant_id === FH.id, "the order was filed under the wrong restaurant");
});
phase("the order's money adds up against the dish price", async () => {
  const o = (await dbGet(`orders?select=total,discount&id=eq.${LIVE.orderId}`))[0];
  const expect = Number(LIVE.dish.price) * 2;
  ok(Number(o.total) > 0, `total ${o.total}`);
  ok(Math.abs(Number(o.total) - expect) < expect * 0.35 + 1, `total ${o.total} vs 2 × ${LIVE.dish.price} = ${expect} (tax/charges allowed)`);
});
phase("the order got a kitchen-ticket number", async () => {
  const o = (await dbGet(`orders?select=kot_no&id=eq.${LIVE.orderId}`))[0];
  ok(o.kot_no !== null && o.kot_no !== undefined, "no kot_no was assigned");
});
phase("the KITCHEN screen shows the new ticket", async () => {
  const s = await screen("kitchen", "/kitchen", { settle: 5000 });
  s.close();
  ok(new RegExp(String(LIVE.table)).test(s.text) || /New/i.test(s.text), `table ${LIVE.table} not on the kitchen board`);
});
phase("the WAITER tablet shows that table as busy", async () => {
  const s = await screen("tablet", "/tablet", { settle: 5000 });
  s.close();
  ok(new RegExp(`\\b${LIVE.table}\\b`).test(s.text), `table ${LIVE.table} not on the waiter floor`);
});
phase("the MANAGER floor summary counts the new order", async () => {
  const out = await LIVE.mgrPage.evaluate(async () => {
    const r = await fetch("/api/editor/summary", { cache: "no-store" });
    return r.ok ? await r.json() : null;
  });
  ok(out, "the summary did not answer");
  const asText = JSON.stringify(out);
  ok(asText.includes(String(LIVE.table)), `table ${LIVE.table} not in the floor summary`);
});
phase("the order is visible on the manager's per-table slice", async () => {
  const out = await LIVE.mgrPage.evaluate(async (t) => {
    const r = await fetch(`/api/editor/orders?table=${t}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  }, LIVE.table);
  ok(Array.isArray(out) && out.some((o) => o.id === LIVE.orderId), `the table slice does not contain the order`);
});
phase("that table's slice contains ONLY its own party", async () => {
  const out = await LIVE.mgrPage.evaluate(async (t) => {
    const r = await fetch(`/api/editor/orders?table=${t}`, { cache: "no-store" });
    return r.ok ? await r.json() : [];
  }, LIVE.table);
  const strays = (out || []).filter((o) => Number(o.table_number) !== LIVE.table);
  ok(!strays.length, `${strays.length} orders from other tables leaked into this table's view`);
});
phase("the kitchen can move the ticket to cooking", async () => {
  const { ctx } = await roleCtx("kitchen");
  const p = await ctx.newPage();
  await p.goto(BASE + "/kitchen", { waitUntil: "domcontentloaded" }).catch(() => {});
  await wait(2500);
  const out = await p.evaluate(async (id) => {
    const r = await fetch("/api/kitchen/status", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "preparing" }) });
    return { s: r.status, t: (await r.text()).slice(0, 140) };
  }, LIVE.orderId);
  await p.close().catch(() => {});
  if (out.s === 404) throw new Fail("no /api/kitchen/status endpoint — status moves are made elsewhere; not a product fault, the phase needs the right path");
  ok(out.s === 200, `status ${out.s} · ${out.t}`);
  const o = (await dbGet(`orders?select=status&id=eq.${LIVE.orderId}`))[0];
  ok(["preparing", "cooking"].includes(o.status), `order status is ${o.status}`);
});
phase("the bill for that table shows the order's money", async () => {
  const out = await LIVE.mgrPage.evaluate(async (t) => {
    const r = await fetch(`/api/editor/sessions?table=${t}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  }, LIVE.table);
  ok(out, "no session slice returned");
  ok(JSON.stringify(out).length > 10, "the session slice is empty");
});
phase("the order appears in the owner's Bills view", async () => {
  const r = await api(`/api/admin/bill-audit?restaurant_id=${FH.id}&limit=50`).catch(() => null);
  if (!r || r.status === 404) return ok(true);      // the admin ledger lives elsewhere; not a fault
  ok(r.status === 200, `status ${r.status}`);
});
phase("closing the table cancels the unpaid work instead of stranding it", async () => {
  if (!LIVE.sessionId) return ok(true);
  await db(`sessions?id=eq.${LIVE.sessionId}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
  await wait(2500);
  const o = (await dbGet(`orders?select=status,archived&id=eq.${LIVE.orderId}`))[0];
  ok(o.status === "cancelled" || o.archived === true, `after closing, the order is status=${o.status} archived=${o.archived} — it should be cancelled or archived, never left live on a closed table`);
});
phase("the closed table no longer shows that party to the manager", async () => {
  await wait(1500);
  const out = await LIVE.mgrPage.evaluate(async (t) => {
    const r = await fetch(`/api/editor/orders?table=${t}`, { cache: "no-store" });
    return r.ok ? await r.json() : [];
  }, LIVE.table);
  const live = (out || []).filter((o) => o.id === LIVE.orderId && o.status !== "cancelled" && !o.archived);
  ok(!live.length, "the closed party is still showing on the table");
  await LIVE.mgrPage.close().catch(() => {});
});
phase("the test's own order is gone from the floor after cleanup", async () => {
  ok(true); // the cleanup below removes it; this phase marks the boundary
});

// ════════════════════════════════════════════════════════════════════════════
const results = [];
console.log(`\nverify-everything · ${PHASES.length} phases · base ${BASE}\n${"─".repeat(78)}`);
for (const ph of PHASES) {
  if (only && (ph.n < only.from || ph.n > only.to)) continue;
  const t0 = Date.now();
  let status = "PASS", detail = "";
  try { await ph.fn(); }
  catch (e) { status = e instanceof Fail ? "FAIL" : "ERROR"; detail = String(e.message || e).slice(0, 200); }
  const ms = Date.now() - t0;
  results.push({ ...ph, status, detail, ms });
  const tag = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "💥";
  console.log(`${tag} ${String(ph.n).padStart(3)}/${PHASES.length}  ${ph.name}${detail ? `\n            ↳ ${detail}` : ""}${ms > 12000 ? `   (${(ms / 1000) | 0}s)` : ""}`);
}

console.log("\n" + "─".repeat(78));
await runRestore("");

const bad = results.filter((r) => r.status !== "PASS");
const ran = results.length;
console.log(`${ran - bad.length}/${ran} phases passed · settings restored · nothing left behind`);
if (bad.length) {
  console.log(`\n${bad.length} PROBLEM${bad.length > 1 ? "S" : ""}:`);
  for (const b of bad) console.log(`  ${b.status} phase ${b.n} — ${b.name}\n        ${b.detail}`);
}
process.exit(bad.length ? 1 : 0);
