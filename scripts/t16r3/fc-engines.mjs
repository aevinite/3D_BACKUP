// Family C — THE SAME BEHAVIOURS IN EVERY BROWSER ENGINE. A waiter's iPhone is WebKit whatever the
// icon says (every iPhone browser is), a manager's laptop may be Firefox, the rest is Chromium. Each
// scenario below runs once per engine against the real file and the stand-in server, and asserts what
// the PERSON gets — never what the code is meant to do. (Item 26 was found here: WebKit cannot write
// WebP.) Firefox: this Mac's Playwright Firefox does not start ("Could not find profile folder", also
// after a forced reinstall, 2026-10-16) — each Firefox run is a visible SKIP that names that, never a
// silent pass. It runs wherever Firefox does.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";
import { firefox } from "playwright";

let FIREFOX = null;
async function firefoxWorks() {
  if (FIREFOX !== null) return FIREFOX;
  try { const b = await firefox.launch(); await b.close(); FIREFOX = true; } catch (e) { FIREFOX = String(e.message).includes("profile folder") ? "this Mac's Playwright Firefox cannot start (Could not find profile folder)" : "Firefox would not start: " + String(e.message).split("\n")[0]; }
  return FIREFOX;
}
function E(subject, what, fn) {
  for (const engine of ["chromium", "webkit", "firefox"]) C("C", subject, `${engine}: ${what}`, async () => {
    if (engine === "firefox") { const w = await firefoxWorks(); if (w !== true) return "skip: " + w; }
    return fn(engine);
  });
}
const PACE = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};";
const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
async function fresh(path, engine, o = {}) {
  const h = await open(path, { engine, ...o });
  await h.page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })).catch(() => {});
  await h.page.reload(); return h;
}

// ── the offline queue ─────────────────────────────────────────────────────────────────────────
// (The no-signal switch is held in sessionStorage so it survives a reload — a reload must not bring the signal back.)
const QP = page("c-queue", { pre: PACE + ONLINE + "if (sessionStorage.getItem('off') === '1') window.__on = false;", body: '<div class="topbar"></div>', scripts: ["outbox.js"] });
E("outbox.js", "a change made with no signal is kept, survives a reload, and is delivered ONCE — with the same action id and marked as a replay — when the signal comes back", async (engine) => {
  setApi(() => ({ status: 200, body: { ok: true } }));
  const h = await fresh(QP, engine); const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => { sessionStorage.setItem("off", "1"); window.__on = false; window.dispatchEvent(new Event("offline")); });
  const r = await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/7/discount", body: { pct: 10 }, table: "7" }));
  const before = log.length;
  await p.reload(); await p.waitForFunction(() => !!window.LFH_OUTBOX);
  // The saved list is read back from the device's store a moment after the page opens.
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length > 0), 3000);
  const kept = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.map((q) => q.label));
  const beforeOnline = log.filter((x) => x.path.includes("/tables/7/discount")).length;
  await p.evaluate(() => { sessionStorage.removeItem("off"); window.__on = true; window.dispatchEvent(new Event("online")); });
  await until(() => log.some((x) => x.path.includes("/tables/7/discount")), 6000);
  await sleep(400);
  const sent = log.filter((x) => x.path.includes("/tables/7/discount"));
  const left = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length);
  await h.close();
  return ok(r && r.queued && before === 0 && beforeOnline === 0 && kept.length === 1 && /^[A-Z]/.test(kept[0]) && sent.length === 1 && sent[0].headers["x-lfh-replay"] === "1" && sent[0].headers["x-lfh-action-id"] === r.action_id && left === 0,
    `queued=${r && r.queued} kept=${JSON.stringify(kept)} sent=${sent.length} replay=${sent[0] && sent[0].headers["x-lfh-replay"]} sameId=${sent[0] && sent[0].headers["x-lfh-action-id"] === r.action_id} left=${left}`);
});
E("outbox.js", "a waiting change the server turns down as a clash is listed as failed in the server's own words, cannot be retried, and can be cleared", async (engine) => {
  setApi(() => ({ status: 503, body: { error: "busy" } }));
  const h = await fresh(QP, engine); const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/3/tag", body: { tag: "vip" }, table: "3" }));
  setApi(() => ({ status: 409, body: { error: "clash_changed_elsewhere", clash: { plain: "Someone else changed this table a moment ago.", todo: "Look at the table and do it again if it's still needed.", retryable: false } } }));   // lib/clash.ts: retryable is always sent
  await p.evaluate(() => window.LFH_OUTBOX.flush());
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length === 1), 5000);
  const f = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed[0]);
  await p.evaluate((id) => window.LFH_OUTBOX.dismiss && window.LFH_OUTBOX.dismiss(id), f && f.id);
  const after = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length);
  await h.close();
  return ok(f && /Someone else changed this table/.test(f.error || f.reason || "") && f.retryable === false && after === 0, JSON.stringify({ f: f && { error: f.error, reason: f.reason, retryable: f.retryable }, after }));
});

