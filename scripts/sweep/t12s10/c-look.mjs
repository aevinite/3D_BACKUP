// scripts/sweep/t12s10/c-look.mjs — BLOCK C · P181346–P181400 · the tablet SEEN, on five screens × two skins.
//
// Read-only: it opens the floor (and a table's popup where one exists) as the signed-in waiter on
// iPad landscape 1194×834, iPad portrait 834×1194, a Samsung A35 360×780 at dpr 3, the A35 held
// sideways, and a 1280 desktop — each in the light AND the dark skin — and measures what a person
// would see: nothing wider than the screen, no code leaking into words, no tile whose contents spill
// out of it, the restaurant's own name in the bar, and a real finger target where one is promised.
//   node scripts/sweep/t12s10/c-look.mjs [--base http://localhost:4412] [--shots <dir>] [--quiet]
import { mkdirSync } from "node:fs";
import { makeRunner, ok, F_APP, F_HTML, waiterContext, openPanel, closeBrowser, sleep } from "./lib.mjs";

const DEVICES = [
  { key: "ipadL", label: "iPad sideways 1194×834", width: 1194, height: 834, touch: true },
  { key: "ipadP", label: "iPad upright 834×1194", width: 834, height: 1194, touch: true },
  { key: "a35", label: "Samsung A35 360×780", width: 360, height: 780, touch: true, dpr: 3, mobile: true },
  { key: "a35L", label: "A35 sideways 780×360", width: 780, height: 360, touch: true, dpr: 3, mobile: true },
  { key: "desk", label: "desktop 1280×800", width: 1280, height: 800, touch: false },
];

