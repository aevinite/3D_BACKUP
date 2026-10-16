// Band E — the owner panel's door (app/owner/layout.tsx) and the two Coming-soon pages.
// ids P189391–P189430.
//
//   node scripts/sweep/t20s10/band-e-gate.mjs --base http://localhost:4420 [--json=<file>]
//
// "Signed out" is a person opening a bookmark in a fresh browser — the ordinary way anyone meets this
// door — and the check is where the page sends them. Nothing here calls an API without its login.
import { chromium } from "playwright";
import { chk, report, src, BASE, junk } from "./lib.mjs";
import { loginAs } from "../login.mjs";

const L = "app/owner/layout.tsx", MK = "app/owner/marketing/page.tsx", ON = "app/owner/online/page.tsx";
const browser = await chromium.launch();

// ── signed out ────────────────────────────────────────────────────────────────────────────────
let n = 189391; const id = () => `P${n++}`;
for (const path of ["/owner", "/owner/marketing", "/owner/online"]) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const ssr = await ctx.request.get(BASE + path, { maxRedirects: 0 });
  const html = await ssr.text();
  await pg.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
  await pg.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});
  const u = new URL(pg.url());
  await chk(id(), L, `signed out, ${path} ends on the sign-in card`, `fresh browser, open ${path}`, () => u.pathname === "/login" || u.pathname);
  await chk(id(), L, `…carrying ${path} as ?next, so signing in returns there`, `fresh browser, open ${path}`, () => u.searchParams.get("next") === path || u.searchParams.get("next"));
  await chk(id(), L, `…and the page served before the hop holds no owner figure or restaurant name`, `GET ${path} with no cookie, read the HTML`, () =>
    (!/My Little French House|Revenue|ow2-kpi|adm owx/.test(html)) || "the signed-out HTML contains dashboard markup");
  await ctx.close();
}
// n = 189400
{
  const ctx = await browser.newContext();
  const html = await (await ctx.request.get(BASE + "/owner", { maxRedirects: 0 })).text();
  await chk("P189400", L, "without JavaScript the signed-out page still reaches sign-in (a noscript refresh)", "GET /owner with no cookie, read the HTML", () => /http-equiv="refresh"[^>]*\/login\?next=%2Fowner/i.test(html) || "no noscript refresh in the HTML");
  await ctx.close();
}

// ── signed in: the two Coming-soon pages ─────────────────────────────────────────────────────────
const octx = await browser.newContext({ serviceWorkers: "block" });
await loginAs(octx, "owner", BASE);
const want = {
  "/owner/marketing": { file: MK, title: "Marketing & offers", points: ["Coupons & happy-hour pricing", "SMS / WhatsApp campaigns", "Campaign ROI tracking"] },
  "/owner/online": { file: ON, title: "Online & aggregators", points: ["Unified Zomato / Swiggy inbox", "Toggle items online instantly", "Your own online-ordering link"] },
};
n = 189401;
for (const [path, w] of Object.entries(want)) {
  const pg = await octx.newPage();
  await pg.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
  await pg.waitForSelector(".adm-coming", { timeout: 60000 }).catch(() => {});
  const text = await pg.locator(".adm-main").innerText().catch(() => "");
  await chk(id(), w.file, `${path}: the heading reads "${w.title}"`, `signed in as the diag owner, open ${path}`, async () => (await pg.locator(".adm-coming-h").innerText().catch(() => "")) === w.title);
  await chk(id(), w.file, `${path}: all three planned points are listed`, `signed in, open ${path}`, () => w.points.every((p) => text.includes(p)) || "missing: " + w.points.filter((p) => !text.includes(p)));
  await chk(id(), w.file, `${path}: it says plainly it is not built yet (no button pretends otherwise)`, `signed in, open ${path}`, async () => {
    // innerText applies text-transform, so the badge reads "COMING SOON" — compare case-blind.
    const ctl = await pg.locator(".adm-coming button, .adm-coming a").count();
    return (/coming soon/i.test(text) && /not built yet/i.test(text) && ctl === 0) || JSON.stringify({ soon: /coming soon/i.test(text), notBuilt: /not built yet/i.test(text), controls: ctl });
  });
  await chk(id(), w.file, `${path}: it renders INSIDE the owner shell (sidebar and top strip present)`, `signed in, open ${path}`, async () => (await pg.locator(".adm.owx").count()) === 1);
  await chk(id(), w.file, `${path}: no code text leaks onto the screen`, `signed in, open ${path}`, () => junk(text).length === 0 || junk(text).join(","));
  await chk(id(), L, `${path}: the browser tab is titled "Owner — Aevidine"`, `signed in, open ${path}`, async () => (await pg.title()) === "Owner — Aevidine" || await pg.title());
  await pg.close();
}
// n = 189413
// ── the skin is painted on the server, from the cookie ─────────────────────────────────────────
const skinOf = async (val, path = "/owner") => {
  const c = await browser.newContext();
  await loginAs(c, "owner", BASE);
  if (val !== null) await c.addCookies([{ name: "aevidine_skin", value: val, url: BASE }]);
  const html = await (await c.request.get(BASE + path)).text();
  await c.close();
  return (html.match(/data-skin="(\w+)"/) || [])[1];
};
await chk("P189413", L, "skin cookie 'light' → the server's HTML is already light (no dark flash)", "GET /owner signed in, cookie aevidine_skin=light, read the HTML", async () => (await skinOf("light")) === "light" || await skinOf("light"));
await chk("P189414", L, "skin cookie 'dark' → dark", "same, cookie dark", async () => (await skinOf("dark")) === "dark");
await chk("P189415", L, "an unrecognised skin value is not trusted — the default (dark) paints", "same, cookie 'purple'", async () => (await skinOf("purple")) === "dark");
await chk("P189416", L, "no skin cookie at all → dark, the default everywhere", "same, no cookie", async () => (await skinOf(null)) === "dark");
await chk("P189417", MK, "the Coming-soon page gets the same server-painted skin", "GET /owner/marketing, cookie light", async () => (await skinOf("light", "/owner/marketing")) === "light");
await chk("P189418", ON, "…and so does the other one", "GET /owner/online, cookie light", async () => (await skinOf("light", "/owner/online")) === "light");