// ── the crash reporter, against the engine's OWN failure wording ─────────────────────────────
const EP = page("c-err", { pre: ONLINE, scripts: ["errlog.js", "offline.js"], body: '<div class="topbar"></div>' });
E("errlog.js + offline.js", "a REAL dropped connection (the engine's own wording) files no crash row, and the panels' no-internet test recognises that same error", async (engine) => {
  setApi((r) => (r.path.startsWith("/api/drop") ? "drop" : { status: 204, body: "" }));
  const h = await open(EP, { engine }); const p = h.page;
  const msg = await p.evaluate(async () => { try { await fetch("/api/drop"); return "no error"; } catch (e) { window.__e = e; return e.name + ": " + e.message; } });
  await p.evaluate(() => { Promise.reject(window.__e); });
  await sleep(700);
  const filed = log.filter((x) => x.path === "/api/log/client-error" && /error/.test(x.body) && !/"kind":"taps"/.test(x.body));
  const offline = await p.evaluate(() => window.LFH_OFF.isOfflineErr(window.__e));
  await h.close();
  return ok(!filed.length && offline, `engine said "${msg}" · rows filed: ${filed.length} · seen as no-internet: ${offline}`);
});
const THROWP = page("c-throw", { pre: ONLINE, scripts: ["errlog.js"], after: "setTimeout(function boom(){ null.x; }, 50);" });
E("errlog.js", "a real crash of ours files exactly one row, in words, naming where it broke", async (engine) => {
  setApi(() => ({ status: 204, body: "" }));
  const h = await open(THROWP, { engine });
  await until(() => log.some((x) => x.path === "/api/log/client-error"), 3000); await sleep(300);
  const rows = log.filter((x) => x.path === "/api/log/client-error").map((x) => { try { return JSON.parse(x.body); } catch { return {}; } }).filter((x) => x.kind === "error");
  await h.close();
  return ok(rows.length === 1 && rows[0].message && rows[0].message.length > 5 && rows[0].where, JSON.stringify(rows));
});

// ── the read helper ───────────────────────────────────────────────────────────────────────────
const NP = page("c-net", { scripts: ["netretry.js"] });
E("netretry.js", "a read that meets a busy server twice is asked again and returns the good answer; a write is sent once only", async (engine) => {
  let n = 0; setApi((r) => (r.method === "GET" ? (++n < 3 ? { status: 503, body: {} } : { status: 200, body: { ok: 1 } }) : { status: 503, body: {} }));
  const h = await open(NP, { engine }); const p = h.page;
  const got = await p.evaluate(async () => { const r = await window.LFH_NET.fetch("/api/x"); const w = await window.LFH_NET.fetch("/api/w", { method: "POST", body: "{}" }); return [r.status, w.status]; });
  const gets = log.filter((x) => x.path === "/api/x").length, posts = log.filter((x) => x.path === "/api/w").length;
  await h.close();
  return ok(got[0] === 200 && gets === 3 && got[1] === 503 && posts === 1, `${JSON.stringify(got)} gets=${gets} posts=${posts}`);
});

// ── the phone's Back button ───────────────────────────────────────────────────────────────────
const BP = page("c-back", { scripts: ["backstack.js"], body: "<p>panel</p>" });
E("backstack.js", "two drawers open: Back closes only the top one; closing the other by its own button rewinds history so the next Back is not swallowed", async (engine) => {
  const h = await open(BP, { engine }); const p = h.page;
  const res = await p.evaluate(async () => {
    const closed = []; const tick = () => new Promise((r) => setTimeout(r, 120));
    const startLen = history.length;
    const un1 = window.LFH_BACK.layer("a", () => closed.push("a"));
    window.LFH_BACK.layer("b", () => closed.push("b"));
    await tick();
    const pushedLen = history.length;
    history.back(); await tick(); await tick();
    const afterBack = closed.slice();
    un1(); await tick(); await tick(); await tick();
    return { startLen, pushedLen, afterBack, closed, state: history.state };
  });
  await h.close();
  return ok(res.pushedLen === res.startLen + 2 && res.afterBack.join() === "b" && res.closed.join() === "b" && !(res.state && res.state.__lfhPanelLayer), JSON.stringify(res));
});

