// Family L — SECOND PASS, AIMED BY COVERAGE: the paths of the smaller helpers no check had run — the
// queue's sign-out / still-busy / refused-in-the-answer endings, the crash reporter's offline keeping,
// the undo card's swipe and its hidden-tab rule, the guest bell's rows and actions, the swipe chip,
// the read helper's deadline, the theme following another tab, the Audit's database counts, and the
// photo shrinker on a browser without createImageBitmap. All real files, all in a browser.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";

const PACE = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};";
const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const QP = page("l-q", { pre: PACE + ONLINE, body: '<div class="topbar"></div>', scripts: ["outbox.js"] });
async function queued(answer) {
  setApi(() => ({ status: 503, body: {} }));
  const h = await open(QP); const p = h.page;
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })); await p.reload();
  await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/3/discount", body: {}, table: "3" }));
  setApi(answer);
  for (let i = 0; i < 12; i++) { await p.evaluate(() => window.LFH_OUTBOX.flush()); await sleep(250); if (await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length)) break; }
  const f = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed[0] || null);
  return { h, p, f };
}
C("L", "outbox.js", "a waiting change replayed onto a signed-out device is not thrown away: after three tries it is listed — 'This device was signed out… Sign in on this device, then tap Try again' — and can be retried", async () => {
  const { h, f } = await queued(() => ({ status: 401, body: { error: "Not authorised." } }));
  await h.close();
  return ok(f && /signed out/.test(f.plain) && /Sign in on this device, then tap Try again/.test(f.todo) && f.retryable !== false, JSON.stringify(f && { plain: f.plain, todo: f.todo, retryable: f.retryable }));
});
C("L", "outbox.js", "a replay the server keeps answering 'still working on it' (409 retry) is asked again a few times, then listed as 'still busy with this change' and can be retried", async () => {
  const { h, f } = await queued(() => ({ status: 409, body: { retry: true } }));
  await h.close();
  return ok(f && /still busy with this change/.test(f.plain) && f.retryable !== false, JSON.stringify(f && { plain: f.plain, retryable: f.retryable }));
});
C("L", "outbox.js", "a replay answered 200 but ok:false is listed with the reason in words ('this table has already been closed') and NOT offered again — nothing was applied", async () => {
  const { h, f } = await queued(() => ({ status: 200, body: { ok: false, reason: "session_closed" } }));
  await h.close();
  return ok(f && /this table has already been closed/.test(f.plain) && /Nothing was applied/.test(f.todo) && f.retryable === false, JSON.stringify(f && { plain: f.plain, todo: f.todo, retryable: f.retryable }));
});
C("L", "outbox.js", "a server that never answers a replay: after six tries the change is listed 'didn't answer, several times over', never dropped", async () => {
  const { h, p } = await queued(() => "drop");
  for (let i = 0; i < 20; i++) { await p.evaluate(() => window.LFH_OUTBOX.flush()); await sleep(200); if (await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length)) break; }
  const f = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed[0] || null);
  await h.close();
  return ok(f && /didn't answer, several times over/.test(f.plain) && f.retryable !== false, JSON.stringify(f && { plain: f.plain }));
});
C("L", "outbox.js", "a LIVE change the server answers 'signed out' is kept (not lost) and the panel is sent to the sign-in page", async () => {
  setApi(() => ({ status: 401, body: { error: "Not authorised." } }));
  const h = await open(QP); const p = h.page; await p.waitForFunction(() => !!window.LFH_OUTBOX);
  p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/8/tag", body: {}, table: "8" }).catch(() => {})).catch(() => {});
  await p.waitForURL(/\/login/, { timeout: 5000 }).catch(() => {});
  const url = p.url(); await p.goto(url.replace(/\/login.*/, "/p/l-q")); await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length === 1), 3000);
  const kept = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.map((q) => q.label));
  await h.close();
  return ok(/\/login$/.test(url) && kept.length === 1 && /Tag/.test(kept[0]), JSON.stringify({ url, kept }));
});
C("L", "outbox.js", "the queue's per-table views: a change moving a party from table 4 to 9 counts on BOTH tables; one that can never be re-sent counts as 'blocked'; pendingForTable lists them", async () => {
  setApi(() => ({ status: 200, body: { ok: true } }));
  const h = await open(QP); const p = h.page; await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => { window.__on = false; });
  const r = await p.evaluate(async () => {
    const O = window.LFH_OUTBOX;
    await O.send({ base: "/api/editor", method: "POST", path: "/tables/4/shift", body: { to: 9 }, table: "4" });
    return { by: O.pendingByTable(), for9: O.pendingForTable(9).map((x) => x.label), blocked: O.blockedByTable(), none: O.pendingForTable(null) };
  });
  await h.close();
  return ok(r.by["4"] === 1 && r.by["9"] === 1 && r.for9.length === 1 && /Shift table/.test(r.for9[0]) && Object.keys(r.blocked).length === 0 && r.none.length === 0, JSON.stringify(r));
});

