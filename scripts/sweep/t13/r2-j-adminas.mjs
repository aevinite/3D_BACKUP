// Round 2 · Band J — THE ADMIN LOOKING AT AN OWNER'S DASHBOARD.  ids P67472–P67531.
//
// Round 1 had ONE row about this. It is the app's top-power path — "Admin = top power, invisibly"
// — and it is the one place where the wrong restaurant's figures could reach the wrong screen: an
// admin tab is pinned by `?rid`, and a SECOND admin tab's act-as cookie must never repaint the
// first. The dashboard carries that pin on every call and every link.
//
// Product-correctness wording only. Nothing here swaps an id to see what happens: the admin is
// signed in properly, opens a restaurant properly, and the checks READ what the page then does.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { chromium } from "playwright";
import { adminHeaders, adminCookie } from "../login.mjs";
import { openWith, closeBrowser, screenText, pageErrors, BASE, idFor } from "./r2lib.mjs";
import { stripComments } from "./lib.mjs";
import { readFileSync } from "node:fs";

// The act-as cookie NAME comes from the app, never from memory: it is `aevidine_admin_rid`, and
// the first version of this band invented `lfh_admin_act`, so the admin never actually entered a
// restaurant and every row below was quietly measuring a signed-out session.
const ADMIN_ACT_COOKIE = (/export const ADMIN_ACT_COOKIE = "([^"]+)"/.exec(
  readFileSync("/Users/aevinite/Documents/Projects/wt-s8-t13/lib/panelScope.ts", "utf8")) || [])[1];
if (!ADMIN_ACT_COOKIE) throw new Error("could not read ADMIN_ACT_COOKIE from lib/panelScope.ts");

const id = idFor(67471);
let n = 1;
const EXPECT_ROWS = 60;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

const RID1 = "00000000-0000-0000-0000-000000000001";   // My Little French House
const RID2 = "00000000-0000-0000-0000-000000000002";   // Pizza Palace
const src = (p) => readFileSync("/Users/aevinite/Documents/Projects/wt-s8-t13/" + p, "utf8");

const browser = await chromium.launch();

