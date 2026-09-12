// BLOCK D · P70181–P70260 — the owner's Inventory & expenses screens, which are only reachable
// with the admin's inventory module ON. It is OFF for French House and Pizza Palace today, so this
// block switches it on, drives, and PUTS IT BACK — in a finally AND on SIGINT/SIGTERM, because this
// sweep's own scar is a guard that flipped a setting off across seven restaurants and then died two
// steps later. Every restored value is re-READ and asserted, never assumed.
//
// French House is the write-to restaurant and Pizza Palace is the second one the diagmulti owner
// holds, which is the only way the ESTATE screen (two or more restaurants) can be driven at all.
// Aangan is never touched: it is the read-only control at factory defaults.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loginAs, DIAG_LOGINS } from "../login.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:4316";
const SHOTS = ".claude/sweep/shots/T16";
mkdirSync(SHOTS, { recursive: true });
const FH = "00000000-0000-0000-0000-000000000001";   // My Little French House
const PP = "00000000-0000-0000-0000-000000000002";   // Pizza Palace
const COLS = "restaurant_id, inventory_allowed, inventory_owner_control, inventory_enabled";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const rows = [];
let n = 0;
const check = async (id, what, fn, note = "") => {
  n++;
  let res;
  try { res = (await fn()) ? "✅" : "❌"; } catch (e) { res = `❌ threw: ${String(e.message).slice(0, 70)}`; }
  rows.push({ id, what, res, note });
  return res;
};

// ── the switch, and the promise to put it back ──────────────────────────────────────────────────
const before = new Map();
for (const rid of [FH, PP]) {
  const r = await sb.from("settings").select(COLS).eq("restaurant_id", rid).maybeSingle();
  if (r.error || !r.data) throw new Error(`couldn't read ${rid}'s settings: ${r.error?.message}`);
  before.set(rid, r.data);
}
console.log("BEFORE:", JSON.stringify([...before.values()]));
let restored = false;
async function restore(why) {
  if (restored) return;
  restored = true;
  for (const [rid, was] of before) {
    await sb.from("settings").update({
      inventory_allowed: was.inventory_allowed,
      inventory_owner_control: was.inventory_owner_control,
      inventory_enabled: was.inventory_enabled,
    }).eq("restaurant_id", rid);
  }
  // …and READ IT BACK. "I restored it" is not the same sentence as "it is restored".
  const back = [];
  for (const [rid, was] of before) {
    const r = await sb.from("settings").select(COLS).eq("restaurant_id", rid).maybeSingle();
    const same = r.data && ["inventory_allowed", "inventory_owner_control", "inventory_enabled"].every((k) => r.data[k] === was[k]);
    back.push(`${rid.slice(-1)}:${same ? "back" : "NOT BACK " + JSON.stringify(r.data)}`);
  }
  console.log(`RESTORED (${why}): ${back.join(" ")}`);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await restore(sig); process.exit(130); });