// ── the crash reporter ────────────────────────────────────────────────────────────────────────
const EP = page("l-err", { pre: ONLINE, scripts: ["errlog.js"], body: '<button id="go" data-log="Settle bill">Settle</button>' });
C("L", "errlog.js", "a crash with NO signal is kept on the device (repeats folded, at most 5), and sent when the signal returns — marked 'offline, … earlier'; a tap trail is sent as taps, never kept", async () => {
  setApi(() => ({ status: 204, body: "" }));
  const h = await open(EP); const p = h.page;
  await p.evaluate(() => localStorage.removeItem("lfh_errlog_pending"));
  await p.evaluate(() => { window.__on = false; for (let i = 0; i < 9; i++) window.LFH_ERRLOG.report("boom " + (i % 7), "app.js:1"); window.LFH_ERRLOG.report("boom 1", "app.js:1"); });
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_errlog_pending") || "[]").map((x) => x.message));
  const sentOffline = log.filter((x) => x.path === "/api/log/client-error").length;
  await p.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); });
  await until(() => log.filter((x) => x.path === "/api/log/client-error").length >= 5, 10000); await sleep(300);
  const sent = log.filter((x) => x.path === "/api/log/client-error").map((x) => JSON.parse(x.body));
  await p.click("#go"); await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(400);
  const taps = log.filter((x) => x.path === "/api/log/client-error").map((x) => JSON.parse(x.body)).filter((x) => x.kind === "taps");
  await h.close();
  return ok(sentOffline === 0 && kept.length === 5 && new Set(kept).size === 5 && sent.length === 5 && sent.every((x) => / · offline, (under a minute|\d+ min) earlier$/.test(x.where)) && taps.length === 1 && /Settle bill/.test(taps[0].detail), JSON.stringify({ kept, sentOffline, sent: sent.map((x) => x.where), taps: taps.map((x) => x.detail) }));
});
C("L", "errlog.js", "a browser that refuses to queue a report (sendBeacon answers false) keeps it for later instead of losing it", async () => {
  setApi(() => ({ status: 204, body: "" }));
  const P2 = page("l-err2", { pre: ONLINE + "navigator.sendBeacon=()=>false;", scripts: ["errlog.js"] });
  const h = await open(P2); const p = h.page;
  await p.evaluate(() => { localStorage.removeItem("lfh_errlog_pending"); window.LFH_ERRLOG.report("render failed", "app.js:9"); });
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_errlog_pending") || "[]").map((x) => x.message));
  await h.close();
  return ok(kept.length === 1 && kept[0] === "render failed", JSON.stringify(kept));
});