// ── light / dark ──────────────────────────────────────────────────────────────────────────────
const TP = page("c-theme", { scripts: ["theme.js"], body: '<button id="themeToggle"></button>' });
E("theme.js", "a new device starts light; the moon button turns it dark, says what it will do next, and the choice survives a reload", async (engine) => {
  const h = await open(TP, { engine }); const p = h.page;
  await p.evaluate(() => localStorage.clear()); await p.reload();
  const a = await p.evaluate(() => [document.documentElement.dataset.theme, document.getElementById("themeToggle").getAttribute("aria-label")]);
  await p.click("#themeToggle");
  await p.reload();
  const b = await p.evaluate(() => [document.documentElement.dataset.theme, document.getElementById("themeToggle").getAttribute("aria-label")]);
  await h.close();
  return ok(a[0] === "light" && /dark/.test(a[1]) && b[0] === "dark" && /light/.test(b[1]), JSON.stringify({ a, b }));
});

// ── the undo card ─────────────────────────────────────────────────────────────────────────────
const UP = page("c-undo", { scripts: ["undobar.js"] });
E("undobar.js", "the undo card shows, a double-tap on Undo takes it back ONCE, and a card asked for 60 seconds is gone by about five", async (engine) => {
  const h = await open(UP, { engine }); const p = h.page;
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms));
    let undos = 0, exp1 = 0;
    window.LFH_UNDO.show({ message: "Served Paneer Tikka", onUndo: () => { undos++; }, onExpire: () => { exp1++; } });
    await sl(500);
    const shown = document.getElementById("lfh-undobar").classList.contains("show");
    const b = document.querySelector("#lfh-undobar .lfh-undo-btn"); b.click(); b.click();
    await sl(200);
    let exp2 = 0; const t0 = Date.now(); let gone = 0;
    window.LFH_UNDO.show({ message: "Settled table 4", seconds: 60, onExpire: () => { exp2++; gone = Date.now() - t0; } });
    await sl(6000);
    return { shown, undos, exp1, exp2, gone };
  });
  await h.close();
  return ok(r.shown && r.undos === 1 && r.exp1 === 0 && r.exp2 === 1 && r.gone > 4000 && r.gone < 5800, JSON.stringify(r));
});

// ── "there is more this way" ──────────────────────────────────────────────────────────────────
const SP = page("c-swipe", { scripts: ["swipehint.js"], body: '<div id="row" data-swipe-hint style="width:300px;overflow-x:auto;white-space:nowrap">' + Array.from({ length: 12 }, (_, i) => `<span style="display:inline-block;width:90px">Cat ${i}</span>`).join("") + "</div>" });
E("swipehint.js", "a row that scrolls sideways says there is more; scrolled to its end it stops saying so", async (engine) => {
  const h = await open(SP, { engine }); const p = h.page;
  await sleep(200);
  const a = await p.evaluate(() => document.getElementById("row").getAttribute("data-more"));
  await p.evaluate(() => { const r = document.getElementById("row"); r.scrollLeft = r.scrollWidth; r.dispatchEvent(new Event("scroll")); });
  await sleep(250);
  const b = await p.evaluate(() => document.getElementById("row").getAttribute("data-more"));
  await h.close();
  return ok(a && /right|end|after/.test(a) && (!b || !/right|end|after/.test(b)), `start=${a} end=${b}`);
});

// ── the figure shortener (fonts measure differently per engine) ───────────────────────────────
const FP = page("c-fit", { scripts: ["fitnums.js"], body: '<div style="width:40px"><span id="t" class="fit-num" style="display:block;font-size:30px">₹1,23,45,678</span></div><div style="width:40px"><span id="b" class="fit-num bill-amt" style="display:block;font-size:30px">₹1,23,45,678</span></div>' });
E("fitnums.js", "a tile figure too wide for its box is shortened with the exact one on hover; a bill figure in the same box is never rewritten", async (engine) => {
  const h = await open(FP, { engine }); const p = h.page;
  await sleep(200);
  const r = await p.evaluate(() => { window.LFH_FITNUM.scan(); const t = document.getElementById("t"), b = document.getElementById("b"); return { t: t.textContent, tt: t.title, b: b.textContent, bt: b.title, px: parseFloat(getComputedStyle(b).fontSize) }; });
  await h.close();
  return ok(/Cr$/.test(r.t) && r.tt === "₹1,23,45,678" && r.b === "₹1,23,45,678" && r.bt === "₹1,23,45,678" && r.px >= 11, JSON.stringify(r));
});