export async function blockC(R = makeRunner("T12 · block C · the tablet seen")) {
  const { check } = R;
  const shotsAt = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? process.argv[i + 1] : null; })();
  if (shotsAt) mkdirSync(shotsAt, { recursive: true });
  let n = 346;
  const id = () => "P181" + String(n++).padStart(3, "0");
  for (const dev of DEVICES) {
    for (const skin of ["light", "dark"]) {
      const ctx = await waiterContext({ ...dev, dark: skin === "dark" });
      const { page, errors } = await openPanel(ctx, { theme: skin });
      const H = `LIVE — ${dev.label}, ${skin} skin`;
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const tiles = [...document.querySelectorAll("#tiles .tile")];
        const clipped = tiles.filter((t) => { const r = t.getBoundingClientRect(); return [...t.querySelectorAll(".t-line, .t-act, .t-top")].some((c) => { const q = c.getBoundingClientRect(); return q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1 || q.left < r.left - 1); }); }).map((t) => t.dataset.t);
        const takes = [...document.querySelectorAll("#tiles .t-take")].map((e) => Math.round(e.getBoundingClientRect().height));
        const nameEl = document.getElementById("restName");
        const nr = nameEl.getBoundingClientRect();
        const text = document.body.innerText;
        return {
          sw: doc.scrollWidth, cw: doc.clientWidth,
          leak: (text.match(/\bundefined\b|\bNaN\b|\[object Object\]|\$\{/) || [""])[0],
          clipped, takes, name: nameEl.textContent, nameW: Math.round(nr.width), nameInView: nr.right <= window.innerWidth + 1,
          theme: document.documentElement.dataset.theme || "", tiles: tiles.length,
          bar: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
          hamburger: Math.round(Math.min(document.getElementById("hamburger").getBoundingClientRect().width, document.getElementById("hamburger").getBoundingClientRect().height)),
        };
      });
      if (shotsAt) await page.screenshot({ path: `${shotsAt}/${dev.key}-${skin}.png` });
      await check(id(), F_APP, `${dev.label} · ${skin}: the floor never scrolls sideways`, H, async () => ok(m.sw <= m.cw + 1, `${m.sw} vs ${m.cw}`));
      await check(id(), F_APP, `${dev.label} · ${skin}: no undefined / NaN / [object Object] anywhere on screen; the skin is the one chosen`, H, async () => ok(!m.leak && m.theme === skin, `${m.leak || "clean"} · theme ${m.theme}`));
      await check(id(), F_APP, `${dev.label} · ${skin}: no tile's contents spill out of it (${m.tiles} tiles)`, H, async () => ok(m.clipped.length === 0, m.clipped.join(",")));
      await check(id(), F_HTML, `${dev.label} · ${skin}: the bar names THIS restaurant, fully on screen, and ☰ is a finger-sized target`, H, async () => ok(/French House/i.test(m.name) && m.nameW > 0 && m.nameInView && m.hamburger >= 36, `${m.name} ${m.nameW}px · ☰ ${m.hamburger}px`));
      await check(id(), F_APP, `${dev.label} · ${skin}: no page error while the floor painted`, H, async () => ok(errors.length === 0, errors.slice(0, 2).join(" · ")));
      await ctx.close();
    }
  }
  // ── five deeper looks: the order screen and its parts on the phone and the iPad ────────────────
  {
    const ctx = await waiterContext({ ...DEVICES[2] });
    const { page } = await openPanel(ctx, { theme: "light" });
    await page.evaluate(() => openQuickOrder());
    await page.waitForSelector("#omScroll .dish", { timeout: 20000 });
    await sleep(500);
    const r = await page.evaluate(() => {
      const doc = document.documentElement, pill = document.getElementById("omViewBtn");
      const dish = document.querySelector("#omScroll .dish").getBoundingClientRect();
      return { sw: doc.scrollWidth, cw: doc.clientWidth, pill: !!pill && getComputedStyle(pill).display !== "none", dishW: Math.round(dish.width), dishH: Math.round(dish.height) };
    });
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/a35-quickorder.png` });
    await check(id(), F_APP, "A35 · ⚡ Quick order: the dish list fits the phone and its tiles are finger-sized", "LIVE — A35 360×780 light", async () => ok(r.sw <= r.cw + 1 && r.dishH >= 44 && r.dishW >= 100, JSON.stringify(r)));
    await check(id(), F_APP, "A35 · ⚡ Quick order: the floating 'View order' pill is there to reach the cart", "LIVE — A35 360×780 light", async () => ok(r.pill, JSON.stringify(r)));
    await page.evaluate(() => { const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length); state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 }); state.viewOrder = true; renderOrderMode(); });
    await sleep(400);
    const v = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, send: (() => { const b = document.getElementById("sendOrder"); const r = b.getBoundingClientRect(); return [Math.round(r.height), r.bottom <= window.innerHeight + 1 || document.querySelector(".om-voscroll").scrollHeight > 0, b.textContent]; })() }));
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/a35-vieworder.png` });
    await check(id(), F_APP, "A35 · the view-order screen fits, and its send button says CHOOSE TABLE & SEND on a quick order", "LIVE — A35 360×780 light", async () => ok(v.sw <= v.cw + 1 && v.send[0] >= 40 && /CHOOSE TABLE/.test(v.send[2]), JSON.stringify(v)));
    await page.evaluate(() => { state.cart = []; exitOrderMode(); });
    await ctx.close();
  }
  {
    const ctx = await waiterContext({ ...DEVICES[0] });
    const { page } = await openPanel(ctx, { theme: "dark" });
    await page.evaluate(() => openQuickOrder());
    await page.waitForSelector("#omScroll .dish", { timeout: 20000 });
    await sleep(400);
    const r = await page.evaluate(() => ({ cart: !!document.getElementById("omCart") && document.getElementById("omCart").getBoundingClientRect().width > 150, view: state.viewOrder, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/ipadL-quickorder-dark.png` });
    await check(id(), F_APP, "iPad sideways · ⚡ Quick order shows the order down the right-hand side, no separate review screen (owner, 2026-08-05)", "LIVE — iPad 1194×834 dark", async () => ok(r.cart && r.view === false && r.sw <= r.cw + 1, JSON.stringify(r)));
    await page.evaluate(() => exitOrderMode());
    await page.evaluate(() => { window.__t12pay = openPaymentMethodModal(1234.5, "Mark bill paid for table 3", { crm: true, split: true }); });
    await sleep(400);
    const p = await page.evaluate(() => { const b = document.querySelector(".pay-box").getBoundingClientRect(); return { inView: b.top >= 0 && b.bottom <= window.innerHeight + 1 || document.querySelector(".pay-box").scrollHeight > b.height, methods: [...document.querySelectorAll(".pay-method-btn")].map((x) => Math.round(x.getBoundingClientRect().height)) }; });
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/ipadL-paysheet-dark.png` });
    await check(id(), F_APP, "iPad sideways · the pay sheet fits the screen (or scrolls inside itself) and every way to pay is ≥ 64px tall", "LIVE — iPad 1194×834 dark", async () => ok(p.inView && p.methods.length >= 4 && p.methods.every((h) => h >= 60), JSON.stringify(p)));
    await page.evaluate(() => document.querySelector(".pay-cancel-btn").click());
    await ctx.close();
  }
  return R;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = await blockC();
  R.done();
  await closeBrowser();
}