// ── the undo card ─────────────────────────────────────────────────────────────────────────────
const UP = page("l-undo", { scripts: ["undobar.js"] });
C("L", "undobar.js", "the undo card can be flicked away (a drag past 60 px hides it without undoing); a small wobble does nothing; a card asked for while the tab is hidden and shown after its time is NOT offered late", async () => {
  const h = await open(UP, { touch: false }); const p = h.page;
  const drag = async (dx, dy) => { const b = await p.locator("#lfh-undobar .lfh-undo-txt").boundingBox(); await p.mouse.move(b.x + 10, b.y + 10); await p.mouse.down(); await p.mouse.move(b.x + 10 + dx, b.y + 10 + dy, { steps: 6 }); await p.mouse.up(); await sleep(400); };
  await p.evaluate(() => { window.__u = 0; window.LFH_UNDO.show({ message: "Served", seconds: 5, onUndo: () => window.__u++ }); }); await sleep(500);
  await drag(20, 0); const afterWobble = await p.evaluate(() => document.getElementById("lfh-undobar").classList.contains("show"));
  await drag(120, 0); const afterFlick = await p.evaluate(() => document.getElementById("lfh-undobar").classList.contains("show"));
  const undone = await p.evaluate(() => window.__u);
  const late = await p.evaluate(async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    let exp = 0; const realNow = Date.now; let shift = 0; Date.now = () => realNow() + shift;
    window.LFH_UNDO.dismiss(); await new Promise((r) => setTimeout(r, 400));
    const t = window.LFH_UNDO; const p = new Promise((r) => { t.show({ message: "Settled", seconds: 3, onExpire: () => { exp++; r(); } }); });
    await Promise.race([p, new Promise((r) => setTimeout(r, 4500))]);
    Date.now = realNow;
    return { exp };
  });
  await h.close();
  return ok(afterWobble && !afterFlick && undone === 0 && late.exp === 1, JSON.stringify({ afterWobble, afterFlick, undone, late }));
});

// ── the guest bell's rows ─────────────────────────────────────────────────────────────────────
const GP = page("l-bell", { body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "guestbell.js"] });
C("L", "guestbell.js", "each kind of row reads as a sentence ('Table 4 rang for a waiter'); tapping a table row closes the sheet and goes to that table; a printer/stock row titles itself, and its one action runs ONCE however fast it is tapped", async () => {
  const h = await open(GP); const p = h.page;
  const r = await p.evaluate(async () => {
    const now = Date.now(); window.__went = []; window.__ran = 0;
    window.LFH_BELL.sync({ menuOn: true, onOpen: (t) => window.__went.push(t), rows: [
      { id: "a", kind: "call", table: "4", at: now - 30000 },
      { id: "b", kind: "order", table: "7", at: now - 120000, text: "2 dishes" },
      { id: "c", kind: "printer", title: "The printer is out of paper", text: "Kitchen printer", at: now, action: { label: "Print again", run: () => window.__ran++ } },
      { id: "d", kind: "stock", title: "Paneer is running low", at: now },
    ] });
    window.LFH_BELL.open(); await new Promise((x) => setTimeout(x, 150));
    const rows = [...document.querySelectorAll(".lfh-bell-row")].map((x) => x.innerText.replace(/\s+/g, " ").trim());
    const act = document.querySelector(".lfh-bell-act"); act.click(); act.click(); await new Promise((x) => setTimeout(x, 100));
    const ranOnce = window.__ran;
    window.LFH_BELL.open(); await new Promise((x) => setTimeout(x, 150));
    const stockDisabled = [...document.querySelectorAll(".lfh-bell-row")].find((x) => /Paneer/.test(x.innerText)).disabled;
    [...document.querySelectorAll(".lfh-bell-row")].find((x) => /Table 4/.test(x.innerText)).click(); await new Promise((x) => setTimeout(x, 150));
    return { rows, ranOnce, stockDisabled, went: window.__went, open: !!document.querySelector(".lfh-bell-sheet") };
  });
  await h.close();
  return ok(r.rows.some((x) => /^.?\s*Table 4 rang for a waiter/.test(x.replace(/^\S+\s/, ""))) && r.rows.some((x) => /Table 7 sent a new order 2 dishes/.test(x)) && r.rows.some((x) => /The printer is out of paper Kitchen printer/.test(x)) && r.ranOnce === 1 && r.stockDisabled === true && r.went.join() === "4" && !r.open, JSON.stringify(r).slice(0, 900));
});
C("L", "guestbell.js", "an empty sheet says 'Nothing needs you right now.'", async () => {
  const h = await open(GP); const p = h.page;
  const t = await p.evaluate(async () => { window.LFH_BELL.sync({ menuOn: true, rows: [] }); window.LFH_BELL.open(); await new Promise((x) => setTimeout(x, 150)); return (document.querySelector(".lfh-bell-sheet") || {}).innerText; });
  await h.close();
  return ok(/Nothing needs you right now/.test(t || ""), t);
});

