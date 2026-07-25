// Screenshot the Guest QR links card (Manager→Settings→Tables) to the Desktop, desktop + phone.
import { chromium } from "playwright";
import os from "os"; import path from "path";
const BASE = process.env.VERIFY_BASE || "https://3-d-backup.vercel.app";
const USER = process.env.DIAG_USER || "diagm2";
const SLUG = process.env.DIAG_SLUG || "pizza-palace";
const DESK = path.join(os.homedir(), "Desktop");
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(`${BASE}/api/panel-login`, { data: { username: USER, password: "diag-mgr-2026" } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.goto(`${BASE}/manager`, { waitUntil: "domcontentloaded", timeout: 60000 });
const getFrame = async () => { const h = await page.$("iframe"); return h ? await h.contentFrame() : null; };
const ev = async (fn) => { const f = await getFrame(); return f ? await f.evaluate(fn).catch(() => null) : null; };
let frame = null; for (let i = 0; i < 40 && !frame; i++) { frame = await getFrame(); if (!frame) await page.waitForTimeout(500); }
for (let i = 0; i < 40; i++) { const b = await ev(() => document.getElementById("brandRest")?.textContent || ""); if (b && b.trim()) break; await page.waitForTimeout(500); }
for (let a = 0; a < 6; a++) { await ev(() => document.querySelector('[data-tab="general"]')?.click()); await page.waitForTimeout(400); await ev(() => document.querySelector(".confirm-overlay .confirm-ok")?.click()); const n = await ev(() => document.querySelectorAll("[data-settings-section]").length); if (n > 0) break; await page.waitForTimeout(300); }
await ev(() => document.querySelector('[data-settings-section="tables"]')?.click());
await page.waitForTimeout(900);
// Scroll the QR card into view
await ev(() => { const h = [...document.querySelectorAll("h3")].find((x) => /Guest QR links/.test(x.textContent)); h?.scrollIntoView({ block: "start" }); });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(DESK, `qr-card-${SLUG}-desktop.png`), fullPage: false });
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(500);
await ev(() => { const h = [...document.querySelectorAll("h3")].find((x) => /Guest QR links/.test(x.textContent)); h?.scrollIntoView({ block: "start" }); });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(DESK, `qr-card-${SLUG}-phone.png`), fullPage: false });
const cnt = await ev(() => document.querySelectorAll("[data-copy-link]").length);
console.log(`screenshots saved to Desktop: qr-card-${SLUG}-desktop.png + -phone.png  (rows: ${cnt})`);
await browser.close();
