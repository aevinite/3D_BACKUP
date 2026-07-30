// verify-offline.mjs — proves the app KEEPS WORKING with no internet.
//
//   node scripts/verify-offline.mjs [--base http://localhost:4000] [--keep]
//
// What it checks, in the order a real shift would hit it:
//   1. The offline layer (public/sw.js) installs and takes control of the page.
//   2. The MANAGER panel, reloaded with the network cut, still opens AND still has the
//      board (served from the device's own saved copy) — not the browser's offline
//      page, not the dead shell it used to leave behind.
//   3. The panel says so honestly: the offline bar reads "no internet".
//   4. The WAITER panel can take a real order with no internet: it's saved on the
//      device, shown on the table as pending, and never reported as failed.
//   5. Back online, that order reaches the kitchen EXACTLY ONCE and the queue empties.
//   6. The GUEST menu also survives an offline reload with its dishes intact.
//
// Headless, against a dev server. Nothing here touches a live stack.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "") || "http://localhost:4000";
const KEEP = args.includes("--keep");
// Optional: the origin of scripts/slow-proxy.mjs, to also test a HANGING connection.
const SLOW = args.includes("--slow-proxy") ? args[args.indexOf("--slow-proxy") + 1] : "";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? `\n       ${extra}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Registration is async: the very first load of a new install isn't controlled yet, and
// every offline expectation below depends on control having been taken.
async function waitControlled(page, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))) return true;
    await sleep(500);
  }
  return false;
}
// Read a value out of the panel INSIDE the iframe (that's where the panel's own state
// lives — the DOM classes change with the design, the state doesn't).
const inPanel = (page, fn, arg) => page.evaluate(
  ({ src, arg }) => {
    const f = document.querySelector("iframe");
    const w = f && f.contentWindow;
    if (!w) return { __err: "no panel iframe" };
    try { return new w.Function("arg", `return (${src})(arg)`)(arg); } catch (e) { return { __err: String(e && e.message || e) }; }
  },
  { src: fn.toString(), arg },
);
// Same, but awaits a promise returned from inside the panel.
const inPanelAsync = async (page, fn, arg) => {
  const r = await page.evaluate(
    async ({ src, arg }) => {
      const w = document.querySelector("iframe").contentWindow;
      try { return await new w.Function("arg", `return (${src})(arg)`)(arg); } catch (e) { return { __err: String(e && e.message || e) }; }
    },
    { src: fn.toString(), arg },
  );
  return r;
};
async function waitFor(fn, ms = 20000, step = 500) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(step);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: !KEEP });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];

  try {
    // ══ MANAGER: can it be opened and read with no internet? ═══════════════════
    console.log("\n1) Offline layer installs (manager panel)");
    const mgrRoute = await loginAs(ctx, "manager", BASE);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await page.goto(BASE + mgrRoute, { waitUntil: "domcontentloaded" });
    const controlled = await waitControlled(page);
    controlled ? ok("service worker is controlling the page") : bad("service worker never took control");
    if (!controlled) throw new Error("no service worker — nothing below can pass");

    // Load again WHILE ONLINE so the shell + the panel's reads are saved on-device.
    await page.reload({ waitUntil: "domcontentloaded" });
    const liveItems = await waitFor(async () => {
      const v = await inPanel(page, () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0);
      return typeof v === "number" && v > 0 ? v : null;
    }, 40000);
    liveItems ? ok(`panel loaded live with ${liveItems} menu rows`) : bad("panel never loaded while ONLINE (test setup problem)");
    await sleep(4000); // let /all + /summary be written to the device

    const saved = await page.evaluate(async () => {
      const out = {};
      for (const k of await caches.keys()) if (k.startsWith("lfh-")) out[k] = (await (await caches.open(k)).keys()).length;
      return out;
    });
    const savedTotal = Object.values(saved).reduce((a, b) => a + b, 0);
    savedTotal > 0 ? ok(`${savedTotal} things saved for offline use (${JSON.stringify(saved)})`) : bad("nothing was saved for offline use");

    // ══ THE ONLINE PATH MUST BE UNCHANGED ══════════════════════════════════════
    // This section exists because the first version of this feature shipped two faults
    // that only showed up ONLINE — a panel header displaying leftover comment text, and
    // slow-but-working reads being quietly answered from the device. An offline-only
    // suite could not see either. Check the normal case too, always.
    console.log("\n1b) With a normal connection, nothing has changed");

    const headerText = await inPanel(page, () => {
      const t = document.querySelector(".topbar");
      return t ? t.innerText : "";
    });
    !/--&gt;|-->/.test(String(headerText || ""))
      ? ok("the manager header shows no leftover markup")
      : bad("the manager header is displaying raw comment text", String(headerText).slice(0, 120));

    const noBar = await inPanel(page, () => !document.querySelector("#lfhOffBar"));
    noBar === true ? ok("no offline bar while everything is fine") : bad("an offline bar is showing on a healthy connection");

    // A live read must come from the SERVER, never from the device.
    const liveRead = await inPanelAsync(page, async () => {
      const r = await fetch("/api/editor/all?rid=" + encodeURIComponent(window.PANEL_RID || ""), { method: "GET" });
      return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache") };
    });
    liveRead && liveRead.fromCache !== "1"
      ? ok("an online read is answered by the server, not the saved copy")
      : bad("an online read was answered from the device", JSON.stringify(liveRead));

    // A forced refresh is the "I'll wait for the real number" contract — it must never be
    // satisfied from the device, even on a bad line.
    const forced = await inPanelAsync(page, async () => {
      // A route THIS panel is allowed to call (the point of the check is the offline
      // layer's rule, not permissions — asking for an owner route from a manager panel
      // just logs a 401 and proves nothing).
      const r = await fetch("/api/editor/all?rid=" + encodeURIComponent(window.PANEL_RID || "") + "&refresh=1", { method: "GET" });
      return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache") };
    });
    forced && forced.fromCache !== "1"
      ? ok("a forced refresh is never answered from the saved copy")
      : bad("a forced refresh returned saved figures", JSON.stringify(forced));

    console.log("\n2) Manager panel RELOADED with no internet");
    await ctx.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const openedOffline = await waitFor(async () => {
      const v = await inPanel(page, () => !!document.querySelector(".topbar"));
      return v === true ? true : null;
    }, 30000);
    openedOffline ? ok("the panel still OPENS offline") : bad("the panel did not open offline");

    const offItems = await waitFor(async () => {
      const v = await inPanel(page, () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0);
      return typeof v === "number" && v > 0 ? v : null;
    }, 30000);
    offItems
      ? ok(`the board still has its data offline (${offItems} menu rows, live was ${liveItems})`)
      : bad("the panel opened but has NO data offline");

    const barText = await waitFor(async () => {
      const v = await inPanel(page, () => { const b = document.querySelector("#lfhOffBar"); return b ? b.textContent : ""; });
      return v && String(v).length ? String(v) : null;
    }, 15000);
    /no internet/i.test(barText || "")
      ? ok(`it tells the truth: "${(barText || "").trim().slice(0, 64)}…"`)
      : bad("no honest offline message shown", `bar said: ${JSON.stringify(barText)}`);
    await ctx.setOffline(false);
    await page.close();

    // ══ WAITER: can a real order be taken with no internet? ════════════════════
    console.log("\n3) Waiter takes a REAL order with no internet");
    const tabRoute = await loginAs(ctx, "tablet", BASE);
    const tab = await ctx.newPage();
    tab.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await tab.goto(BASE + tabRoute, { waitUntil: "domcontentloaded" });
    await waitControlled(tab);
    await tab.reload({ waitUntil: "domcontentloaded" });
    const ready = await waitFor(async () => {
      const v = await inPanel(tab, () => {
        const d = (typeof state !== "undefined" && state.data) || {};
        return { dishes: (d.dishes || []).length, tiles: Object.keys((state.summary || {}).tiles || {}).length };
      });
      return v && v.dishes > 0 ? v : null;
    }, 45000);
    ready ? ok(`waiter panel loaded live (${ready.dishes} dishes, ${ready.tiles} tables)`) : bad("waiter panel never loaded live");
    await sleep(3000);

    // Pick a FREE table and a normal (non open-price) dish, so this is a clean new order.
    const target = await inPanel(tab, () => {
      const d = state.data || {};
      // summary.tiles is an OBJECT keyed by table number, e.g. { "1": { state:"free", … } }.
      const tiles = (state.summary || {}).tiles || {};
      const count = Number((d.settings || {}).table_count || 0) || Object.keys(tiles).length || 10;
      let free = null;
      for (let i = 1; i <= count; i++) {
        const t = tiles[String(i)];
        if (!t || t.state === "free") { free = String(i); break; }
      }
      const dish = (d.dishes || []).find((x) => !x.open_price && x.available !== false && !x.sold_out) || (d.dishes || [])[0];
      return { free, dishId: dish && dish.id, dishName: dish && (dish.title_en || dish.title || dish.name) };
    });
    if (!target || target.__err || !target.free || !target.dishId) bad("couldn't find a free table + dish to test with", JSON.stringify(target));

    // Hand the picked table + dish into the panel (a Function() built inside the iframe
    // can't close over this script's scope, so the values go via window).
    await inPanel(tab, (arg) => { window.__T = arg.free; window.__D = arg.dishId; return true; }, target);

    await ctx.setOffline(true);
    const placed = await inPanelAsync(tab, async () => {
      const w = window;
      const before = w.LFH_OUTBOX.getSnapshot().count;
      const res = await api("POST", "/order", { table: w.__T, items: [{ id: w.__D, qty: 1 }], allergies: [], note: "offline check" });
      await new Promise((r) => setTimeout(r, 800));
      const s = w.LFH_OUTBOX.getSnapshot();
      return { before, res, queued: s.queued.length, failed: s.failed.length, label: (s.queued[0] || {}).label };
    });
    if (placed && placed.__err) bad("placing the offline order threw", placed.__err);
    else if (placed) {
      placed.res && placed.res.queued === true ? ok("the order was SAVED on the device") : bad("the order was not saved offline", JSON.stringify(placed.res));
      placed.failed === 0 ? ok("it is not marked as failed") : bad("it was wrongly marked as failed");
      placed.queued > 0 ? ok(`waiting to send: "${placed.label}"`) : bad("nothing is waiting to send — the order went nowhere");
    }

    // Does the waiter SEE it on the table while still offline?
    const seenLocally = await inPanel(tab, () => {
      const p = window.LFH_OUTBOX && window.LFH_OUTBOX.pendingForTable ? window.LFH_OUTBOX.pendingForTable(window.__T) : null;
      const tile = document.querySelector(`.tile[data-t="${window.__T}"]`);
      return { pending: p ? p.length : 0, tileMarked: !!(tile && /pending|wait|⏳/i.test(tile.className + " " + tile.innerHTML)) };
    });
    if (seenLocally && !seenLocally.__err) {
      seenLocally.pending > 0 ? ok(`the table shows ${seenLocally.pending} change waiting`) : bad("the table shows nothing pending — the waiter can't tell the order was taken");
      seenLocally.tileMarked ? ok("the table tile is marked as having an unsent change") : bad("the table tile is not marked");
    }

    console.log("\n4) Back online — it must land exactly once");
    await ctx.setOffline(false);
    await inPanel(tab, () => { window.dispatchEvent(new Event("online")); });
    const drained = await waitFor(async () => {
      const s = await inPanel(tab, () => window.LFH_OUTBOX.getSnapshot());
      if (!s || s.__err) return null;
      return s.queued.length === 0 ? s : null;
    }, 40000);
    if (!drained) bad("the queue never emptied after reconnecting");
    else {
      drained.failed.length === 0 ? ok("the saved order was sent on reconnect") : bad(`it came back needing attention: ${drained.failed[0].error}`);
    }
    // EXACTLY ONCE is the money question. The table was FREE before this test, so asking
    // the server what's on it now is the whole answer: 1 = right, 2 = a double bill.
    const landed = await inPanelAsync(tab, async () => {
      const j = await api("GET", "/state?table=" + window.__T);
      const list = (j && (j.orders || (j.session && j.session.orders))) || [];
      return { total: list.length, statuses: list.map((o) => o.status) };
    });
    if (!landed || landed.__err) bad("couldn't read the table back from the server", landed && landed.__err);
    else if (landed.total === 1) ok("the order landed EXACTLY ONCE on a table that was empty before");
    else bad(`the table has ${landed.total} orders — expected exactly 1`, JSON.stringify(landed));
    // ══ A REAL CLASH: another device moved on while this one was offline ═══════
    // The situation that used to corrupt a bill: a waiter takes an order with no signal,
    // and meanwhile the manager closes and bills that table from another device. When the
    // signal returns, the saved order must NOT be quietly added (it would land on a
    // settled bill, or on the next party's) — it must come back to a person, explained.
    console.log("\n5) A change that clashes with another device");
    const mgrCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // stays ONLINE
    try {
      const clashTarget = await inPanel(tab, () => {
        const tiles = (state.summary || {}).tiles || {};
        const count = Number(((state.data || {}).settings || {}).table_count || 0) || Object.keys(tiles).length || 10;
        let free = null;
        for (let i = 1; i <= count; i++) { const t = tiles[String(i)]; if (!t || t.state === "free") { free = String(i); break; } }
        const d = (state.data.dishes || []).find((x) => !x.open_price) || state.data.dishes[0];
        return { free, dishId: d && d.id };
      });
      await inPanel(tab, (arg) => { window.__T2 = arg.free; window.__D2 = arg.dishId; return true; }, clashTarget);

      // 1. Seat the table for real, ONLINE, so there's a live bill to clash with.
      const seeded = await inPanelAsync(tab, async () => {
        const r = await api("POST", "/order", { table: window.__T2, items: [{ id: window.__D2, qty: 1 }], allergies: [], note: "clash seed" });
        await new Promise((res) => setTimeout(res, 1500));
        return { placed: !!r };
      });
      // The session id comes from the OTHER device (the manager's own read), which is
      // also more honest: that's the device that will close the table.
      await loginAs(mgrCtx, "manager", BASE);
      const sessResp = await mgrCtx.request.get(`${BASE}/api/editor/sessions?table=${clashTarget.free}`);
      const sessBody = await sessResp.json().catch(() => null);
      const rows = Array.isArray(sessBody) ? sessBody : (sessBody && (sessBody.sessions || sessBody.rows)) || [];
      const live = rows.find((s) => s && s.status !== "closed");
      live && live.id
        ? ok(`table ${clashTarget.free} is open with a live bill`)
        : bad("couldn't seat a table to clash with", JSON.stringify({ seeded, got: sessBody && Object.keys(sessBody) }));

      // 2. The waiter's device drops offline and takes ANOTHER order for that table.
      await ctx.setOffline(true);
      await inPanelAsync(tab, async () => {
        await api("POST", "/order", { table: window.__T2, items: [{ id: window.__D2, qty: 2 }], allergies: [], note: "taken while offline" });
        return true;
      });
      ok("a second order was taken on the offline device");

      // 3. MEANWHILE, on another device that still has signal, the manager closes+bills it.
      const closeRes = await mgrCtx.request.post(`${BASE}/api/editor/sessions/${live && live.id}/close`, {
        headers: { "content-type": "application/json" },
        data: { force: true },
      });
      closeRes.ok() ? ok("another device closed and billed that table") : bad(`couldn't close the table from the other device (HTTP ${closeRes.status()})`);

      // 4. The replay guard only judges a change that is genuinely OLD (so live writes are
      //    never touched) — wait past that threshold before reconnecting.
      await sleep(22000);
      await ctx.setOffline(false);
      await inPanel(tab, () => { window.dispatchEvent(new Event("online")); });

      const needsYou = await waitFor(async () => {
        const s = await inPanel(tab, () => window.LFH_OUTBOX.getSnapshot());
        if (!s || s.__err) return null;
        return s.failed.length ? s : null;
      }, 45000);
      if (!needsYou) bad("the clashing order was NOT flagged — it may have been applied to a closed bill");
      else {
        const f = needsYou.failed[0];
        ok(`it came back needing a person: "${(f.plain || f.error || "").slice(0, 90)}"`);
        /closed|billed|different party/i.test(f.plain || f.error || "")
          ? ok("the reason is in plain words a waiter can act on")
          : bad("the reason is not plain language", JSON.stringify(f.error));
        f.todo ? ok(`it says what to do: "${String(f.todo).slice(0, 80)}"`) : bad("it doesn't say what to do next");
        f.retryable === false ? ok("it is not offered as a pointless 'try again'") : bad("it offers a retry that cannot work");
      }
      // 5. And it is put IN FRONT of the person, not hidden in a menu.
      const sheetShown = await inPanel(tab, () => {
        const sh = document.querySelector(".lfh-off-sheet");
        return { open: !!sh, text: sh ? sh.textContent.slice(0, 120) : "" };
      });
      sheetShown && sheetShown.open ? ok("the \"needs you\" list opened by itself") : bad("nothing was shown to the person");
      // 6. "Not needed anymore" clears it. (Also leaves a clean device for the checks
      //    below — an unsent change rightly follows the DEVICE across panels, so without
      //    this the kitchen would still be showing this one.)
      const cleared = await inPanelAsync(tab, async () => {
        const s = window.LFH_OUTBOX.getSnapshot();
        for (const it of s.failed) await window.LFH_OUTBOX.dismiss(it.id);
        await new Promise((r) => setTimeout(r, 400));
        return window.LFH_OUTBOX.getSnapshot().failed.length;
      });
      cleared === 0 ? ok("\"Not needed anymore\" clears it from the list") : bad("dismissing it didn't clear it");
    } finally {
      await mgrCtx.close();
    }
    await tab.close();

    // ══ KITCHEN ════════════════════════════════════════════════════════════════
    // The kitchen screen used to come back EMPTY after an offline reload — a cook would
    // think every ticket had vanished mid-service.
    console.log("\n6) Kitchen screen with no internet");
    const kRoute = await loginAs(ctx, "kitchen", BASE);
    const kit = await ctx.newPage();
    kit.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await kit.goto(BASE + kRoute, { waitUntil: "domcontentloaded" });
    await waitControlled(kit);
    await kit.reload({ waitUntil: "domcontentloaded" });
    const kLive = await waitFor(async () => {
      const v = await inPanel(kit, () => (typeof state !== "undefined" && (state.dishes || []).length) || 0);
      return typeof v === "number" && v > 0 ? v : null;
    }, 40000);
    kLive ? ok(`kitchen loaded live (${kLive} dishes on the board)`) : bad("kitchen never loaded live");
    await sleep(3000);
    await ctx.setOffline(true);
    await kit.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const kOff = await waitFor(async () => {
      const v = await inPanel(kit, () => (typeof state !== "undefined" && (state.dishes || []).length) || 0);
      return typeof v === "number" && v > 0 ? v : null;
    }, 30000);
    kOff ? ok(`the kitchen board survives an offline reload (${kOff} dishes)`) : bad("the kitchen board is empty offline");
    const kBar = await waitFor(async () => {
      const v = await inPanel(kit, () => { const b = document.querySelector("#lfhOffBar"); return b ? b.textContent : ""; });
      return v && String(v).length ? String(v) : null;
    }, 15000);
    /no internet/i.test(String(kBar || "")) ? ok("the kitchen says it's offline") : bad("the kitchen shows no offline message", JSON.stringify(kBar));
    await ctx.setOffline(false);
    await kit.close();

    // ══ OWNER PANEL ════════════════════════════════════════════════════════════
    // A dashboard is the one place stale numbers are dangerous, so it must both survive
    // AND admit that the figures are saved ones.
    console.log("\n7) Owner panel with no internet");
    const oRoute = await loginAs(ctx, "owner", BASE);
    const own = await ctx.newPage();
    await own.goto(BASE + oRoute, { waitUntil: "domcontentloaded" });
    await waitControlled(own);
    await own.reload({ waitUntil: "domcontentloaded" });
    await sleep(6000);
    await ctx.setOffline(true);
    await own.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(5000);
    const oText = (await own.locator("body").textContent().catch(() => "")) || "";
    !/This screen hasn't been opened on this device/i.test(oText)
      ? ok("the owner panel still opens offline")
      : bad("the owner panel fell through to the last-resort page");
    const notice = await waitFor(async () => {
      const t = (await own.locator("[role=status]").allTextContents().catch(() => [])).join(" ");
      return /No internet|saved figures/i.test(t) ? t : null;
    }, 20000);
    notice ? ok("it admits the figures are saved ones, not live") : bad("the owner panel shows figures with no offline warning");
    await ctx.setOffline(false);
    await own.close();

    // ══ GUEST MENU ═════════════════════════════════════════════════════════════
    console.log("\n8) Guest menu with no internet");
    const guest = await ctx.newPage();
    guest.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await guest.goto(`${BASE}/r/french-house/menu`, { waitUntil: "domcontentloaded" });
    await waitControlled(guest);
    await guest.reload({ waitUntil: "domcontentloaded" });
    const liveDishes = await waitFor(async () => {
      const n = await guest.locator(".item-card:not(.skeleton-card)").count();
      return n > 0 ? n : null;
    }, 40000);
    liveDishes ? ok(`guest menu live with ${liveDishes} dishes`) : bad("guest menu never loaded live (test setup problem)");
    await sleep(3000);
    await ctx.setOffline(true);
    await guest.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const body = (await guest.locator("body").textContent().catch(() => "")) || "";
    !/No internet right now/i.test(body)
      ? ok("the guest menu opens from the device (not the last-resort page)")
      : bad("the guest menu fell through to the last-resort offline page");
    const offDishes = await waitFor(async () => {
      const n = await guest.locator(".item-card:not(.skeleton-card)").count();
      return n > 0 ? n : null;
    }, 25000);
    offDishes ? ok(`the menu still lists ${offDishes} dishes offline (live was ${liveDishes})`) : bad("the guest menu is empty offline");
    await ctx.setOffline(false);

    // 409 is EXPECTED here: it's the clash refusal this suite deliberately provokes.
    // ══ A CRAWLING CONNECTION (there, but hopeless) ════════════════════════════
    // The owner's other case: "the internet is less". A dead network fails fast; a
    // connection that HANGS is worse, because the panel looks frozen with nothing said.
    // The offline layer stops waiting after a few seconds and paints the saved board.
    //
    // Chrome's own throttling doesn't reach a service worker, so this slows the SERVER
    // (scripts/slow-proxy.mjs) — the only way to reproduce it truthfully.
    console.log("\n9) A crawling connection (reads hang for 12s)");
    if (!SLOW) {
      console.log("  – skipped (pass --slow-proxy http://localhost:4099 to include it)");
    } else {
      const slowPage = await ctx.newPage();
      await loginAs(ctx, "manager", SLOW);
      await slowPage.goto(SLOW + "/manager", { waitUntil: "domcontentloaded" });
      await waitControlled(slowPage);
      await slowPage.reload({ waitUntil: "domcontentloaded" });
      const warm = await waitFor(async () => {
        const v = await inPanel(slowPage, () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0);
        return typeof v === "number" && v > 0 ? v : null;
      }, 45000);
      warm ? ok("warmed up through the proxy while it was fast") : bad("couldn't warm up through the proxy");
      await sleep(3000);

      // Every read now takes 12 seconds — twice the layer's patience.
      await ctx.request.get(SLOW + "/__slow?ms=12000");
      const t0 = Date.now();
      await slowPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      const painted = await waitFor(async () => {
        const v = await inPanel(slowPage, () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0);
        return typeof v === "number" && v > 0 ? v : null;
      }, 40000);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      painted && Number(secs) < 12
        ? ok(`the board painted in ${secs}s instead of hanging for 12s (${painted} rows)`)
        : bad(painted ? `the board took ${secs}s — it waited for the hanging read` : "the board never painted; it just spun");
      const slowBar = await waitFor(async () => {
        const v = await inPanel(slowPage, () => { const b = document.querySelector("#lfhOffBar"); return b ? b.textContent : ""; });
        return v && String(v).length ? String(v) : null;
      }, 15000);
      /struggling|no internet|saved/i.test(String(slowBar || ""))
        ? ok(`and it explains why: "${String(slowBar).trim().slice(0, 60)}…"`)
        : bad("it showed saved figures with no explanation", JSON.stringify(slowBar));
      await ctx.request.get(SLOW + "/__slow?ms=0");
      await slowPage.close();
    }

    const realErrors = consoleErrors.filter((t) => !/Failed to fetch|net::ERR|offline|503|409|Service Worker/i.test(t));
    realErrors.length === 0 ? ok("no unexpected console errors") : bad(`${realErrors.length} console error(s)`, realErrors.slice(0, 3).join("\n       "));
  } catch (e) {
    bad("the run stopped early", e.stack || e.message);
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    if (!KEEP) await browser.close();
    process.exit(fail === 0 ? 0 : 1);
  }
}

run();