// ── the swipe chip ────────────────────────────────────────────────────────────────────────────
const SP = page("l-swipe", { scripts: ["swipehint.js"], body: '<div style="position:static"><div id="row" data-swipe-hint data-swipe-count style="width:300px;overflow-x:auto;white-space:nowrap">' + Array.from({ length: 9 }, (_, i) => `<span style="display:inline-block;width:90px">Cat ${i}</span>`).join("") + '</div></div><div id="fit" data-swipe-hint data-swipe-count style="width:900px;overflow:hidden;white-space:nowrap"><span>One</span></div>' });
C("L", "swipehint.js", "a row with more to see gets a '→ N more' chip counting what is out of sight, which scrolls it when tapped; a row that cannot scroll gets no promise at all", async () => {
  const h = await open(SP); const p = h.page; await sleep(300);
  const a = await p.evaluate(() => { const c = document.querySelector(".lfh-swipe-more"); return c && { text: c.textContent.trim(), hidden: c.hidden }; });
  await p.evaluate(() => document.querySelector(".lfh-swipe-more").click()); await sleep(700);
  const moved = await p.evaluate(() => document.getElementById("row").scrollLeft);
  const fit = await p.evaluate(() => { const r = document.getElementById("fit"); return { more: r.getAttribute("data-more"), chip: r.__lfhChip ? !r.__lfhChip.hidden : false }; });
  await h.close();
  return ok(a && /^→ \d+ more$/.test(a.text) && Number(a.text.match(/\d+/)[0]) >= 5 && !a.hidden && moved > 100 && !fit.more && !fit.chip, JSON.stringify({ a, moved, fit }));
});

// ── the read helper's own deadline ────────────────────────────────────────────────────────────
const NP = page("l-net", { scripts: ["netretry.js"] });
C("L", "netretry.js", "a read the server accepts and never answers ends after its 15 s deadline as 'the server didn't answer in time' (a TimeoutError a panel can word), not an endless spinner", async () => {
  setApi(() => "hang");
  const h = await open(NP); const p = h.page;
  const t0 = Date.now();
  const e = await p.evaluate(() => window.LFH_NET.fetch("/api/slow").then(() => null, (e) => ({ name: e.name, message: e.message, timeout: e.timeout })));
  const secs = (Date.now() - t0) / 1000; await h.close();
  return ok(e && e.name === "TimeoutError" && e.message === "the server didn't answer in time" && e.timeout === true && secs > 13 && secs < 19, JSON.stringify({ e, secs }));
});
C("L", "netretry.js", "a read the CALLER cancels is not retried and not reworded", async () => {
  setApi(() => "hang");
  const h = await open(NP); const p = h.page;
  const e = await p.evaluate(() => { const c = new AbortController(); setTimeout(() => c.abort(), 300); return window.LFH_NET.fetch("/api/slow", { signal: c.signal }).then(() => null, (e) => e.name); });
  const asked = log.filter((x) => x.path === "/api/slow").length; await h.close();
  return ok(e === "AbortError" && asked === 1, JSON.stringify({ e, asked }));
});

// ── light / dark following another tab ───────────────────────────────────────────────────────
const TP = page("l-theme", { scripts: ["theme.js"], body: '<button id="themeToggle"></button>' });
C("L", "theme.js", "another tab of this panel switching to dark repaints this one — but never under a finger that is on the screen: it waits for the finger to lift", async () => {
  const h = await open(TP); const p = h.page;
  await p.evaluate(() => { localStorage.setItem("lfh_panel_theme", "light"); window.LFH_THEME.set("light"); });
  const r = await p.evaluate(async () => {
    const fire = (v) => window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: v }));
    window.dispatchEvent(new PointerEvent("pointerdown")); fire("dark"); const during = window.LFH_THEME.get();
    window.dispatchEvent(new PointerEvent("pointerup")); const after = window.LFH_THEME.get();
    fire("light"); const back = window.LFH_THEME.get();
    fire(null); window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "dark" })); const ignored = window.LFH_THEME.get();
    return { during, after, back, ignored, label: document.getElementById("themeToggle").getAttribute("aria-label") };
  });
  await h.close();
  return ok(r.during === "light" && r.after === "dark" && r.back === "light" && r.ignored === "light" && /dark/.test(r.label), JSON.stringify(r));
});

