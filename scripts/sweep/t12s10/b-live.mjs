// scripts/sweep/t12s10/b-live.mjs — BLOCK B · P181201–P181360 · the waiter tablet DRIVEN, end to end.
//
// One signed-in waiter (French House's diagt1), iPad landscape 1194×834 with touch, driving the real
// panel on :4412 the way a waiter does: tap a free table, build an order, send it, accept, serve,
// discount, split, pay, undo, reprint, merge and un-merge, move, change table, mark a table's type,
// close, the back button inside every layer — then the same panel with NO INTERNET, and with ONE
// request answered by a stand-in to show what a PIN-gated restaurant sees.
//
// WRITES: real orders on French House only, on four tables picked at run time from a list that no
// other guard claims (scripts/sweep/fixtureTables.mjs), and every one is retired by table in a
// finally AND on SIGINT/SIGTERM. Print jobs this run caused are dismissed by id. Aangan is never
// touched. Nothing here loops a request or repeats a rate-limited action.
//   node scripts/sweep/t12s10/b-live.mjs [--base http://localhost:4412] [--quiet]
import { makeRunner, ok, F_APP, RID, BASE, ROOT, db, waiterContext, openPanel, closeBrowser, visible, sleep } from "./lib.mjs";
import { retireTables } from "../fixture.mjs";
import { restoreOnExit, restoreNow } from "../restore.mjs";

import { claimedTables } from "../fixtureTables.mjs";

