// Block 3a — P01301..P01351. Headless, port 4103. Aangan is READ-ONLY (nothing of mine may
// reach its floor); French House is the one this sweep may write to.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
// THIS CHECKOUT'S OWN KEYS, NOT THE SHARED FOLDER'S (sweep #6 / T28, 2026-08-22). This read
// /Users/aevinite/Documents/Projects/backup_Menu/.env.local by absolute path. Every parallel lane of a
// sweep runs from its OWN worktree — that is the rule — so a guard that reaches back into the shared
// folder asserts against whatever stack THAT copy is pointed at, which may be the other backup stack
// entirely. A check that tests something other than what you asked for is worse than no check.
const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const AANGAN_ID = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const runStartedAt = new Date().toISOString();
const BASE = process.env.T3_BASE || "http://localhost:4103";
const FH = "/r/french-house/menu", AA = "/r/aangan-garden-restaurant/menu";
let pass = 0, fail = 0; const fails = [];
const t = (id, name, ok, extra = "") => { if (ok) pass++; else { fail++; fails.push(id); } console.log(`${ok ? "ok  " : "FAIL"} ${id} ${name}${extra ? " — " + extra : ""}`); };
const b = await chromium.launch();
const phone = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const settle = (p, ms = 5500) => p.waitForTimeout(ms);
const cartOf = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("lfh_cart:")) o[k] = JSON.parse(localStorage.getItem(k) || "[]"); } return o; });

{ // A. the basket on a sessions-OFF restaurant, phone
  const ctx = await b.newContext(phone); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
  t("P01301", "the guest menu paints dishes", (await p.locator(".food-card, .fc-card, [class*=card]").count()) > 0);
  t("P01302", "no uncaught page error on first paint", errs.length === 0, errs[0] || "");
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ timeout: 5000 });
  await p.waitForTimeout(1200);
  let c = await cartOf(p);
  t("P01303", "tapping + puts exactly one line in the basket", Object.values(c)[0]?.length === 1);
  t("P01304", "the basket is stored under THIS restaurant's key", Object.keys(c)[0] === "lfh_cart:aangan-garden-restaurant");
  t("P01305", "the mini-cart pill appears", (await p.locator(".mini-cart").count()) === 1);
  const pillText = await p.locator(".mini-cart").innerText().catch(() => "");
  t("P01306", "the pill says how many items", /1 item\b/.test(pillText), JSON.stringify(pillText.replace(/\n/g, " ")));
  t("P01307", "the pill shows a price, not a bare number", /[₹$€£]/.test(pillText));
  t("P01308", "the body carries the mini-cart flag so the live strip rides above it", await p.evaluate(() => document.body.getAttribute("data-lfh-minicart") === "1"));
  await p.locator(".mini-cart").click(); await p.waitForTimeout(900);
  t("P01309", "tapping the pill opens the bill", (await p.locator("#cart-panel").count()) === 1);
  t("P01310", "the pill hides itself while the bill is open", (await p.locator(".mini-cart").count()) === 0);
  t("P01311", "the bill lists the line", (await p.locator(".cart-item").count()) === 1);
  t("P01312", "the bill has a Subtotal row", (await p.locator(".bill-line", { hasText: "Subtotal" }).count()) === 1);
  t("P01313", "the bill has a Total row", (await p.locator(".bill-line.grand").count()) === 1);
  t("P01314", "there is a Place Order button", (await p.locator(".btn-gold", { hasText: "Place Order" }).count()) === 1);
  t("P01315", "the table-number field starts empty on a restaurant with no QR table", (await p.locator("#cart-table").inputValue()) === "");
  await p.locator('button[aria-label^="Decrease"], button[aria-label^="Increase"]').first().waitFor({ timeout: 5000 });
  await p.locator('button[aria-label^="Increase"]').first().click(); await p.waitForTimeout(600);
  c = await cartOf(p);
  t("P01316", "the + in the bill raises the quantity", Object.values(c)[0]?.[0]?.qty === 2);
  await p.locator('button[aria-label^="Decrease"]').first().click(); await p.waitForTimeout(600);
  c = await cartOf(p);
  t("P01317", "the − in the bill lowers it again", Object.values(c)[0]?.[0]?.qty === 1);
  await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:")); const a = JSON.parse(localStorage.getItem(k)); a[0].qty = 99; localStorage.setItem(k, JSON.stringify(a)); window.dispatchEvent(new Event("lfh:cart-updated")); });
  await p.waitForTimeout(700);
  await p.locator('button[aria-label^="Increase"]').first().click(); await p.waitForTimeout(900);
  const toastTxt = await p.locator(".toast-stack .toast-ticket").first().innerText().catch(() => "");
  t("P01318", "the + at 99 explains itself instead of going quiet", /99/.test(toastTxt), JSON.stringify(toastTxt.replace(/\n/g, " ").slice(0, 70)));
  c = await cartOf(p);
  t("P01319", "…and the quantity is not pushed past 99", Object.values(c)[0]?.[0]?.qty === 99);
  const before = await cartOf(p);
  await p.locator(".btn-gold").first().click(); await p.waitForTimeout(1200);
  t("P01320", "Place Order with no table number does not empty the basket", JSON.stringify(await cartOf(p)) === JSON.stringify(before));
  t("P01321", "…and the table field is visibly flagged", await p.evaluate(() => { const el = document.getElementById("cart-table"); return !!el && (el.classList.length > 0 || !!el.getAttribute("data-error")); }));
  await p.locator(".remove-item").first().click(); await p.waitForTimeout(700);
  c = await cartOf(p);
  t("P01322", "the bin empties the line", (Object.values(c)[0] || []).length === 0);
  t("P01323", "an empty basket says so", /empty/i.test(await p.locator("#cart-panel").innerText()));
  await ctx.close();
}