// ── the offline bar ───────────────────────────────────────────────────────────────────────────
const OP = page("c-off", { pre: ONLINE, scripts: ["offline.js"], body: '<div class="topbar">Top</div><main>board</main>' });
E("offline.js", "losing the signal shows a bar that says Offline in words; getting it back takes the bar away", async (engine) => {
  setApi(() => ({ status: 200, body: {} }));
  const h = await open(OP, { engine }); const p = h.page;
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); });
  await sleep(400);
  const a = await p.evaluate(() => { const b = document.getElementById("lfhOffBar"); return b ? { text: b.textContent.trim().slice(0, 120), shown: !b.hidden && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().height > 0 } : null; });
  await p.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); });
  await sleep(2500);
  const b = await p.evaluate(() => { const x = document.getElementById("lfhOffBar"); return !x || x.hidden || getComputedStyle(x).display === "none" || x.getBoundingClientRect().height === 0 || !/no internet|offline/i.test(x.textContent); });
  await h.close();
  return ok(a && a.shown && /no internet|offline/i.test(a.text) && b, JSON.stringify({ a, goneAfter: b }));
});

// ── the connection pill ───────────────────────────────────────────────────────────────────────
const CP = page("c-conn", { scripts: ["connbadge.js"], body: '<div class="topbar"><div class="top-actions"></div></div>' });
E("connbadge.js", "the connection pill sits in the top bar, is a real button with a spoken name, and a tap opens the Connection panel", async (engine) => {
  const h = await open(CP, { engine }); const p = h.page;
  await sleep(200);
  const a = await p.evaluate(() => { const b = document.getElementById("lfhConnBadge"); return b && { inBar: !!b.closest(".topbar"), tag: b.tagName, name: b.getAttribute("aria-label") || b.title || "" }; });
  await p.click("#lfhConnBadge").catch(() => {});
  await sleep(300);
  const open_ = await p.evaluate(() => !!document.querySelector(".lfh-conn-pop") && getComputedStyle(document.querySelector(".lfh-conn-pop")).display !== "none");
  await h.close();
  return ok(a && a.inBar && a.tag === "BUTTON" && a.name.length > 3 && open_, JSON.stringify({ a, open: open_ }));
});

// ── what the guest menu is asking for ─────────────────────────────────────────────────────────
const GP = page("c-bell", { scripts: ["guestbell.js"], body: '<div class="topbar"><div class="top-actions"></div></div>' });
E("guestbell.js", "with the guest menu ON the bell shows the true waiting count; with it OFF there is no bell at all", async (engine) => {
  const h = await open(GP, { engine }); const p = h.page;
  const r = await p.evaluate(async () => {
    const now = Date.now(); const rows = Array.from({ length: 63 }, (_, i) => ({ id: "c" + i, kind: "call", table: String(1 + (i % 9)), at: now - i * 1000, label: "Table " + (1 + (i % 9)) + " calls a waiter" }));
    window.LFH_BELL.sync({ menuOn: true, rows });
    await new Promise((x) => setTimeout(x, 100));
    const count = window.LFH_BELL.count(), btn = document.querySelector(".topbar button, .lfh-bell, [class*=bell]");
    const btnText = btn ? btn.textContent : null;
    window.LFH_BELL.sync({ menuOn: false, rows });
    await new Promise((x) => setTimeout(x, 100));
    const after = document.querySelector(".lfh-bell, [class*=bell]");
    return { count, btnText, after: after ? after.outerHTML.slice(0, 80) : null };
  });
  await h.close();
  return ok(r.count === 63 && r.btnText && /63/.test(r.btnText) && !r.after, JSON.stringify(r));
});

// ── Report an issue ───────────────────────────────────────────────────────────────────────────
const IP = page("c-issue", { scripts: ["backstack.js", "issue-raise.js"] });
E("issue-raise.js", "Report an issue: Send without a subject is refused in words and sends nothing; with a subject it sends exactly one ticket", async (engine) => {
  const h = await open(IP, { engine }); const p = h.page;
  const r = await p.evaluate(async () => {
    const calls = []; window.LFH_ISSUE.open({ api: async (m, path, body) => { calls.push([m, path, body && body.subject]); return { ok: true }; } });
    await new Promise((x) => setTimeout(x, 100));
    const ov = document.querySelector(".lfhir-ov"); const send = [...ov.querySelectorAll("button")].find((b) => /send/i.test(b.textContent));
    send.click(); await new Promise((x) => setTimeout(x, 200));
    const refused = calls.length, said = ov.textContent;
    const subj = ov.querySelector("input[type=text], input:not([type]), input[type=search]"); subj.value = "Printer jammed"; subj.dispatchEvent(new Event("input", { bubbles: true }));
    send.click(); send.click(); await new Promise((x) => setTimeout(x, 400));
    return { refused, said: said.slice(0, 300), calls };
  });
  await h.close();
  return ok(r.refused === 0 && /subject|what|describe|title/i.test(r.said) && r.calls.length === 1 && r.calls[0][1] === "/issue" && r.calls[0][2] === "Printer jammed", JSON.stringify(r));
});