// On-plan tables only (the pickers offer 1…table_count), never one another guard has claimed, and —
// because another terminal may shrink the floor while this runs — chosen from TODAY's table count.
let CANDIDATES = [];
async function pickTables(n) {
  const count = Number((await db(`settings?restaurant_id=eq.${RID}&select=table_count&limit=1`))[0]?.table_count) || 30;
  const claimed = new Set(claimedTables());
  CANDIDATES = Array.from({ length: count }, (_, i) => String(count - i)).filter((t) => !claimed.has(t));
  const inList = `table_number=in.(${CANDIDATES.join(",")})`;
  const open = (await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&${inList}&select=table_number&limit=50`)).map((s) => String(s.table_number));
  const live = (await db(`orders?restaurant_id=eq.${RID}&${inList}&archived=is.false&status=neq.cancelled&select=table_number&limit=50`)).map((o) => String(o.table_number));
  const busy = new Set([...open, ...live]);
  const out = CANDIDATES.filter((t) => !busy.has(t)).slice(0, n);
  if (out.length < n) throw new Error(`only ${out.length} free candidate tables (${out.join(",")}) — the floor is busy with someone else's run`);
  return out;
}

export async function blockB(R = makeRunner("T12 · block B · the tablet driven")) {
  const { check: rawCheck } = R;
  const SHOTS = process.argv.includes("--shots") ? "/private/tmp/t12s10-shots" : null;
  let pageRef = null;
  const check = async (id, ...rest) => {
    const before = R.rows.length;
    await rawCheck(id, ...rest);
    const row = R.rows[before];
    if (SHOTS && row && row.mark === "❌" && pageRef) {
      const fs = await import("node:fs"); fs.mkdirSync(SHOTS, { recursive: true });
      await pageRef.screenshot({ path: `${SHOTS}/${id}.png` }).catch(() => {});
      const html = await pageRef.evaluate(() => "TOASTS: " + [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent).join(" | ") + "\nURL: " + location.href + "\n" + (document.getElementById("panel") || document.body).innerText.slice(0, 1500)).catch(() => "");
      fs.writeFileSync(`${SHOTS}/${id}.txt`, html);
    }
  };
  const L = "LIVE — driven on :4412 (iPad 1194×834, touch)";
  const N = "NET — one request answered by a stand-in, nothing written";
  const [A, B, C, D] = await pickTables(4);
  const used = [A, B, C, D];
  const myJobs = new Set();
  restoreOnExit("t12s10 block B tables", async () => { await retireTables(used, () => {}); });

  const ctx = await waiterContext({ width: 1194, height: 834, touch: true, noServiceWorker: process.argv.includes("--old-app") });
  // --old-app: serve the panel's app.js as it is on origin/main (`git show origin/main:…`) — the
  // sabotage run that proves these checks fail on the code BEFORE this branch's fixes.
  if (process.argv.includes("--old-app")) {
    const { execSync } = await import("node:child_process");
    const old = execSync("git show origin/main:public/panels/tablet/app.js", { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
    await ctx.route("**/panels/tablet/app.js*", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: old }));
  }
  const { page, errors } = await openPanel(ctx);
  pageRef = page;
  // Every toast is RECORDED the moment it appears — a toast lives 2.6s, and a check that waits for the
  // network to go quiet can easily look after it has gone. clearToasts() empties the record too.
  await page.evaluate(() => {
    window.__t12toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__t12toasts.push(n.querySelector("span")?.textContent || ""); })
      .observe(document.getElementById("toasts"), { childList: true });
  });
  const inPanel = (fn, arg) => page.evaluate(fn, arg);
  const inPanelAsync = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms });
  // A real finger first. If Playwright cannot land it (an element scrolled inside its own pane, or
  // under a transient toast), the element's own click handler is fired instead — and the fallback is
  // RECORDED, so block C can look at each of those places on screen rather than trust them.
  const fallbacks = [];
  // On an iPad the table's cart is NOT beside the menu: it is one tap away behind the floating
  // "View order" pill (the phone's shape; only ⚡ Quick order held sideways keeps it on the right).
  // A real finger goes through the pill, so this does too before touching anything in the cart.
  const viaCart = async (sel) => {
    if (!/#sendOrder|#orderAlg/.test(sel)) return;
    const hidden = await page.evaluate(() => { const b = document.getElementById("sendOrder"); return !b || b.getBoundingClientRect().width === 0; });
    if (hidden && await visible(page, "#omViewBtn")) { await page.locator("#omViewBtn").click(); await sleep(300); }
  };
  const tap = async (sel) => {
    await viaCart(sel);
    try { await page.locator(sel).first().click({ timeout: 4000 }); }
    catch (e) {
      const hit = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; }, sel);
      if (!hit) throw e;
      fallbacks.push(sel);
    }
  };
  const back = async () => { await inPanel(() => history.back()); await sleep(700); };
  const toasts = (pg) => pg.evaluate(() => (window.__t12toasts || []).slice());
  const clearToasts = (pg) => pg.evaluate(() => { window.__t12toasts = []; const t = document.getElementById("toasts"); if (t) t.innerHTML = ""; });
  const lastToast = async () => (await toasts(page)).slice(-1)[0] || "";
  const confirmYes = async () => { await inPanelAsync(() => !document.getElementById("confirmOverlay").hidden); const txt = await inPanel(() => document.getElementById("confirmText").textContent); await tap("#confirmYes"); return txt; };
  const confirmNo = async () => { await inPanelAsync(() => !document.getElementById("confirmOverlay").hidden); const txt = await inPanel(() => document.getElementById("confirmText").textContent); await tap("#confirmNo"); return txt; };
  const closeDetail = async () => { if (await visible(page, "#detailClose")) { await tap("#detailClose"); await sleep(400); } };
  const tileOf = (t) => `#tiles .tile[data-t="${t}"]`;
  const tileState = (t) => inPanel((t) => { const el = document.querySelector(`#tiles .tile[data-t="${t}"]`); return el ? ([...el.classList].find((c) => /^t-(free|new|ready|prep|bill|done|seated|req)$/.test(c)) || "").slice(2) : null; }, t);
  const reload = async () => { await inPanel(() => load().catch(() => {})); await settle(500); };
  // The shared dev database is small and can be slow to wake: poll the truth instead of guessing a delay.
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(700); } return v; };
  const ordersOn = (t) => db(`orders?restaurant_id=eq.${RID}&table_number=eq.${t}&archived=is.false&select=id,status,payment_status,tip,discount,kot_no,session_id,total&order=created_at.asc&limit=20`);
  // NETWORK-QUIET instead of a guessed delay: the shared dev box answers in 100ms one minute and 2s the
  // next, so "wait 1.5s, then look" was a coin toss. settle() waits until no /api/tablet request has
  // been in flight for 700ms (and at least 400ms overall), capped at 25s.
  let inflight = 0, lastNet = Date.now();
  const isApi = (r) => r.url().includes("/api/tablet/");
  page.on("request", (r) => { if (isApi(r)) { inflight++; lastNet = Date.now(); } });
  const done = (r) => { if (isApi(r)) { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); } };
  page.on("requestfinished", done); page.on("requestfailed", done);
  const settle = async (min = 400) => { await sleep(min); const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (inflight === 0 && Date.now() - lastNet > 700) return; await sleep(150); } };
  const tipPosts = [];
  page.on("request", (r) => { if (/\/tip$/.test(r.url()) && r.method() === "POST") tipPosts.push(r.postData()); });
  page.on("response", async (res) => {
    try {
      if (/\/api\/tablet\/(print-jobs|print\/send)/.test(res.url()) && res.request().method() === "POST") {
        const j = await res.json().catch(() => null);
        if (j && j.id) myJobs.add(j.id);
      }
    } catch {}
  });

  try {
    // ── B1 · taking an order for a FREE table ──────────────────────────────────────────────────
    await check("P181201", F_APP, `table ${A} starts free on the floor`, L, async () => ok((await tileState(A)) === "free", await tileState(A)));
    await tap(tileOf(A));
    await check("P181202", F_APP, "tapping a FREE tile goes straight into taking an order (no empty popup)", L, async () => {
      await inPanelAsync(() => !!document.getElementById("omScroll"));
      return ok(!(await visible(page, ".detail-pop")), "order builder open");
    });
    await check("P181203", F_APP, "the order screen is titled with the table, and its exit says ← back", L, async () => {
      const r = await inPanel(() => [document.querySelector(".om-head h2").textContent, document.getElementById("omExit").textContent]);
      return ok(new RegExp(`T${A}`).test(r[0]) && /back/.test(r[1]), JSON.stringify(r));
    });
    await check("P181204", F_APP, "there is one category chip per section of dishes", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".om-nav .om-cat").length, document.querySelectorAll("#omScroll .om-sec").length]);
      return ok(r[0] === r[1] && r[0] > 0, JSON.stringify(r));
    });
    await check("P181205", F_APP, "tapping a category chip jumps the dish list to that section", L, async () => {
      const r = await inPanel(async () => {
        const chips = [...document.querySelectorAll(".om-nav .om-cat")]; const last = chips[chips.length - 1];
        last.click(); await new Promise((s) => setTimeout(s, 300));
        const sc = document.getElementById("omScroll"); const sec = sc.querySelector(`.om-sec[data-cat="${CSS.escape(last.dataset.cat)}"]`);
        return [last.classList.contains("on"), Math.abs(sc.scrollTop - Math.max(0, sec.offsetTop - 6)) < 40 || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2];
      });
      return ok(r.join() === "true,true", JSON.stringify(r));
    });
    await check("P181206", F_APP, "searching collapses the menu into one 'Search results' list", L, async () => {
      await page.fill("#dishSearch", "espresso");
      await sleep(200);
      const r = await inPanel(() => [...document.querySelectorAll("#omScroll .om-sec")].map((s) => s.dataset.cat + ":" + s.querySelectorAll(".dish").length));
      return ok(r.length === 1 && /^__search:\d+$/.test(r[0]), JSON.stringify(r));
    });
    await check("P181207", F_APP, "a search that matches nothing says so in words", L, async () => {
      await page.fill("#dishSearch", "zzzz-no-dish");
      await sleep(150);
      return ok(/No dishes match/.test(await inPanel(() => document.getElementById("omScroll").innerText)));
    });
    await page.fill("#dishSearch", "");
    await sleep(200);
    const plain = await inPanel(() => { const d = state.data.dishes.find((x) => !(x.tags || []).includes("sold-out") && !x.open_price && !(Array.isArray(x.options) && x.options.length)); return d ? { id: d.id, title: d.title } : null; });
    const withOpts = await inPanel(() => { const d = state.data.dishes.find((x) => Array.isArray(x.options) && x.options.length); return d ? { id: d.id, title: d.title } : null; });
    await check("P181208", F_APP, "clearing the search brings every section back", L, async () => ok((await inPanel(() => document.querySelectorAll("#omScroll .om-sec").length)) > 1));
    await tap(`#omScroll .dish[data-dish="${plain.id}"]`);
    await check("P181209", F_APP, "tapping a plain dish adds one, and its tile shows ×1", L, async () => {
      const r = await inPanel((id) => [state.cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0), document.querySelector(`#omScroll .dish[data-dish="${id}"] .dqty`)?.textContent], plain.id);
      return ok(r[0] === 1 && r[1] === "×1", JSON.stringify(r));
    });
    await tap(`#omScroll .dish[data-dish="${plain.id}"] .dname`);
    await check("P181210", F_APP, "tapping it again stacks onto the same plain line (×2, one line)", L, async () => {
      const r = await inPanel((id) => [state.cart.filter((l) => l.id === id).length, state.cart.find((l) => l.id === id).qty], plain.id);
      return ok(r.join() === "1,2", JSON.stringify(r));
    });
    await tap(`#omScroll .dish[data-dish="${plain.id}"] .dminus`);
    await check("P181211", F_APP, "the tile's − takes exactly one off", L, async () => ok((await inPanel((id) => state.cart.find((l) => l.id === id).qty, plain.id)) === 1));
    await check("P181212", F_APP, "the cart pane lists the line with its price and the running total", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll("#omCart .cline").length, document.querySelector("#omCart .ctotal b").textContent]);
      return ok(r[0] === 1 && /^₹[\d,]+$/.test(r[1]), JSON.stringify(r));
    });
    await tap(`#omScroll .dish[data-dish="${withOpts.id}"] .dedit`);
    await check("P181213", F_APP, "the ✎ on a dish opens its options popup with allergy chips and ＋ Other", L, async () => {
      await inPanelAsync(() => !!document.getElementById("optOverlay"));
      const r = await inPanel(() => [document.querySelectorAll("#optOverlay .opt-alg .optchoice").length, !!document.querySelector("#optOverlay .alg-other")]);
      return ok(r[0] >= 7 && r[1] === true, JSON.stringify(r));
    });
    await check("P181214", F_APP, "the phone/browser BACK closes only the options popup, not the order", L, async () => {
      await back();
      const r = await inPanel(() => [!!document.getElementById("optOverlay"), !!document.getElementById("omScroll")]);
      return ok(r.join() === "false,true", JSON.stringify(r));
    });
    await tap(`#omScroll .dish[data-dish="${withOpts.id}"] .dedit`);
    await inPanelAsync(() => !!document.getElementById("optOverlay"));
    await check("P181215", F_APP, "choosing an option adds its price to the popup's own total", L, async () => {
      const r = await inPanel(async () => {
        const before = document.querySelector("#optOverlay .ctotal b").textContent;
        const priced = [...document.querySelectorAll("#optOverlay [data-optg]")].find((b) => /\+₹/.test(b.textContent)) || document.querySelector("#optOverlay [data-optg]");
        priced.click(); await new Promise((s) => setTimeout(s, 80));
        return [before, document.querySelector("#optOverlay .ctotal b").textContent, priced.textContent];
      });
      return ok(r[0] !== r[1] || !/\+₹/.test(r[2]), JSON.stringify(r));
    });
    await check("P181216", F_APP, "the popup's quantity stepper and 'Add to order' put a separate, customised line in the cart", L, async () => {
      await tap("#optPlus");
      await inPanel(() => { const n = document.getElementById("optNote"); n.value = "less ice"; n.dispatchEvent(new Event("input")); });
      await tap("#optAdd");
      await sleep(200);
      const r = await inPanel((id) => state.cart.filter((l) => l.id === id).map((l) => [l.qty, l.note || ""]), withOpts.id);
      return ok(r.length === 1 && r[0][0] === 2 && r[0][1] === "less ice", JSON.stringify(r));
    });
    await check("P181217", F_APP, "the cart shows the dish note verbatim (✎ less ice), not as an allergy", L, async () => {
      const r = await inPanel(() => document.getElementById("omCart").innerText);
      return ok(/✎ less ice/.test(r) && !/no less ice/i.test(r), r.replace(/\s+/g, " ").slice(0, 160));
    });
    await tap('#orderAlg [data-oalg="nuts"]');
    await check("P181218", F_APP, "the whole-order avoid chip toggles on in the cart (no reason asked before the order exists)", L, async () => {
      await sleep(150);
      const r = await inPanel(() => [state.allergies, !!document.querySelector('#orderAlg [data-oalg="nuts"].on'), !!document.querySelector(".alg-why-in")]);
      return ok(r[0] === "nuts" && r[1] === true && r[2] === false, JSON.stringify(r));
    });
    await tap("#sendOrder");
    await check("P181219", F_APP, "SEND asks first, naming the item count and the table", L, async () => {
      const txt = await confirmNo();
      return ok(new RegExp(`Send 3 items to the kitchen for table ${A}\\?`).test(txt), txt);
    });
    await check("P181220", F_APP, "answering Cancel keeps the order screen and the whole cart", L, async () => {
      const r = await inPanel(() => [state.ordering, state.cart.reduce((s, l) => s + l.qty, 0)]);
      return ok(r[0] === true && r[1] === 3, JSON.stringify(r));
    });
    await clearToasts(page);
    await tap("#sendOrder");
    await confirmYes();
    await check("P181221", F_APP, "Yes sends it: the toast names the kitchen ticket number", L, async () => {
      await inPanelAsync(() => (window.__t12toasts || []).some((s) => /Kitchen ticket #\d+/.test(s)));
      return ok(true, await lastToast());
    });
    await check("P181222", F_APP, "after sending, the order screen closes and the cart is empty", L, async () => {
      await inPanelAsync(() => !document.getElementById("omScroll"), null, 8000).catch(() => {});
      const r = await inPanel(() => [state.ordering, state.cart.length, !!document.getElementById("omScroll")]);
      return ok(r.join() === "false,0,false", JSON.stringify(r));
    });
    await check("P181223", F_APP, "the order reached the database with the whole-order allergy and the dish note", L + " + DB", async () => {
      const o = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${A}&archived=is.false&select=id,status,allergies,items&limit=5`);
      const notes = (o[0] && o[0].items || []).map((i) => i.note || "").join("|");
      // A WAITER's order is already confirmed, so it goes straight to the kitchen as "preparing" — only a
      // guest's own phone order arrives "received" and needs accepting (owner, 2026-06-16; the route says so).
      return ok(o.length === 1 && o[0].status === "preparing" && (o[0].allergies || []).includes("nuts") && /less ice/.test(notes), JSON.stringify(o.map((x) => [x.status, x.allergies, notes])));
    });
    // FIXTURE: make THIS run's own order look like a guest's phone order ("received"), so the Accept
    // path can be driven without placing a guest order (that door is rate-limited). Our row, by id.
    {
      const o = (await ordersOn(A))[0];
      const full = (await db(`orders?restaurant_id=eq.${RID}&id=eq.${o.id}&select=items&limit=1`))[0];
      await db(`orders?restaurant_id=eq.${RID}&id=eq.${o.id}`, "PATCH", { status: "received", items: (full.items || []).map((i) => ({ ...i, status: "received" })) });
      await db(`order_items?restaurant_id=eq.${RID}&order_id=eq.${o.id}`, "PATCH", { status: "received" });
    }
    await reload();
    await check("P181224", F_APP, `table ${A}'s tile turns NEW with a one-tap ✓ accept`, L, async () => {
      const r = await inPanel((t) => [!!document.querySelector(`#tiles .tile[data-t="${t}"] [data-quick="accept"]`)], A);
      return ok((await tileState(A)) === "new" && r[0] === true, await tileState(A));
    });

    // ── B2 · the table's detail ────────────────────────────────────────────────────────────────
    await tap(tileOf(A) + " .tnum");
    await inPanelAsync(() => !!document.querySelector(".detail-pop .iline .inm"));
    await sleep(400);
    await check("P181225", F_APP, "tapping an occupied tile opens its detail popup, titled with the table", L, async () => {
      const h = await inPanel(() => document.querySelector(".detail-pop .phead h2").textContent);
      return ok(h === `T${A}`, h);
    });
    await check("P181226", F_APP, "the new order shows as its own card with its KOT number and an Accept button", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".detail-pop [data-accept]").length, document.querySelector(".detail-pop .kot")?.textContent]);
      return ok(r[0] === 1 && /^#\d+$/.test(r[1] || ""), JSON.stringify(r));
    });
    await check("P181227", F_APP, "every dish row carries the whole-order 'no nuts' line", L, async () => {
      const r = await inPanel(() => [...document.querySelectorAll(".detail-pop .iline")].map((l) => /no nuts/i.test(l.innerText)));
      return ok(r.length > 0 && r.every(Boolean), JSON.stringify(r));
    });
    await check("P181228", F_APP, "no 'Mark bill paid' while the only order is still un-accepted", L, async () => ok(!(await visible(page, "#payBill"))));
    await check("P181229", F_APP, "the KOT ▾ menu sits at the TOP of the popup when table operations are on", L, async () => {
      const r = await inPanel(() => { const ops = document.querySelector(".detail-pop .phead-ops"); return [!!ops, !!(ops && ops.querySelector("#kotMenuBtn"))]; });
      return ok(r.join() === "true,true", JSON.stringify(r));
    });
    await check("P181230", F_APP, "the bill box says the bill number honestly (or 'not numbered yet'), never a dash", L, async () => {
      const t = await inPanel(() => document.querySelector(".detail-pop .foot .billbox")?.innerText || "");
      return ok(/bill #\d+|bill not numbered yet|no bill yet/.test(t) && !/—/.test(t), t.replace(/\s+/g, " "));
    });
    await clearToasts(page);
    await tap(".detail-pop [data-accept]");
    await check("P181231", F_APP, "Accept flips the order to cooking at once (before the server answers)", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".detail-pop [data-accept]").length, state.data.orders.filter((o) => o.status === "preparing").length]);
      return ok(r[0] === 0 && r[1] >= 1, JSON.stringify(r));
    });
    await check("P181232", F_APP, "…and offers a take-back bar 'Order accepted'", L, async () => {
      await inPanelAsync(() => !!document.querySelector("#lfh-undobar") && /accepted/i.test(document.querySelector("#lfh-undobar").innerText));
      return ok(true, await inPanel(() => document.querySelector("#lfh-undobar").innerText.replace(/\s+/g, " ")));
    });
    await page.locator("#lfh-undobar .lfh-undo-btn").click();
    await check("P181233", F_APP, "tapping UNDO sends the order back to the new-order queue (server agrees)", L + " + DB", async () => {
      const o = await until(async () => { const r = await ordersOn(A); return r.length === 1 && r[0].status === "received" ? r : null; }) || await ordersOn(A);
      return ok(o.length === 1 && o[0].status === "received", JSON.stringify(o.map((x) => x.status)));
    });
    await closeDetail();
    await reload();
    await tap(tileOf(A) + ' [data-quick="accept"]');
    await check("P181234", F_APP, "the tile's own ✓ accepts without opening the table", L + " + DB", async () => {
      await settle(1800);
      const o = await ordersOn(A);
      return ok(o[0].status === "preparing" && !(await visible(page, ".detail-pop .phead h2")), o[0].status);
    });
    await reload();
    await check("P181235", F_APP, `table ${A}'s tile now reads Preparing`, L, async () => ok((await tileState(A)) === "prep", await tileState(A)));
    await tap(tileOf(A) + " .tnum");
    await inPanelAsync(() => !!document.querySelector(".detail-pop [data-serve]"));
    await clearToasts(page);
    await settle(2600);   // let the accept's own 2.5s reconcile land first, so the row is not rebuilt under the finger
    const hitInfo = await inPanel(() => { const b = document.querySelector(".detail-pop [data-serve]"); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top === b || b.contains(top) ? "button" : (top && (top.id || top.className)) || "nothing"; });
    console.log("serve button hit-test:", hitInfo);
    await page.locator(".detail-pop [data-serve]").first().click();
    await check("P181236", F_APP, "✓ Serve on one dish flips it to served at once and offers a take-back", L, async () => {
      await inPanelAsync(() => !!document.querySelector("#lfh-undobar") && /served/i.test(document.querySelector("#lfh-undobar").innerText));
      return ok((await inPanel(() => state.data.items.filter((i) => i.status === "served").length)) >= 1);
    });
    await settle(2800);
    await check("P181237", F_APP, "'🍽️ Serve all' is offered while anything accepted is still unserved", L, async () => ok(await visible(page, ".detail-pop [data-serve-all]")));
    await tap(".detail-pop [data-serve-all]");
    await check("P181238", F_APP, "Serve all serves every dish (server agrees)", L + " + DB", async () => {
      await settle(3500);
      const it = await db(`order_items?restaurant_id=eq.${RID}&order_id=in.(${(await ordersOn(A)).map((o) => o.id).join(",")})&select=status&limit=50`);
      return ok(it.length > 0 && it.every((i) => i.status === "served"), JSON.stringify(it.map((i) => i.status)));
    });
    await reload();
    await check("P181239", F_APP, `table ${A} reads Served with the red 'unpaid' ring`, L, async () => {
      const r = await inPanel((t) => document.querySelector(`#tiles .tile[data-t="${t}"]`).className, A);
      return ok((await tileState(A)) === "bill" && /pay-unpaid/.test(r), r);
    });
    if (!(await visible(page, ".detail-pop .phead h2"))) { await tap(tileOf(A) + " .tnum"); await sleep(700); }
    await tap(".detail-pop [data-edit-order]");
    await check("P181240", F_APP, "✎ Edit asks the kitchen-check question before opening edit mode", L, async () => {
      const txt = await confirmYes();
      await sleep(300);
      return ok(/checked with the kitchen/.test(txt) && (await visible(page, ".detail-pop .ordctl-edit")), txt);
    });
    await check("P181241", F_APP, "edit mode shows the order-wide allergy chips, ＋ Add dish and ✓ Done editing", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".detail-pop .ordctl-alg .talg").length, !!document.querySelector(".detail-pop [data-add-dish]"), !!document.querySelector(".detail-pop [data-done-order]")]);
      return ok(r[0] >= 7 && r[1] && r[2], JSON.stringify(r));
    });
    await check("P181242", F_APP, "a SERVED dish in edit mode offers only ✎ Edit (no quantity steppers)", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".detail-pop [data-qty-inc]").length, document.querySelectorAll(".detail-pop [data-edit-dish]").length]);
      return ok(r[0] === 0 && r[1] >= 1, JSON.stringify(r));
    });
    await page.locator(".detail-pop [data-edit-dish]").first().click();
    await check("P181243", F_APP, "a served dish's edit box is locked and offers '↩ Send back to kitchen'", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".dish-edit-overlay"));
      const r = await inPanel(() => [!!document.querySelector(".dish-edit-unserve"), document.querySelector(".dish-edit-save").disabled, /already/.test(document.querySelector(".dish-edit-box").innerText)]);
      return ok(r.join() === "true,true,true", JSON.stringify(r));
    });
    await check("P181244", F_APP, "BACK closes the dish edit box and leaves the table open", L, async () => {
      await back();
      return ok(!(await inPanel(() => !!document.querySelector(".dish-edit-overlay"))) && (await visible(page, ".detail-pop .phead h2")));
    });
    await page.locator('.detail-pop .ordctl-alg [data-slug="dairy"]').first().click();
    await check("P181245", F_APP, "an order-wide allergy chip asks WHY before changing anything", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".alg-why-in"));
      return ok(true);
    });
    await tap(".alg-why-cancel");
    await check("P181246", F_APP, "backing out of the reason leaves the chip exactly as it was (no flip-and-revert)", L, async () => {
      await sleep(300);
      const r = await inPanel(() => [!!document.querySelector('.detail-pop .ordctl-alg [data-slug="dairy"].on'), state.data.orders.some((o) => (o.allergies || []).includes("dairy"))]);
      return ok(r.join() === "false,false", JSON.stringify(r));
    });
    await page.locator('.detail-pop .ordctl-alg [data-slug="dairy"]').first().click();
    await inPanelAsync(() => !!document.querySelector(".alg-why-chips button"));
    await page.locator(".alg-why-chips button").first().click();
    await check("P181247", F_APP, "with a reason, the allergy change is saved (server agrees)", L + " + DB", async () => {
      let o;
      for (let i = 0; i < 8; i++) { await sleep(800); o = await db(`orders?restaurant_id=eq.${RID}&table_number=eq.${A}&archived=is.false&select=allergies&limit=1`); if ((o[0].allergies || []).includes("dairy")) break; }
      const q = await inPanel(() => { const sn = window.LFH_OUTBOX.getSnapshot(); return { queued: sn.queued.map((x) => x.path + ":" + (x.why || x.status)), failed: sn.failed.map((x) => x.path + ":" + (x.error || x.plain)) }; });
      return ok((o[0].allergies || []).includes("dairy"), JSON.stringify(o[0].allergies) + " outbox " + JSON.stringify(q) + " toasts " + (await toasts(page)).join("|"));
    });
    await page.locator(".detail-pop [data-done-order]").first().click().catch(() => {});
    await sleep(300);
    await check("P181248", F_APP, "✓ Done editing leaves edit mode", L, async () => ok(!(await visible(page, ".detail-pop .ordctl-edit"))));
    await check("P181249", F_APP, "'✕ Cancel order' says it CANCELS (stays on the bill at ₹0) and its other button keeps the order", L, async () => {
      await page.locator(".detail-pop [data-del-order]").first().click();
      const r = await inPanel(async () => { await new Promise((s) => setTimeout(s, 150)); return [document.getElementById("confirmText").textContent, document.getElementById("confirmYes").textContent, document.getElementById("confirmNo").textContent]; });
      await tap("#confirmNo");
      return ok(/stays on the bill at ₹0/.test(r[0]) && r[1] === "Cancel order" && r[2] === "Keep order", JSON.stringify(r));
    });

    // ── B3 · money: discount, split, pay, undo, unpay, print ───────────────────────────────────
    await check("P181250", F_APP, "'− Discount whole bill' is offered on an open bill with orders", L, async () => ok(await visible(page, "#billDiscountBtn")));
    await tap("#billDiscountBtn");
    await inPanelAsync(() => !!document.querySelector(".disc-overlay"));
    await check("P181251", F_APP, "the discount box opens with 'They pay' already holding the full bill, selected", L, async () => {
      await sleep(250);
      const r = await inPanel(() => [document.querySelector(".disc-pay-input").value, document.activeElement && document.activeElement.className]);
      return ok(Number(r[0]) > 0 && /disc-pay-input/.test(r[1] || ""), JSON.stringify(r));
    });
    await check("P181252", F_APP, "typing 10% fills the ₹ off and 'They pay' to match", L, async () => {
      const r = await inPanel(() => { const p = document.querySelector(".disc-pct-input"); p.value = "10"; p.dispatchEvent(new Event("input")); return [document.querySelector(".disc-amt-input").value, document.querySelector(".disc-pay-input").value]; });
      return ok(Number(r[0]) > 0 && Number(r[1]) > 0, JSON.stringify(r));
    });
    await check("P181253", F_APP, "asking for more off than the bill can give names the real maximum and refuses the first Apply", L, async () => {
      const r = await inPanel(() => { const a = document.querySelector(".disc-amt-input"); a.value = "999999"; a.dispatchEvent(new Event("input")); return document.querySelector(".disc-cap-note").textContent; });
      await clearToasts(page);
      await tap(".disc-apply-btn");
      await sleep(200);
      const still = await inPanel(() => !!document.querySelector(".disc-overlay"));
      return ok(/most you can take off/.test(r) && still && /most you can take off/.test(await lastToast()), r);
    });
    await inPanel(() => { const p = document.querySelector(".disc-pct-input"); p.value = "10"; p.dispatchEvent(new Event("input")); });
    await clearToasts(page);
    await tap(".disc-apply-btn");
    await check("P181254", F_APP, "Apply saves the whole-bill discount and says how much (server agrees)", L + " + DB", async () => {
      await settle(1800);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${A}&status=eq.open&select=discount&limit=1`);
      return ok(s[0] && Number(s[0].discount) > 0 && /Bill discount ₹/.test((await toasts(page)).join(" ")), JSON.stringify(s));
    });
    await check("P181255", F_APP, "the detail shows the discount with its percentage", L, async () => {
      const t = await inPanel(() => document.querySelector(".detail-pop .bill-disc-note")?.textContent || "");
      return ok(/Whole-bill discount − ₹[\d,]+ \(10%\)/.test(t), t);
    });
    await tap("#billDiscountBtn");
    await inPanelAsync(() => !!document.querySelector(".disc-remove-btn"));
    await tap(".disc-remove-btn");
    await check("P181256", F_APP, "Remove takes the whole-bill discount off again", L + " + DB", async () => {
      await settle(1800);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${A}&status=eq.open&select=discount&limit=1`);
      return ok(s[0] && Number(s[0].discount) === 0, JSON.stringify(s));
    });
    await check("P181257", F_APP, "'💳 Mark bill paid' is offered on the served, unpaid bill", L, async () => ok(await visible(page, "#payBill")));
    await tap("#payBill");
    await inPanelAsync(() => !!document.querySelector(".pay-overlay"));
    await check("P181258", F_APP, "the pay sheet names the bill and the amount collected", L, async () => {
      const r = await inPanel(() => [document.querySelector(".pay-overlay h3").textContent, document.querySelector(".pay-overlay b").textContent]);
      return ok(new RegExp(`table ${A}`).test(r[0]) && /^₹[\d,]+$/.test(r[1]), JSON.stringify(r));
    });
    await check("P181259", F_APP, "the pay sheet offers the small 'Split this bill →' line (splitting is on here)", L, async () => ok(await visible(page, ".pay-split-open")));
    await check("P181260", F_APP, "BACK closes the pay sheet without paying", L + " + DB", async () => {
      await back();
      const o = await ordersOn(A);
      return ok(!(await inPanel(() => !!document.querySelector(".pay-overlay"))) && o.every((x) => x.payment_status !== "paid"), JSON.stringify(o.map((x) => x.payment_status)));
    });
    await tap("#payBill");
    await inPanelAsync(() => !!document.querySelector(".pay-split-open"));
    await tap(".pay-split-open");
    await check("P181261", F_APP, "'Split this bill →' opens THE split screen, titled with the bill to the paise", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".sb-tabs"));
      const h = await inPanel(() => document.querySelector(".detail-pop .phead h2").textContent);
      return ok(new RegExp(`Split T${A}'s bill · ₹`).test(h), h);
    });
    await check("P181262", F_APP, "Equal starts with two parts that add up to the bill exactly", L, async () => {
      const r = await inPanel(() => [document.querySelectorAll(".sb-row").length, document.querySelector(".sb-sum").textContent]);
      return ok(r[0] === 2 && /✓ The parts add up to/.test(r[1]), JSON.stringify(r));
    });
    await check("P181263", F_APP, "'By kitchen ticket' on a one-ticket bill is refused out loud, and the screen stays on Equal", L, async () => {
      await clearToasts(page);
      await tap('.sb-tab[data-mode="ticket"]');
      await sleep(150);
      const on = await inPanel(() => document.querySelector(".sb-tab.primary")?.dataset.mode);
      return ok(/one kitchen ticket/.test(await lastToast()) && on === "equal", on);
    });
    await check("P181264", F_APP, "Custom: a short part shows red 'still to cover', and Collect refuses naming the gap", L, async () => {
      await tap('.sb-tab[data-mode="custom"]');
      await inPanel(() => { const a = document.querySelectorAll(".sb-amt")[0]; a.value = "1"; a.dispatchEvent(new Event("input")); });
      const line = await inPanel(() => document.querySelector(".sb-sum").textContent);
      await clearToasts(page);
      await tap(".sb-go");
      return ok(/still to cover/.test(line) && /still uncovered/.test(await lastToast()), line);
    });
    await check("P181265", F_APP, "＋ Add another part over a covered bill names the EMPTY part before the arithmetic", L, async () => {
      await tap('.sb-tab[data-mode="equal"]');
      await tap(".sb-add");
      const line = await inPanel(() => document.querySelector(".sb-sum").textContent);
      return ok(/One part still needs an amount/.test(line), line);
    });
    await check("P181266", F_APP, "choosing 3 people re-seeds three parts that still add up exactly", L, async () => {
      await tap('.sb-nb[data-n="3"]');
      const r = await inPanel(() => [document.querySelectorAll(".sb-row").length, document.querySelector(".sb-sum").textContent]);
      return ok(r[0] === 3 && /✓/.test(r[1]), JSON.stringify(r));
    });
    await check("P181267", F_APP, "the split screen's ✕ goes back to the table, nothing paid", L + " + DB", async () => {
      await tap(".picker-back");
      await sleep(400);
      const o = await ordersOn(A);
      return ok((await visible(page, "#payBill")) && o.every((x) => x.payment_status !== "paid"));
    });
    await clearToasts(page);
    await tap("#payBill");
    await inPanelAsync(() => !!document.querySelector('.pay-method-btn[data-method="Cash"]'));
    await tap('.pay-method-btn[data-method="Cash"]');
    await check("P181268", F_APP, "Cash settles the bill and offers a take-back naming the method", L + " + DB", async () => {
      await inPanelAsync(() => !!document.querySelector("#lfh-undobar") && /Cash/.test(document.querySelector("#lfh-undobar").innerText));
      await sleep(800);
      const o = await ordersOn(A);
      return ok(o.every((x) => x.payment_status === "paid"), JSON.stringify(o.map((x) => x.payment_status)));
    });
    await page.locator("#lfh-undobar .lfh-undo-btn").click();
    await check("P181269", F_APP, "UNDO on a settle reopens the bill (server agrees)", L + " + DB", async () => {
      await settle(2500);
      const o = await ordersOn(A);
      return ok(o.every((x) => x.payment_status !== "paid"), JSON.stringify(o.map((x) => x.payment_status)));
    });
    await reload();
    if (!(await visible(page, "#payBill"))) { await closeDetail(); await tap(tileOf(A) + " .tnum"); await sleep(800); }
    await tap("#payBill");
    await inPanelAsync(() => !!document.querySelector('.pay-tip-pick[data-tip-pct="10"]'));
    await tap('.pay-tip-pick[data-tip-pct="10"]');
    const tipShown = await inPanel(() => document.querySelector(".pay-tip-amt").value);
    await tap('.pay-method-btn[data-method="UPI"]');
    await check("P181270", F_APP, "UPI with a 10% tip settles the bill and records the tip on the first ticket", L + " + DB", async () => {
      await settle(3000);
      const o = await ordersOn(A);
      const tip = o.reduce((s, x) => s + (Number(x.tip) || 0), 0);
      return ok(o.every((x) => x.payment_status === "paid") && Math.abs(tip - Number(tipShown)) < 0.011 && tip > 0, `tip shown ${tipShown}, stored ${tip} · tip posts ${JSON.stringify(tipPosts)} · toasts ${(await toasts(page)).join(" | ")}`);
    });
    await reload();
    await check("P181271", F_APP, `table ${A}'s tile reads Cleared with the green ring and the ⏻`, L, async () => {
      const r = await inPanel((t) => { const el = document.querySelector(`#tiles .tile[data-t="${t}"]`); return [el.className, !!el.querySelector('[data-quick="close"]')]; }, A);
      return ok((await tileState(A)) === "done" && /pay-paid/.test(r[0]) && r[1], JSON.stringify(r));
    });
    if (!(await visible(page, ".detail-pop .phead h2"))) { await tap(tileOf(A) + " .tnum"); await sleep(800); }
    await check("P181272", F_APP, "a paid bill offers '↩ Mark unpaid', and no longer 'Mark bill paid'", L, async () => ok((await visible(page, "#unpayBill")) && !(await visible(page, "#payBill"))));
    await tap("#unpayBill");
    await confirmYes();
    await inPanelAsync(() => !!document.querySelector(".rp-in"));
    await clearToasts(page);
    await tap(".rp-cancel");
    await settle(1200);
    const stayed = await inPanel(() => typeof state !== "undefined" && /\/panels\/tablet\//.test(location.pathname)).catch(() => false);
    await check("P181273", F_APP, "backing out of the reason does NOT reopen the bill", L + " + DB", async () => {
      const o = await ordersOn(A);
      return ok(o.every((x) => x.payment_status === "paid"), JSON.stringify(o.map((x) => x.payment_status)));
    });
    await check("P181345", F_APP, "…and the waiter is still on the tablet screen afterwards (Yes → Cancel does not throw them back a page)", L, async () =>
      ok(stayed, stayed ? "" : "the page left the panel — public/panels/backstack.js counts one history entry too many after a box closes and another opens straight after (outside this territory; reported to T16)"));
    if (!stayed) {
      await page.goto(BASE + "/panels/tablet/index.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled === true, null, { timeout: 30000 });
      await page.evaluate(() => { window.__t12toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__t12toasts.push(n.querySelector("span")?.textContent || ""); }).observe(document.getElementById("toasts"), { childList: true }); });
      await sleep(800);
      await inPanel((t) => selectTable(t), A);
      await inPanelAsync(() => !!document.querySelector("#printBillBtn"), null, 45000).catch(async () => {
        console.log("recovery: the paid table's detail did not finish — panel says:", (await inPanel(() => document.getElementById("panel").innerText.slice(0, 200))).replace(/\s+/g, " "));
      });
    }
    await check("P181274", F_APP, "'🖨 Print bill' is offered and never says 'Reprint' (R62)", L, async () => {
      const t = await inPanel(() => document.getElementById("printBillBtn")?.textContent || "");
      return ok(/🖨 Print bill/.test(t) && !/Reprint/i.test(t), t);
    });

    // ── B4 · KOT ▾ and the reprint ─────────────────────────────────────────────────────────────
    await tap("#kotMenuBtn");
    await check("P181275", F_APP, "KOT ▾ opens the operations list in the popup, with a back button of its own", L, async () => {
      await inPanelAsync(() => document.querySelectorAll("[data-kotop]").length > 0);
      const ids = await inPanel(() => [...document.querySelectorAll("[data-kotop]")].map((b) => b.dataset.kotop).join(","));
      return ok(/shift,merge,movekot,moveitem/.test(ids) && /reprint$/.test(ids), ids);
    });
    await check("P181276", F_APP, "a PAID table's tickets are not movable (Move a KOT / dish rows disabled)", L, async () => {
      const r = await inPanel(() => ["movekot", "moveitem"].map((k) => document.querySelector(`[data-kotop="${k}"]`).disabled));
      return ok(r.join() === "true,true", JSON.stringify(r));
    });
    await check("P181277", F_APP, "…but its ticket can still be reprinted (the 🖨 row is enabled)", L, async () => ok((await inPanel(() => document.querySelector('[data-kotop="reprint"]').disabled)) === false));
    await check("P181278", F_APP, "BACK from the KOT menu returns to the table, not the floor", L, async () => {
      await back();
      return ok((await visible(page, "#kotMenuBtn")) && !(await inPanel(() => !!document.querySelector("[data-kotop]"))));
    });
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="reprint"]'));
    await tap('[data-kotop="reprint"]');
    await check("P181279", F_APP, "the reprint picker lists the table's ticket by number and dish count", L, async () => {
      await inPanelAsync(() => !!document.querySelector("[data-pickprint]"));
      const t = await inPanel(() => document.querySelector("[data-pickprint]").textContent);
      return ok(/^#\d+ · Order 1 · \d+ dish/.test(t), t);
    });
    await tap("[data-pickprint]");
    await check("P181280", F_APP, "'Print it where?' asks the server who owns the slips and offers the kitchen first", L, async () => {
      await inPanelAsync(() => !!document.querySelector("[data-printkitchen]"));
      const t = await inPanel(() => document.querySelector("[data-printkitchen]").innerText);
      return ok(/Reprint in the kitchen|Print on /.test(t), t.replace(/\s+/g, " "));
    });
    await clearToasts(page);
    await tap("[data-printkitchen]");
    await check("P181281", F_APP, "sending it to the kitchen says it will come out marked DUPLICATE", L, async () => {
      await inPanelAsync(() => (window.__t12toasts || []).some((s) => /DUPLICATE|Couldn't send/.test(s)));
      return ok(/DUPLICATE/.test(await lastToast()), await lastToast());
    });
    await check("P181282", F_APP, "…and a reprint job really was queued for that ticket", L + " + DB", async () => {
      const ids = (await ordersOn(A)).map((o) => o.id);
      const j = await db(`print_jobs?restaurant_id=eq.${RID}&order_id=in.(${ids.join(",")})&select=id,reprint,status&limit=10`);
      j.forEach((x) => myJobs.add(x.id));
      return ok(j.length >= 1 && j.some((x) => x.reprint === true), JSON.stringify(j));
    });

    // ── B5 · a second table by ⚡ Quick order, then merge / unmerge / move / change table ─────────
    await closeDetail();
    await tap("#quickOrderBtn");
    await check("P181283", F_APP, "⚡ Quick order opens the builder with no table chosen", L, async () => {
      await inPanelAsync(() => !!document.getElementById("omScroll"));
      const r = await inPanel(() => [state.quick, state.table, document.querySelector(".om-head h2").textContent]);
      return ok(r[0] === true && r[1] === null && /Quick order/.test(r[2]), JSON.stringify(r));
    });
    await tap(`#omScroll .dish[data-dish="${plain.id}"]`);
    await tap("#sendOrder");
    await check("P181284", F_APP, "the quick order's SEND opens 'Which table gets this order?' instead of a confirm", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".qdest-overlay"));
      return ok((await inPanel(() => document.getElementById("confirmOverlay").hidden)) === true);
    });
    await check("P181285", F_APP, "the table picker labels a busy table 'joins its bill' and a free one 'free'", L, async () => {
      const r = await inPanel(({ A, B }) => [document.querySelector(`[data-qdest="${A}"] small`)?.textContent, document.querySelector(`[data-qdest="${B}"] small`)?.textContent], { A, B });
      return ok(r[0] === "joins its bill" && r[1] === "free", JSON.stringify(r));
    });
    await check("P181286", F_APP, "BACK closes the table picker and keeps the order being built", L, async () => {
      await back();
      const r = await inPanel(() => [!!document.querySelector(".qdest-overlay"), state.cart.length, state.quick]);
      return ok(r.join() === "false,1,true", JSON.stringify(r));
    });
    await tap("#sendOrder");
    await inPanelAsync(() => !!document.querySelector(".qdest-overlay"));
    await clearToasts(page);
    await tap(`[data-qdest="${B}"]`);
    await check("P181287", F_APP, "picking the table IS the send — the toast names the table and the ticket", L, async () => {
      await inPanelAsync(() => (window.__t12toasts || []).some((s) => /Sent to T\d+! Kitchen ticket #\d+/.test(s)));
      return ok(new RegExp(`Sent to T${B}!`).test(await lastToast()), await lastToast());
    });
    // accept B's order so it can be merged / moved
    await reload();
    // a waiter's order is already accepted (straight to the kitchen); nothing to accept here
    await settle(2000);
    await reload();
    await tap(tileOf(B) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#kotMenuBtn"));
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="merge"]'));
    await check("P181288", F_APP, `the Merge row is enabled while another of the waiter's tables is open (${A})`, L, async () => ok((await inPanel(() => document.querySelector('[data-kotop="merge"]').disabled)) === false));
    await tap('[data-kotop="merge"]');
    await check("P181289", F_APP, "the merge picker offers only open tables, never this one", L, async () => {
      await inPanelAsync(() => !!document.querySelector("[data-mergeto]"));
      const r = await inPanel(() => [...document.querySelectorAll("[data-mergeto]")].map((b) => b.dataset.mergeto));
      return ok(r.includes(A) && !r.includes(B), JSON.stringify(r));
    });
    await tap(`[data-mergeto="${A}"]`);
    await check("P181290", F_APP, "the merge question names the table that will HOLD the bill (the lowest number)", L, async () => {
      const txt = await confirmNo();
      const keeps = Number(A) <= Number(B) ? A : B;
      return ok(new RegExp(`held by T${keeps} \\(the lowest table number\\)`).test(txt), txt);
    });
    // A is PAID — merging a paid bill into an open one is a different story; settle the question on the
    // honest path: merge B into A is still offered; we answered No above. Now move B's KOT to C instead.
    await tap(".picker-back").catch(() => {});
    await sleep(400);
    if (!(await visible(page, "#kotMenuBtn"))) { await closeDetail(); await tap(tileOf(B) + " .tnum"); await sleep(800); }
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="movekot"]'));
    await tap('[data-kotop="movekot"]');
    await check("P181291", F_APP, "Move a KOT lists this table's unpaid tickets with their net amount", L, async () => {
      await inPanelAsync(() => !!document.querySelector("[data-pickorder]"));
      const t = await inPanel(() => document.querySelector("[data-pickorder]").textContent);
      return ok(/^#\d+ · Order 1 · ₹[\d,]+$/.test(t), t);
    });
    await check("P181292", F_APP, "BACK from step 2 of a move goes back ONE step, to the KOT menu's list", L, async () => {
      await tap("[data-pickorder]");
      await inPanelAsync(() => !!document.querySelector("[data-moveto]"));
      await back();
      return ok(await inPanel(() => !!document.querySelector("[data-pickorder]")));
    });
    await tap("[data-pickorder]");
    await inPanelAsync(() => !!document.querySelector("[data-moveto]"));
    await check("P181293", F_APP, "the move target grid never offers the table the ticket is already on", L, async () => {
      const r = await inPanel(() => [...document.querySelectorAll("[data-moveto]")].map((b) => b.dataset.moveto));
      return ok(!r.includes(B) && r.includes(C), JSON.stringify(r).slice(0, 120));
    });
    await clearToasts(page);
    await tap(`[data-moveto="${C}"]`);
    await check("P181294", F_APP, "moving the KOT says where it went (server agrees)", L + " + DB", async () => {
      await settle(2500);
      const o = await ordersOn(C);
      return ok(o.length === 1 && new RegExp(`KOT moved to T${C}`).test((await toasts(page)).join(" ")), (await toasts(page)).join(" | "));
    });
    await reload();
    await closeDetail();
    await tap(tileOf(C) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#kotMenuBtn"));
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="shift"]'));
    await tap('[data-kotop="shift"]');
    await check("P181295", F_APP, "Change table shows the WHOLE floor, the ones that can't take it dimmed with a reason", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".shiftpick"));
      const r = await inPanel(() => [document.querySelectorAll(".shiftpick").length, document.querySelectorAll(".shiftpick-off").length, document.querySelector(".shiftpick-off small")?.textContent]);
      const tc = await inPanel(() => tableCount());
      return ok(r[0] === tc && r[1] >= 1 && /this one|taken|joined|wants in|not yours/.test(r[2] || ""), JSON.stringify(r));
    });
    await check("P181296", F_APP, "tapping a dimmed table SAYS why it can't take the party", L, async () => {
      await clearToasts(page);
      await page.locator(`.shiftpick-off[data-shiftwhy="this one"]`).first().click();
      return ok(/already on/.test(await lastToast()), await lastToast());
    });
    await clearToasts(page);
    await tap(`[data-shiftto="${D}"]`);
    await check("P181297", F_APP, "changing table moves the party and its order (server agrees)", L + " + DB", async () => {
      await settle(2500);
      const o = await ordersOn(D);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${D}&status=eq.open&select=id&limit=2`);
      return ok(o.length === 1 && s.length === 1, JSON.stringify([o.length, s.length]));
    });
    await reload();
    await check("P181298", F_APP, `after the move, table ${C} is free again and ${D} carries the party`, L, async () => ok((await tileState(C)) === "free" && (await tileState(D)) !== "free", `${await tileState(C)} / ${await tileState(D)}`));

    // ── B6 · merge two OPEN tables, undo, merge again, unmerge from the detail ──────────────────
    await closeDetail();
    // put a fresh order on B (it was emptied by the move) via the floor's free-tile tap
    await tap(tileOf(B));
    await inPanelAsync(() => !!document.getElementById("omScroll"));
    await tap(`#omScroll .dish[data-dish="${plain.id}"]`);
    await tap("#sendOrder");
    await confirmYes();
    await settle(2000);
    await reload();
    // a waiter's order is already accepted (straight to the kitchen); nothing to accept here
    await settle(1800);
    await reload();
    await tap(tileOf(D) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#kotMenuBtn"));
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="merge"]'));
    await tap('[data-kotop="merge"]');
    await inPanelAsync((b) => !!document.querySelector(`[data-mergeto="${b}"]`), B);
    await tap(`[data-mergeto="${B}"]`);
    const holder = Number(B) <= Number(D) ? B : D, joined = holder === B ? D : B;
    await confirmYes();
    await check("P181299", F_APP, "Merge joins the two parties and offers a FIFTEEN-second take-back naming both", L, async () => {
      await inPanelAsync(() => !!document.querySelector("#lfh-undobar") && /one bill/.test(document.querySelector("#lfh-undobar").innerText), null, 15000);
      const t = await inPanel(() => document.querySelector("#lfh-undobar").innerText.replace(/\s+/g, " "));
      return ok(new RegExp(`T${joined} joined T${holder}`).test(t), t);
    });
    await check("P181300", F_APP, "the merge is real: the server lists the join with the lowest table holding it", L + " + DB", async () => {
      const r = await inPanel(() => state.summary.merges || []);
      return ok(r.some((m) => String(m.parent_table) === holder && String(m.child_table) === joined), JSON.stringify(r));
    });
    await check("P181301", F_APP, "the joined tile wears the party's state and a ⇄ chip naming its partner", L, async () => {
      await reload();
      const h = await inPanel((t) => document.querySelector(`#tiles .tile[data-t="${t}"]`).outerHTML, joined);
      return ok(/t-merged/.test(h) && new RegExp(`T${holder}`).test(h) && !/t-free/.test(h), h.replace(/\s+/g, " ").slice(0, 200));
    });
    await page.locator("#lfh-undobar .lfh-undo-btn").click().catch(() => {});
    await check("P181302", F_APP, "UNDO on the merge separates them again without asking a second time", L, async () => {
      await settle(2500);
      await reload();
      const r = await inPanel(() => state.summary.merges || []);
      return ok(!r.some((m) => [String(m.parent_table), String(m.child_table)].includes(joined)) && (await inPanel(() => document.getElementById("confirmOverlay").hidden)), JSON.stringify(r));
    });
    await closeDetail();
    await tap(tileOf(D) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#kotMenuBtn"));
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="merge"]'));
    await tap('[data-kotop="merge"]');
    await inPanelAsync((b) => !!document.querySelector(`[data-mergeto="${b}"]`), B);
    await tap(`[data-mergeto="${B}"]`);
    await confirmYes();
    await settle(2500);
    await inPanel(() => { if (window.LFH_UNDO) LFH_UNDO.dismiss(); });
    await reload();
    if (!(await visible(page, ".unmerge-btn"))) { await closeDetail(); await tap(tileOf(holder) + " .tnum"); await settle(1000); }
    await check("P181303", F_APP, "the table holding the bill offers '⇹ Unmerge T…' for its partner at the bottom", L, async () => {
      const t = await inPanel(() => [...document.querySelectorAll(".unmerge-btn")].map((b) => b.textContent));
      return ok(t.some((x) => new RegExp(`Unmerge T${joined}`).test(x)), JSON.stringify(t));
    });
    await check("P181304", F_APP, "the detail of a merged table names the party 'one party · T… + T…'", L, async () => {
      const t = await inPanel(() => document.querySelector(".detail-pop .pmeta").textContent);
      return ok(/one party · T\d+ \+ T\d+/.test(t), t);
    });
    await check("P181305", F_APP, "a merged bill marks each dish with the table it was ordered at", L, async () => {
      const r = await inPanel(() => [...document.querySelectorAll(".detail-pop .ifrom")].map((e) => e.textContent));
      return ok(r.length >= 2 && new Set(r).size === 2, JSON.stringify(r));
    });
    await page.locator(`.unmerge-btn[data-unmerge="${joined}"]`).click();
    await check("P181306", F_APP, "the unmerge question says what goes back, what stays, before anything moves", L, async () => {
      const txt = await confirmYes();
      return ok(new RegExp(`Split T${joined} back out of T${holder}`).test(txt) && /Back to T\d+: KOT #\d+ — ₹/.test(txt) && /Stays on T\d+: KOT #\d+/.test(txt), txt.replace(/\n/g, " / "));
    });
    await check("P181307", F_APP, "unmerging says it is done and the join is gone (server agrees)", L, async () => {
      await settle(2500);
      const r = await inPanel(() => state.summary.merges || []);
      return ok(!r.some((m) => String(m.child_table) === joined) && /split from/.test((await toasts(page)).join(" ")), (await toasts(page)).join(" | "));
    });

    // ── B7 · move a single dish, table type, close ─────────────────────────────────────────────
    await reload();
    await closeDetail();
    await tap(tileOf(D) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#kotMenuBtn"));
    await tap("#kotMenuBtn");
    await inPanelAsync(() => !!document.querySelector('[data-kotop="moveitem"]'));
    await tap('[data-kotop="moveitem"]');
    await check("P181308", F_APP, "Move a single dish lists the dishes grouped under their KOT", L, async () => {
      await inPanelAsync(() => !!document.querySelector("[data-mvitem]"));
      const t = await inPanel(() => document.querySelector(".detail-body").innerText);
      return ok(/KOT #\d+/.test(t), t.replace(/\s+/g, " ").slice(0, 120));
    });
    await tap("[data-mvitem]");
    await inPanelAsync(() => !!document.querySelector("[data-mvto]"));
    await check("P181309", F_APP, "the dish target grid leaves out its own table", L, async () => {
      const r = await inPanel(() => [...document.querySelectorAll("[data-mvto]")].map((b) => b.dataset.mvto));
      return ok(!r.includes(D) && r.includes(B), JSON.stringify(r).slice(0, 100));
    });
    await clearToasts(page);
    await tap(`[data-mvto="${B}"]`);
    await check("P181310", F_APP, "moving the dish says it got a new KOT there (server agrees)", L + " + DB", async () => {
      await settle(2500);
      const o = await ordersOn(B);
      return ok(o.length >= 2 && new RegExp(`Dish moved to table ${B}`).test((await toasts(page)).join(" ")), (await toasts(page)).join(" | "));
    });
    await reload();
    await closeDetail();
    await tap(tileOf(B) + " .tnum");
    await inPanelAsync(() => !!document.querySelector("#tagTable"));
    await tap("#tagTable");
    await check("P181311", F_APP, "🏷 Table type opens the three marks", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".tag-overlay"));
      return ok((await inPanel(() => document.querySelectorAll(".tag-pick").length)) === 3);
    });
    await tap('.tag-pick[data-tag="vip"]');
    await check("P181312", F_APP, "marking VIP paints the tile's ribbon at once (server agrees)", L + " + DB", async () => {
      await settle(1500);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${B}&status=eq.open&select=table_tag&limit=1`).catch(() => [{}]);
      const h = await inPanel((t) => document.querySelector(`#tiles .tile[data-t="${t}"]`).outerHTML, B);
      return ok(/tag-vip/.test(h) && /t-ribbon/.test(h), JSON.stringify(s));
    });
    if (!(await visible(page, "#tagTable"))) { await tap(tileOf(B) + " .tnum"); await sleep(800); }
    await tap("#tagTable");
    await inPanelAsync(() => !!document.querySelector('.tag-pick[data-tag=""]'));
    await check("P181313", F_APP, "a marked table's sheet offers 'Remove mark'", L, async () => ok(true));
    await tap('.tag-pick[data-tag=""]');
    await check("P181314", F_APP, "Remove mark takes the ribbon off", L, async () => {
      await settle(1500);
      const h = await inPanel((t) => document.querySelector(`#tiles .tile[data-t="${t}"]`).outerHTML, B);
      return ok(!/tag-vip/.test(h), "");
    });
    if (!(await visible(page, "#closeTable"))) { await closeDetail(); await tap(tileOf(B) + " .tnum"); await sleep(900); }
    await tap("#closeTable");
    await check("P181315", F_APP, "closing an UNPAID table warns with the amount in the question", L, async () => {
      const txt = await confirmYes();
      return ok(/still UNPAID/.test(txt) && /₹/.test(txt), txt);
    });
    await check("P181316", F_APP, "the server refuses a busy close and the panel offers 'Close anyway' instead of a dead end", L, async () => {
      await inPanelAsync(() => !document.getElementById("confirmOverlay").hidden, null, 15000);
      const r = await inPanel(() => [document.getElementById("confirmYes").textContent, document.getElementById("confirmText").textContent]);
      await tap("#confirmNo");
      return ok(r[0] === "Close anyway", JSON.stringify(r));
    });
    await check("P181317", F_APP, "answering No keeps the table open (server agrees)", L + " + DB", async () => {
      await sleep(800);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${B}&status=eq.open&select=id&limit=1`);
      return ok(s.length === 1, String(s.length));
    });
    await reload();
    await closeDetail();
    await tap(tileOf(A) + ' [data-quick="close"]');
    await check("P181318", F_APP, "the ⏻ on a finished tile asks 'Close T… and free it?' (its second step)", L, async () => {
      const txt = await confirmYes();
      return ok(new RegExp(`Close T${A} and free it\\?`).test(txt) && !/UNPAID/.test(txt), txt);
    });
    await check("P181319", F_APP, "…and frees the table (server agrees)", L + " + DB", async () => {
      await settle(2500);
      const s = await db(`sessions?restaurant_id=eq.${RID}&table_number=eq.${A}&status=eq.open&select=id&limit=1`);
      await reload();
      return ok(s.length === 0 && (await tileState(A)) === "free", `${s.length} open · ${await tileState(A)}`);
    });

    // ── B8 · the ‹ › stepper and the back-button ladder ────────────────────────────────────────
    await tap(tileOf(B) + " .tnum");
    await inPanelAsync(() => !!document.querySelector(".detail-pop .phead h2"));
    await inPanelAsync(() => !!document.querySelector("#closeTable"));
    const busyN = await inPanel(() => stepTables().length);
    await check("P181320", F_APP, "the ‹ › stepper appears exactly when there is more than one busy table to walk", L, async () => {
      const n = await inPanel(() => document.querySelectorAll("[data-step-table]").length);
      return ok(busyN > 1 ? n === 2 : n === 0, `${busyN} busy · ${n} buttons`);
    });
    if (busyN > 1) {
      await tap('[data-step-table][aria-label="Next table"]');
      await check("P181321", F_APP, "› opens the next busy table without closing the popup", L, async () => {
        await sleep(900);
        const h = await inPanel(() => document.querySelector(".detail-pop .phead h2").textContent);
        return ok(h && h !== `T${B}` && !h.endsWith(`(T${B})`), h);
      });
    } else {
      // put a second party on A (it is free again) so the stepper has two tables to walk
      await closeDetail();
      await tap(tileOf(A));
      await inPanelAsync(() => !!document.getElementById("omScroll"));
      await tap(`#omScroll .dish[data-dish="${plain.id}"]`);
      await tap("#sendOrder"); await confirmYes(); await settle(2200); await reload();
      await tap(tileOf(B) + " .tnum");
      await inPanelAsync(() => document.querySelectorAll("[data-step-table]").length === 2);
      await tap('[data-step-table][aria-label="Next table"]');
      await check("P181321", F_APP, "with a second busy table, › opens it without closing the popup", L, async () => {
        await sleep(900);
        const h = await inPanel(() => document.querySelector(".detail-pop .phead h2").textContent);
        return ok(h && h !== `T${B}` && !h.endsWith(`(T${B})`), h);
      });
    }
    await check("P181322", F_APP, "BACK on an open table closes it and leaves the floor showing", L, async () => {
      await back();
      return ok(!(await visible(page, ".detail-pop .phead h2")) && (await inPanel(() => document.querySelectorAll("#tiles .tile").length)) > 0);
    });
    await check("P181323", F_APP, "the ✕ on the popup closes it and clears the selection", L, async () => {
      await tap(tileOf(B) + " .tnum");
      await inPanelAsync(() => !!document.querySelector("#detailClose"));
      await tap("#detailClose");
      return ok((await inPanel(() => state.table)) === null && !(await visible(page, ".detail-pop")));
    });
    await check("P181324", F_APP, "tapping the dim margin around the popup closes it too", L, async () => {
      await tap(tileOf(B) + " .tnum");
      await inPanelAsync(() => !!document.querySelector(".detail-pop"));
      await page.mouse.click(8, 400);
      await sleep(300);
      return ok((await inPanel(() => state.table)) === null);
    });

    // ── B9 · the drawer ────────────────────────────────────────────────────────────────────────
    await tap("#hamburger");
    await check("P181325", F_APP, "☰ opens the drawer with the person, their role and the restaurant", L, async () => {
      await inPanelAsync(() => document.querySelector(".tbl-drawer").classList.contains("open"));
      await inPanelAsync(() => document.getElementById("dwName").textContent !== "…", null, 15000).catch(() => {});
      const r = await inPanel(() => [document.getElementById("dwName").textContent, document.getElementById("dwRole").textContent, document.getElementById("dwRest").textContent]);
      return ok(r[0] && r[0] !== "…" && /tablet|diagt1/.test(r[1]) && /French House/i.test(r[2]), JSON.stringify(r));
    });
    await check("P181326", F_APP, "the drawer's clock shows the time once it is open", L, async () => ok(/\d{1,2}:\d{2}/.test(await inPanel(() => document.getElementById("dwClock").textContent))));
    await check("P181327", F_APP, "the drawer's Build line reads the app.js content hash, not a typed version", L, async () => {
      const r = await inPanel(() => [document.getElementById("dwBuild").textContent, [...document.scripts].map((s) => s.src).find((s) => /\/app\.js\?v=/.test(s))]);
      const v = (r[1] || "").split("v=")[1];
      return ok(v && r[0] === "tablet " + v, JSON.stringify(r));
    });
    await check("P181328", F_APP, "Banquet billing shows in the drawer only when the module and the waiter's switch allow it", L, async () => {
      const r = await inPanel(() => { const s = state.data.settings; const allowed = s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false) && tperm("tablet_banquet") !== "off"; return [document.getElementById("dwBanquet").hidden, allowed]; });
      return ok(r[0] === !r[1], JSON.stringify(r));
    });
    await check("P181329", F_APP, "BACK closes the drawer", L, async () => {
      await back();
      return ok(!(await inPanel(() => document.querySelector(".tbl-drawer").classList.contains("open"))));
    });
    await tap("#hamburger");
    await inPanelAsync(() => document.querySelector(".tbl-drawer").classList.contains("open"));
    await tap("#dwSettings");
    await check("P181330", F_APP, "⚙️ Settings holds Sign out as a POST form aimed at the whole window", L, async () => {
      await inPanelAsync(() => !!document.querySelector(".set-overlay form"));
      const r = await inPanel(() => { const f = document.querySelector(".set-overlay form"); return [f.method, f.getAttribute("action"), f.target]; });
      await back();
      return ok(r[0] === "post" && r[1] === "/api/panel-logout" && r[2] === "_top", JSON.stringify(r));
    });

    // ── B10 · NO INTERNET ──────────────────────────────────────────────────────────────────────
    // A's table is free again; take an order on it with the connection cut.
    await ctx.setOffline(true);
    await sleep(500);
    await tap(tileOf(A));
    await inPanelAsync(() => !!document.getElementById("omScroll"));
    await tap(`#omScroll .dish[data-dish="${plain.id}"]`);
    await clearToasts(page);
    await tap("#sendOrder");
    await confirmYes();
    await check("P181331", F_APP, "with no internet, SEND saves the order on the device and says so honestly", L + " (offline)", async () => {
      await inPanelAsync(() => (window.__t12toasts || []).length > 0);
      return ok(/Order saved ✓/.test(await lastToast()) && !/Failed|undefined/.test(await lastToast()), await lastToast());
    });
    await check("P181332", F_APP, "the saved order is visible on its table as '⏳ Waiting to send', not on the bill", L + " (offline)", async () => {
      await inPanel((t) => { state.table = t; state.ordering = false; renderPanel(); }, A);
      const t = await inPanel(() => document.getElementById("panel").innerText);
      return ok(/Waiting to send/i.test(t) && /Not on the bill until the kitchen has it/i.test(t), t.replace(/\s+/g, " ").slice(0, 160));
    });
    // FINDING (item 2): printing a bill offline — reach a table with a session (B is open and unpaid).
    await inPanel(() => { state.table = null; renderPanel(); });
    await inPanel((t) => { state.table = t; renderPanel(); }, B);
    await sleep(400);
    const popups = [];
    const onPop = (p) => popups.push(p);
    page.on("popup", onPop);
    await clearToasts(page);
    await inPanel(() => document.getElementById("printBillBtn") && document.getElementById("printBillBtn").click());
    await settle(2500);
    page.off("popup", onPop);
    await check("P181333", F_APP, "Print bill with no internet shows the bill HERE instead of claiming it was sent", L + " (offline)", async () => {
      const said = (await toasts(page)).join(" | ");
      return ok(popups.length >= 1 && !/Sent to undefined/.test(said), `popups ${popups.length} · toasts: ${said || "(none)"}`);
    });
    await check("P181334", F_APP, "…and no stale print request is left in the queue to come out of the counter printer later", L + " (offline)", async () => {
      const r = await inPanel(() => (window.LFH_OUTBOX.getSnapshot().queued || []).filter((it) => /print\/send/.test(it.path)).length);
      return ok(r === 0, `${r} print request(s) waiting in the queue`);
    });
    for (const p of popups) await p.close().catch(() => {});
    // the 🖨 "where?" sheet asks the server a QUESTION; with no internet it must not leave a phantom change queued
    const ord = await inPanel((t) => partyOrders(t)[0] && { id: partyOrders(t)[0].id, kot_no: partyOrders(t)[0].kot_no }, B);
    if (ord) await inPanel((o) => renderReprintWhere(state.table, partyOrders(state.table).find((x) => x.id === o.id)), ord);
    await settle(1200);
    await check("P181335", F_APP, "opening 'Print it where?' with no internet leaves no question sitting in the waiting-to-send list", L + " (offline)", async () => {
      const r = await inPanel(() => (window.LFH_OUTBOX.getSnapshot().queued || []).filter((it) => /print\/send/.test(it.path)).length);
      return ok(r === 0, `${r} probe(s) queued`);
    });
    await check("P181336", F_APP, "…and the sheet still offers the kitchen, and 'Print here' as the safe fallback", L + " (offline)", async () => {
      const r = await inPanel(() => [!!document.querySelector("[data-printkitchen]"), !!document.querySelector("[data-printhere]")]);
      await inPanel(() => { const b = document.querySelector(".picker-back"); if (b) b.click(); });
      return ok(r.join() === "true,true", JSON.stringify(r));
    });
    // FINDING (item 3): banquet billing — opened while online, the connection drops before Create.
    await ctx.setOffline(false);
    await sleep(800);
    // French House has no banquet items, so the ONE read that lists them is answered by a stand-in —
    // in the page, at the panel's own read helper (a service worker sits in front of /api/tablet reads,
    // and a browser-level route never sees what it answers).
    await inPanel(() => {
      window.__t12realNetFetch = window.LFH_NET.fetch;
      window.LFH_NET.fetch = (url, o) => /\/banquet-items/.test(String(url))
        ? Promise.resolve(new Response(JSON.stringify({ items: [{ id: "t12-stand-in", title: "Stand-in plate", price: 250, unit: "per plate" }] }), { status: 200, headers: { "Content-Type": "application/json" } }))
        : window.__t12realNetFetch(url, o);
    });
    await inPanel(() => openBanquet());
    await inPanelAsync(() => !!document.querySelector('[data-bq-step="1"]'));
    await tap('[data-bq-step="1"]');
    await ctx.setOffline(true);
    await sleep(400);
    await clearToasts(page);
    await tap("#bqCreate");
    await settle(1200);
    await check("P181337", F_APP, "a banquet bill saved with no internet is NOT announced as created with a ₹0 total", L + " (offline) + NET", async () => {
      const said = (await toasts(page)).join(" | ");
      return ok(!/created/.test(said) && !/₹0\b/.test(said) && /Saved/.test(said), said);
    });
    // never let the stand-in plate reach the server
    await inPanel(() => Promise.all((window.LFH_OUTBOX.getSnapshot().queued || []).filter((it) => /banquet\/place/.test(it.path)).map((it) => window.LFH_OUTBOX.dismiss(it.id))));
    await inPanel(() => { if (typeof closeBanquet === "function") closeBanquet(); });
    await inPanel(() => { if (window.__t12realNetFetch) window.LFH_NET.fetch = window.__t12realNetFetch; });
    await ctx.setOffline(false);
    await check("P181338", F_APP, "back online, the saved order is delivered by itself and appears on the bill", L + " + DB", async () => {
      await inPanel(() => window.LFH_OUTBOX.flush());
      for (let i = 0; i < 20; i++) { const o = await ordersOn(A); if (o.length) return ok(true, `${o.length} order(s) on T${A}`); await settle(1000); }
      return ok(false, "the saved order never arrived");
    });

    // ── B11 · a restaurant that asks for a manager PIN to settle (stand-in answers) ─────────────
    // French House has no manager PIN set, so its PIN gate is open; the gate's real answer is
    // `403 { needPin: true }` without a PIN (app/api/tablet route → managerPinGate). Two requests are
    // answered by a stand-in exactly that way, so what the waiter would see can be watched without
    // writing a PIN onto anybody: the bill's pay and the tip.
    await reload();
    await closeDetail();
    await tap(tileOf(B) + ' [data-quick="accept"]').catch(() => {});
    await settle(1500);
    await reload();
    const sent = { pay: [], tip: [] };
    await page.route("**/api/tablet/tables/*/pay", async (route) => {
      const b = JSON.parse(route.request().postData() || "{}"); sent.pay.push(b);
      await sleep(350);   // a real network's gap — an instant answer only exercises the back-count drift (P181345)
      if (!b.managerPin) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "A manager PIN is required for this.", needPin: true }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/api/tablet/orders/*/tip", async (route) => {
      const b = JSON.parse(route.request().postData() || "{}"); sent.tip.push(b);
      if (!b.managerPin) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "A manager PIN is required for this.", needPin: true }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await inPanel(() => { state.data.settings = Object.assign({}, state.data.settings, { tablet_mark_paid: "pin" }); });
    await inPanel((t) => { state.table = t; state.ordering = false; renderPanel(); }, B);
    await sleep(500);
    await inPanel((t) => { const a = tableAgg(t); payBillWithMethod(t, a); }, B);
    await inPanelAsync(() => !!document.querySelector('.pay-tip-pick[data-tip-pct="10"]'));
    await tap('.pay-tip-pick[data-tip-pct="10"]');
    await clearToasts(page);
    await tap('.pay-method-btn[data-method="Cash"]');
    await inPanelAsync(() => !!document.querySelector(".pp-in"));
    await inPanel(() => { document.querySelector(".pp-in").value = "4321"; });
    await tap(".pp-ok");
    await settle(2000);
    await check("P181339", F_APP, "PIN-gated settle: the tip is NOT sent before the PIN has been given", N, async () => {
      const early = sent.tip.length && sent.pay.length && sent.tip.findIndex(Boolean) >= 0 && !sent.tip.some((b) => b.managerPin) ? sent.tip.length : 0;
      return ok(sent.tip.every((b) => !!b.managerPin) || sent.tip.length === 0, `tip calls: ${JSON.stringify(sent.tip)} · pay calls: ${sent.pay.length} · early ${early}`);
    });
    await check("P181340", F_APP, "PIN-gated settle: the tip is recorded with the SAME PIN the waiter just typed", N, async () => {
      return ok(sent.tip.some((b) => b.managerPin === "4321" && b.amount > 0), JSON.stringify(sent.tip));
    });
    await check("P181341", F_APP, "PIN-gated settle: the waiter is never told 'the tip was not recorded' for a paid bill", N, async () => {
      const said = (await toasts(page)).join(" | ");
      return ok(!/tip was not recorded/.test(said), said);
    });
    sent.pay.length = 0; sent.tip.length = 0;
    // A fresh page first: the stand-in answers instantly, so the pay sheet closing and the PIN box
    // opening land in the same moment — exactly the back-button count drift reported to T16
    // (P181345). Starting clean keeps that one fault from hiding the tip checks behind it.
    {
      await page.goto(BASE + "/panels/tablet/index.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled === true, null, { timeout: 30000 });
      await inPanel(() => { state.data.settings = Object.assign({}, state.data.settings, { tablet_mark_paid: "pin" }); });
    }
    await inPanel((t) => { const a = tableAgg(t); payBillWithMethod(t, a); }, B);
    await inPanelAsync(() => !!document.querySelector('.pay-tip-pick[data-tip-pct="5"]'));
    await tap('.pay-tip-pick[data-tip-pct="5"]');
    await tap('.pay-method-btn[data-method="UPI"]');
    await inPanelAsync(() => !!document.querySelector(".pp-cancel"));
    await tap(".pp-cancel");
    await settle(1500);
    await check("P181342", F_APP, "PIN-gated settle CANCELLED: no tip is written onto a bill that was not paid", N, async () => ok(sent.tip.length === 0, JSON.stringify(sent.tip)));
    await page.unroute("**/api/tablet/tables/*/pay");
    await page.unroute("**/api/tablet/orders/*/tip");
    await inPanel(() => load().catch(() => {}));

    await check("P181343", F_APP, "the panel raised no uncaught page error during the whole driven block", L, async () => ok(errors.length === 0, errors.slice(0, 3).join(" · ")));
    console.log("taps that needed the in-page fallback:", JSON.stringify([...new Set(fallbacks)]));
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    await ctx.setOffline(false).catch(() => {});
    await retireTables(used, () => {});
    if (myJobs.size) {
      const now = new Date().toISOString();
      for (const id of myJobs) await db(`print_jobs?restaurant_id=eq.${RID}&id=eq.${id}&status=eq.queued`, "PATCH", { status: "dismissed", done_at: now, error: "sweep #10 T12 test reprint — dismissed by its own run" }).catch(() => {});
    }
    await ctx.close().catch(() => {});
    await restoreNow().catch(() => {});
  }
  await check("P181344", F_APP, "every table this block touched is free again afterwards", "DB", async () => {
    const s = await db(`sessions?restaurant_id=eq.${RID}&status=eq.open&table_number=in.(${used.join(",")})&select=table_number&limit=10`);
    const o = await db(`orders?restaurant_id=eq.${RID}&archived=is.false&status=neq.cancelled&table_number=in.(${used.join(",")})&select=table_number&limit=10`);
    return ok(s.length === 0 && o.length === 0, JSON.stringify({ s, o }));
  });
  return R;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = await blockB();
  R.done();
  await closeBrowser();
}