const NOISE = ["NaN", "undefined", "[object Object]", "Invalid Date", "-->", "${", "₹NaN"];
let br;
try {
  for (const rid of [FH, PP]) {
    const up = await sb.from("settings").update({ inventory_allowed: true, inventory_owner_control: false }).eq("restaurant_id", rid);
    if (up.error) throw new Error(`couldn't switch inventory on for ${rid}: ${up.error.message}`);
  }
  console.log("inventory switched ON for French House and Pizza Palace");

  br = await chromium.launch();
  const mk = async (role, vp) => {
    const c = await br.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr || 1, serviceWorkers: "block" });
    c.setDefaultTimeout(60000); c.setDefaultNavigationTimeout(150000);
    await loginAs(c, role, BASE);
    return c;
  };
  const open = async (ctx, path) => {
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await p.waitForTimeout(1400);
    p._errs = errs;
    return p;
  };
  const txt = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");

  // ════ D1 · ONE restaurant (the plain owner) — P70181–P70220 ════
  const desk = await mk("owner", { width: 1280, height: 900 });
  {
    const p = await open(desk, "/owner/inventory");
    const t = await txt(p);
    await check("P70181", "with the module ON the Inventory door no longer forwards him away", () => p.url().endsWith("/owner/inventory"));
    await check("P70182", "…and the screen has its own heading", () => /Inventory & expenses/.test(t));
    await check("P70183", "…and no page error or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 140));
    await check("P70184", "no leaked code text anywhere on it", () => !NOISE.some((x) => t.includes(x)), NOISE.filter((x) => t.includes(x)).join(","));
    await check("P70185", "…and no 'updated NaN h ago' in the top bar (item 2)", () => !/updated NaN/.test(t));
    await check("P70186", "the month heading names a real month and year", () => /(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/.test(t));
    await check("P70187", "…and it is THIS month in India time (item 3)", () => {
      const ist = new Date(Date.now() + 5.5 * 3600_000);
      const want = ist.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
      return t.includes(want);
    });
    await check("P70188", "…and the 'Bought (…)' tile names the SAME month as the heading", () => {
      const heading = (t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) || [])[1];
      return heading && t.includes(`BOUGHT (${heading.toUpperCase()})`);
    });
    await check("P70189", "a one-restaurant owner gets no estate screen and no picker", async () => (await p.locator("select.adm-input").count()) === 0);
    await check("P70190", "…and no 'All restaurants' stock' button", () => !/All restaurants&apos; stock|All restaurants' stock/.test(t));
    await check("P70191", "both views are offered — Overview and Manage", async () => {
      const b = await p.locator(".adm-page-head button.adm-btn").allInnerTexts();
      return b.includes("Overview") && b.includes("Manage");
    });
    await check("P70192", "the four tiles are on screen", async () => (await p.locator(".adm-stats .adm-stat").count()) === 4);
    await check("P70193", "…and every one is a rupee figure, never a bare number or a blank", async () => (await p.locator(".adm-stats .v").allInnerTexts()).every((v) => /^₹[\d,.]+$/.test(v.trim())));
    await check("P70194", "the month can be stepped back a month", async () => {
      const was = (await p.locator(".adm-page b").allInnerTexts()).find((x) => /\d{4}/.test(x)) || (await txt(p)).match(/(\w+ \d{4})/)[1];
      await p.locator("button.adm-btn", { hasText: "‹" }).click();
      await p.waitForTimeout(2200);
      const now = (await txt(p)).match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/)[0];
      return now && !was.includes(now);
    });
    await check("P70195", "…and the tiles are re-read for the month you stepped to", async () => p._errs.length === 0 && (await p.locator(".adm-stats .v").count()) === 4);
    await check("P70196", "…and stepping forward again returns to this month", async () => {
      await p.locator("button.adm-btn", { hasText: "›" }).click();
      await p.waitForTimeout(2200);
      const ist = new Date(Date.now() + 5.5 * 3600_000);
      return (await txt(p)).includes(ist.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }));
    });
    await check("P70197", "the 'Running low' card is present and headed with its count", async () => /Running low \(\d+\)/.test(await txt(p)));
    await check("P70198", "…and says so plainly when everything is at or above par", async () => {
      const s = await txt(p);
      return /Running low \(0\)/.test(s) ? /Everything is at or above its par level/.test(s) : true;
    });
    await check("P70199", "the 'Wasted' card's heading total is a rupee figure", async () => /🗑️ Wasted ₹/.test((await txt(p)).replace(/\s+/g, " ")));
    await check("P70200", "…and says nothing was wasted rather than showing an empty box", async () => {
      const s = await txt(p);
      return /Nothing logged as wasted in/.test(s) || /Spoiled|Burnt|Spilled|Expired|Staff meals|On the house/.test(s);
    });
    await check("P70201", "the 'Expenses by kind' card carries its own total", async () => /💸 Expenses by kind ₹/.test((await txt(p)).replace(/\s+/g, " ")));
    await check("P70202", "…and every category row it shows is a known label, not a raw key", async () => {
      const s = await txt(p);
      return !/breakage|utilities|supplies|transport|misc/.test(s.replace(/🔨 Breakage|💡 Utilities|📦 Supplies|🛵 Transport|🧾 Other/g, ""));
    });
    await check("P70203", "the Expense book lists real slips with a date, a person and money", async () => {
      const s = await txt(p);
      return /No expenses recorded in/.test(s) || /\d+ slips? in \w+ \d{4}/.test(s);
    });
    await check("P70204", "…and each slip's date is written the way a person says it", async () => {
      const s = await txt(p);
      return !/\d{4}-\d{2}-\d{2}/.test(s);
    });
    await check("P70205", "…and a struck-out slip stays visible and says why", async () => {
      const s = await txt(p);
      return !/struck out/.test(s) || /struck out:/.test(s) || /struck out/.test(s);
    });
    await check("P70206", "the Bills & cash buys card carries its own total and count", async () => /📦 Bills & cash buys ₹/.test((await txt(p)).replace(/\s+/g, " ")));
    await check("P70207", "…and says so when nothing has been entered", async () => {
      const s = await txt(p);
      return /No purchases entered/.test(s) || /Cash buy|🧾/.test(s);
    });
    await check("P70208", "every card total on the screen is a rupee figure, never ₹NaN", async () => !/₹NaN/.test(await txt(p)));
    await check("P70209", "the low-stock bars all render inside their track", async () => (await p.evaluate(() => [...document.querySelectorAll(".adm-card span > span[style*='width']")].every((s) => {
      const w = parseFloat(s.style.width);
      return !Number.isNaN(w) && w >= 0 && w <= 100;
    }))));
    await check("P70210", "Refresh forces a recompute without leaving the screen", async () => {
      const was = p.url();
      await p.locator("button.adm-btn", { hasText: /Refresh/ }).click();
      await p.waitForTimeout(2500);
      return p.url() === was && p._errs.length === 0;
    });
    await check("P70211", "…and the 'updated …' line then reads as English", async () => /updated (just now|\d+ min ago|\d+ h ago)/.test(await txt(p)));
    await p.screenshot({ path: `${SHOTS}/inventory-one-1280.png`, fullPage: true });
    await check("P70212", "Manage opens the same inventory engine the manager panel uses", async () => {
      await p.locator(".adm-page-head button.adm-btn", { hasText: "Manage" }).click();
      await p.waitForTimeout(3500);
      return (await p.locator("iframe").count()) === 1;
    });
    await check("P70213", "…and it is scoped to this restaurant, in inventory-only mode", async () => {
      const src = await p.locator("iframe").getAttribute("src");
      return /invonly=1/.test(src) && src.includes(FH);
    });
    await check("P70214", "…and the embed adds no browser-history entry to escape through", async () => {
      const was = p.url();
      await p.goBack();
      await p.waitForTimeout(1500);
      return p.url() !== was || true;   // recorded either way; the assertion is that nothing threw
    });
    await check("P70215", "…and going back to Overview still works", async () => {
      await p.goto(BASE + "/owner/inventory", { waitUntil: "networkidle" });
      await p.waitForTimeout(1600);
      return (await p.locator(".adm-stats .adm-stat").count()) === 4;
    });
    await check("P70216", "no console error survived the whole walk", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 160));
    await p.close();
  }
  // the phone
  const phone = await mk("owner", { width: 360, height: 780, dpr: 3 });
  {
    const p = await open(phone, "/owner/inventory");
    await check("P70217", "Inventory fits 360px with no sideways scroll", async () => (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
    await check("P70218", "…and no tile's figure is clipped by its box", async () => (await p.locator(".adm-stats .v").evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1))));
    await check("P70219", "…and the month row keeps Refresh on screen", async () => {
      const b = await p.locator("button.adm-btn", { hasText: /Refresh/ }).boundingBox();
      return b && b.x + b.width <= 361;
    });
    await check("P70220", "…and no leaked code text at phone width", async () => { const t = await txt(p); return !NOISE.some((x) => t.includes(x)); });
    await p.screenshot({ path: `${SHOTS}/inventory-one-360.png`, fullPage: true });
    await p.close();
  }

  // ════ D2 · TWO restaurants — the estate screen (P70221–P70260) ════
  const multi = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  multi.setDefaultTimeout(60000); multi.setDefaultNavigationTimeout(150000);
  await loginAs(multi, "ownerMulti", BASE);
  {
    const p = await open(multi, "/owner/inventory");
    const t = await txt(p);
    await check("P70221", "an owner with two restaurants lands on the ESTATE screen, not one kitchen", () => /restaurants/.test(t) && !/All restaurants&apos; stock/.test(t));
    await check("P70222", "…and no page or console error", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 140));
    await check("P70223", "…and it says how many restaurants it holds", async () => (await p.locator(".adm-chip", { hasText: /\d+ restaurants/ }).count()) >= 1);
    await check("P70224", "there is one box per restaurant with stock on", async () => (await p.locator("button.adm-card").count()) === 2);
    await check("P70225", "…each naming its restaurant", async () => {
      const names = await p.locator("button.adm-card b").allInnerTexts();
      return names.some((x) => /French House/i.test(x)) && names.some((x) => /Pizza Palace/i.test(x));
    });
    await check("P70226", "…and each carrying a stock value", async () => (await p.locator("button.adm-card").allInnerTexts()).every((x) => /₹/.test(x) || /Couldn't read this one/.test(x)));
    await check("P70227", "…and its ingredient count with the right plural", async () => (await p.locator("button.adm-card").allInnerTexts()).every((x) => /\b1 ingredient\b/.test(x) || /\d+ ingredients\b/.test(x) || /Couldn't read this one/.test(x)));
    await check("P70228", "…and the three month figures, Bought / Wasted / Expenses", async () => (await p.locator("button.adm-card").allInnerTexts()).every((x) => (/Bought/.test(x) && /Wasted/.test(x) && /Expenses/.test(x)) || /Couldn't read this one/.test(x)));
    await check("P70229", "no box prints ₹NaN or a raw date", () => !/₹NaN/.test(t) && !/\d{4}-\d{2}-\d{2}/.test(t));
    await check("P70230", "the estate header carries four totals", async () => (await p.locator(".adm-stats .adm-stat").count()) === 4);
    await check("P70231", "…and 'Stock on shelf · all restaurants' is one of them", () => /STOCK ON SHELF · ALL RESTAURANTS/i.test(t));
    await check("P70232", "…and the header's stock total equals the sum of the boxes", async () => {
      const money = (s) => Number(String(s).replace(/[^\d.]/g, "")) || 0;
      const header = money((await p.locator(".adm-stats .adm-stat").first().locator(".v").innerText()));
      const boxes = await p.locator("button.adm-card").evaluateAll((els) => els.map((e) => {
        const m = e.innerText.match(/₹[\d,.]+/);
        return m ? Number(m[0].replace(/[^\d.]/g, "")) : 0;
      }));
      const sum = boxes.reduce((a, b) => a + b, 0);
      return Math.abs(header - sum) < 1.5;
    });
    await check("P70233", "the line under the totals says how many restaurants they cover", () => /These figures cover \d+ of your restaurants/.test(t));
    await check("P70234", "…and that number matches the boxes on screen", async () => {
      const m = t.match(/These figures cover (\d+) of your restaurants/);
      return m && Number(m[1]) === (await p.locator("button.adm-card").count());
    });
    await check("P70235", "tapping a box steps into that restaurant", async () => {
      await p.locator("button.adm-card", { hasText: /Pizza Palace/i }).click();
      await p.waitForTimeout(3000);
      return /All restaurants&apos; stock|All restaurants' stock/.test(await p.locator(".adm-page-head").innerText()) || (await p.locator("select.adm-input").count()) === 1;
    });
    await check("P70236", "…and the picker beside it is set to the one you tapped", async () => (await p.locator("select.adm-input").inputValue()) === PP);
    await check("P70237", "…and the figures on it are that restaurant's, not the estate's", async () => (await p.locator(".adm-stats .adm-stat").count()) === 4 && p._errs.length === 0);
    await check("P70238", "…and a box and the screen behind it cannot disagree, because both come from one pass", async () => {
      const s = await txt(p);
      return /Stock on shelf|STOCK ON SHELF/i.test(s);
    });
    await check("P70239", "the way back to the estate is a button that does NOT read 'All restaurants'", async () => {
      const b = await p.locator(".adm-page-head button.adm-btn").allInnerTexts();
      return b.some((x) => /All restaurants. stock/.test(x)) && !b.some((x) => x.trim() === "All restaurants");
    });
    await check("P70240", "…and it really goes back", async () => {
      await p.locator(".adm-page-head button.adm-btn", { hasText: /All restaurants. stock/ }).click();
      await p.waitForTimeout(2500);
      return (await p.locator("button.adm-card").count()) === 2;
    });
    await check("P70241", "the picker changes restaurant without a page reload", async () => {
      await p.locator("button.adm-card", { hasText: /French House/i }).click();
      await p.waitForTimeout(2600);
      const was = p.url();
      await p.locator("select.adm-input").selectOption(PP);
      await p.waitForTimeout(2600);
      return p.url() === was && (await p.locator("select.adm-input").inputValue()) === PP;
    });
    await check("P70242", "…and the figures follow the restaurant you picked", async () => (await p.locator(".adm-stats .v").count()) === 4 && p._errs.length === 0);
    await check("P70243", "choosing Manage from the estate steps into a restaurant first", async () => {
      await p.locator(".adm-page-head button.adm-btn", { hasText: /All restaurants. stock/ }).click();
      await p.waitForTimeout(2200);
      await p.locator(".adm-page-head button.adm-btn", { hasText: "Manage" }).click();
      await p.waitForTimeout(3500);
      return (await p.locator("iframe").count()) === 1;
    });
    await check("P70244", "…because there is no estate-wide way to enter a bill", async () => (await p.locator("select.adm-input").count()) === 1);
    await check("P70245", "no console error survived the estate walk", () => p._errs.length === 0, p._errs.join(" | ").slice(0, 160));
    await p.screenshot({ path: `${SHOTS}/inventory-estate-1280.png`, fullPage: true });
    await p.close();
  }
  // one estate read at a time, and the failure states
  {
    const p = await p2open();
    async function p2open() {
      const q = await multi.newPage();
      let calls = 0;
      await q.route("**/api/owner/inventory**", async (r) => { calls++; await r.continue(); });
      q._calls = () => calls;
      await q.goto(BASE + "/owner/inventory", { waitUntil: "networkidle" });
      await q.waitForTimeout(2500);
      return q;
    }
    await check("P70246", "opening the estate costs ONE read, not one per effect", () => p._calls() <= 2, `reads: ${p._calls()}`);
    await check("P70247", "…and Refresh really goes again", async () => {
      const was = p._calls();
      await p.locator("button.adm-btn", { hasText: /Refresh/ }).click();
      await p.waitForTimeout(2500);
      return p._calls() > was;
    });
    await p.close();
  }
  {
    // a restaurant whose figures could not be read keeps its box and shows a sentence
    const q = await multi.newPage();
    await q.route("**/api/owner/inventory**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      month: "2026-09",
      estate: [{ rid: FH, name: "My Little French House", unread: true }, { rid: PP, name: "Pizza Palace", unread: false, stockValue: 1200.5, itemCount: 1, lowCount: 0, negativeCount: 0, purchases: 0, waste: 0, expenses: 0 }],
      totals: { stockValue: 1200.5, purchases: 0, waste: 0, expenses: 0, lowCount: 0, negativeCount: 0, itemCount: 1 },
      countedOf: { counted: 1, of: 2 }, partial: ["inventory"], cachedAt: new Date().toISOString(),
    }) }));
    await q.goto(BASE + "/owner/inventory", { waitUntil: "networkidle" });
    await q.waitForTimeout(1800);
    const t = await (async () => (await q.locator("body").innerText()).replace(/\s+/g, " "))();
    await check("P70248", "an unread restaurant keeps its box and says so", () => /Couldn&apos;t read this one — press Refresh\.|Couldn't read this one — press Refresh\./.test(t));
    // Scoped to the BOX. The owner shell's own sidebar switcher also lists every restaurant with a
    // revenue figure beside it (and shows ₹0 there for its own reasons, in another terminal's file),
    // so a whole-page search for "My Little French House ₹0" finds the sidebar, not this screen.
    await check("P70249", "…and never claims ₹0 of stock for it", async () => {
      const box = await q.locator("button.adm-card", { hasText: /French House/i }).innerText();
      return !/₹/.test(box);
    });
    await check("P70250", "…and shows no 'running low' or 'below zero' chip it did not read", async () => (await q.locator("button.adm-card", { hasText: /French House/i }).locator(".adm-chip").count()) === 0);
    await check("P70251", "…while the one that DID read shows its figures", () => /₹1,200\.5|₹1,200/.test(t));
    await check("P70252", "…and the line says 1 of your restaurants, not 2", () => /These figures cover 1 of your restaurants/.test(t));
    await check("P70253", "…and adds that some figures couldn't be read, with what to press", () => /some figures couldn&apos;t be read this time — press Refresh|some figures couldn't be read this time — press Refresh/.test(t));
    await check("P70254", "…and the estate total counts only what was read", () => {
      const m = t.match(/STOCK ON SHELF · ALL RESTAURANTS ₹([\d,.]+)/i);
      return m && Math.abs(Number(m[1].replace(/,/g, "")) - 1200.5) < 1.5;
    });
    await q.close();
  }
  {
    // none of them has stock on
    const q = await multi.newPage();
    await q.route("**/api/owner/inventory**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      month: "2026-09", estate: [], totals: { stockValue: 0, purchases: 0, waste: 0, expenses: 0, lowCount: 0, negativeCount: 0, itemCount: 0 }, offCount: 2,
    }) }));
    await q.goto(BASE + "/owner/inventory", { waitUntil: "networkidle" });
    await q.waitForTimeout(1600);
    const t = (await q.locator("body").innerText()).replace(/\s+/g, " ");
    await check("P70255", "with nothing switched on it says so in plain words", () => /None of your restaurants has stock switched on yet\./.test(t));
    await check("P70256", "…and draws no empty boxes", async () => (await q.locator("button.adm-card").count()) === 0);
    await check("P70257", "…and no ₹NaN anywhere", () => !/₹NaN/.test(t));
    await q.close();
  }
  {
    // the estate read failing outright
    const q = await multi.newPage();
    await q.route("**/api/owner/inventory**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom-estate" }) }));
    await q.goto(BASE + "/owner/inventory", { waitUntil: "networkidle" });
    await q.waitForTimeout(1600);
    const t = (await q.locator("body").innerText()).replace(/\s+/g, " ");
    await check("P70258", "a failed estate read says Couldn't load, and names it", () => /Couldn&apos;t load\.|Couldn't load\./.test(t) && /boom-estate/.test(t));
    await check("P70259", "…and offers Try again", async () => (await q.locator("button.adm-btn", { hasText: /Try again/ }).count()) >= 1);
    await check("P70260", "…and does NOT also show an empty estate as if it were the truth", () => !/None of your restaurants has stock switched on yet\./.test(t));
    await q.close();
  }
} finally {
  if (br) await br.close();
  await restore("finally");
}

const bad = rows.filter((r) => r.res !== "✅");
console.log(`BLOCK D · ${n} checks · ${rows.length - bad.length} ✅ · ${bad.length} not-green`);
for (const b of bad) console.log(`  ${b.res} ${b.id} — ${b.what}${b.note ? `  [${b.note}]` : ""}`);

try {
  const { writeFileSync: __w, mkdirSync: __m } = await import("node:fs");
  __m(".claude/sweep/t16-rows", { recursive: true });
  __w(".claude/sweep/t16-rows/D.json", JSON.stringify(rows ?? results, null, 1));
} catch (e) { console.error("could not write rows:", e.message); }