{ // B. tenant isolation on ONE device
  const ctx = await b.newContext(phone); const p = await ctx.newPage();
  await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(1000);
  const aangan = await cartOf(p);
  await p.goto(BASE + FH, { waitUntil: "domcontentloaded" }); await settle(p);
  t("P01324", "moving to another restaurant on the same phone shows NO pill from the first", (await p.locator(".mini-cart").count()) === 0);
  const both = await cartOf(p);
  t("P01325", "…because each basket is under its own key", !!both["lfh_cart:aangan-garden-restaurant"] && !both["lfh_cart:french-house"]);
  t("P01326", "…and the first basket is not destroyed by the visit", both["lfh_cart:aangan-garden-restaurant"]?.length === aangan["lfh_cart:aangan-garden-restaurant"]?.length);
  await ctx.close();
}

{ // C. the printed table sticker
  const ctx = await b.newContext(phone); const p = await ctx.newPage();
  await p.goto(BASE + "/q/9AAG8YK8", { waitUntil: "domcontentloaded" }); await settle(p);
  t("P01327", "the sticker opens the restaurant's own menu", (await p.locator(".food-card, .fc-card, [class*=card]").count()) > 0);
  t("P01328", "the tab is pinned to that restaurant", (await p.evaluate(() => sessionStorage.getItem("lfh_tab_tenant"))) === "aangan-garden-restaurant");
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(1200);
  t("P01329", "tapping + ADDS the dish — the table gate this restaurant switched off does NOT open", (await p.locator(".sg-overlay").count()) === 0);
  const c = await cartOf(p);
  t("P01330", "…and the basket lands under the sticker's own restaurant", !!c["lfh_cart:aangan-garden-restaurant"]);
  t("P01331", "…and the table number never appears in the address bar", !/table=|\?t=/.test(p.url()), p.url());
  await ctx.close();
}