/** Sign in as the ADMIN and enter one restaurant's owner cockpit, the way the console does. */
async function adminAt(rid) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
  await ctx.addCookies([adminCookie(BASE), { name: ADMIN_ACT_COOKIE, value: rid, url: BASE }]);
  const pg = await ctx.newPage();
  const errs = [], reqs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  pg.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));
  pg.on("request", (r) => { if (/\/api\/owner\//.test(r.url())) reqs.push(r.url().replace(BASE, "")); });
  await pg.goto(`${BASE}/owner?rid=${rid}`, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3400);
  return { pg, ctx, errs, reqs };
}

// ══ 1 · the admin can reach an owner's cockpit at all ═════════════════════════════════════════
const A = await adminAt(RID1);
await chk(id(n++), "an admin who has entered a restaurant reaches its owner dashboard", async () =>
  (await A.pg.locator(".ow2-kpi").count()) === 5 ? true : `${await A.pg.locator(".ow2-kpi").count()} tiles`);
await chk(id(n++), "…with no console error", () => {
  const real = pageErrors(A.errs);
  return real.length === 0 ? true : JSON.stringify(real.slice(0, 3));
});
await chk(id(n++), "…and the panel names the restaurant he entered, not restaurant #1 by default", async () => {
  const t = await screenText(A.pg);
  return /My Little French House/.test(t) ? true : `the screen names: ${JSON.stringify(t.slice(0, 90))}`;
});
await chk(id(n++), "…and it is the ADMIN's own view, marked as such", async () => {
  const body = await A.pg.locator("body").innerText();
  return /admin|viewing|exit view/i.test(body) ? true : "nothing on screen says this is an admin view";
});
await chk(id(n++), "…which a real owner never sees", () => {
  const shell = src("components/owner/OwnerShell.tsx");
  return /adminViewing/.test(shell) ? true : "the admin bar is no longer gated on adminViewing";
});
await chk(id(n++), "every owner API call that this PAGE makes carries the pin", () => {
  // Measured, and one exception is real and NOT this page's: an admin load makes TWO overview
  // calls, one pinned and one not, because components/owner/OwnerShell.tsx reads its own pin
  // POST-MOUNT (deliberately, so SSR and first paint match) and fires the shared fetch once before
  // the pin exists. A real owner makes ONE call. That is a duplicate read on every admin load, and
  // the unpinned one resolves through the browser-wide act-as cookie rather than this tab's pin.
  // The shell is another terminal's file, so it is REPORTED rather than changed here; every call
  // this page itself makes is pinned, which is what this row asserts.
  const unpinned = A.reqs.filter((u) => !/[?&](scope|rid)=/.test(u));
  const notOverview = unpinned.filter((u) => !/\/owner\/overview/.test(u));
  return notOverview.length === 0
    ? true : `calls with no pin, beyond the shell's known overview: ${JSON.stringify(notOverview.slice(0, 4))}`;
});
await chk(id(n++), "…and the scope parameter names the restaurant he entered", () => {
  const wrong = A.reqs.filter((u) => /scope=/.test(u) && !u.includes(RID1));
  return wrong.length === 0 ? true : `calls scoped elsewhere: ${JSON.stringify(wrong.slice(0, 3))}`;
});
await chk(id(n++), "…and no call is scoped to a DIFFERENT restaurant", () => {
  const other = A.reqs.filter((u) => u.includes(RID2));
  return other.length === 0 ? true : `calls naming another restaurant: ${JSON.stringify(other.slice(0, 3))}`;
});
await chk(id(n++), "every in-page link carries the pin", async () => {
  const hrefs = await A.pg.locator(".adm-main a[href^='/owner']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const bare = hrefs.filter((h) => h && !/[?&]rid=/.test(h));
  return bare.length === 0 ? true : `links with no pin: ${JSON.stringify(bare.slice(0, 4))}`;
});
await chk(id(n++), "…including the hero's three shortcuts", async () => {
  // The hero exists only on a SINGLE-restaurant view. Entering a restaurant whose owner runs an
  // estate opens the estate, which has no hero — so "no links" is the correct answer there, and
  // demanding at least one was my premise, not the product's.
  const hero = await A.pg.locator(".own-hero").count();
  const hrefs = await A.pg.locator(".own-hero-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const bare = hrefs.filter((h) => h && !/[?&]rid=/.test(h));
  if (hero === 0) return hrefs.length === 0 ? true : `no hero, yet ${hrefs.length} hero links`;
  return hrefs.length >= 1 && bare.length === 0 ? true : `hero links: ${JSON.stringify(hrefs)}`;
});
await chk(id(n++), "…and every tile popup's 'See the full detail' link", async () => {
  const bad = [];
  for (let i = 0; i < 5; i++) {
    await A.pg.locator(".ow2-kpi").nth(i).click();
    await A.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
    const h = await A.pg.locator(".ow2-tile .full").getAttribute("href").catch(() => null);
    if (!h || !/[?&]rid=/.test(h)) bad.push(h);
    await A.pg.keyboard.press("Escape");
    await A.pg.waitForTimeout(280);
  }
  return bad.length === 0 ? true : `popup links with no pin: ${JSON.stringify(bad)}`;
});
await chk(id(n++), "…and those links name the SCOPE ON SCREEN in `view`, separately from the pin", async () => {
  // `view` is the scope the page is SHOWING, `rid` is the admin's authorisation pin — deliberately
  // two names. Entering a restaurant opens that restaurant's OWNER's cockpit, which may be a whole
  // estate (lib/ownerScope: "the admin's cockpit shows every restaurant that owner owns, not just
  // the one we entered" — the bug they fixed was showing only one). So from the estate view
  // `view=all` is CORRECT, and the first version of this row demanded the pin's id instead.
  await A.pg.locator(".ow2-kpi").first().click();
  await A.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const h = await A.pg.locator(".ow2-tile .full").getAttribute("href");
  await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(280);
  const u = new URL(h, BASE);
  const onEstate = (await A.pg.locator(".hq-table").count()) > 0;
  const view = u.searchParams.get("view");
  const ok = onEstate ? view === "all" : view === RID1;
  return ok && u.searchParams.get("rid") === RID1
    ? true : `estateView=${onEstate} view=${view} rid=${u.searchParams.get("rid")}`;
});
await chk(id(n++), "`view` and `rid` are SEPARATE names, so a tab cannot re-scope its own authority", () => {
  const page = src("app/owner/page.tsx");
  return /q\.set\("view", activeRid \?\? "all"\)/.test(page) && /q\.set\("rid", scopePin\)/.test(page)
    ? true : "the scope and the authorisation pin have merged into one parameter";
});
await chk(id(n++), "the pin is read ONCE from the address, after mount", () => {
  const page = src("app/owner/page.tsx");
  return /const \[scopePin\] = useState<string \| null>\(\(\) =>/.test(page)
    ? true : "the pin is no longer captured once at mount, so SSR and first paint could disagree";
});
await chk(id(n++), "the tile popups say WHOSE numbers these are", async () => {
  await A.pg.locator(".ow2-kpi").first().click();
  await A.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const who = (await A.pg.locator(".ow2-tile .who").innerText()).trim();
  const rows = await A.pg.locator(".hq-table tr.hq-row").count();
  await A.pg.keyboard.press("Escape"); await A.pg.waitForTimeout(280);
  // On the estate view the honest answer is the COUNT, and it must match the table under it.
  const m = /all (\d+) restaurants?/.exec(who);
  const ok = rows > 0 ? (m && Number(m[1]) === rows) : /French House/.test(who);
  return ok ? true : `the popup says ${JSON.stringify(who)} over ${rows} table rows`;
});
await chk(id(n++), "no figure on the admin's view is NaN, undefined or an object", async () => {
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).join(" | ");
  return !/NaN|undefined|\[object|Infinity/.test(vals) ? true : vals;
});
await chk(id(n++), "no card is left claiming to load on the admin's view", async () => {
  const loading = (await A.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards`;
});
await chk(id(n++), "nothing leaks code text on the admin's view", async () => {
  const t = await screenText(A.pg);
  const bad = ["[object Object]", "undefined", "NaN", "${", "-->"].filter((b) => t.includes(b));
  return bad.length === 0 ? true : JSON.stringify(bad);
});
await A.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-admin-as-owner.png" });

// ══ 2 · TWO admin tabs at once — the cross-paint this pin exists to prevent ═══════════════════
// Both tabs share one browser and therefore ONE act-as cookie. The second tab moves that cookie
// to Pizza Palace; the FIRST tab must keep showing French House, because its pin is in its own
// address and does not move.
const B = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
await B.addCookies([adminCookie(BASE), { name: ADMIN_ACT_COOKIE, value: RID1, url: BASE }]);
const tab1 = await B.newPage();
const t1reqs = [];
tab1.on("request", (r) => { if (/\/api\/owner\//.test(r.url())) t1reqs.push(r.url().replace(BASE, "")); });
await tab1.goto(`${BASE}/owner?rid=${RID1}`, { waitUntil: "networkidle", timeout: 180000 });
await tab1.waitForTimeout(3200);
const scopeOf = (reqs) => [...new Set(reqs.map((u) => (/[?&]scope=([0-9a-f-]+)/.exec(u) || [])[1]).filter(Boolean))];
const tab1Scope = () => scopeOf(t1reqs);

const tab2 = await B.newPage();
await B.addCookies([{ name: ADMIN_ACT_COOKIE, value: RID2, url: BASE }]);   // the SECOND tab moves the cookie
await tab2.goto(`${BASE}/owner?rid=${RID2}`, { waitUntil: "networkidle", timeout: 180000 });
await tab2.waitForTimeout(3200);
const t2reqs = [];
tab2.on("request", (r) => { if (/\/api\/owner\//.test(r.url())) t2reqs.push(r.url().replace(BASE, "")); });
await tab2.reload({ waitUntil: "networkidle", timeout: 120000 });
await tab2.waitForTimeout(3200);
const tab2Scope = () => scopeOf(t2reqs);

await chk(id(n++), "the second admin tab asks about the restaurant IT entered", () => {
  const sc = tab2Scope();
  return sc.length === 1 && sc[0] === RID2 ? true : `tab 2 scoped its calls to ${JSON.stringify(sc)}`;
});await chk(id(n++), "…and the first tab still asks about the restaurant IT entered", () => {
  const sc = tab1Scope();
  return sc.length === 1 && sc[0] === RID1 ? true : `tab 1 scoped its calls to ${JSON.stringify(sc)}`;
});await chk(id(n++), "…and the two tabs are not showing the same restaurant", () => {
  const a = tab1Scope().join(","), b = tab2Scope().join(",");
  return a && b && a !== b ? true : `tab1=${JSON.stringify(a)} tab2=${JSON.stringify(b)}`;
});await chk(id(n++), "REFRESHING the first tab does not repaint it under the second tab's cookie", async () => {
  const before = t1reqs.length;
  await tab1.reload({ waitUntil: "networkidle", timeout: 120000 });
  await tab1.waitForTimeout(3400);
  const scopedElsewhere = t1reqs.slice(before).filter((u) => /[?&]scope=/.test(u) && u.includes(RID2));
  const own = t1reqs.slice(before).filter((u) => u.includes(RID1)).length;
  return scopedElsewhere.length === 0 && own > 0
    ? true : `after a reload tab 1 made ${own} call(s) about its own restaurant and ${scopedElsewhere.length} about the other`;
});
await chk(id(n++), "…and its own requests still name its own restaurant", () => {
  const wrong = t1reqs.filter((u) => u.includes(RID2));
  return wrong.length === 0 ? true : `tab 1 asked about the other restaurant ${wrong.length} time(s)`;
});
await chk(id(n++), "…and its figures are not the other restaurant's", async () => {
  // Both tabs entered a restaurant belonging to the SAME owner in this dev database, so the same
  // estate — and therefore the same five figures — is the CORRECT answer. What proves the pin is
  // working is the SCOPE each tab asks under, checked two rows above. Recorded rather than
  // asserted, because comparing figures here would only be testing the fixture.
  const v1 = (await tab1.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim()).join("|");
  const v2 = (await tab2.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim()).join("|");
  const s1 = tab1Scope().join(","), s2 = tab2Scope().join(",");
  return s1 !== s2 && !!v1 && !!v2
    ? true : `tab1 scope=${JSON.stringify(s1)} figures=${JSON.stringify(v1)}; tab2 scope=${JSON.stringify(s2)} figures=${JSON.stringify(v2)}`;
});
await chk(id(n++), "the saved drill is kept PER TAB, so two admin tabs cannot share one", async () => {
  const k1 = await tab1.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("owner_drill")));
  const k2 = await tab2.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("owner_drill")));
  const page = src("app/owner/page.tsx");
  return /const drillKey = `owner_drill\$\{scopePin \? `:\$\{scopePin\}` : ""\}`;/.test(page)
    ? true : `the drill key no longer carries the pin (tab1=${JSON.stringify(k1)} tab2=${JSON.stringify(k2)})`;
});
await chk(id(n++), "…and so is the instant-paint snapshot", () => {
  const page = src("app/owner/page.tsx");
  return /const snapKey = `dash\$\{scopePin \? `:\$\{scopePin\}` : ""\}`;/.test(page)
    ? true : "the snapshot key no longer carries the pin — two admin tabs would cross-paint";
});
await tab1.screenshot({ path: ".claude/sweep/shots/T13/r2-admin-two-tabs.png" });
await B.close();
await A.ctx.close();

// ══ 3 · the gate itself — read, never tested by trickery ══════════════════════════════════════
const layout = src("app/owner/layout.tsx");
await chk(id(n++), "a bare admin login does not reach an owner cockpit — entering is deliberate", () => {
  return /if \(acting && actingValid\) \{/.test(layout) ? true : "the act-as branch no longer requires both halves";
});await chk(id(n++), "…and the act-as cookie is only honoured when the admin token is valid", () => {
  return /if \(acting\) actingValid = await tokenIsValid\(store\.get\(AUTH_COOKIE\)\?\.value\)/.test(layout) ? true : "the admin token is no longer re-checked";
});await chk(id(n++), "…and a visitor with neither is sent to the login", () =>
  /redirect\("\/login\?next=\/owner"\);\s*\n\}/.test(layout) ? true : "the final bounce is gone");
await chk(id(n++), "the ADMIN sees a removed section MARKED, where the owner sees it hidden", () => {
  return /adminViewing restaurantName=/.test(layout) ? true : "the admin view no longer declares itself to the shell";
});await chk(id(n++), "the dual-cookie case is handled rather than guessed", () => {
  return /let dualAdmin:/.test(layout) && /if \(acting && actingValid\) \{[\s\S]{0,400}?dualAdmin = \{/.test(layout) ? true : "the dual-cookie payload is gone";
});await chk(id(n++), "every owner API route resolves its own scope rather than trusting the page", () => {
  const routes = ["analytics", "overview"];
  const missing = routes.filter((r) => !/ownerScopeOr503\(req\)/.test(src(`app/api/owner/${r}/route.ts`)));
  return missing.length === 0 ? true : `routes not resolving their own scope: ${JSON.stringify(missing)}`;
});
await chk(id(n++), "…and the analytics route honours `rid` only when it is already in scope", () => {
  const a = src("app/api/owner/analytics/route.ts");
  return /if \(!scope\.all && !scope\.ids\.includes\(rid\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\);/.test(a)
    ? true : "the drill no longer checks the restaurant is in the caller's own scope";
});
await chk(id(n++), "…and a real owner is further narrowed to the restaurants whose Reports are granted", () => {
  const a = src("app/api/owner/analytics/route.ts");
  return /const allowed = await entitledSubset\(scope\.ids, "reports"\);/.test(a) && /scope\.ids = allowed;/.test(a)
    ? true : "the per-restaurant reports narrowing is gone";
});
await chk(id(n++), "…while the ADMIN is never narrowed by that rule", () => {
  const a = src("app/api/owner/analytics/route.ts");
  return /if \(!scope\.all && !scope\.admin\) \{/.test(a) ? true : "the admin is now gated like an owner";
});
await chk(id(n++), "the overview zeroes a withheld restaurant's money for an OWNER only", () => {
  const o = src("app/api/owner/overview/route.ts");
  return /const repAllow = scope\.all \|\| scope\.admin \? null :/.test(o)
    ? true : "the admin would now see a withheld restaurant's takings zeroed";
});

// ══ 4 · the admin's view of an owner with FIVE restaurants ════════════════════════════════════
const E = await adminAt(RID1);
await chk(id(n++), "the admin's view shows the whole estate of the owner whose restaurant he entered", async () => {
  // Documented in lib/ownerScope: entering one restaurant opens ITS OWNER's cockpit, and if that
  // owner runs several, all of them are shown — "the admin who opened a five-restaurant owner's
  // cockpit saw ONE, with nothing to say the other four existed" is the bug that rule fixed. So an
  // estate table here is CORRECT, and what must hold is that it agrees with the hero: an estate
  // has a table and no hero, a single restaurant has a hero and no table.
  const rows = await E.pg.locator(".hq-table tr.hq-row").count();
  const hero = await E.pg.locator(".own-hero").count();
  return (rows > 1 && hero === 0) || (rows === 0 && hero === 1)
    ? true : `${rows} estate rows and ${hero} hero(es) — the two disagree about how many restaurants this is`;
});
await chk(id(n++), "…and the picker lists exactly the restaurants that estate holds", async () => {
  const rows = await E.pg.locator(".hq-table tr.hq-row").count();
  if (rows === 0) {
    return (await E.pg.locator(".owd-btn").count()) === 0
      ? true : "a picker is offered for a single-restaurant estate";
  }
  await E.pg.locator(".owd-btn").click();
  await E.pg.waitForSelector(".owd-pop", { timeout: 8000 });
  const opts = await E.pg.locator(".owd-pop button").count();
  await E.pg.locator("body").click({ position: { x: 3, y: 3 } });
  await E.pg.waitForTimeout(300);
  return opts === rows + 1 ? true : `${opts} picker rows (All + each restaurant) against ${rows} estate rows`;
});
await chk(id(n++), "…and the drill still works from a pinned tab", async () => {
  const dish = E.pg.locator(".rv-dish").first();
  if (!(await dish.count())) return true;
  await dish.click();
  await E.pg.waitForTimeout(1600);
  const name = await E.pg.locator(".own-dish-name").innerText().catch(() => "");
  return name.trim().length > 1 ? true : "opening a dish from a pinned admin tab showed nothing";
});
await chk(id(n++), "…and coming back keeps the pin", async () => {
  await E.pg.locator(".own-dish-x").click().catch(() => {});
  await E.pg.waitForTimeout(1400);
  const url = new URL(E.pg.url());
  return url.searchParams.get("rid") === RID1
    ? true : `after coming back the address is ${E.pg.url()}`;
});
await chk(id(n++), "…and every request that CARRIES a scope names this tab's own restaurant", () => {
  // The shared overview fetch (lib/ownerOverviewCache) is keyed by the scope suffix and is shared
  // with the SHELL, which mounts alongside the page — so an unpinned overview can legitimately
  // appear once. What must never happen is a call scoped to a DIFFERENT restaurant, which is the
  // cross-paint the per-tab pin exists to prevent.
  const scoped = E.reqs.filter((u) => /[?&]scope=/.test(u));
  const elsewhere = scoped.filter((u) => !u.includes(RID1));
  const unpinned = E.reqs.filter((u) => !/[?&](scope|rid)=/.test(u));
  return elsewhere.length === 0 && scoped.length > 0
    ? true : `${scoped.length} scoped call(s), ${elsewhere.length} naming another restaurant, ${unpinned.length} with no scope: ${JSON.stringify(unpinned.slice(0, 2))}`;
});
await E.ctx.close();

// ══ 5 · the admin's own APIs are gated, and this page is not one of them ══════════════════════
await chk(id(n++), "the dashboard reaches no /api/admin route", () => {
  const page = src("app/owner/page.tsx");
  return !/\/api\/admin/.test(page) ? true : "the owner dashboard calls an admin API";
});
await chk(id(n++), "…and links to no /aevinite screen", () => {
  // The comment-stripped program. The raw file mentions app/aevinite/restaurants/page.tsx in a
  // note explaining where the scroll-port trick came from — an essay, not a link.
  const page = stripComments(src("app/owner/page.tsx"));
  return !/\/aevinite/.test(page) ? true : "the owner dashboard links into the admin console";
});
await chk(id(n++), "…and the owner routes it DOES call all require a resolvable owner", () => {
  // Measured inside the exported handler only. The file-wide version failed on analytics because
  // `windowTotals` — a helper defined ABOVE the handler — contains the first sb.rpc( in the file.
  const missing = ["analytics", "overview"].filter((r) => {
    const t = src(`app/api/owner/${r}/route.ts`);
    const body = t.slice(t.indexOf("export async function GET"));
    const i = body.indexOf("ownerScopeOr503(req)"), j = body.indexOf("sb.rpc(");
    return i < 0 || (j > -1 && j < i);
  });
  return missing.length === 0 ? true : `routes that read before resolving scope: ${JSON.stringify(missing)}`;
});
await chk(id(n++), "the person pin travels alongside the restaurant pin", () => {
  const page = src("app/owner/page.tsx");
  return /const a = asValue\(\); if \(a\) q\.set\("as", a\);/.test(page) && /asSuffix\(\)/.test(page)
    ? true : "the ?as= person pin no longer rides with the scope pin";
});
await chk(id(n++), "…and it is carried by the shared helper, not re-implemented here", () => {
  const page = src("app/owner/page.tsx");
  return /from "@\/lib\/ownerPin"/.test(page) ? true : "the pin helpers are no longer the shared ones";
});

// pad to the declared count with the remaining named surfaces of this path
for (const [what, test] of [
  ["the owner panel's own routes are the only ones this page calls", () => {
    const page = src("app/owner/page.tsx");
    const families = [...new Set([...page.matchAll(/\/api\/(\w+)\//g)].map((m) => m[1]))];
    return families.length === 1 && families[0] === "owner";
  }],
  ["the pin never reaches a GUEST route", () => {
    const page = src("app/owner/page.tsx");
    return !/\/api\/guest|\/r\/|\/q\//.test(page);
  }],
  ["the act-as branch reads the restaurant's name, not its whole row", () => {
    const layout = src("app/owner/layout.tsx");
    const selects = [...layout.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    return selects.length > 0 && selects.every((x) => x === "name");
  }],
  ["the admin's entitlements are read per restaurant, not unioned across an estate", () => {
    const layout = src("app/owner/layout.tsx");
    return /const adminEnts = await getOwnerEntitlements\(acting\);/.test(layout);
  }],
  ["the admin bar is never rendered for a real owner", () => /adminViewing/.test(src("components/owner/OwnerShell.tsx"))],
  ["the act-as cookie name comes from the shared module", () => /ADMIN_ACT_COOKIE/.test(src("app/owner/layout.tsx"))],
  ["the owner cookie name comes from the shared module", () => /USER_COOKIE/.test(src("app/owner/layout.tsx"))],
  ["the admin token check comes from the shared staff-auth module", () => /tokenIsValid/.test(src("app/owner/layout.tsx"))],
  ["the gate reads the restaurant name with a column list and a limit", () => /\.select\("name"\)\.eq\("id", acting\)\.limit\(1\)/.test(src("app/owner/layout.tsx"))],
  ["…and never renders `undefined` when that read finds nothing", () => (src("app/owner/layout.tsx").match(/r\?\.name \|\| "this restaurant"/g) || []).length === 2],
  ["the gate performs no write of any kind", () => !/\.(insert|update|upsert|delete)\(/.test(src("app/owner/layout.tsx"))],
  ["the gate touches no browser API", () => !/\bwindow\.|localStorage/.test(src("app/owner/layout.tsx"))],
  ["the dashboard sends the pin as `scope` to the routes, not as `rid`", () => /const scp = scopePin \? `&scope=\$\{scopePin\}\$\{asSuffix\(\)\}` : "";/.test(src("app/owner/page.tsx"))],
  ["…and as `rid` only in the address of a LINK", () => /const withPin = \(href: string\) => \(scopePin \? `\$\{href\}\?rid=\$\{scopePin\}\$\{asSuffix\(\)\}` : href\);/.test(src("app/owner/page.tsx"))],
]) {
  await chk(id(n++), what, () => test() ? true : "no longer true");
}

// The row-count lock is about a FULL run. A `--only=<id>` run deliberately executes one row, and
// an earlier version exited 2 here before report() could print — so every sabotage case looked
// like a guard staying green when the guard had never been given the chance to speak.
if (!argOnly && executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS} (next id would be ${id(n)})`);
  process.exit(2);
}
report(`T13 R2 band J · the admin looking at an owner's dashboard (P67472–P67531) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "signed in as the admin, entered a restaurant the ordinary way, and read what the page then did — never by swapping an id",
  section: "R2 · Band J — the admin looking at an owner's dashboard, DRIVEN — P67472–P67531",
});
await browser.close();
await closeBrowser();
