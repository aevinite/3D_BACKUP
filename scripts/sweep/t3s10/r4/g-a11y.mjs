// Round 4 · G — A DINER WHO USES A SCREEN READER OR ONLY A KEYBOARD.
//
// Half 1: axe-core (node_modules/axe-core — the standard automated accessibility checker, the one browser
// devtools use) runs over each ordering screen in both skins, limited to that screen's own box, against
// WCAG 2.0/2.1 A and AA. Colour contrast is left to round 3's own measured audit (it read gradients axe
// cannot) — everything else axe knows is checked.
// Half 2: the keyboard. Each popup opened with Enter must take the focus inside it, keep Tab inside it (a
// focus trap), close on Escape, and hand the focus back to the button that opened it.
// Orders and calls are caught in the browser; nothing is sent.
import { check, ROOT } from "./h4.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { page, open, addDish, openBill, closeAll } from "./live4.mjs";

const AXE = readFileSync(join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
async function catchAll(p) {
  await p.route("**/api/guest/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }));
  await p.route("**/rest/v1/rpc/lfh_call_waiter_table*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
  await p.route("**/rest/v1/rpc/lfh_submit_review*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
}
const seedTracked = () => { try { const now = Date.now(); localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000d1", tableNumber: "4", total: 840, itemCount: 2, items: [{ title: "Caffè Latte", qty: 1 }, { title: "Mocha Frappe", qty: 1 }], status: "preparing", placedAt: now - 120000 }])); } catch { /* blocked */ } };
const SCREENS = [
  ["the menu's ordering widgets (strip, basket pill, bell, saved chip)", ".order-tracker, .mini-cart, .chef-call, .gob-chip", async (p) => { await addDish(p, 0); }],
  ["the bill (Current bill)", "#cart-panel", async (p) => { await addDish(p, 0); await addDish(p, 3); await openBill(p); }],
  ["the bill (Live status)", "#cart-panel", async (p) => { await openBill(p); await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(1500); }],
  ["the bell popup", "#chef-popup", async (p) => { await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900); }],
  ["the dish popup (Customize)", ".order-confirm", async (p) => { await p.locator('button[aria-label="Customize and add Espresso"]').evaluate((b) => { b.scrollIntoView({ block: "center" }); b.click(); }); await p.locator(".order-confirm").waitFor(); await p.waitForTimeout(500); }],
  ["the dish page's Rate tab", ".review-form, .sr-rating", async (p) => { await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(700); await p.locator(".sr-toggle").nth(3).click(); await p.waitForTimeout(500); }, "/r/french-house/item/espresso?cat=coffee"],
];
let k = 0;
for (const [name, sel, go, path] of SCREENS) {
  k++;
  check(`R4-G0${k}`, "G", `${name}: axe-core finds no WCAG 2.1 A/AA problem inside it, dark and light`, async () => {
    const bad = []; let nodes = 0;
    for (const skin of ["dark", "light"]) {
      const { ctx, p, errs } = await page({ w: 390, skin, init: seedTracked });
      try {
        await catchAll(p); await p.route("**/rest/v1/rpc/get_order_status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "preparing", table_number: "4", created_at: new Date().toISOString() }]) }));
        await open(p, path); await go(p);
        await p.addScriptTag({ content: AXE });
        const res = await p.evaluate(async (sel) => {
          const roots = [...document.querySelectorAll(sel)]; if (!roots.length) return { missing: true };
          const out = []; let n = 0;
          for (const root of roots) {
            const r = await window.axe.run(root, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { "color-contrast": { enabled: false } } });
            n += r.passes.reduce((s, x) => s + x.nodes.length, 0);
            for (const v of r.violations) for (const nd of v.nodes) out.push(`${v.id} (${v.impact}) at ${nd.target.join(" ")}: ${(nd.failureSummary || "").split("\n")[1]?.trim().slice(0, 80) || ""}`);
          }
          return { out, n };
        }, sel);
        if (res.missing) bad.push(`${skin}: the screen did not appear`); else { nodes += res.n; for (const o of res.out) bad.push(`${skin}: ${o}`); }
        if (errs.length) bad.push(`${skin}: page error ${errs[0]}`);
      } finally { await ctx.close(); }
    }
    return { ok: !bad.length, note: bad.slice(0, 4).join(" · ") || `${nodes} element checks passed over 2 skins` };
  });
}
// ── the keyboard ─────────────────────────────────────────────────────────────────────────────────────
const KEYS = [
  ["the bell popup", ".chef-call", "#chef-popup"],
  ["the dish popup", 'button[aria-label="Customize and add Espresso"]', ".order-confirm"],
];
let j = 0;
for (const [name, opener, box] of KEYS) {
  j++;
  check(`R4-G1${j}`, "G", `${name} with only a keyboard: Enter opens it with the focus inside, 25 Tabs never leave it, Escape closes it and the focus returns to the button that opened it`, async () => {
    const { ctx, p, errs } = await page({ w: 1280, h: 860, touch: false });
    try {
      await catchAll(p); await open(p);
      await p.locator(opener).first().evaluate((b) => { b.scrollIntoView({ block: "center" }); b.focus(); });
      await p.keyboard.press("Enter"); await p.waitForTimeout(900);
      const inside = () => p.evaluate((box) => { const b = document.querySelector(box); return !!b && b.contains(document.activeElement); }, box);
      const first = await inside(); let escaped = 0;
      for (let i = 0; i < 25; i++) { await p.keyboard.press("Tab"); if (!(await inside())) escaped++; }
      for (let i = 0; i < 6; i++) { await p.keyboard.press("Shift+Tab"); if (!(await inside())) escaped++; }
      await p.keyboard.press("Escape"); await p.waitForTimeout(700);
      const closed = await p.evaluate((box) => { const b = document.querySelector(box); return !b || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0 || !b.closest("body"); }, box);
      const back = await p.evaluate((opener) => document.activeElement === document.querySelector(opener) || !!document.activeElement?.matches?.(opener), opener);
      return { ok: first && !escaped && closed && back && !errs.length, note: `focus inside on open: ${first} · Tabs that left it: ${escaped}/31 · closed by Escape: ${closed} · focus back on its button: ${back}` };
    } finally { await ctx.close(); }
  });
}
check("R4-G13", "G", "the bill with only a keyboard: opened from the basket button with Enter, Tab stays inside, Escape closes it and the focus comes back", async () => {
  const { ctx, p, errs } = await page({ w: 1280, h: 860, touch: false });
  try {
    await catchAll(p); await open(p); await addDish(p, 0); await closeAll(p);
    const opener = await p.evaluate(() => { const c = [...document.querySelectorAll("button, a[href]")].find((b) => { const l = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase(); const r = b.getBoundingClientRect(); return r.width > 0 && /\b(cart|bill|basket|order)\b/.test(l) && !/add|customi[sz]e/.test(l); }); if (!c) return null; c.setAttribute("data-r4-opener", "1"); return c.getAttribute("aria-label") || c.textContent.trim().slice(0, 30); });
    if (!opener) return { ok: false, note: "no keyboard-reachable button opens the bill at 1280px" };
    await p.locator("[data-r4-opener]").focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(1200);
    const inside = () => p.evaluate(() => { const b = document.querySelector("#cart-panel"); return !!b && b.classList.contains("open") && b.contains(document.activeElement); });
    const first = await inside(); let escaped = 0;
    for (let i = 0; i < 25; i++) { await p.keyboard.press("Tab"); if (!(await inside())) escaped++; }
    await p.keyboard.press("Escape"); await p.waitForTimeout(800);
    const closed = await p.evaluate(() => !document.querySelector("#cart-panel.open"));
    const back = await p.evaluate(() => document.activeElement?.hasAttribute("data-r4-opener"));
    return { ok: first && !escaped && closed && back && !errs.length, note: `opened by "${opener}" · focus inside: ${first} · Tabs that left: ${escaped}/25 · Escape closed it: ${closed} · focus back: ${back}` };
  } finally { await ctx.close(); }
});
