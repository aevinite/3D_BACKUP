// scripts/sweep/t3s10/r3/livelib.mjs — what every live round-3 check shares: a phone or laptop page on the
// worktree app, a menu opened and ready, two dishes in the basket, and one screen measured.
import { chromium } from "playwright";
import { AUDIT } from "./contrast.mjs";

export const BASE = process.env.T3_BASE || "http://localhost:4403";
export const PROXY = process.env.T3R3_PROXY || "http://localhost:5499";
export const FH_PATH = "/r/french-house/menu";
export const WIDTHS = [[360, 780, true], [390, 844, true], [768, 1024, true], [1280, 800, false]];
export const LEAK = /\bundefined\b|\bNaN\b|\[object |\$\{/;
export let browser = null;
export const B = async () => (browser ||= await chromium.launch());
export async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }
// ── A PAGE THAT SAVED WORK OFFLINE NEVER GOES BACK ONLINE (learned the hard way, 2026-10-15) ───────────────
// The first contrast pass saved an order with the phone offline, asked IndexedDB to delete the saved work,
// then switched the phone back online. The delete was BLOCKED — the app still had the database open — so
// the queue did exactly its job and sent six test orders to French House's real kitchen (table 4,
// 13:32–13:41 UTC; cancelled, archived and their session closed the same afternoon). Every check here that
// saves offline therefore CLOSES its context while still offline: the context's storage dies with it, and
// nothing can send. Never `setOffline(false)` on a page after saving work on it.
export async function page({ w = 360, h = 780, touch = true, skin = "dark", seed = true } = {}) {
  const ctx = await (await B()).newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch && w < 700, hasTouch: touch, serviceWorkers: "block" });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addInitScript(({ s, seed }) => { try { localStorage.setItem("lfh_theme", s); if (seed) { const now = Date.now(); localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([
    { id: "00000000-0000-4000-8000-0000000000d1", tableNumber: "4", total: 8.4, itemCount: 2, items: [{ title: "Caffè Latte", qty: 1 }, { title: "Mocha Frappe", qty: 1 }], status: "preparing", placedAt: now - 120000 },
    { id: "00000000-0000-4000-8000-0000000000d2", tableNumber: "4", total: 3.2, itemCount: 1, items: [{ title: "Espresso", qty: 1 }], status: "served", placedAt: now - 900000, finalizedAt: now - 300000 }])); } } catch {} }, { s: skin, seed });
  await p.route("**/rest/v1/rpc/get_order_status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "preparing", table_number: "4", created_at: new Date().toISOString() }]) }));
  return { ctx, p, errs };
}
export const open = async (p, path = FH_PATH) => { for (let k = 0; k < 3; k++) { try { await p.goto(BASE + path, { waitUntil: "domcontentloaded" }); break; } catch { await p.waitForTimeout(1500); } } await p.locator('button[aria-label^="Add"], .review-tab-btn').first().waitFor({ timeout: 90000 }); await p.waitForTimeout(2500); };
export const addTwo = async (p) => { for (let i = 0; i < 2; i++) { await p.evaluate(() => { const x = document.querySelector('button[aria-label^="Add"]'); if (x) { x.scrollIntoView({ block: "center" }); x.click(); } }); await p.waitForTimeout(1100); await p.locator(".order-confirm-close").click({ timeout: 1500 }).catch(() => {}); } };
// one screen, measured: contrast, leaked code, sideways spill, tap size
export async function measure(p, sel) {
  const rows = await p.evaluate(AUDIT, sel);
  const extra = await p.evaluate((sel) => {
    const roots = [...document.querySelectorAll(sel)]; const text = roots.map((r) => r.innerText).join("\n");
    const small = []; for (const r of roots) for (const el of r.querySelectorAll("button, a[href], [role=button], input, select, textarea")) {
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!b.width || !b.height || cs.visibility === "hidden" || el.closest(".sr-rating")) continue;   // stars: the owner declined a larger size (J3)
      // what a FINGER can hit, not only the drawn box: four points 20 px out from the centre must land on it
      // (an invisible ::after hit area counts — that is how the small ✕ buttons are made thumb-sized)
      // probe it where a thumb would meet it: on screen (a point past the screen's edge hits nothing at all)
      let cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      // …and in the middle of its scroll area, as a person scrolls before tapping (near an edge, a sticky bar
      // such as the bill's Place Order footer can sit over part of it)
      if (b.width < 40 || b.height < 40) { el.scrollIntoView({ block: "center" }); const n = el.getBoundingClientRect(); cx = n.left + n.width / 2; cy = n.top + n.height / 2; }
      const reach = (d) => [[cx - d, cy], [cx + d, cy], [cx, cy - d], [cx, cy + d]].every(([x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); });
      // the 44 px target everywhere — the bin included since item 41 (2026-10-16) gave it its whole 44×44 box
      const need = 20;
      if ((b.width < 40 || b.height < 40) && !reach(need)) small.push(`${el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20) || el.className}`.slice(0, 40) + ` ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    return { text, spill: document.documentElement.scrollWidth > innerWidth + 1, small, found: roots.length };
  }, sel);
  return { bad: rows.filter((r) => !r.ok), n: rows.length, ...extra };
}