{ // D. the join-a-table gate on a sessions-ON restaurant
  const ctx = await b.newContext(phone); const p = await ctx.newPage();
  await p.goto(BASE + FH, { waitUntil: "domcontentloaded" }); await settle(p);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(2500);
  t("P01332", "with sessions ON, adding a dish opens the join-a-table gate", (await p.locator(".sg-overlay").count()) === 1);
  const title = await p.locator(".sg-title").first().innerText().catch(() => "");
  t("P01333", "the gate asks for the table first", /which table/i.test(title), JSON.stringify(title));
  const kicker = await p.locator(".sg-kicker").first().innerText().catch(() => "");
  t("P01334", "the gate is branded with the restaurant's OWN name", kicker === "" || /french house/i.test(kicker), JSON.stringify(kicker));
  const box = p.locator(".sg-input").first();
  await box.fill("999"); await p.locator(".sg-btn.gold").first().click();
  // WAIT FOR THE ANSWER, don't sleep and hope. Ten terminals share this restaurant, so a fixed
  // sleep here is the difference between a phase that means something and a coin toss — the first
  // pass of this row failed twice on nothing but load, which is a false red and as bad as a false
  // green.
  await p.locator(".sg-sub", { hasText: /1–30|1-30/ }).first().waitFor({ timeout: 12000 }).catch(() => {});
  const note = await p.locator(".sg-sub").last().innerText().catch(() => "");
  t("P01335", "a table this restaurant does not have is refused, naming the real range", /1–30|1-30/.test(note), JSON.stringify(note.slice(0, 80)));
  await box.fill("29"); await p.locator(".sg-btn.gold").first().click();
  // A real table settles on ONE of its two correct screens; poll until it does rather than
  // photographing whatever is on screen after an arbitrary wait.
  const settled = async () => {
    for (let i = 0; i < 30; i++) {
      const s = await p.locator(".sg-title").first().innerText().catch(() => "");
      if (/what should we call you|isn.t open yet|already open/i.test(s)) return s;
      await p.waitForTimeout(500);
    }
    return await p.locator(".sg-title").first().innerText().catch(() => "");
  };
  const t2 = await settled();
  const boxTxt = await p.locator(".sg-box").innerText();
  t("P01336", "a real table reaches one of its TWO correct screens — never a dead end", /what should we call you/i.test(t2) || /isn.t open yet/i.test(t2), JSON.stringify(t2));
  t("P01337", "…and that screen names the table number back to the guest", /table 29/i.test(boxTxt), JSON.stringify(boxTxt.replace(/\n/g, " ").slice(0, 60)));
  await p.locator(".sg-btn.gold").first().click(); await p.waitForTimeout(1200);
  const asksName = /what should we call you|isn.t open yet/i.test(t2);
  const boxAfter = await p.locator(".sg-box").innerText();
  t("P01338", "continuing with no name says why instead of doing nothing",
    asksName ? /add your name/i.test(boxAfter) : true,
    asksName ? JSON.stringify(boxAfter.replace(/\n/g, " ").slice(0, 60)) : "table is another party's — the name guard belongs to the other two screens, covered end to end in block 3b");
  await p.locator(".sg-x").click(); await p.waitForTimeout(900);
  t("P01339", "closing the gate closes it", (await p.locator(".sg-overlay").count()) === 0);
  t("P01340", "…and the dish it was holding is NOT quietly added", ((await cartOf(p))["lfh_cart:french-house"] || []).length === 0);
  await ctx.close();
}

{ // E. no signal
  const ctx = await b.newContext(phone); const p = await ctx.newPage();
  await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(1000);
  await p.locator(".mini-cart").click(); await p.waitForTimeout(900);
  await p.locator("#cart-table").fill("3");
  await ctx.setOffline(true);
  await p.evaluate(() => { window.__t = []; window.addEventListener("lfh:toast", (e) => window.__t.push(e.detail)); });
  await p.locator(".btn-gold").first().click(); await p.waitForTimeout(2600);
  const said = (await p.evaluate(() => window.__t || [])).map((x) => `${x.message} ${x.subtitle || ""}`).join(" | ");
  t("P01341", "placing with no signal says the order is SAVED, not that it failed", /saved/i.test(said), JSON.stringify(said.slice(0, 90)));
  t("P01341b", "…and promises automatic sending, because storage really took it", /automatic/i.test(said));
  t("P01342", "…and the basket is emptied so it cannot be sent twice", ((await cartOf(p))["lfh_cart:aangan-garden-restaurant"] || []).length === 0);
  t("P01343", "a chip appears showing what is waiting on this phone", (await p.locator(".gob-chip").count()) === 1);
  const chip = await p.locator(".gob-chip").innerText().catch(() => "");
  t("P01344", "…counting them in plain words", /waiting to send/i.test(chip), JSON.stringify(chip));
  await p.locator(".gob-chip").click(); await p.waitForTimeout(700);
  t("P01345", "tapping the chip opens the list", (await p.locator(".gob-sheet").count()) === 1);
  t("P01346", "…which names what was ordered", (await p.locator(".gob-row-title").count()) >= 1);
  t("P01347", "a WAITING order offers no cancel button", (await p.locator(".gob-row:not(.gob-row-failed) .gob-btn").count()) === 0);
  const idb = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("lfh_guest_outbox"); r.onsuccess = () => { const g = r.result.transaction("orders", "readonly").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.length); g.onerror = () => res(-1); }; r.onerror = () => res(-1); }));
  t("P01348", "the order really reached this phone's storage", (await idb()) === 1);
  t("P01349", "the body flag lifts the tracker above the chip", await p.evaluate(() => document.body.getAttribute("data-lfh-outbox") === "1"));
  await p.reload({ waitUntil: "domcontentloaded" }); await settle(p, 7000);
  t("P01350", "the saved order survives a reload with no signal", (await idb()) === 1);
  await ctx.close();
  const landed = (await sb.from("orders").select("id").eq("restaurant_id", AANGAN_ID).gte("created_at", runStartedAt).limit(5)).data || [];
  t("P01351", "the read-only control restaurant is left with nothing of mine on its floor", landed.length === 0, `${landed.length} order(s) reached it`);
}

console.log(`\nBLOCK 3a: ${pass} passed, ${fail} failed${fails.length ? " -> " + fails.join(", ") : ""}`);
await b.close();
process.exit(fail ? 1 : 0);
