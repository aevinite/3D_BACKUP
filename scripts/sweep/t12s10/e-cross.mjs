// scripts/sweep/t12s10/e-cross.mjs — BLOCK E · P181161–P181200 · what a waiter's tap does to the OTHER
// screens, two waiter devices on one table, and judgment about a real restaurant.
//
// Writes: one order on ONE French House table (picked from today's floor, never a claimed one), retired by
// table in a finally and on SIGINT/SIGTERM. One manager and one kitchen sign-in for the whole run
// (scripts/sweep/login.mjs caches them). Reads of the manager's and kitchen's own APIs are those panels'
// ordinary reads, made with their own logins.
//   node scripts/sweep/t12s10/e-cross.mjs [--base http://localhost:4412] [--quiet]
import { makeRunner, ok, read, code, fnBody, F_APP, F_HTML, RID, BASE, db, waiterContext, openPanel, browser, closeBrowser, sleep } from "./lib.mjs";
import { retireTables } from "../fixture.mjs";
import { restoreOnExit, restoreNow } from "../restore.mjs";
import { claimedTables } from "../fixtureTables.mjs";
import { loginAs } from "../login.mjs";

export async function blockE(R = makeRunner("T12 · block E · across panels, two devices, judgment")) {
  const { check } = R;
  const X = "LIVE — tablet + the manager's/kitchen's own reads on :4412";
  const J = "JUDGMENT — read against how a real restaurant works";
  const app = read(F_APP), appC = code(F_APP);
  const count = Number((await db(`settings?restaurant_id=eq.${RID}&select=table_count&limit=1`))[0]?.table_count) || 30;
  const claimed = new Set(claimedTables());
  const open = new Set((await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&select=table_number&limit=200`)).map((s) => String(s.table_number)));
  const T = Array.from({ length: count }, (_, i) => String(i + 1)).reverse().find((t) => !claimed.has(t) && !open.has(t));
  restoreOnExit("t12s10 block E table", async () => { await retireTables([T], () => {}); });

  const b = await browser();
  const mgr = await b.newContext(); await loginAs(mgr, "manager", BASE);
  const kit = await b.newContext(); await loginAs(kit, "kitchen", BASE);
  const get = async (ctx, path) => { const r = await ctx.request.get(BASE + path); return r.ok() ? r.json() : { __status: r.status() }; };
  const w1 = await waiterContext({ width: 1194, height: 834 });
  const { page: p1 } = await openPanel(w1);
  const w2 = await waiterContext({ width: 1194, height: 834 });
  const { page: p2 } = await openPanel(w2);
  try {
    // place one order from device 1, the waiter's own way
    const plain = await p1.evaluate(() => { const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length); return d.id; });
    await p1.evaluate((t) => { openOrderForTable(t); }, T);
    await p1.waitForSelector(`#omScroll .dish[data-dish="${plain}"]`, { timeout: 20000 });
    // the element's own handlers, in the page (the cart pane scrolls inside itself; block B already
    // drove these with a real finger)
    await p1.evaluate((id) => document.querySelector(`#omScroll .dish[data-dish="${id}"]`).click(), plain);
    await p1.evaluate(() => document.getElementById("sendOrder").click());
    await p1.waitForFunction(() => !document.getElementById("confirmOverlay").hidden);
    await p1.evaluate(() => document.getElementById("confirmYes").click());
    let o = [];
    for (let i = 0; i < 30 && !o.length; i++) { await sleep(1000); o = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${T}&archived=is.false&select=id,kot_no,status&limit=5`); }
    await check("P181161", F_APP, `the waiter's order on T${T} reaches the database as one ticket with a KOT number`, X + " + DB", async () => ok(o.length === 1 && o[0].kot_no != null, JSON.stringify(o)));
    await check("P181162", F_APP, "…and the MANAGER's floor shows that table busy, from its own summary read", X, async () => {
      for (let i = 0; i < 10; i++) { const s = await get(mgr, `/api/editor/summary?table=${T}`); const tile = s && s.tiles && s.tiles[T]; if (tile && tile.state !== "free") return ok(true, tile.state + " · " + (tile.meta || "")); await sleep(1000); }
      return ok(false, "the manager's summary never showed it");
    });
    await check("P181163", F_APP, "…and the KITCHEN's board carries the ticket", X, async () => {
      for (let i = 0; i < 10; i++) { const k = await get(kit, `/api/kitchen/board?table=${T}`); const has = JSON.stringify(k).includes(o[0].id); if (has) return ok(true, `KOT #${o[0].kot_no}`); await sleep(1000); }
      return ok(false, "the kitchen board never listed it");
    });
    await check("P181164", F_APP, "a SECOND waiter device sees the table go busy by itself — no reload, well inside the 60s backstop", X, async () => {
      for (let i = 0; i < 20; i++) { const st = await p2.evaluate((t) => summaryTile(t).state, T); if (st !== "free") return ok(true, `${st} after ~${i}s`); await sleep(1000); }
      return ok(false, "device 2 still shows it free after 20s");
    });
    // two devices change the SAME dish's quantity
    await p1.evaluate((t) => selectTable(t), T); await p2.evaluate((t) => selectTable(t), T);
    await p1.waitForFunction((t) => sliceLoaded(t), T, { timeout: 20000 }); await p2.waitForFunction((t) => sliceLoaded(t), T, { timeout: 20000 });
    const itemId = await p1.evaluate(() => state.data.items[0] && state.data.items[0].id);
    await p1.evaluate(() => { window.__t = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__t.push(n.innerText); }).observe(document.getElementById("toasts"), { childList: true }); });
    await p2.evaluate(() => { window.__t = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__t.push(n.innerText); }).observe(document.getElementById("toasts"), { childList: true }); });
    // Both devices are showing 1. Device 1 asks for 2 and device 2 for 3 in the same instant — before
    // any breadcrumb can refresh either (a gap of seconds lets realtime catch device 2 up, and then it
    // is simply editing the newer number, which is correct and not a clash).
    const answers = [];
    for (const [n, pg] of [[1, p1], [2, p2]]) pg.on("response", async (res) => { if (/\/items\/[^/]+\/qty$/.test(res.url())) answers.push(`device ${n}: ${res.status()} ${(await res.text().catch(() => "")).slice(0, 160)}`); });
    await Promise.all([p1.evaluate((id) => bumpItemQty(id, +1), itemId), p2.evaluate((id) => bumpItemQty(id, +2), itemId)]);
    // Wait for the ANSWER, not a guessed delay (the shared dev box can take seconds): until one device
    // has been told, and both screens agree with the database, or 25s.
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const told = [(await p1.evaluate(() => window.__t.join(" "))), (await p2.evaluate(() => window.__t.join(" ")))].some((x) => /not saved/i.test(x));
      if (told) { await sleep(2500); break; }
    }
    const qty = (await db(`order_items?restaurant_id=eq.${RID}&id=eq.${itemId}&select=qty&limit=1`))[0]?.qty;
    const said1 = (await p1.evaluate(() => window.__t)).join(" | "), said2 = (await p2.evaluate(() => window.__t)).join(" | ");
    const lost = /not saved/i.test(said1) ? 1 : /not saved/i.test(said2) ? 2 : 0;
    await check("P181165", F_APP, "two devices on one dish at once: the dish ends on ONE of the two numbers (2 or 3), never their sum (4)", X + " + DB", async () => ok(qty === 2 || qty === 3, `qty ${qty}`));
    await check("P181166", F_APP, "…and the device whose number was replaced is TOLD it was not saved (first save wins, loser told)", X, async () => {
      const qs = JSON.stringify(await Promise.all([p1, p2].map((pg) => pg.evaluate(() => { const q = window.LFH_OUTBOX.getSnapshot(); return { q: q.queued.map((x) => x.path + ":" + x.why), f: q.failed.map((x) => x.path + ":" + (x.plain || x.error)) }; }))));
      return ok(lost !== 0, `answers: ${answers.join(" ‖ ") || "(none)"} · queues ${qs} · said: ${said1.slice(0, 60) || "-"} / ${said2.slice(0, 60) || "-"}`);
    });
    await check("P181167", F_APP, "…and the losing device's screen comes back to the number that was kept", X, async () => {
      await sleep(1500);
      const pg = lost === 1 ? p1 : p2;
      const q = await pg.evaluate((id) => (state.data.items.find((x) => x.id === id) || {}).qty, itemId);
      return ok(q === qty, `kept ${qty}, losing device shows ${q}`);
    });
    await check("P181168", F_APP, "the winning device is never told anything went wrong", X, async () => {
      const said = lost === 1 ? said2 : said1;
      return ok(!/Failed|not saved/i.test(said), said || "(nothing)");
    });
    await check("P181169", F_APP, "the manager's floor carries the same due the waiter's tile shows (one number, two screens)", X, async () => {
      await p1.evaluate(() => load()); await sleep(1500);
      const tab = await p1.evaluate((t) => Math.round(summaryTile(t).due || 0), T);
      const s = await get(mgr, `/api/editor/summary?table=${T}`);
      const man = Math.round(Number(s.tiles && s.tiles[T] && s.tiles[T].due) || 0);
      return ok(tab === man, `tablet ₹${tab} · manager ₹${man}`);
    });
    // close from device 1 (unpaid → the panel offers 'Close anyway'; we decline) — only observe
    await check("P181170", F_APP, "the restaurant's other screens never saw the waiter's half-typed cart (nothing is sent until SEND)", X, async () => {
      await p1.evaluate((t) => { openOrderForTable(t); }, T);
      await p1.waitForSelector("#omScroll .dish", { timeout: 20000 });
      await p1.evaluate(() => { const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(x.options || []).length); state.cart.push({ id: d.id, title: d.title, price: 1, qty: 1 }); });
      await sleep(1500);
      const o2 = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${T}&archived=is.false&select=id&limit=5`);
      await p1.evaluate(() => { state.cart = []; exitOrderMode(); });
      return ok(o2.length === 1, `${o2.length} order(s)`);
    });
  } finally {
    await retireTables([T], () => {});
    for (const c of [mgr, kit, w1, w2]) await c.close().catch(() => {});
    await restoreNow().catch(() => {});
  }
  await check("P181171", F_APP, `table T${T} is free again after the block`, "DB", async () => {
    const s = await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&table_number=eq.${T}&select=id&limit=2`);
    return ok(s.length === 0, `${s.length} open`);
  });

  // ── E2 · judgment — a waiter, one hand, a full tray, a busy room ─────────────────────────────
  await check("P181172", F_APP, "every money action is exactly TWO steps (tap → confirm or a picker), never one, never three", J, () =>
    ok(/if \(dest == null && !\(await confirmDialog\(`Send /.test(app) && /if \(!\(await confirmDialog\(`Close \$\{tableLabel\(t\)\} and free it\?/.test(app) && /Picking a method IS the confirmation/.test(app)));
  await check("P181173", F_APP, "a quick order never asks a third time: picking the table IS the send", J, () => ok(/A quick order already answered its second\s*\n?\s*\/\/ step in the picker/.test(app)));
  await check("P181174", F_APP, "a tap that cannot happen always SAYS why (no disabled money button on this touch panel)", J, () =>
    ok(/data-needs-accept="1" style="opacity:\.55"/.test(app) && !/id="payBill"[^>]*disabled/.test(app)));
  await check("P181175", F_APP, "the biggest control on an occupied tile is ＋ Take order — the thing a waiter does most", J, () =>
    ok(/＋ Take order \(the biggest control\)/.test(app)));
  await check("P181176", F_APP, "an accidental tile tap mid-order asks before throwing the cart away", J, () => ok(/Discard this unsent order and switch table\?/.test(app)));
  await check("P181177", F_APP, "a mis-tapped serve, accept, settle, call-done or merge can be taken back from an undo bar", J, () => {
    const n = ["Order accepted", "served", "All dishes served", "Call attended", "one bill", "tap undo to reopen the bill"].filter((w) => app.includes(w)).length;
    return ok(n === 6, `${n}/6 undo messages present`);
  });
  await check("P181178", F_APP, "a merge's undo lasts FIFTEEN seconds (owner, 2026-08-17), the others five", J, () => ok(/seconds: 15,/.test(app) && /seconds: 5,/.test(app)));
  await check("P181179", F_APP, "a waiter learns ONE split screen, reached from two doors, that can put one part on a tab", J, () =>
    ok(/function renderSplitBill/.test(app) && !/function renderSplitSettle/.test(appC) && /PAY_LATER/.test(fnBody(app, "renderSplitBill"))));
  await check("P181180", F_APP, "the payment sheet does not ask for the customer's number twice in one visit", J, () => ok(/ALREADY ASKED, SO DO NOT ASK AGAIN/.test(app) && /pay-cust-known/.test(app)));
  await check("P181181", F_APP, "an allergy is never changed without a reason — and a kitchen NOTE ('less ice') is not interrogated", J, () =>
    ok(/askAllergyReason\(/.test(app) && /a note-only save\s*\n?\s*\/\/ \("less ice"\) is not interrogated/.test(app)));
  await check("P181182", F_APP, "a typed allergy and a dish note travel separately, so 'less ice' never prints as 'NO LESS ICE'", J, () =>
    ok(/the ✎ note travels VERBATIM/.test(app) && /const avoidTxt = \(l\.avoid && l\.avoid\.length\) \? `⚠ no \$\{l\.avoid\.join/.test(app)));
  await check("P181183", F_APP, "nothing ends a table by itself — a person decides when the guests have left", J, () => ok(/Nothing ends a table by itself/.test(app) && !/auto-?close\(|autoSettle\(/.test(appC)));
  await check("P181184", F_APP, "a waiter holding no section is told plainly who can fix it, on the floor AND in the quick-order picker", J, () =>
    ok((app.match(/No tables assigned to you yet/g) || []).length >= 2));
  await check("P181185", F_APP, "a dimmed 'Change table' target still answers why when tapped (no hover needed)", J, () => ok(/A DIMMED TILE STILL ANSWERS/.test(app) && /WHY_SAYS/.test(app)));
  await check("P181186", F_APP, "a dish that sold out while the waiter was building the order turns untappable in place", J, () => ok(/if \(state\.ordering\) updateDishAvailability\(\)/.test(app)));
  await check("P181187", F_APP, "the waiter's floor and the manager's agree on what 'Free' means for a seated-but-empty table", J, () => ok(/if \(tile\.state === "waiting"\) return Object\.assign\(\{\}, tile, \{ state: "free"/.test(app) && /function tableHasAnyParty\(i\)/.test(app)));
  await check("P181188", F_APP, "a phone held by a waiter gets the same powers as the iPad — only the layout changes", J, () => ok(!/isMobile|navigator\.userAgent/.test(appC)));
  await check("P181189", F_APP, "a blocked device goes fully dark and stops asking the server anything", J, () => ok(/if \(blockedWallUp\) throw blockedError\(\);/.test(app) && /z-index:2147483647/.test(app)));
  await check("P181190", F_APP, "a slow or busy system never shows a waiter the word 'database' or a raw error code", J, () =>
    ok(/The system is very busy right now/.test(app) && !/["'`]Can't reach the database/.test(appC)));
  await check("P181191", F_APP, "the phone's back button peels one layer at a time inside an order (options → order → table → floor)", J, () =>
    ok(/Smart ONE-STEP back/.test(app) && /tablet-vieworder/.test(app) && /tablet-optpopup/.test(app)));
  await check("P181192", F_APP, "a PIN is asked only when the restaurant set one (the server decides), never by the screen guessing", J, () => ok(/const wantsPin = \(e\) =>/.test(app) && /e\.data && e\.data\.needPin === true/.test(app)));
  await check("P181193", F_APP, "after this sweep a tip is recorded only once the bill really settled (item 5)", J, () => ok(/const paid = await payBill\(t, picked\.method, picked\.note\);\n  if \(paid\) await recordTip\(t, picked\.tip, paid\.pin\);/.test(app)));
  await check("P181194", F_APP, "after this sweep a print, a question or a banquet bill made with no internet says what really happened (items 2–4)", J, () =>
    ok(/if \(queueAnswered\(r\)\) \{/.test(app) && /The banquet bill is made the moment it goes through/.test(app)));
  // Re-judged 2026-10-16 (round 3): the owner said yes to item 12 on 2026-10-15, so this is no longer a
  // question — the plain state line ("Free", "Wants in") is kept back on a phone tile. Was ⏭ (judged).
  await check("P181195", "public/panels/tablet/style.css", "the phone's 4-per-row floor still says 'Free' on a free tile (item 12, owner's yes 2026-10-15)", "read today's style.css", () =>
    ok(/@container \(max-width: 56px\) \{ \.t-line-plain \.t-linenum \{ display: block;/.test(read("public/panels/tablet/style.css"))));
  // Re-judged 2026-10-16 (round 3): fixed as item 7 (2026-10-15) — the strip counts the rota's tables
  // that are ON the floor. Was ⏭ (judged).
  await check("P181196", F_APP, "'Your tables' counts only the rota's tables that are on the floor (item 7) — a 500-table rota on a 30-table floor reads 30", "read today's app.js", () =>
    ok(/const onFloor = new Set\(floorTableList\(\)\.map\(String\)\);\s*\n\s*const real = my\.filter\(\(n\) => onFloor\.has\(String\(n\)\)\);/.test(app)));
  // Re-judged 2026-10-16 (round 3): the note was corrected as item 6 (2026-10-15). Was ⏭ (judged).
  await check("P181197", F_APP, "the app.js note about phone bands matches today's stylesheet (four per row under 1150px on a touch screen — item 6)", "read today's app.js", () =>
    ok(/two edges are both under 1150px — a phone either way up, an iPad held upright — draws FOUR per row/.test(read(F_APP))));
  await check("P181198", F_APP, "the waiter's ⚡ and the manager's Quick order are the same two-step shape (build first, table last)", J, () => ok(/build the order FIRST,\s*\n?\s*\/\/ pick the table LAST/.test(app)));
  await check("P181199", F_HTML, "the shell's loading block is announced to a screen reader (role=status, aria-live)", J, () => ok(/role="status" aria-live="polite"/.test(read(F_HTML))));
  await check("P181200", F_APP, "a waiter's own notification bell reads only their own section's tables", J, () => ok(/const mine = new Set\(floorTableList\(\)\.filter\(\(t\) => inMySection\(t\)\)\.map\(String\)\);/.test(app) && /if \(!mine\.has\(t\)\) continue;/.test(app)));   // round 3: the section filter (item 9); P213939 drives it
  return R;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = await blockE();
  R.done();
  await closeBrowser();
}