// ── phone width ────────────────────────────────────────────────────────────────────────────────
const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await loginAs(phone, "owner", BASE);
n = 189419;
for (const [path, w] of Object.entries(want)) {
  const pg = await phone.newPage();
  await pg.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
  await pg.waitForSelector(".adm-coming", { timeout: 60000 }).catch(() => {});
  const m = await pg.evaluate(() => {
    const h = document.querySelector(".adm-coming-h")?.getBoundingClientRect();
    const box = document.querySelector(".adm-coming")?.getBoundingClientRect();
    return { docW: document.documentElement.scrollWidth, vw: innerWidth, hR: h ? h.right : -1, hL: h ? h.left : -1, bR: box ? box.right : -1 };
  });
  await chk(id(), w.file, `${path} at 360px: the page never scrolls sideways`, "A35-sized phone, 360x780 dpr3, touch", () => m.docW <= m.vw || `document ${m.docW}px on a ${m.vw}px screen`);
  await chk(id(), w.file, `${path} at 360px: the heading and the card sit fully on screen`, "A35-sized phone", () => (m.hL >= 0 && m.hR <= m.vw && m.bR <= m.vw + 0.5) || JSON.stringify(m));
  await pg.close();
}
// n = 189423
// ── reading the gate ───────────────────────────────────────────────────────────────────────────
const g = src(L);
await chk("P189423", L, "the admin token is only checked when an act-as cookie is present (no wasted read for an owner)", "read the try block", () => /if \(acting\) actingValid = await tokenIsValid\(store\.get\(AUTH_COOKIE\)\?\.value\)/.test(g));
await chk("P189424", L, "an owner who owns nothing live gets the plain sign-in redirect, never an empty cockpit", "read the owner branch", () => /if \(!ownedIds\.length\) redirect\("\/login\?next=\/owner"\)/.test(g));
await chk("P189425", L, "a module read that fails hides that one nav item for one render — the panel itself still opens", "read navOn", () => /const navOn = \(p: Promise<\{ effective: boolean \}>\) => p\.then\(\(l\) => l\.effective, \(\) => false\)/.test(g));
await chk("P189426", L, "both database-blip errors land on the reconnecting screen; anything else is rethrown", "read the catch", () => /if \(e instanceof AuthDbError \|\| e instanceof OwnedLookupFailed\) return <OwnerReconnecting \/>;\s*throw e;/.test(g));
await chk("P189427", L, "the admin's act-as view reads ONE restaurant's entitlements (the one acted as), never the union", "read the admin branch", () => (g.match(/getOwnerEntitlements\(acting\)/g) || []).length === 2);
await chk("P189428", L, "the number-fitting helper is mounted on both render paths", "read both returns", () => (g.match(/<AutoFitNumbers \/>/g) || []).length === 2);
await chk("P189429", L, "the signed-out branch is the LAST statement — nothing after it can render the cockpit", "read the tail", () => /return <SignInBounce \/>;\s*\}\s*$/.test(g));
await chk("P189430", L, "the gate issues no write of any kind", "read every call", () => !/\.(insert|update|upsert|delete)\(/.test(g));

await browser.close();
report("T20 band E · the owner panel's door and the two Coming-soon pages (P189391–P189430)", { expect: 40 });
process.exit(process.exitCode || 0);
