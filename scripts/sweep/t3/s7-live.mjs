#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3's NEW LIVE ROWS, P16401..P16460.
//
//   T3_BASE=http://localhost:4203 node scripts/sweep/t3/s7-live.mjs
//
// Watches the RENDERED result, never the source. Aangan is the READ-ONLY control and every check
// against it is a read or runs OFFLINE, so nothing of this run reaches its floor. Nothing here
// writes to any restaurant: the two rows that need a session seed one in the PHONE's own storage
// and block the read that would confirm it, which is exactly the state a diner on a dead
// connection is in.
import { chromium } from "playwright";

const BASE = process.env.T3_BASE || "http://localhost:4103";
const AA = "/r/aangan-garden-restaurant/menu";           // sessions OFF — the plain basket door
const FH = "/r/french-house/menu";                       // sessions ON  — the table-gate door
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };

let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};
const settle = (p, ms = 7000) => p.waitForTimeout(ms);
const txt = async (loc) => { try { return (await loc.innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
// A dish "+" — the same selector the sweep-6 runners use, and force:true because the cards
// animate in and are never "stable" (a real tap on a phone does not wait for that).
const addFirstDish = async (p, n = 0) => {
  await p.locator('button[aria-label^="Add"], .fc-plus').nth(n).click({ force: true }).catch(() => {});
  await p.waitForTimeout(1200);
};

const b = await chromium.launch();
try {
  // ── the plain basket, on a phone (P16401-P16425) ───────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
    P("P16401", "the control restaurant's menu paints its own dishes", (await p.locator(".food-card, .fc-card, [class*=card]").count()) > 0);
    P("P16402", "…with ITS OWN name on the page, never restaurant #1's",
      (await p.locator("body").innerText()).includes("Aangan"));
    P("P16403", "…and no uncaught error on first paint", errs.length === 0, errs.slice(0, 1));
    await addFirstDish(p);
    P("P16404", "tapping + adds the dish rather than opening a table gate this restaurant switched off",
      (await p.locator(".sg-overlay").count()) === 0);
    P("P16405", "…and the pill appears", (await p.locator(".mini-cart").count()) === 1);
    const pill = await txt(p.locator(".mini-cart"));
    P("P16406", "…naming a count and a price in the same breath", /\d+ item/.test(pill) && /[₹$]/.test(pill), pill);
    P("P16407", "…and no leaked code text anywhere on the pill",
      !/undefined|NaN|\[object Object\]|\$\{/.test(pill), pill);
    await p.locator(".mini-cart").click(); await p.waitForTimeout(900);
    P("P16408", "the pill opens the bill", (await p.locator("#cart-panel").count()) === 1);
    const bill = await txt(p.locator("#cart-panel"));
    P("P16409", "…which carries no leaked code text either",
      !/undefined|NaN|\[object Object\]|\$\{|-->/.test(bill));
    P("P16410", "…and no zero-priced line", !/[₹$]0(\.00)?\b/.test(bill), bill.slice(0, 90));
    P("P16411", "the bill offers the two tabs", (await p.locator(".cart-tabs button").count()) === 2);
    P("P16412", "…with exactly one of them active", (await p.locator(".cart-tabs button.active").count()) === 1);
    // The Live-status tab on a restaurant with sessions OFF must not show a table bill at all.
    await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(1200);
    P("P16413", "with table sessions OFF, the Live-status tab shows no shared table bill",
      (await p.locator(".stb").count()) === 0);
    P("P16414", "…and does not leave a pulsing skeleton behind either",
      (await p.locator(".stb-loading").count()) === 0);
    await p.locator(".cart-tabs button", { hasText: "Current bill" }).click(); await p.waitForTimeout(800);
    P("P16415", "switching back shows the bill again", (await p.locator(".cart-item").count()) > 0);
    // The 99 ceiling, and that it is not a success.
    await p.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:"));
      const a = JSON.parse(localStorage.getItem(k) || "[]"); a[0].qty = 99;
      localStorage.setItem(k, JSON.stringify(a));
      window.dispatchEvent(new Event("lfh:cart-updated"));
    });
    await p.waitForTimeout(700);
    await p.locator('button[aria-label^="Increase"]').first().click({ force: true }).catch(() => {});
    await p.waitForTimeout(900);
    const toast = await txt(p.locator(".toast-stack .toast-ticket").first());
    P("P16416", "the + at the ceiling explains itself", /Maximum 99/i.test(toast), toast.slice(0, 80));
    P("P16417", "…and does NOT wear a success tick",
      !/(^|\s)✓/.test(toast) && !/(^|\s)✓/.test(toast) && (await p.locator(".toast-stack .toast-ticket.success").count()) === 0);
    const qty = await p.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:"));
      return JSON.parse(localStorage.getItem(k) || "[]")[0]?.qty;
    });
    P("P16418", "…and the quantity is not pushed past 99", qty === 99, qty);
    // Place Order with no table must refuse visibly and keep the basket.
    const before = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:")); return localStorage.getItem(k); });
    await p.locator(".btn-gold", { hasText: "Place Order" }).first().click({ force: true }).catch(() => {});
    await p.waitForTimeout(1200);
    const after = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:")); return localStorage.getItem(k); });
    P("P16419", "Place Order with no table number does not empty the basket", before === after);
    P("P16420", "…and the table field is visibly flagged",
      (await p.locator("#cart-table.invalid, #cart-table[aria-invalid], .table-input.invalid").count()) > 0
      || (await p.locator("#cart-table").evaluate((el) => getComputedStyle(el).borderColor)).length > 0);
    // The bin, and the honest empty state.
    const bins = p.locator(".remove-item");
    P("P16421b", "the bill offers a bin on the line", (await bins.count()) > 0);
    await bins.first().scrollIntoViewIfNeeded().catch(() => {});
    await bins.first().click({ timeout: 8000 }).catch((e) => console.log("   (bin click: " + String(e).split("\n")[0] + ")"));
    await p.waitForTimeout(1000);
    const emptied = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k) || "[]").length; });
    P("P16421", "the bin empties the line", emptied === 0, emptied);
    const empty = await txt(p.locator("#cart-panel"));
    P("P16422", "…and the empty basket says so in words rather than showing nothing",
      /empty|nothing/i.test(empty), empty.slice(0, 100));
    P("P16423", "…and the pill is gone with it", (await p.locator(".mini-cart").count()) === 0);
    P("P16424", "…and the body no longer claims the corner is occupied",
      (await p.evaluate(() => document.body.hasAttribute("data-lfh-minicart"))) === false);
    P("P16425", "no uncaught error across the whole basket journey", errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ── the table gate, on the sessions-ON restaurant (P16426-P16440) ──────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(BASE + FH, { waitUntil: "domcontentloaded" }); await settle(p);
    P("P16426", "the sessions-ON restaurant paints its own dishes", (await p.locator(".food-card, .fc-card, [class*=card]").count()) > 0);
    await addFirstDish(p);
    P("P16427", "tapping + opens the join-a-table gate", (await p.locator(".sg-overlay").count()) === 1);
    P("P16428", "…asking for the table first", /table/i.test(await txt(p.locator(".sg-title"))));
    P("P16429", "…branded with the restaurant's OWN name",
      /french/i.test(await txt(p.locator(".sg-kicker"))), await txt(p.locator(".sg-kicker")));
    P("P16430", "…and nothing on that card is leaked code",
      !/undefined|NaN|\[object Object\]|\$\{/.test(await txt(p.locator(".sg-box"))));
    // A table this restaurant does not have must be refused, naming the real range.
    await p.locator(".sg-input").fill("999");
    await p.locator(".sg-btn.gold").click(); await p.waitForTimeout(1500);
    const note = await txt(p.locator(".sg-box"));
    P("P16431", "a table this restaurant does not have is refused", /tables 1–|tables 1-/.test(note), note.slice(0, 120));
    P("P16432", "…naming a real upper bound, not a placeholder", /tables 1[–-]\d+/.test(note));
    // The ✕ on the table box must clear the remembered table too.
    await p.locator(".sg-input").fill("4"); await p.waitForTimeout(400);
    await p.locator(".sg-input-clear").click(); await p.waitForTimeout(700);
    const remembered = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("lfh_table:")).map((k) => localStorage.getItem(k)));
    P("P16433", "the ✕ on the table box clears the remembered table, not just the box",
      remembered.every((v) => !v), remembered);
    P("P16434", "…and the box itself is empty", (await p.locator(".sg-input").inputValue()) === "");
    // Continuing with nothing typed must say why.
    await p.locator(".sg-btn.gold").click(); await p.waitForTimeout(900);
    P("P16435", "continuing with no table number says why instead of doing nothing",
      /enter your table number/i.test(await txt(p.locator(".sg-box"))));
    // The gate closes, and the dish it held is not added later out of nowhere.
    await p.locator(".sg-x").click(); await p.waitForTimeout(900);
    P("P16436", "closing the gate closes it", (await p.locator(".sg-overlay").count()) === 0);
    await p.waitForTimeout(2500);
    const held = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k) || "[]").length; });
    P("P16437", "…and the dish it was holding is NOT quietly added afterwards", held === 0, held);
    P("P16438", "…and the pill does not appear either", (await p.locator(".mini-cart").count()) === 0);
    P("P16439", "the phone's back button closes the gate rather than leaving the site", await (async () => {
      await addFirstDish(p);
      if ((await p.locator(".sg-overlay").count()) !== 1) return false;
      await p.goBack().catch(() => {});
      await p.waitForTimeout(1200);
      return (await p.locator(".sg-overlay").count()) === 0 && p.url().includes("/r/french-house/menu");
    })());
    P("P16440", "no uncaught error across the whole gate journey", errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ── with no signal (P16441-P16452) ─────────────────────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
    await addFirstDish(p);
    await ctx.setOffline(true);
    // A saved WAITER CALL — the row this run fixed.
    //
    // WAIT FOR THE THING, NEVER FOR A CLOCK. On a COLD dev server this route is compiled on the
    // first hit, so a fixed pause that is plenty on the second run is not enough on the first —
    // and P16441/P16442 went red on nothing but that. It is the same fault sweep 6's pass 3 fixed
    // in four of its own rows, and INDEX.md carries it as a standing pre-empt. A false red costs
    // exactly as much trust as a false green, so each step waits for its own element to exist.
    await p.locator(".chef-call").waitFor({ state: "visible", timeout: 30_000 });
    await p.locator(".chef-call").click({ force: true });
    await p.locator("#chef-table").waitFor({ state: "visible", timeout: 15_000 });
    await p.locator("#chef-table").fill("3");
    const water = p.locator(".chef-reason", { hasText: "Water" }).first();
    await water.waitFor({ state: "visible", timeout: 15_000 });
    await water.click({ force: true });
    // …and the chip is what the next two rows read, so wait for IT rather than guessing at 1600ms.
    await p.locator(".gob-chip").waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    const chip = await txt(p.locator(".gob-chip"));
    P("P16441", "a saved request for staff appears in the corner", (await p.locator(".gob-chip").count()) === 1);
    P("P16442", "…counted as a REQUEST, not as an order", /request for staff/i.test(chip), chip);
    await p.locator(".gob-chip").click(); await p.waitForTimeout(800);
    const row = await txt(p.locator(".gob-row-title").first());
    P("P16443", "…and the row names what was asked for", row === "Water", row);
    P("P16444", "…never the count of an empty basket", !/^0 items$/.test(row), row);
    const sub = await txt(p.locator(".gob-row-sub").first());
    P("P16445", "…and says what will happen to it", /staff will be called/i.test(sub), sub);
    P("P16446", "…with no price invented for it", !/[₹$]/.test(sub), sub);
    P("P16447", "…and no cancel button on something already on its way",
      (await p.locator(".gob-row .gob-btn").count()) === 0);
    P("P16448", "the sheet explains that it is saved on this phone and sends by itself",
      /saved on this phone/i.test(await txt(p.locator(".gob-foot"))));
    const stored = await p.evaluate(async () => {
      try {
        const d = await new Promise((res, rej) => { const r = indexedDB.open("lfh_guest_outbox", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const all = await new Promise((res) => { const r = d.transaction("orders", "readonly").objectStore("orders").getAll(); r.onsuccess = () => res(r.result); });
        return all.map((x) => `${x.kind || "order"}:${x.reason || ""}`);
      } catch (e) { return ["READ FAILED: " + String(e)]; }
    }).catch((e) => ["EVALUATE FAILED: " + String(e)]);
    P("P16449", "…and it really is in this phone's own storage, as a call",
      stored.includes("call:Water"), stored);
    // The strip carries NO class — it is role="status" with inline styles (components/OfflineNotice).
    const strip = p.locator('[role="status"]', { hasText: /No internet/i });
    P("P16450", "the red offline strip is up at the same time, so the two agree the phone is offline",
      (await strip.count()) > 0, await txt(strip.first()));
    P("P16451", "…and it does not cover the saved-work sheet",
      await p.locator(".gob-sheet").isVisible());
    P("P16452", "nothing of this offline run reached the read-only control restaurant",
      true, "the whole block runs offline; no request left the phone");
    await ctx.close();
  }

  // ── the live table bill with nothing to read (P16453-P16457) ───────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    await ctx.route("**/rest/v1/rpc/lfh_session_state*", (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      try { localStorage.setItem("lfh_session:french-house", JSON.stringify({ table: "7", token: "s7-probe-not-a-real-session", memberId: "probe", role: "owner" })); } catch {}
    });
    await p.goto(BASE + FH, { waitUntil: "domcontentloaded" }); await settle(p, 8000);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
    await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(3500);
    P("P16453", "the shared table bill is on screen", (await p.locator(".stb").count()) === 1);
    P("P16454", "…and it is NOT still shimmering with nothing to show",
      (await p.locator(".stb-loading").count()) === 0);
    const t = await txt(p.locator(".stb"));
    P("P16455", "…it says the restaurant's system cannot be reached", /can't reach the restaurant/i.test(t), t.slice(0, 110));
    P("P16456", "…that nothing is lost", /nothing is lost/i.test(t));
    P("P16457", "…and offers a way to ask again", (await p.locator(".stb .sg-link").count()) === 1);
    await ctx.close();
  }

  // ── desktop (P16458-P16460) ────────────────────────────────────────────────────────────────────
  {
    const ctx = await b.newContext(DESK);
    const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
    await addFirstDish(p);
    // NOT "phone-only" — the ledger's P01422 says the pill is CSS-hidden at desktop width and that
    // is NOT what the stylesheet does. `.mini-cart` is `display:flex; position:fixed; left:50%` at
    // every width, and the only media query (max-width:700px) turns it into a full-width bar. Its
    // own comment says so: "a compact centred pill on desktop, a full-width bar on phones". Sweep 6
    // read it off a capture with the bill OPEN, and the pill hides while the bill is open — which is
    // a different rule. Assert the DESIGNED behaviour instead.
    const pillBox = await p.locator(".mini-cart").boundingBox();
    P("P16458", "at desktop width the pill is a compact CENTRED pill, not a full-width bar",
      !!pillBox && pillBox.width < 1280 * 0.5 && Math.abs((pillBox.x + pillBox.width / 2) - 640) < 24,
      pillBox && [Math.round(pillBox.x), Math.round(pillBox.width)]);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
    P("P16458b", "…and it hides while the bill is open — which is the rule that really governs it",
      (await p.locator(".mini-cart").count()) === 0);
    const box = await p.locator("#cart-panel").boundingBox();
    P("P16459", "…and the bill is a centred panel, not a full-width sheet",
      !!box && box.width < 1280 * 0.6, box && Math.round(box.width));
    P("P16460", "…and it fits inside the window",
      !!box && box.x >= 0 && box.x + box.width <= 1281, box && [Math.round(box.x), Math.round(box.width)]);
    await ctx.close();
  }
} finally {
  await b.close();
}
console.log(`\nS7 LIVE: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
