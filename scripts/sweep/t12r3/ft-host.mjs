// scripts/sweep/t12r3/ft-host.mjs — band T: the three HOST pages that wrap the tablet —
// app/tablet/page.tsx, app/tablet/layout.tsx and app/r/[restaurant]/tablet/page.tsx — read from what
// they render for the people who really open them: a signed-in waiter, and the admin from the console.
// The REAL pages, read-only: every request that is not a read is refused inside the browser, so
// nothing the panel inside does at boot can change anything. Aangan is opened (as the admin) and only read.
import { ok, browser, db } from "../t12s10/lib.mjs";
import { loginAs, adminCookie } from "../login.mjs";
import { BASE } from "./f-world.mjs";

const FH = "00000000-0000-0000-0000-000000000001";
const H = "LIVE (read-only) — the real page on :4412, writes refused in the browser";
const ctxAs = async (who, vp = { width: 1194, height: 834 }) => {
  const b = await browser();
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: "block" });
  await ctx.route(/./, (r) => (r.request().method() === "GET" || r.request().method() === "HEAD" ? r.continue() : r.fulfill({ status: 418, body: "read-only check" })));
  if (who === "admin") await ctx.addCookies([adminCookie(BASE)]); else await loginAs(ctx, who, BASE);
  return ctx;
};
const frameSrc = async (ctx, path) => {
  const page = await ctx.newPage();
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const src = await page.waitForSelector("iframe", { timeout: 30000 }).then((f) => f.getAttribute("src")).catch(() => null);
  return { page, status: resp && resp.status(), url: page.url().replace(BASE, ""), src, title: await page.title() };
};

export async function blockFT(R, id) {
  const { check } = R;
  // Aangan's id is read from its slug (one scoped read) — never assumed.
  const AANGAN = (await db("restaurants?slug=eq.aangan-garden-restaurant&select=id&limit=1"))[0]?.id;
  {
    const ctx = await ctxAs("tablet");
    const a = await frameSrc(ctx, "/tablet");
    await check(id(), "app/tablet/page.tsx", "a signed-in waiter opening /tablet gets the panel framed, with their OWN restaurant as the paint hint (?skel=) and no ?rid", H, () => ok(a.status === 200 && a.url === "/tablet" && a.src === `/panels/tablet/index.html?skel=${FH}`, JSON.stringify({ s: a.status, u: a.url, src: a.src })));
    await check(id(), "app/tablet/page.tsx", "…the browser tab is named 'Waiter tablet — Aevidine' (not the generic app title)", H, () => ok(a.title === "Waiter tablet — Aevidine", a.title));
    await check(id(), "app/tablet/layout.tsx", "…the layout let the waiter through (the page is the panel, not a sign-in screen)", H, async () => ok(!/\/login/.test(a.url) && !!a.src));
    const b = await frameSrc(ctx, "/r/french-house/tablet");
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "the same waiter at /r/french-house/tablet gets the same frame, the address kept", H, () => ok(b.status === 200 && b.url === "/r/french-house/tablet" && b.src === `/panels/tablet/index.html?skel=${FH}`, JSON.stringify({ s: b.status, u: b.url, src: b.src })));
    const fr = await (await b.page.$("iframe")).contentFrame();
    await fr.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled, null, { timeout: 30000 }).catch(() => {});
    const drawn = await fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length).catch(() => 0);
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "…and the framed panel draws the restaurant's floor", H, () => ok(drawn >= 30, `${drawn} tiles`));
    await ctx.close();
  }
  {
    const ctx = await ctxAs("tablet", { width: 390, height: 844 });
    const a = await frameSrc(ctx, "/tablet");
    const size = await a.page.evaluate(() => { const f = document.querySelector("iframe").getBoundingClientRect(); return { w: Math.round(f.width), h: Math.round(f.height), vw: innerWidth, vh: innerHeight }; });
    await check(id(), "app/tablet/page.tsx", "on a phone the frame fills the visible screen exactly (PanelFrame)", H, () => ok(size.w === size.vw && Math.abs(size.h - size.vh) <= 1, JSON.stringify(size)));
    await ctx.close();
  }
  {
    const ctx = await ctxAs("admin");
    const a = await frameSrc(ctx, "/r/french-house/tablet");
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "the admin opening /r/french-house/tablet gets that restaurant pinned into the frame (?rid=)", H, () => ok(a.status === 200 && a.src === `/panels/tablet/index.html?rid=${FH}`, JSON.stringify({ s: a.status, src: a.src })));
    const b = await frameSrc(ctx, `/r/french-house/tablet?view=real&as=11111111-2222-4333-8444-555555555555`);
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "…'as one named waiter' and 'the actual tablet' ride into the frame (as=…&view=real)", H, () => ok(b.src === `/panels/tablet/index.html?rid=${FH}&as=11111111-2222-4333-8444-555555555555&view=real`, b.src));
    const c = await frameSrc(ctx, `/r/french-house/tablet?as=not-a-person&view=something`);
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "…a person pin that is not an id, and any view but 'real', are dropped rather than passed on", H, () => ok(c.src === `/panels/tablet/index.html?rid=${FH}`, c.src));
    const d = await frameSrc(ctx, "/r/aangan-garden-restaurant/tablet");
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "…a different restaurant's address pins THAT restaurant (each restaurant's own panel)", H, () => ok(d.src === `/panels/tablet/index.html?rid=${AANGAN}`, d.src));
    const fr = await (await d.page.$("iframe")).contentFrame();
    await fr.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled && state.data.restaurant, null, { timeout: 30000 }).catch(() => {});
    const rest = await fr.evaluate(() => state.data.restaurant && state.data.restaurant.id).catch(() => null);
    await check(id(), "app/r/[restaurant]/tablet/page.tsx", "…and the panel inside reads that restaurant (never restaurant #1's)", H, () => ok(rest === AANGAN, rest));
    await ctx.close();
  }
}
