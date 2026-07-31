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
import { loginAs as loginOnce } from "./sweep/login.mjs";

// Signing in occasionally times out on a busy dev server — a blip in the test rig, not in the
// app (the same request answers in under a second by hand). One retry keeps a 54-check run
// from being thrown away by it, without hiding a real login failure: the second failure still
// stops the run.
async function loginAs(ctx, role, base, creds) {
  try { return await loginOnce(ctx, role, base, creds); }
  catch (e) {
    console.log(`  · sign-in as ${role} timed out, retrying once`);
    await new Promise((r) => setTimeout(r, 3000));
    return loginOnce(ctx, role, base, creds);
  }
}

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
// A tab opened AFTER the network was cut adopts that state a moment later; navigating
// before it does races the real server and the test measures nothing. Always go through this.
async function offlinePage(ctx) {
  const pg = await ctx.newPage();
  for (let i = 0; i < 20; i++) {
    if (await pg.evaluate(() => navigator.onLine === false).catch(() => false)) break;
    await sleep(250);
  }
  return pg;
}
// Is this read actually saved on the device yet? The offline checks depend on it, so assert the
// precondition instead of sleeping and hoping.
async function waitCached(page, urlPart, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    const has = await page.evaluate(async (part) => {
      for (const n of await caches.keys()) {
        if (!n.startsWith("lfh-data")) continue;
        const keys = await (await caches.open(n)).keys();
        if (keys.some((k) => k.url.includes(part))) return true;
      }
      return false;
    }, urlPart).catch(() => false);
    if (has) return true;
    if (Date.now() > until) return false;
    await sleep(500);
  }
}

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
  const badResponses = [];   // {status, url} for anything >= 400 — so a failure names itself
  const watch = (pg) => {
    pg.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pg.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(BASE, "").replace(SLOW || "\u0000", "[slow]")}`); });
  };
  // A separate STAFF context used only for setup/cleanup and for acting as "the other
  // device". Kept apart from `ctx` so signing in as a manager never disturbs the tablet's
  // own session.
  const staff = await browser.newContext();
  const seatedByUs = [];   // tables this run put an order on, so it can tidy up after itself

  const sessionsOn = async (t) => {
    const j = await staff.request.get(`${BASE}/api/editor/sessions?table=${t}`).then((r) => r.json()).catch(() => null);
    const list = Array.isArray(j) ? j : (j && (j.sessions || j.rows)) || [];
    return list.filter((r) => r && r.status !== "closed");
  };
  // Setup POSTs get a generous timeout and one retry: this database is shared with other
  // sessions' test suites, and their load must not be reported as our failure.
  const setupPost = async (path, data, tries = 2) => {
    for (let i = 0; i < tries; i++) {
      try { return await staff.request.post(BASE + path, { headers: { "content-type": "application/json" }, data, timeout: 90000 }); }
      catch (e) {
        if (i === tries - 1) { console.log(`  · setup ${path} timed out twice (shared database under load)`); return null; }
        console.log(`  · setup ${path} timed out, retrying once`);
        await sleep(2000);
      }
    }
    return null;
  };
  const closeSession = (id) => setupPost(`/api/editor/sessions/${id}/close`, { force: true });

  // A genuinely FREE table to test on. On a real floor (and after a few runs of this
  // script) there may not be one, so if every table is occupied we free the longest-running
  // one first. Scans the tile keys themselves rather than 1..table_count, because a table
  // ABOVE table_count can still hold live orders — scanning to the count found nothing
  // while table 48 sat free.
  async function pickFreeTable(tiles) {
    // Don't depend on the caller having the floor loaded: with no tile map, ask the server
    // about tables 1..30 directly. (An empty map used to make this return "no free table"
    // and abort a whole section for no real reason.)
    let keys = Object.keys(tiles || {}).sort((x, y) => Number(x) - Number(y));
    if (!keys.length) keys = Array.from({ length: 30 }, (_, i) => String(i + 1));
    // ONLY tables that really exist. The tile map deliberately includes tables ABOVE the floor
    // count when they still hold live orders (a real table with an unpaid bill must never be
    // hidden — see the table-ownership rule), so leftover test rows on e.g. table 9397561 put
    // that number in here. Picking one made the app refuse the order it was asked to place —
    // "Table 992 doesn't exist (this place has 30 tables)" — and the whole offline section then
    // failed for a reason that was the fixture's, not the product's. (2026-07-31)
    const floorCount = await (async () => {
      const r = await staff.request.get(`${BASE}/api/editor/all`).then((x) => x.json()).catch(() => null);
      const n = Number(r && (r.table_count ?? (r.settings && r.settings.table_count)));
      return Number.isFinite(n) && n > 0 ? n : 30;
    })();
    keys = keys.filter((k) => { const n = Number(k); return Number.isFinite(n) && n >= 1 && n <= floorCount; });
    for (const k of keys) {
      const t = tiles[k];
      if (!t || t.state === "free") {
        if ((await sessionsOn(k)).length === 0) return String(k);
      }
    }
    // Nothing free → borrow one by closing its bill (this is a dev database).
    for (const k of keys) {
      const live = await sessionsOn(k);
      if (live.length) {
        const r = await closeSession(live[0].id);
        if (r && r.ok() && (await sessionsOn(k)).length === 0) return String(k);
      }
    }
    return null;
  }

  try {
    // ══ MANAGER: can it be opened and read with no internet? ═══════════════════
    console.log("\n1) Offline layer installs (manager panel)");
    const mgrRoute = await loginAs(ctx, "manager", BASE);
    const page = await ctx.newPage();
    watch(page);
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
    (await waitCached(page, "/api/editor/all")) ? ok("the board's data is saved on the device") : bad("the board's data never got saved — the offline checks below cannot be trusted");

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
    watch(tab);
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
    await waitCached(tab, "/api/tablet/summary");

    // Pick a FREE table and a normal (non open-price) dish, so this is a clean new order.
    await loginAs(staff, "manager", BASE); // the setup/cleanup + "other device" identity
    const picked = await inPanel(tab, () => {
      const d = state.data || {};
      // summary.tiles is an OBJECT keyed by table number, e.g. { "1": { state:"free", … } }.
      const dish = (d.dishes || []).find((x) => !x.open_price && x.available !== false && !x.sold_out) || (d.dishes || [])[0];
      return { tiles: (state.summary || {}).tiles || {}, dishId: dish && dish.id, dishName: dish && dish.title };
    });
    const target = { free: await pickFreeTable(picked && picked.tiles), dishId: picked && picked.dishId };
    if (!target.free || !target.dishId) throw new Error("test setup: no usable table + dish (" + JSON.stringify(picked && Object.keys(picked.tiles || {}).length) + " tiles)");
    ok(`testing on table ${target.free} with "${picked.dishName}"`);
    seatedByUs.push(target.free);

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
      if (drained.failed.length === 0) ok("the saved order was sent on reconnect");
      else {
        const why = String(drained.failed[0].plain || drained.failed[0].error || "");
        const perms = /isn't enabled for you|ask a manager|permission/i.test(why);
        bad(`it came back needing attention: ${why}`, perms
          ? "that is a PERMISSION refusal, not an offline fault — another session's suite toggles\n       waiter permissions while it runs; re-run when nothing else is testing"
          : undefined);
      }
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
      const clashPick = await inPanel(tab, () => {
        const d = (state.data.dishes || []).find((x) => !x.open_price) || state.data.dishes[0];
        return { tiles: (state.summary || {}).tiles || {}, dishId: d && d.id };
      });
      const clashTarget = { free: await pickFreeTable(clashPick && clashPick.tiles), dishId: clashPick && clashPick.dishId };
      if (!clashTarget.free) throw new Error("test setup: no table available for the clash check");
      seatedByUs.push(clashTarget.free);
      await inPanel(tab, (arg) => { window.__T2 = arg.free; window.__D2 = arg.dishId; return true; }, clashTarget);

      // 1. Seat the table for real, ONLINE, so there's a live bill to clash with.
      const seeded = await inPanelAsync(tab, async () => {
        const r = await api("POST", "/order", { table: window.__T2, items: [{ id: window.__D2, qty: 1 }], allergies: [], note: "clash seed" });
        await new Promise((res) => setTimeout(res, 1500));
        return { placed: !!r };
      });
      // The session id comes from the OTHER device (the manager's own read), which is
      // also more honest: that's the device that will close the table.
      // Read from the OTHER device (the staff context, which stays online) — that's the
      // device that will close the table, so this is the honest way round.
      const sessResp = await staff.request.get(`${BASE}/api/editor/sessions?table=${clashTarget.free}`);
      const sessBody = await sessResp.json().catch(() => null);
      const rows = Array.isArray(sessBody) ? sessBody : (sessBody && (sessBody.sessions || sessBody.rows)) || [];
      const live = rows.find((s) => s && s.status !== "closed");
      if (!live || !live.id) throw new Error("test setup: couldn't seat table " + clashTarget.free + " to clash with (" + JSON.stringify(seeded) + ")");
      ok(`table ${clashTarget.free} is open with a live bill`);

      // 2. The waiter's device drops offline and takes ANOTHER order for that table.
      await ctx.setOffline(true);
      await inPanelAsync(tab, async () => {
        await api("POST", "/order", { table: window.__T2, items: [{ id: window.__D2, qty: 2 }], allergies: [], note: "taken while offline" });
        return true;
      });
      ok("a second order was taken on the offline device");

      // 3. MEANWHILE, on another device that still has signal, the manager closes+bills it.
      const closeRes = await setupPost(`/api/editor/sessions/${live.id}/close`, { force: true });
      if (!closeRes || !closeRes.ok()) throw new Error("test setup: the other device couldn't close the table (" + (closeRes ? "HTTP " + closeRes.status() : "timed out twice") + ")");
      ok("another device closed and billed that table");

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
        // Insist it failed for the RIGHT reason. Just checking "something failed" let a
        // setup error ("valid table required") tick this box green.
        const isClash = /closed and billed|different party now/i.test(String(f.plain || ""));
        isClash
          ? ok(`it came back needing a person: "${String(f.plain).slice(0, 90)}"`)
          : bad("it failed, but NOT with a clash explanation — this check proved nothing", JSON.stringify({ error: f.error, plain: f.plain }));
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
    await tab.close();

    // ══ A GUEST's offline order gets the same protection ═══════════════════════
    // A customer's own phone is the device most likely to lose signal in a restaurant, so
    // this is the likeliest replay of all. It must not be added to a bill that has been
    // closed, or to whoever is sitting at that table now.
    console.log("\n5b) A guest order replayed onto a table that moved on");
    {
      const menu = await staff.request.get(`${BASE}/api/r/french-house/menu-data`).then((r) => r.json()).catch(() => null);
      const dish = menu && menu.items && menu.items[0];
      // Build the whole situation ourselves rather than hunting for a table that happens to
      // have been occupied for a while — depending on existing data made this check quietly
      // un-runnable once the suite's own tidy-up had closed the long-standing tables.
      //   t0  a guest order seats the table
      //   t1  the moment our imaginary offline guest placed THEIR order
      //   t2  staff close and bill the table
      // then we replay with queued-at = t1, which is after the party arrived and before it
      // was billed — exactly the situation the guard exists for.
      let gt = null;
      for (let i = 30; i >= 1; i--) {
        const probe = await staff.request.get(`${BASE}/api/editor/sessions?table=${i}`).then((r) => r.json()).catch(() => null);
        const list = Array.isArray(probe) ? probe : (probe && (probe.sessions || probe.rows)) || [];
        if (!list.some((r) => r && r.status !== "closed")) { gt = String(i); break; }
      }
      if (!gt) throw new Error("test setup: no free table for the guest check");
      seatedByUs.push(gt);
      // Seat it as STAFF. A public (QR) guest order doesn't necessarily open a dining
      // session, and the clash guard reasons about the SESSION — so seating it the way a
      // waiter does is both what really happens and what makes this check meaningful.
      const seat = await setupPost("/api/editor/sessions/open", { table: gt });
      seat && seat.ok() ? ok(`staff seated table ${gt}`) : bad(`couldn't seat table ${gt}`, seat ? `HTTP ${seat.status()}` : "request timed out twice");
      await sleep(1500);
      const QUEUED_AT = new Date();                       // t1: our offline guest ordered now
      await sleep(1500);
      const sList = await staff.request.get(`${BASE}/api/editor/sessions?table=${gt}`).then((r) => r.json()).catch(() => null);
      const sRows = Array.isArray(sList) ? sList : (sList && (sList.sessions || sList.rows)) || [];
      const liveS = sRows.find((r) => r && r.status !== "closed");
      if (!liveS) throw new Error("test setup: the guest order didn't open a session on table " + gt);
      const closed = await setupPost(`/api/editor/sessions/${liveS.id}/close`, { force: true });
      closed && closed.ok() ? ok("staff closed and billed it while the phone had no signal") : bad(`couldn't close table ${gt}`, closed ? `HTTP ${closed.status()}` : "request timed out twice");
      // The guard deliberately ignores anything younger than 20s, so the replay has to be
      // genuinely old before it means anything.
      await sleep(22000);

      const replay = await staff.request.post(`${BASE}/api/guest/place-order`, {
        headers: {
          "content-type": "application/json",
          "X-LFH-Action-Id": "test-" + Date.now(),
          "X-LFH-Replay": "1",
          "X-LFH-Queued-At": QUEUED_AT.toISOString(), // taken before staff closed the table
        },
        data: { mode: "public", table: gt, items: [{ id: dish && dish.id, qty: 1 }], allergies: [] },
      });
      const rBody = await replay.json().catch(() => null);
      replay.status() === 409 && rBody && rBody.clash
        ? ok(`the guest's stale order was refused: "${String(rBody.clash.plain).slice(0, 70)}"`)
        : bad(`a stale guest order was NOT refused (HTTP ${replay.status()})`, JSON.stringify(rBody));
      rBody && rBody.clash && rBody.clash.todo ? ok("with what to do about it") : bad("no guidance came back with it");
    }

    // ══ KITCHEN ════════════════════════════════════════════════════════════════
    // The kitchen screen used to come back EMPTY after an offline reload — a cook would
    // think every ticket had vanished mid-service.
    console.log("\n6) Kitchen screen with no internet");
    const kRoute = await loginAs(ctx, "kitchen", BASE);
    const kit = await ctx.newPage();
    watch(kit);
    await kit.goto(BASE + kRoute, { waitUntil: "domcontentloaded" });
    await waitControlled(kit);
    await kit.reload({ waitUntil: "domcontentloaded" });
    const kLive = await waitFor(async () => {
      const v = await inPanel(kit, () => (typeof state !== "undefined" && (state.dishes || []).length) || 0);
      return typeof v === "number" && v > 0 ? v : null;
    }, 40000);
    kLive ? ok(`kitchen loaded live (${kLive} dishes on the board)`) : bad("kitchen never loaded live");
    (await waitCached(kit, "/api/kitchen/board")) ? ok("the kitchen board is saved on the device") : bad("the kitchen board never got saved");
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
    // Same reason as the guest menu below: the owner dashboard's offline bar appears only after
    // its data settles, and on a cold deployed site that is slower than 20s.
    const notice = await waitFor(async () => {
      const t = (await own.locator("[role=status]").allTextContents().catch(() => [])).join(" ");
      return /No internet|saved figures/i.test(t) ? t : null;
    }, 40000);
    notice ? ok("it admits the figures are saved ones, not live") : bad("the owner panel shows figures with no offline warning");
    await ctx.setOffline(false);
    await own.close();

    // ══ GUEST MENU ═════════════════════════════════════════════════════════════
    console.log("\n8) Guest menu with no internet");
    const guest = await ctx.newPage();
    watch(guest);
    await guest.goto(`${BASE}/r/french-house/menu`, { waitUntil: "domcontentloaded" });
    await waitControlled(guest);
    await guest.reload({ waitUntil: "domcontentloaded" });
    // 75s. This is the SETUP step for everything below it: if the menu hasn't painted live, the
    // saved-copy and offline checks all fail too, and the whole section reports four faults for
    // one slow load. Against the deployed site a cold guest menu already needs past 30s, and
    // under a parallel test run — several browser lanes hitting the same site — it needs more.
    // The check itself labels this "(test setup problem)"; giving it room is how that label stops
    // being printed as if the app were broken.
    const liveDishes = await waitFor(async () => {
      const n = await guest.locator(".item-card:not(.skeleton-card)").count();
      return n > 0 ? n : null;
    }, 75000);
    liveDishes ? ok(`guest menu live with ${liveDishes} dishes`) : bad("guest menu never loaded live (test setup problem)");
    (await waitCached(guest, "/menu-data")) ? ok("the menu is saved on the device") : bad("the menu never got saved");
    await ctx.setOffline(true);
    await guest.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const body = (await guest.locator("body").textContent().catch(() => "")) || "";
    !/No internet right now/i.test(body)
      ? ok("the guest menu opens from the device (not the last-resort page)")
      : bad("the guest menu fell through to the last-resort offline page");
    // 45s, not 25s. Against the DEPLOYED site a cold guest menu can take past 30 seconds to
    // paint its dishes — measured: a 6-second look said 0 dishes, a 30-second look said 59 on the
    // same URL. At 25s this reported "the guest menu is empty offline" intermittently, which is
    // the worst kind of red: the feature works, so the next person learns to re-run and move on.
    const offDishes = await waitFor(async () => {
      const n = await guest.locator(".item-card:not(.skeleton-card)").count();
      return n > 0 ? n : null;
    }, 45000);
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
      // And it must NOT cry wolf. Reads are crawling here, but live updates are still
      // flowing, so the connection is not "struggling" in any way a person would recognise —
      // the owner caught exactly that warning sitting above a green "Live" badge. Silence is
      // the correct answer; the layer refetches by itself within seconds.
      const slowBar = await inPanel(slowPage, () => ({
        bar: (function () { const b = document.querySelector("#lfhOffBar"); return b ? b.innerText.replace(/\n/g, " | ") : ""; })(),
        rt: (window.LFH_RT && window.LFH_RT.getStatus) ? window.LFH_RT.getStatus() : "?",
      }));
      const liveFlowing = slowBar && slowBar.rt === "online";
      const alarmed = /struggling|no internet/i.test((slowBar && slowBar.bar) || "");
      liveFlowing && alarmed
        ? bad(`it cried wolf while live updates were flowing: "${slowBar.bar.slice(0, 60)}"`)
        : ok(liveFlowing ? "and it stays quiet, because live updates are still flowing" : `and it says so: "${(slowBar.bar || "").slice(0, 50)}"`);
      await ctx.request.get(SLOW + "/__slow?ms=0");
      await slowPage.close();
    }

    // ══ THE SIGN-IN PAGE, offline ══════════════════════════════════════════════
    // The most likely offline moment of all: a panel tab wakes up, reloads, has no signal
    // and the app bounces it to the sign-in page. That page was excluded from the offline
    // layer at first, so staff got the browser's error page — and that failed navigation
    // then stopped the NEXT one being handled, taking our own offline page down with it.
    console.log("\n11) The sign-in page, reloaded with no internet");
    const lg = await ctx.newPage();
    await lg.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await waitControlled(lg);
    await lg.reload({ waitUntil: "domcontentloaded" });   // once online, so it's saved
    await sleep(2500);
    await ctx.setOffline(true);
    await lg.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(2000);
    const lgText = ((await lg.locator("body").textContent().catch(() => "")) || "");
    // "Served from the device" = we got OUR html back (the app's own page or our offline
    // page). The browser's error page yields an empty body here.
    lgText.trim().length > 0
      ? ok(`the sign-in page still comes from the device: "${lgText.trim().replace(/\s+/g, " ").slice(0, 46)}…"`)
      : bad("the sign-in page fell through to the browser's error page (empty body)");
    // …and it must not leave the NEXT navigation unhandled.
    //
    // NOTE ON WHAT THIS CAN AND CANNOT PROVE: Chrome's offline emulation applies to the
    // PAGE, not to the service worker's own fetches (the same gap that made the crawling-
    // connection test need a real slow server). So a fresh tab's navigation can legitimately
    // be answered live here. What we CAN assert is that something of ours comes back rather
    // than the browser's error page — an empty body. A true end-to-end proof for navigations
    // needs a real device losing WiFi; that's the outstanding item in docs/OFFLINE-SYNC.md.
    const after = await offlinePage(ctx);
    await after.goto(BASE + "/still-unseen-" + Date.now(), { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(1500);
    const afterText = ((await after.locator("body").textContent().catch(() => "")) || "").trim();
    afterText.length > 0
      ? ok("and the next navigation is still answered (not the browser's error page)")
      : bad("a sign-in reload left the next navigation unhandled (empty body)");
    await ctx.setOffline(false);
    await lg.close(); await after.close();

    // ══ A SCREEN THIS DEVICE HAS NEVER OPENED, offline ═════════════════════════
    // The last-resort case: nothing saved for this URL and no network. Staff must get the
    // branded "no internet — nothing you did is lost" page, not the browser's own error
    // page. This was broken on the first release and no test covered it, because every
    // other check visits a page while online first.
    console.log("\n10) A screen never opened on this device, with no internet");
    const fresh = await ctx.newPage();
    await fresh.goto(BASE + "/login", { waitUntil: "domcontentloaded" });   // installs the worker
    await waitControlled(fresh);
    await ctx.setOffline(true);
    for (let i = 0; i < 20 && !(await fresh.evaluate(() => navigator.onLine === false).catch(() => false)); i++) await sleep(250);
    // A URL that certainly has no saved copy on this device.
    await fresh.goto(BASE + "/never-opened-" + Date.now(), { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(1500);
    const lastResort = (await fresh.locator("body").textContent().catch(() => "")) || "";
    /No internet right now/i.test(lastResort)
      ? ok("it shows our own page, not the browser's error page")
      : bad("the branded offline page was not served", JSON.stringify(lastResort.slice(0, 100)));
    /Nothing you did is lost/i.test(lastResort)
      ? ok("and it reassures them their work is safe")
      : bad("the reassurance text is missing");
    await ctx.setOffline(false);
    await fresh.close();

    // ══ NO FALSE ALARMS ON A HEALTHY CONNECTION ════════════════════════════════
    // The owner photographed the manager panel showing "Connection is struggling" above its
    // own green "Live" badge, with the internet perfectly fine. One slow read had been
    // answered from the device and the warning stuck. A warning that cries wolf is worse
    // than no warning: staff stop believing the real one.
    console.log("\n12) A slow read on a HEALTHY connection must not raise the alarm");
    if (!SLOW) {
      console.log("  – skipped (needs --slow-proxy)");
    } else {
      const hp = await ctx.newPage();
      await loginAs(ctx, "manager", SLOW);
      await hp.goto(SLOW + "/manager", { waitUntil: "domcontentloaded" });
      await waitControlled(hp);
      await hp.reload({ waitUntil: "domcontentloaded" });
      await waitFor(async () => {
        const v = await inPanel(hp, () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0);
        return typeof v === "number" && v > 0 ? v : null;
      }, 45000);
      await sleep(2500);
      // Reads now take 14s — past the layer's patience — but the connection is FINE.
      await ctx.request.get(SLOW + "/__slow?ms=14000");
      await inPanel(hp, () => { try { pollOrders(); } catch (e) {} });
      await sleep(16000);
      const st = await inPanel(hp, () => ({
        bar: (function () { const b = document.querySelector("#lfhOffBar"); return b ? b.innerText.replace(/\n/g, " | ") : ""; })(),
        rt: (window.LFH_RT && window.LFH_RT.getStatus) ? window.LFH_RT.getStatus() : "?",
        online: navigator.onLine,
      }));
      await ctx.request.get(SLOW + "/__slow?ms=0");
      if (st && !st.__err) {
        const claimsStruggling = /struggling/i.test(st.bar || "");
        const connectionIsFine = st.online !== false && st.rt === "online";
        connectionIsFine && claimsStruggling
          ? bad(`it cried wolf: live updates are flowing (${st.rt}) but the bar says "${st.bar.slice(0, 60)}"`)
          : ok(`no false alarm while live updates flow (bar: ${st.bar ? JSON.stringify(st.bar.slice(0, 40)) : "none"}, realtime: ${st.rt})`);
      }
      // …and once reads are quick again it must clear itself without anyone touching it.
      const cleared = await waitFor(async () => {
        const v = await inPanel(hp, () => { const b = document.querySelector("#lfhOffBar"); return b ? b.innerText : ""; });
        return /struggling/i.test(String(v || "")) ? null : true;
      }, 40000);
      cleared ? ok("it clears itself once reads are quick again") : bad("the warning stayed up after the connection recovered");
      await hp.close();
    }

    // ══ TWO TABLETS, ONE DISH, AT THE SAME MOMENT ══════════════════════════════
    // The owner's scenario: waiter 1 marks a dish "more spicy", waiter 2 marks the same dish
    // "less spicy", seconds apart. It must NOT silently overwrite — one wins, and the other
    // person is told what it says now so the kitchen isn't cooking a guess.
    console.log("\n13) Two waiters editing the SAME dish at the same time");
    {
      const t1 = await ctx.newPage();     // tablet 1 (this context is signed in as a waiter)
      await loginAs(ctx, "tablet", BASE);
      await t1.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
      await waitFor(async () => {
        const v = await inPanel(t1, () => (typeof state !== "undefined" && state.data && (state.data.dishes || []).length) || 0);
        return v > 0 ? v : null;
      }, 45000);

      // Put a real dish on a real table so there's something to fight over.
      await waitFor(async () => {
        const n = await inPanel(t1, () => Object.keys((state.summary || {}).tiles || {}).length);
        return typeof n === "number" && n > 0 ? n : null;
      }, 30000);
      const pick = await inPanel(t1, () => {
        const d = (state.data.dishes || []).find((x) => !x.open_price) || state.data.dishes[0];
        return { tiles: (state.summary || {}).tiles || {}, dishId: d && d.id };
      });
      const table = await pickFreeTable(pick && pick.tiles);
      if (!table) throw new Error("test setup: no free table for the two-device check");
      seatedByUs.push(table);
      await inPanel(t1, (a) => { window.__CT = a.t; window.__CD = a.d; return true; }, { t: table, d: pick.dishId });
      const placed = await inPanelAsync(t1, async () => {
        await api("POST", "/order", { table: window.__CT, items: [{ id: window.__CD, qty: 1 }], allergies: [], note: null });
        await new Promise((r) => setTimeout(r, 1800));
        // Read the saved dish back from the SERVER rather than from panel state: the panel
        // only holds a table's full detail while that table is selected.
        const j = await api("GET", "/state?table=" + window.__CT);
        const items = (j && j.items) || [];
        const item = items[0];
        return { itemId: item && item.id, note: item ? String(item.note || "") : "", count: items.length };
      });
      if (!placed || placed.__err || !placed.itemId) throw new Error("test setup: couldn't get a saved dish to edit (" + JSON.stringify(placed) + ")");
      ok(`a dish is on table ${table} for both waiters to edit`);

      await inPanel(t1, (a) => { window.__ITEM = a.id; window.__WAS = a.was; return true; }, { id: placed.itemId, was: placed.note || "" });

      // BOTH tablets save a different note, each saying what it was editing FROM ("").
      const both = await inPanelAsync(t1, async () => {
        const id = window.__ITEM, was = window.__WAS;
        const attempt = async (note) => {
          // The documented shape (CLAUDE.md → NEW-FEATURE CHECKLIST item 11): say WHICH row and
          // which fields you were editing from. A malformed expectation is ignored by design,
          // so the test must use the real one or it proves nothing.
          const expect = { table: "order_items", id, fields: { note: was } };
          try { await api("POST", "/items/" + id + "/note", { note }, { expect }); return { note, ok: true }; }
          catch (e) { return { note, ok: false, status: e.status, clash: e.data && e.data.clash ? e.data.clash : null, msg: e.message }; }
        };
        const a = await attempt("more spicy");
        const b = await attempt("less spicy");   // same starting point → the ground has moved
        return { a, b };
      }, null);
      // (ids handed in first)
      if (both && both.__err) bad("the two-device check threw", both.__err);
      else if (both) {
        const winners = [both.a, both.b].filter((r) => r.ok);
        winners.length === 1
          ? ok(`exactly one of the two saves won ("${winners[0].note}")`)
          : bad(`${winners.length} of the 2 saves were accepted — one must lose`, JSON.stringify(both));
        const loser = [both.a, both.b].find((r) => !r.ok);
        loser && loser.clash
          ? ok(`the other waiter was told: "${String(loser.clash.plain).slice(0, 78)}"`)
          : bad("the losing waiter got no clear explanation", JSON.stringify(loser));
        loser && loser.clash && /more spicy|less spicy/.test(String(loser.clash.plain))
          ? ok("and the message names what it says NOW, so they can decide")
          : bad("the message doesn't say what the value is now", JSON.stringify(loser && loser.clash));
      }
      // The database must hold ONE of them — never a merge, never both.
      const stored = await inPanelAsync(t1, async () => {
        const j = await api("GET", "/state?table=" + window.__CT);
        const list = (j && j.items) || [];
        const it = list.find((x) => String(x.id) === String(window.__ITEM));
        return it ? String(it.note || "") : null;
      });
      /^(more spicy|less spicy)$/.test(String(stored || ""))
        ? ok(`the dish holds exactly one instruction: "${stored}"`)
        : bad(`the stored note is not one of the two: ${JSON.stringify(stored)}`);
      await t1.close();
    }

    const realErrors = consoleErrors.filter((t) => !/Failed to fetch|net::ERR|offline|503|409|Service Worker/i.test(t));
    const realBad = [...new Set(badResponses)].filter((b) => !/^40[13] .*(panel-login|staff-login)/.test(b));
    realErrors.length === 0
      ? ok("no unexpected console errors")
      : bad(`${realErrors.length} console error(s)`, [...realErrors.slice(0, 2), ...(realBad.length ? ["failing requests: " + realBad.slice(0, 5).join(", ")] : [])].join("\n       "));
  } catch (e) {
    bad("the run stopped early", e.stack || e.message);
  } finally {
    // Leave the floor as we found it. Without this, each run seated another table and
    // eventually there was none left to test with — which is exactly how this suite
    // started failing on its own leftovers.
    try {
      for (const t of [...new Set(seatedByUs)]) {
        for (const live of await sessionsOn(t)) await closeSession(live.id);
      }
      if (seatedByUs.length) console.log(`\n  · tidied up tables ${[...new Set(seatedByUs)].join(", ")}`);
    } catch { /* cleanup is best-effort */ }
    await staff.close().catch(() => {});
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    if (!KEEP) await browser.close();
    process.exit(fail === 0 ? 0 : 1);
  }
}

run();