// ── the Audit's counts from the database ──────────────────────────────────────────────────────
const AP = page("l-audit", { scripts: ["auditsort.js"] });
C("L", "auditsort.js", "the type chips use the DATABASE's counts when it sent them (every type it names, biggest first, zero counts dropped), the page's rows only when it did not; tag chips count every tag", async () => {
  const h = await open(AP); const p = h.page;
  const r = await p.evaluate(() => {
    const A = window.LFH_AUDITSORT || window.AuditSort || window.LFH_AUDIT;
    const rows = [{ id: 1, kind: "bill_deleted" }, { id: 2, kind: "comp" }];
    const db = [{ kind: "invoice_voided", n: 12, amount: "4500.5" }, { kind: "comp", n: 3, amount: 0 }, { kind: "discount", n: 0 }, { kind: "", n: 4 }];
    const withDb = A.kindCountsFrom(rows, db, A.KIND_LABEL, A.KIND_ICON), page = A.kindCountsFrom(rows, [], A.KIND_LABEL, A.KIND_ICON);
    const tags = A.tagCountsFrom([{ kind: "order_cancelled", meta: { made: true } }, { kind: "order_cancelled", meta: { made: false } }, { kind: "order_cancelled", meta: {} }]);
    return { withDb: withDb.map((c) => [c.kind, c.count, c.amount]), page: page.map((c) => [c.kind, c.count]), tags: tags.map((t) => [t.tag, t.count, !!t.label]) , name: !!A };
  });
  await h.close();
  return ok(r.name && JSON.stringify(r.withDb) === JSON.stringify([["invoice_voided", 12, 4500.5], ["comp", 3, 0]]) && r.page.length === 2 && r.tags.some((t) => t[0] === "loss" && t[1] === 1) && r.tags.some((t) => t[0] === "no-loss" && t[1] === 1) && r.tags.every((t) => t[2]), JSON.stringify(r));
});

// ── the photo shrinker on a browser without createImageBitmap (older iPads) ───────────────────
const IP = page("l-img", { pre: "window.createImageBitmap=undefined;window.__made=0;window.__freed=0;const c0=URL.createObjectURL.bind(URL),r0=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(b)=>{window.__made++;return c0(b)};URL.revokeObjectURL=(u)=>{window.__freed++;return r0(u)};", scripts: ["shrinkimg.js"] });
C("L", "shrinkimg.js", "with no createImageBitmap (an older iPad) a big photo is still shrunk through the <img> fallback — and every temporary picture address it makes is let go again (item 31), so a panel open all shift does not hold every photo in memory", async () => {
  const h = await open(IP); const p = h.page;
  const r = await p.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const c = document.createElement("canvas"); c.width = 2600; c.height = 1900; const x = c.getContext("2d"); const d = x.createImageData(2600, 1900); let s = 7 + i; for (let k = 0; k < d.data.length; k++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d.data[k] = k % 4 === 3 ? 255 : s & 255; } x.putImageData(d, 0, 0);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95)); const f = new File([b], "p.jpg", { type: "image/jpeg" });
      const before = window.__made;
      const res = await window.LFH_IMG.shrink(f); out.push({ changed: res.changed, made: window.__made - before });
    }
    return { out, made: window.__made, freed: window.__freed };
  });
  await h.close();
  return ok(r.out.every((x) => x.changed && x.made === 1) && r.freed === r.made, JSON.stringify(r));
});

// ── the Back button's own safety net ──────────────────────────────────────────────────────────
const BP = page("l-back", { scripts: ["backstack.js"] });
C("L", "backstack.js", "if the browser never reports the rewind it was asked for, the Back manager recovers by itself after 1.5 s — the next drawer still gets its own Back entry", async () => {
  const h = await open(BP); const p = h.page;
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms));
    const go0 = history.go.bind(history); history.go = () => {};          // a rewind that never lands
    const un = window.LFH_BACK.layer("a", () => {}); await sl(80); un(); await sl(80);
    history.go = go0; const len0 = history.length;
    await sl(1700);
    let closed = 0; window.LFH_BACK.layer("b", () => closed++); await sl(120);
    return { pushed: history.length > len0 || history.state && history.state.__lfhPanelLayer };
  });
  await h.close();
  return ok(r.pushed, JSON.stringify(r));
});
