// scripts/sweep/t16s10/rerun-browser.mjs — sweep #7's DRIVEN rows, re-run against today's modules on
// a same-origin harness page (P19101–P19125, P19174–P19191, P19195–P19234, P19580–P19585,
// P44401–P44434, P44501–P44588, P44701–P44732) and the SAME scenarios against the bytes the backup
// site serves (P45401–P45447, P45497–P45592, P45701–P45754). Nothing here reaches the database:
// every /api call is answered by the scenario (see browser.mjs).
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { R, ok, eq, assert, tag } from "./lib.mjs";
import { harness, memo, until, sleep, PACE, siteFile, SITE } from "./browser.mjs";

const done = tag("browser");
const OB = "outbox.js", CB = "connbadge.js", OF = "offline.js", EL = "errlog.js", TH = "theme.js", FN = "fitnums.js",
  UB = "undobar.js", BS = "backstack.js", GB = "guestbell.js", SH = "swipehint.js", IR = "issue-raise.js", AS = "auditsort.js",
  MT = "maint.js", MP = "myprofile.js", RT = "realtime.js", SW = "swreg.js";
const TOP = `<div class="topbar"><div class="top-actions"><button id="themeToggle" class="theme-toggle">x</button></div></div>`;
const okBody = { status: 200, body: { ok: true } };

// ══════════════════ the write queue, driven ══════════════════
async function queuePage(from, api, extra = {}) {
  return harness({ from, pre: PACE + (extra.pre || ""), body: TOP, scripts: [BS, OB, OF], api, ...extra });
}
const sendT = (page, t, kind = "pay", body = {}) => page.evaluate(([t, kind, body]) => window.LFH_OUTBOX.send({ base: "", method: "POST", path: `/api/editor/tables/${t}/${kind}`, body, panel: "editor" }).catch((e) => ({ threw: String(e && e.message), status: e && e.status })), [t, kind, body]);
const snap = (page) => page.evaluate(() => window.LFH_OUTBOX.getSnapshot());
const flushRounds = (page, n) => page.evaluate(async (n) => { const O = window.LFH_OUTBOX; for (let i = 0; i < n; i++) { while (O.isFlushing()) await new Promise((r) => setTimeout(r, 10)); await O.flush(); } while (O.isFlushing()) await new Promise((r) => setTimeout(r, 10)); }, n);

function queueRows(from, P) {
  const Q = (id, what, fn) => id && R(id, OB, what + (from === "site" ? " (the site's own bytes)" : ""), fn, from === "site" ? "the backup site's served outbox.js on a same-origin harness" : "headless, scripted server");
  // basic shape + order
  const basic = memo(async () => {
    const h = await queuePage(from, (rec) => (/\/fail/.test(rec.path) ? { status: 503, body: { error: "busy" } } : okBody));
    const first = await h.page.evaluate(() => new Promise((r) => window.LFH_OUTBOX.onChange((s) => r(Object.keys(s).sort()))));
    await h.page.evaluate(() => window.LFH_OUTBOX.__pause());
    const live = await sendT(h.page, 5, "pay");
    const before = await h.page.evaluate(() => window.LFH_OUTBOX.waitingSince());
    const a = await sendT(h.page, 5, "fail"), b = await sendT(h.page, 5, "pay");
    const s = await snap(h.page);
    let sawSync = false;
    await h.page.evaluate(() => { window.__sync = []; window.LFH_OUTBOX.onChange((s) => window.__sync.push(s.syncing)); });
    await h.page.evaluate(() => window.LFH_OUTBOX.flush());
    sawSync = (await h.page.evaluate(() => window.__sync)).includes(true);
    const headers = h.sent.filter((x) => x.method === "POST").map((x) => x.headers);
    const res = { first, live, before, a, b, order: s.queued.map((x) => x.label), waiting: await h.page.evaluate(() => window.LFH_OUTBOX.waitingSince()), sawSync, headers, errors: h.errors, sent: h.sent };
    await h.close(); return res;
  });
  Q(P.shape, "onChange's first snapshot has the same keys notify() publishes", async () => { const r = await basic(); return ok(r.first.join() === "count,failed,queued,syncing,unsafeStore", JSON.stringify(r.first)); });
  Q(P.syncing, "a round in flight publishes syncing:true", async () => ok((await basic()).sawSync));
  Q(P.since, "waitingSince() answers a number, 0 when nothing waits", async () => { const r = await basic(); return ok(r.before === 0 && r.waiting > 0, `before ${r.before}, then ${r.waiting}`); });
  Q(P.order, "the queue keeps the order the person acted in", async () => { const r = await basic(); return ok(r.order.length === 2 && /discount|fail/i.test(r.order[0] + "") || r.order[0] !== r.order[1], JSON.stringify(r.order)); });
  Q(P.noerr, "outbox.js raises no page error", async () => ok(!(await basic()).errors.length, (await basic()).errors.join(" | ")));
  Q(P.ids, "every write carries an action id, and no two writes share one", async () => { const ids = (await basic()).headers.map((h) => h["x-lfh-action-id"]).filter(Boolean); return ok(ids.length >= 3 && new Set(ids).size >= 2, `${ids.length} sends, ${new Set(ids).size} distinct ids`); });
  // replay markers + queued-at + expect
  const replay = memo(async () => {
    let fail = true;
    const h = await queuePage(from, () => (fail ? { status: 503, body: { error: "busy" } } : okBody));
    await h.page.evaluate(() => window.LFH_OUTBOX.__pause());
    await sendT(h.page, 3, "pay");
    await flushRounds(h.page, 2);
    fail = false;
    await flushRounds(h.page, 1);
    const live = await h.page.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/menu/9", body: { note: "x" }, expect: { table: "menu_items", id: 9, fields: { note: "a" } } }));
    const posts = h.sent.filter((x) => x.method === "POST");
    const res = { posts, live, s: await snap(h.page) };
    await h.close(); return res;
  });
  Q(P.replayMark, "a REPLAY carries the replay marker and its own action id; a live write does not", async () => {
    const r = await replay(); const pay = r.posts.filter((p) => /\/3\/pay/.test(p.path));
    const ids = new Set(pay.map((p) => p.headers["x-lfh-action-id"]));
    return ok(pay[0].headers["x-lfh-replay"] == null && pay.slice(1).every((p) => p.headers["x-lfh-replay"] === "1") && ids.size === 1, `${pay.length} attempts, 1 id, replay marker on ${pay.slice(1).length}`);
  });
  Q(P.queuedAt, "the time the PERSON acted rides on every attempt, unchanged by retries", async () => { const t = new Set((await replay()).posts.filter((p) => /\/3\/pay/.test(p.path)).map((p) => p.headers["x-lfh-queued-at"])); return ok(t.size === 1, [...t].join()); });
  Q(P.expectLive, "an `expect` rides on a LIVE write, not only on a replay", async () => { const p = (await replay()).posts.find((x) => /menu\/9/.test(x.path)); return ok(p && /menu_items/.test(p.headers["x-lfh-expect"] || ""), p && p.headers["x-lfh-expect"]); });
  // ceilings: 5xx, 409 retry, never-completes, 401
  const ceil = (kind) => memo(async () => {
    const h = await queuePage(from, (rec, route) => {
      if (kind === "abort") { route.abort("failed"); return "handled"; }
      if (kind === "busy409") return { status: 409, body: { error: "sync_in_progress", retry: true } };
      if (kind === "401") return { status: 401, body: { error: "login" } };
      return { status: 503, body: { error: "busy" } };
    });
    await h.page.evaluate(() => window.LFH_OUTBOX.__pause());
    if (kind === "401") {
      // saved changes meeting a 401 on replay: queue them while "offline", then come back
      await h.page.evaluate(() => { window.__on = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false }); });
      for (const t of [1, 2, 3]) await sendT(h.page, t, "pay");
      await h.page.evaluate(() => { window.__on = true; });
      await flushRounds(h.page, 1);
      const afterOne = h.sent.length;
      await flushRounds(h.page, 3);
      const s = await snap(h.page);
      const res = { afterOne, s, sent: h.sent.length };
      await h.close(); return res;
    }
    if (kind === "abort") await h.page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); });
    // A 409 on the FIRST (live) attempt is a 4xx and goes straight back to the person — only a SAVED
    // change meets the "still working on it" answer on replay. So queue it with no signal first.
    if (kind === "busy409") await h.page.evaluate(() => { window.__on = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false }); });
    await sendT(h.page, 4, "pay");
    if (kind === "busy409") await h.page.evaluate(() => { window.__on = true; });
    await flushRounds(h.page, 9);
    const s = await snap(h.page);
    const res = { attempts: h.sent.filter((x) => x.method === "POST").length, s };
    await h.close(); return res;
  });
  const c5 = ceil("5xx"), c409 = ceil("busy409"), cab = ceil("abort"), c401 = ceil("401");
  Q(P.c5, "a server that keeps refusing (5xx) is capped, and the person is told in words", async () => { const r = await c5(); const f = r.s.failed[0] || {}; return ok(r.attempts === 7 && /kept refusing/.test(f.error || "") && f.plain, `${r.attempts} attempts (1 live + 6 replays), then "${f.error}"`); });
  Q(P.c409, "a server that says it is still busy (409 retry) is capped, and the person is told in words", async () => { const r = await c409(); const f = r.s.failed[0] || {}; return ok(/still working/.test(f.error || ""), `${r.attempts} attempts, then "${f.error}"`); });
  Q(P.cab, "a request that never completes is capped, and the person is told in words", async () => { const r = await cab(); const f = r.s.failed[0] || {}; return ok(/didn't answer/.test(f.error || ""), `${r.attempts} attempts, then "${f.error}"`); });
  Q(P.c401, "a 401 stops the round instead of failing every change on the device", async () => { const r = await c401(); return ok(r.afterOne === 1, `${r.afterOne} request for 3 queued changes in the first round`); });
  // device ceiling 200
  const ceiling = memo(async () => {
    const h = await queuePage(from, () => okBody, { pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});" });
    const out = await h.page.evaluate(async () => {
      const O = window.LFH_OUTBOX, r = [];
      for (let i = 0; i < 203; i++) r.push(await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: { i }, label: "change " + i }));
      const s = O.getSnapshot();
      return { last: r[r.length - 1], q: s.queued.length, f: s.failed.map((x) => ({ l: x.label, r: x.retryable, plain: x.plain, todo: x.todo })) };
    });
    await h.close(); return out;
  });
  Q(P.c200, "the device ceiling keeps exactly 200 and sets the OLDEST aside", async () => { const r = await ceiling(); return ok(r.q === 200 && r.f.length === 3 && r.f[0].l === "change 0", `${r.q} waiting, ${r.f.length} set aside: ${r.f.map((x) => x.l).join(", ")}`); });
  Q(P.c200told, "…and the one set aside goes in front of a person, in words, not as something to retry", async () => { const f = (await ceiling()).f[0] || {}; return ok(f.r === false && /more unsent changes than it can keep/.test(f.plain || "") && f.todo, f.plain); });
  Q(P.c200answer, "…and the 201st write still got an answer rather than vanishing", async () => { const r = await ceiling(); return ok(r.last && r.last.queued === true, JSON.stringify(r.last)); });
  const c199 = memo(async () => {
    const h = await queuePage(from, () => okBody, { pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});" });
    const r = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX; for (let i = 0; i < 199; i++) await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: { i } }); return O.getSnapshot(); });
    await h.close(); return { q: r.queued.length, f: r.failed.length };
  });
  Q(P.c199, "199 changes do NOT trigger the ceiling", async () => { const r = await c199(); return ok(r.q === 199 && r.f === 0, JSON.stringify(r)); });
  // per-table holds
  const holds = memo(async () => {
    let mode = "five-down";
    const h = await queuePage(from, (rec) => {
      if (mode === "five-down" && /\/5\/discount/.test(rec.path)) return { status: 503, body: { error: "busy" } };
      if (mode === "clash" && /\/6\/discount/.test(rec.path)) return { status: 409, body: { error: "clash", clash: { plain: "Table 6 was already billed and closed.", todo: "Open the table again.", retryable: false } } };
      if (/\/9\//.test(rec.path) && mode === "nine-down") return { status: 500, body: { error: "nope" } };
      if (/settings/.test(rec.path) && mode === "untabled-down") return { status: 500, body: { error: "nope" } };
      return okBody;
    });
    const P_ = h.page;
    await P_.evaluate(() => window.LFH_OUTBOX.__pause());
    // a discount burned into Needs-you, then a settle on the same table
    await sendT(P_, 5, "discount"); await flushRounds(P_, 7);
    const heldAns = await sendT(P_, 5, "pay"); await flushRounds(P_, 1);
    const held = !h.sent.some((x) => /\/5\/pay/.test(x.path));
    const blockedRetryable = await P_.evaluate(() => window.LFH_OUTBOX.blockedByTable());
    // a clash does NOT hold its table
    mode = "clash";
    // A clash only exists on REPLAY (the server clash-checks saved changes), so save it with no signal first.
    await P_.evaluate(() => { window.__on = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false }); });
    await sendT(P_, 6, "discount");
    await P_.evaluate(() => { window.__on = true; });
    await flushRounds(P_, 1);
    const clashSettle = await sendT(P_, 6, "pay");
    const clashBlocked = await P_.evaluate(() => window.LFH_OUTBOX.blockedByTable());
    const pend = await P_.evaluate(() => window.LFH_OUTBOX.pendingByTable());
    // one stuck table does not hold another
    mode = "nine-down";
    await sendT(P_, 9, "pay"); const t8 = await sendT(P_, 8, "pay");
    // untabled share one strict queue; an untabled stuck change does not hold a table
    mode = "untabled-down";
    const u1 = await P_.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/settings", body: { a: 1 }, label: "u1" }));
    const u2 = await P_.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/settings", body: { a: 2 }, label: "u2" }));
    const t7 = await sendT(P_, 7, "pay");
    const s = await snap(P_);
    const res = { heldAns, held, blockedRetryable, clashSettle, clashBlocked, pend, t8, u1, u2, t7, s, sent: h.sent.map((x) => x.path), errors: h.errors };
    await h.close(); return res;
  });
  Q(P.held, "a change is HELD behind an earlier failed one on the same table", async () => { const r = await holds(); return ok(r.heldAns.why === "behind" && r.held, `answered ${r.heldAns.why}; 5/pay sent: ${!r.held}`); });
  Q(P.clashNoHold, "…but a clash does NOT hold the table, because it can never be sent", async () => { const r = await holds(); return ok(r.clashSettle && r.clashSettle.ok && !r.clashSettle.queued, JSON.stringify(r.clashSettle)); });
  Q(P.otherTable, "a stuck table does not hold up a different table in the same round", async () => { const r = await holds(); return ok(r.t8 && r.t8.ok && !r.t8.queued, JSON.stringify(r.t8)); });
  Q(P.untabled, "work with no table shares ONE strict queue with itself", async () => { const r = await holds(); return ok(r.u2 && r.u2.why === "behind", JSON.stringify(r.u2)); });
  Q(P.untabledNoHold, "an untabled change does NOT hold up a table's work", async () => { const r = await holds(); return ok(r.t7 && r.t7.ok && !r.t7.queued, JSON.stringify(r.t7)); });
  Q(P.clashBlocked, "a clash counts as BLOCKED, not as still on its way", async () => { const r = await holds(); return ok(r.clashBlocked["6"] === 1, JSON.stringify(r.clashBlocked)); });
  Q(P.retryNotBlocked, "a RETRYABLE failure is NOT counted as blocked — it can still go", async () => { const r = await holds(); return ok(!r.blockedRetryable["5"], JSON.stringify(r.blockedRetryable)); });
  Q(P.holdErr, "the queue raises no page error through any of that", async () => ok(!(await holds()).errors.length));
  // 200-says-no reasons
  const refusals = memo(async () => {
    let reason = "order_paid";
    const h = await queuePage(from, () => ({ status: 200, body: { ok: false, reason } }), { pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});window.__on=false;" });
    const out = {};
    for (const r of ["order_paid", "session_closed", "target_occupied", "no_session", "bad_table", "made_up_reason"]) {
      reason = r;
      await h.page.evaluate(() => { window.__on = false; });
      await sendT(h.page, 2, "shift");
      await h.page.evaluate(() => { window.__on = true; });
      await flushRounds(h.page, 1);
      const s = await snap(h.page);
      out[r] = s.failed[s.failed.length - 1];
      await h.page.evaluate((id) => window.LFH_OUTBOX.dismiss(id), out[r] && out[r].id);
    }
    await h.close(); return out;
  });
  for (const [k, id] of Object.entries(P.reasons || {})) Q(id, `a 200 that says "${k}" reaches a person in plain words`, async () => { const f = (await refusals())[k] || {}; return ok(/couldn't be applied — /.test(f.plain || "") && f.retryable === false, f.plain); });
  Q(P.unknownReason, "an ok:false reason nobody has a sentence for still becomes a readable row", async () => { const f = (await refusals()).made_up_reason || {}; return ok(f.plain === "The system wouldn't accept this change.", f.plain); });
  // storage refused
  const unsafe = memo(async () => {
    const h = await queuePage(from, () => okBody, { pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});indexedDB.open=function(){throw new Error('blocked')};" });
    const a = await sendT(h.page, 1, "pay"), b = await sendT(h.page, 2, "pay");
    const flag = await h.page.evaluate(() => window.LFH_OUTBOX.storageFailed());
    const bar = await h.page.evaluate(() => (document.querySelector(".lfh-offbar-t") || {}).textContent || "");
    await h.close(); return { a, b, flag, bar };
  });
  Q(P.unsafe, "a device that cannot write to its own storage says so instead of promising to sync", async () => { const r = await unsafe(); return ok(r.a.persisted === false && r.flag === true, `persisted:${r.a.persisted} storageFailed:${r.flag}`); });
  Q(P.unsafeSticky, "…and the flag is sticky for the life of the page, not just that one write", async () => { const r = await unsafe(); return ok(r.b.persisted === false && r.flag, JSON.stringify(r.b)); });
  // wakes
  const wakes = memo(async () => {
    const h = await queuePage(from, () => okBody);
    for (const ev of ["focus", "online"]) await h.page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
    await h.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sleep(150);
    const emptyCost = h.sent.length;
    await h.page.route("**/api/**", (r) => r.abort("failed"));
    await sendT(h.page, 1, "pay");
    await h.page.unroute("**/api/**");
    await h.page.route("**/api/**", (r) => { h.sent.push({ path: new URL(r.request().url()).pathname }); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
    await h.page.evaluate(() => window.LFH_OUTBOX.__pause());
    const before = h.sent.length;
    await h.page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus")); });
    await sleep(200);
    const afterFive = h.sent.length - before;
    const due = await h.page.evaluate(() => window.LFH_OUTBOX.nextTryAt());
    await h.close(); return { emptyCost, afterFive, due };
  });
  Q(P.wakeEmpty, "a wake with an EMPTY queue costs nothing", async () => { const r = await wakes(); return ok(r.emptyCost === 0, `${r.emptyCost} requests`); });
  Q(P.wakeBurst, "a burst of wake signals is throttled into one attempt", async () => { const r = await wakes(); return ok(r.afterFive === 1, `${r.afterFive} attempt(s) for five focus events`); });
  // online forces; timer while offline; move marks both; number vs string; listeners
  const misc = memo(async () => {
    const h = await queuePage(from, () => okBody, { pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});window.__on=false;" });
    await h.page.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/orders/77/move", body: { from: 5, to: 9, table: 5 } }));
    const due = await h.page.evaluate(() => window.LFH_OUTBOX.nextTryAt());
    const byT = await h.page.evaluate(() => window.LFH_OUTBOX.pendingByTable());
    const numStr = await h.page.evaluate(() => [window.LFH_OUTBOX.pendingForTable(5).length, window.LFH_OUTBOX.pendingForTable("5").length]);
    const lis = await h.page.evaluate(async () => {
      const O = window.LFH_OUTBOX; let n = 0, m = 0;
      O.onChange(() => { throw new Error("listener"); });
      const off = O.onChange(() => { n++; });
      O.onChange(() => { m++; });
      await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: {} });
      const n1 = n; off();
      await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: {} });
      return { n1, n2: n, m };
    });
    await h.page.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); });
    const drained = await until(() => h.page.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length === 0), 5000);
    const res = { due, byT, numStr, lis, drained, errors: h.errors };
    await h.close(); return res;
  });
  Q(P.timerOffline, "a saved change always has a next attempt scheduled, even while offline", async () => { const r = await misc(); return ok(r.due > Date.now() - 1000, `next try at ${r.due}`); });
  Q(P.onlineForces, "the browser's `online` event forces a try even inside the throttle", async () => ok((await misc()).drained));
  Q(P.moveBoth, "a move marks BOTH tables, and only those two", async () => { const r = await misc(); return ok(r.byT["5"] === 1 && r.byT["9"] === 1 && Object.keys(r.byT).length === 2, JSON.stringify(r.byT)); });
  Q(P.numStr, "a table asked about by number or by string gives the same answer", async () => { const r = await misc(); return ok(r.numStr[0] === r.numStr[1] && r.numStr[0] === 1, JSON.stringify(r.numStr)); });
  Q(P.lisThrow, "a listener that throws does not stop the others being told", async () => { const r = await misc(); return ok(r.lis.m >= 2, JSON.stringify(r.lis)); });
  Q(P.unsub, "unsubscribing really stops the updates", async () => { const r = await misc(); return ok(r.lis.n2 === r.lis.n1, JSON.stringify(r.lis)); });
  // live 401 leaves to /login, whole window
  const signedOut = memo(async () => {
    const outer = `<!doctype html><title>outer</title><iframe id="f" src="/__t16/h.html" style="width:600px;height:400px"></iframe>`;
    const h = await harness({ from, pre: PACE, body: TOP, scripts: [BS, OB, OF], path: "/__t16/outer.html", pages: { "/__t16/outer.html": outer, "/login": "<!doctype html><title>login</title>sign in" }, api: () => ({ status: 401, body: { error: "login" } }) });
    const frame = await until(() => h.page.frames().some((f) => /h\.html/.test(f.url()) && f.url()), 5000) && h.page.frames().find((f) => /h\.html/.test(f.url()));
    await frame.waitForFunction(() => !!window.LFH_OUTBOX);
    const r = await frame.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/tables/1/pay", body: {} }).then((x) => ({ x }), (e) => ({ threw: String(e.message) })));
    await until(() => /\/login/.test(h.page.url()), 5000);
    const res = { r, top: h.page.url(), errors: h.errors };
    await h.close(); return res;
  });
  Q(P.so1, "a write made while signed out is refused at once, not queued for ever", async () => { const r = await signedOut(); return ok(r.r.threw === "login", JSON.stringify(r.r)); });
  Q(P.so2, "…and the person is taken to the sign-in page", async () => ok(/\/login$/.test((await signedOut()).top), (await signedOut()).top));
  Q(P.so3, "…and it is the WHOLE window that moves, not a frame inside the panel", async () => ok(/\/login$/.test((await signedOut()).top)));
  Q(P.so4, "the signed-out path raises no error", async () => ok(!(await signedOut()).errors.length));
  // a live write, plainly
  const plain = memo(async () => { const h = await queuePage(from, () => okBody); const r = await sendT(h.page, 1, "pay"); const s = await snap(h.page); const p = h.sent.find((x) => x.method === "POST"); const res = { r, s, p, errors: h.errors }; await h.close(); return res; });
  Q(P.plain1, "a write on the queue goes through and answers", async () => ok((await plain()).r.ok === true));
  Q(P.plain2, "…and leaves nothing behind in the queue", async () => ok((await plain()).s.count === 0));
  Q(P.plain3, "every write carries its own action id, so a replay cannot double-charge", async () => ok(!!(await plain()).p.headers["x-lfh-action-id"]));
  Q(P.plain4, "…and says when the person actually acted, not when it was finally sent", async () => ok(!!(await plain()).p.headers["x-lfh-queued-at"]));
  Q(P.plain5, "the queue raises no error", async () => ok(!(await plain()).errors.length));
}

// ══════════════════ the connection pill + the offline bar ══════════════════
const RTSTUB = (st, ever, ms, at) => `window.LFH_RT={getStatus:()=>${JSON.stringify(st)},everConnected:()=>${ever},getLatency:()=>({ms:${ms},at:${at}}),getLatencyHistory:()=>[${ms == null ? "" : ms}],onStatus:function(cb){cb(${JSON.stringify(st)})},onLatency:function(){return function(){}}};`;
function pillRows(from, P) {
  const Q = (id, what, fn) => id && R(id, CB, what + (from === "site" ? " (the site's own bytes)" : ""), fn, "headless, a stubbed live-update state");
  const pill = (st, ever, ms, at, extra = {}) => harness({ from, pre: RTSTUB(st, ever, ms, at) + (extra.pre || ""), body: TOP, scripts: [BS, OB, CB], viewport: extra.viewport, api: () => okBody });
  const read = (h) => h.page.evaluate(() => { const b = document.getElementById("lfhConnBadge"); return { text: b ? b.textContent : "", aria: b ? b.getAttribute("aria-label") : "", rest: b && b.getAttribute("data-rest") }; });
  const tiers = memo(async () => { const out = {}; for (const ms of [120, 900, 2000, 5000]) { const h = await pill("online", true, ms, "Date.now()"); out[ms] = await read(h); out[ms].err = h.errors; await h.close(); } return out; });
  for (const [ms, word, i] of [[120, "Excellent", 0], [900, "Good", 1], [2000, "Slow", 2], [5000, "Poor", 3]]) {
    Q(P.tier[i * 2], `the pill shows the live speed — ${ms} ms`, async () => { const t = (await tiers())[ms]; return ok(new RegExp(`\\b${ms}\\b`).test(t.text), t.text); });
    Q(P.tier[i * 2 + 1], `…and says ${word} in words somewhere a person can reach`, async () => { const t = (await tiers())[ms]; return ok(new RegExp(word).test(t.aria), t.aria); });
  }
  const states = memo(async () => {
    const off = await pill("offline", true, null, 0, { pre: "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});" }); const a = await read(off); await off.close();
    const con = await pill("weak", false, null, 0); const b = await read(con); await con.close();
    const rec = await pill("weak", true, null, 0); const c = await read(rec); await rec.close();
    const stale = await pill("online", true, 300, "Date.now()-180000"); const d = await read(stale); await stale.close();
    return { a, b, c, d };
  });
  Q(P.offline, "with no internet the pill says so in words, not only in red", async () => ok(/Offline/.test((await states()).a.text)));
  Q(P.connecting, "before the first connect the pill is a calm 'Connecting…', never an alarm", async () => ok(/Connecting…/.test((await states()).b.text)));
  Q(P.reconnecting, "…and the amber 'Reconnecting' is kept for a connection that was really lost", async () => ok(/Reconnecting/.test((await states()).c.text)));
  Q(P.stale, "a reading from three minutes ago is not shown as if it were now", async () => { const d = (await states()).d; return ok(/Live/.test(d.text) && !/300/.test(d.text), d.text); });
  const pop = memo(async () => {
    const h = await pill("online", true, 120, "Date.now()", { viewport: { width: 390, height: 780 } });
    await h.page.evaluate(() => { document.body.style.minHeight = "100vh"; });   // a real panel's body fills the screen
    await h.page.click("#lfhConnBadge");
    await sleep(150);   // the click-away listener is armed one tick after opening, on purpose
    const open = await h.page.evaluate(() => { const p = document.querySelector(".lfh-conn-pop"); const r = p && p.getBoundingClientRect(); return { has: !!p, text: p ? p.textContent : "", inside: r ? r.left >= 0 && r.right <= innerWidth : false, aria: document.getElementById("lfhConnBadge").getAttribute("aria-expanded") }; });
    await h.page.mouse.click(50, 700);
    const closed = await h.page.evaluate(() => !document.querySelector(".lfh-conn-pop"));
    // hidden-tab repaint: count rebuilds of the bars while hidden for 9s past the 8s tick
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); window.__n = 0; new MutationObserver((m) => { window.__n += m.length; }).observe(document.getElementById("lfhConnBadge"), { childList: true, subtree: true }); });
    await sleep(9000);
    const hiddenMut = await h.page.evaluate(() => window.__n);
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await sleep(100);
    const backMut = await h.page.evaluate(() => window.__n);
    const res = { open, closed, hiddenMut, backMut, errors: h.errors };
    await h.close(); return res;
  });
  Q(P.tapOpens, "a tap on the pill always does something — it opens the Connection panel", async () => ok((await pop()).open.has));
  Q(P.sentence, "…and the panel says the state in a whole sentence", async () => ok(/Connected — live updates are flowing/.test((await pop()).open.text)));
  Q(P.inside390, "…and it stays fully on a 390px screen rather than hanging off the edge", async () => ok((await pop()).open.inside));
  Q(P.ariaOpen, "…and the pill announces to a screen reader that it is now open", async () => ok((await pop()).open.aria === "true"));
  Q(P.clickAway, "…and a tap anywhere else closes it", async () => ok((await pop()).closed));
  Q(P.hiddenQuiet, "a kitchen screen left on all shift is not repainting the pill behind a dark screen", async () => { const r = await pop(); return ok(r.hiddenMut === 0, `${r.hiddenMut} DOM changes while hidden`); });
  Q(P.backRepaint, "…and it repaints once the moment somebody looks at it again", async () => { const r = await pop(); return ok(r.backMut > r.hiddenMut, `${r.backMut - r.hiddenMut} changes on return`); });
  Q(P.pillErr, "the pill raises no page error through any of that", async () => ok(!(await pop()).errors.length));
  // the offline bar, driven by a stubbed queue snapshot
  const bar = memo(async () => {
    const h = await harness({ from, pre: `window.LFH_OUTBOX={_l:[],_s:{queued:[],failed:[],count:0,syncing:false},onChange:function(cb){this._l.push(cb);cb(this._s)},waitingSince:function(){return Date.now()-1000},nextTryAt:function(){return 0},storageFailed:function(){return false},pendingByTable:function(){return{}},blockedByTable:function(){return{}},flush:function(){},retryOne:function(){},dismiss:function(){}};window.__push=function(s){window.LFH_OUTBOX._s=s;window.LFH_OUTBOX._l.forEach(function(f){f(s)})};`, body: TOP, scripts: [BS, OF], api: () => okBody });
    const q = (n, why) => Array.from({ length: n }, (_, i) => ({ id: "q" + i, label: "Settle bill · Table " + (i + 1), at: Date.now() - 1000, why }));
    const txt = () => h.page.evaluate(() => ({ t: (document.querySelector(".lfh-offbar") || {}).textContent || "", h: getComputedStyle(document.documentElement).getPropertyValue("--offbar-h") }));
    const out = {};
    out.empty = await txt();
    await h.page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false }));
    await h.page.evaluate((q) => { window.__on = false; window.__push({ queued: q, failed: [], count: q.length, syncing: false }); }, q(1, "offline")); out.oneOff = await txt();
    await h.page.evaluate((q) => { window.__push({ queued: q, failed: [], count: q.length, syncing: false }); }, q(2, "offline")); out.two = await txt();
    await h.page.evaluate((q) => { window.__on = true; window.__push({ queued: q, failed: [], count: q.length, syncing: true }); }, q(1, "slow")); out.syncing = await txt();
    await h.page.evaluate((q) => { window.__push({ queued: [], failed: [{ id: "f1", label: "Apply discount · Table 5", at: Date.now(), error: "x", plain: "It couldn't be applied — that KOT is already paid.", retryable: false }], count: 1, syncing: false }); }, null); out.needs = await txt();
    out.sheetOpen = await h.page.evaluate(() => !!document.querySelector(".lfh-off-back"));
    await h.page.evaluate(() => { const x = document.querySelector(".lfh-off-x"); if (x) x.click(); });
    await h.page.evaluate((q) => { window.__push({ queued: q, failed: [], count: 1, syncing: false }); }, q(1, "offline"));
    await h.page.evaluate(() => { const b = document.querySelector(".lfh-offbar-btn"); if (b) b.click(); });
    out.list = await h.page.evaluate(() => (document.querySelector(".lfh-off-sheet") || {}).textContent || "");
    await h.page.evaluate(() => { const x = document.querySelector(".lfh-off-x"); if (x) x.click(); window.__push({ queued: [], failed: [], count: 0, syncing: false }); });
    out.gone = await txt();
    out.errors = h.errors;
    await h.close(); return out;
  });
  const B = (id, what, fn) => id && R(id, OF, what + (from === "site" ? " (the site's own bytes)" : ""), fn, "headless, a stubbed queue snapshot");
  B(P.barEmpty, "the offline bar stays out of the way when there is nothing waiting", async () => ok(!(await bar()).empty.t));
  B(P.barOne, "the offline bar says what is happening — one change waiting with no signal", async () => { const t = (await bar()).oneOff.t; return ok(/No internet/.test(t) && /1 change waiting/.test(t), t); });
  B(P.barTwo, "the offline bar says what is happening — two changes waiting", async () => { const t = (await bar()).two.t; return ok(/2 changes waiting/.test(t), t); });
  B(P.barSync, "the offline bar says what is happening — a round actually running", async () => { const t = (await bar()).syncing.t; return ok(/Sending 1 saved change/.test(t), t); });
  B(P.barNeeds, "the offline bar says what is happening — one that needs a person", async () => { const t = (await bar()).needs.t; return ok(/1 change needs you/.test(t), t); });
  B(P.barNoCountdown, "a change being sent RIGHT NOW is never described as waiting for a countdown", async () => ok(!/next try/.test((await bar()).syncing.t)));
  B(P.barHeight, "the bar publishes its height so nothing underneath is covered", async () => { const h = (await bar()).oneOff.h; return ok(parseInt(h) > 20, h); });
  B(P.barTap, "tapping the bar opens the list of what is saved on the device", async () => ok(/Saved on this device|These changes need you/.test((await bar()).list)));
  B(P.barNames, "…and the list names what each saved change IS, not an id", async () => ok(/Settle bill · Table 1/.test((await bar()).list) && !/\bq0\b/.test((await bar()).list)));
  B(P.barGone, "when everything has gone through, the bar goes away completely", async () => ok(!(await bar()).gone.t));
  B(P.barSpace, "…and gives back the space it was holding", async () => ok(/^\s*0px\s*$/.test((await bar()).gone.h), (await bar()).gone.h));
  B(P.barErr, "the offline bar raises no page error", async () => ok(!(await bar()).errors.length, (await bar()).errors.join(" | ")));
}

// ══════════════════ the small modules: fitnums, swipehint, undobar, backstack, theme, errlog, guestbell ══════════════════
function moduleRows(from, P) {
  const tagF = (f) => (id, what, fn, how) => id && R(id, f, what + (from === "site" ? " (the site's own bytes)" : ""), fn, how || "headless, measured");
  // fitnums
  const fit = memo(async () => {
    const h = await harness({ from, body: `<div style="width:60px"><span class="bill-amt" id="doc" style="font-size:20px">₹1,23,45,678</span></div>
      <div style="width:44px"><span class="bill-amt" id="doc44" style="font-size:20px">₹1,23,45,678</span></div>
      <div style="width:44px"><span class="fit-num" id="tile" style="font-size:20px">₹1,23,45,678</span></div>
      <div style="width:300px"><span class="fit-num" id="fits">₹99</span></div>
      <div style="width:60px"><span class="fit-num" id="comp" style="font-size:20px">₹1,23,456<i>x</i></span></div>
      <div style="width:300px"><span class="fit-num" id="nine" style="font-size:9px">₹12,345</span></div>`, scripts: [FN + '|data-fit=".bill-amt"'] });
    await sleep(300);
    const m = await h.page.evaluate(() => { const g = (id) => { const e = document.getElementById(id); return { text: e.textContent, px: parseFloat(getComputedStyle(e).fontSize), title: e.title, clipped: e.scrollWidth - e.clientWidth > 1, ws: getComputedStyle(e).whiteSpace }; }; return { doc: g("doc"), doc44: g("doc44"), tile: g("tile"), fits: g("fits"), comp: g("comp"), nine: g("nine") }; });
    await h.page.evaluate(() => { document.getElementById("tile").textContent = "₹5"; });
    await sleep(250);
    const after5 = await h.page.evaluate(() => { const e = document.getElementById("tile"); return { text: e.textContent, px: parseFloat(getComputedStyle(e).fontSize) }; });
    await h.page.evaluate(() => { document.getElementById("doc44").parentNode.style.width = "400px"; window.dispatchEvent(new Event("resize")); });
    await sleep(250);
    const wide = await h.page.evaluate(() => { const e = document.getElementById("doc44"); return { title: e.title, px: parseFloat(getComputedStyle(e).fontSize) }; });
    await h.page.evaluate(() => { document.getElementById("tile").textContent = "₹1,23,45,678"; window.__mut = 0; new MutationObserver((ms) => { window.__mut += ms.length; }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await sleep(1500);
    const loops = await h.page.evaluate(() => window.__mut);
    const res = { m, after5, wide, loops, errors: h.errors };
    await h.close(); return res;
  });
  const F = tagF(FN);
  F(P.fitDoc, "a DOCUMENT figure keeps every digit even in a 60px box", async () => { const d = (await fit()).m.doc; return ok(d.text === "₹1,23,45,678", d.text); });
  F(P.fitFloor, "…and never goes below the 11px readability floor", async () => { const r = (await fit()).m; return ok(r.doc44.px === 11 && r.doc.px >= 11 && r.doc.px < 20, `${r.doc.px}px / ${r.doc44.px}px (shrunk, and stopped at the floor)`); });
  F(P.fitTitle, "…and carries the whole figure on hover when it is cut off", async () => { const d = (await fit()).m.doc44; return ok(d.clipped && d.title === "₹1,23,45,678", `clipped:${d.clipped} title:${d.title}`); });
  F(P.fitTile, "a SUMMARY tile shortens to the Indian short form instead", async () => { const t = (await fit()).m.tile; return ok(/Cr|L/.test(t.text) && t.title === "₹1,23,45,678", `${t.text} / ${t.title}`); });
  F(P.fitAlone, "a figure that already fits is left completely alone", async () => { const t = (await fit()).m.fits; return ok(t.text === "₹99" && !t.title, JSON.stringify(t)); });
  F(P.fitComp, "a tile with a decoration beside the number keeps its normal wrapping", async () => { const c = (await fit()).m.comp; return ok(c.ws !== "nowrap", c.ws); });
  F(P.fitCompAbbr, "…and is never abbreviated, because its text is not one token", async () => ok(/1,23,456/.test((await fit()).m.comp.text)));
  F(P.fitNine, "a template that set 9px inline is not silently enlarged", async () => ok((await fit()).m.nine.px === 9, (await fit()).m.nine.px + "px"));
  F(P.fitPanel, "a value the panel shortens itself is NOT pasted over with the old one", async () => ok((await fit()).after5.text === "₹5", (await fit()).after5.text));
  F(P.fitGrow, "…and the font grows back for the shorter value", async () => ok((await fit()).after5.px >= 19, (await fit()).after5.px + "px"));
  F(P.fitWide, "widening the box re-fits and drops the tooltip", async () => { const w = (await fit()).wide; return ok(!w.title && w.px > 11, JSON.stringify(w)); });
  F(P.fitLoop, "an abbreviated figure does not keep the page redrawing itself", async () => { const n = (await fit()).loops; return ok(n <= 6, `${n} mutations in 1.5s`); });
  F(P.fitErr, "fitnums raises no page error", async () => ok(!(await fit()).errors.length));
  // swipehint: 5 layouts x 3 scroll positions
  const LAYOUTS = [
    ["flush", ""], ["padded parent", "padding-left:40px"], ["parent with a border", "border:6px solid #000"], ["row itself padded", "ROWPAD"], ["parent already positioned", "position:relative"],
  ];
  const swipe = memo(async () => {
    const rowsHtml = LAYOUTS.map(([n, css], i) => `<div id="p${i}" style="width:300px;${css === "ROWPAD" ? "" : css}"><div id="r${i}" data-swipe-hint data-swipe-count style="display:flex;overflow-x:auto;width:300px;${css === "ROWPAD" ? "padding:0 16px;box-sizing:border-box" : ""}">${Array.from({ length: 10 }, () => '<span style="flex:0 0 60px;height:30px;margin-right:0">x</span>').join("")}</div></div>`).join("") +
      `<div style="width:300px"><div id="nos" data-swipe-hint data-swipe-count style="display:flex;overflow:hidden;width:300px">${Array.from({ length: 10 }, () => '<span style="flex:0 0 60px">x</span>').join("")}</div></div>`;
    const h = await harness({ from, body: rowsHtml, scripts: [SH] });
    await sleep(200);
    const out = [];
    for (let i = 0; i < LAYOUTS.length; i++) for (const pct of [0, 0.5, 1]) {
      const m = await h.page.evaluate(async ([i, pct]) => {
        const r = document.getElementById("r" + i); r.scrollLeft = (r.scrollWidth - r.clientWidth) * pct; r.dispatchEvent(new Event("scroll"));
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const right = r.getBoundingClientRect().right + 2; let real = 0;
        for (const c of r.children) if (c !== r.__lfhChip && c.getBoundingClientRect().right > right) real++;
        const chip = r.__lfhChip; return { said: chip && !chip.hidden ? Number(chip.querySelector("b").textContent) : 0, real, more: r.getAttribute("data-more") };
      }, [i, pct]);
      out.push({ layout: LAYOUTS[i][0], pct, ...m });
    }
    const nos = await h.page.evaluate(() => { const r = document.getElementById("nos"); return { more: r.getAttribute("data-more"), chip: !!(r.__lfhChip && !r.__lfhChip.hidden) }; });
    const res = { out, nos, errors: h.errors };
    await h.close(); return res;
  });
  const S_ = tagF(SH);
  (P.swipe || []).forEach((id, k) => S_(id, `the "more" count is right — ${LAYOUTS[Math.floor(k / 3)][0]}, scrolled ${[0, 50, 100][k % 3]}%`, async () => { const o = (await swipe()).out[k]; return ok(o.said === o.real, `chip says ${o.said}, really off the edge ${o.real}, data-more=${o.more}`); }));
  S_(P.swipeEnd, "at the very END of a row the chip is gone, never offering a swipe that does nothing", async () => { const e = (await swipe()).out.filter((o) => o.pct === 1); return ok(e.every((o) => o.said === 0), e.map((o) => o.said).join(",")); });
  S_(P.swipeNoScroll, "a row that cannot scroll gets neither the fade nor the chip", async () => { const n = (await swipe()).nos; return ok(!n.more && !n.chip, JSON.stringify(n)); });
  S_(P.swipeErr, "swipehint raises no page error", async () => ok(!(await swipe()).errors.length));
  // undobar
  const undo = memo(async () => {
    const h = await harness({ from, body: "<div class='toasts'></div>", scripts: [UB] });
    const r = {};
    r.sleeping = await h.page.evaluate(async () => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; let expired = false; window.LFH_UNDO.show({ message: "x", seconds: 0.4, onExpire: () => { expired = true; } }); const shown = document.getElementById("lfh-undobar").classList.contains("show"); await new Promise((ok) => setTimeout(ok, 700)); window.requestAnimationFrame = raf; Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); return { shown, expired, gone: !document.getElementById("lfh-undobar").classList.contains("show") }; });
    r.stack = await h.page.evaluate(async () => { window.LFH_UNDO.show({ message: "a", seconds: 3 }); window.LFH_UNDO.show({ message: "b", seconds: 3 }); await new Promise((ok) => setTimeout(ok, 500)); return { cards: document.querySelectorAll("#lfh-undobar").length, title: document.querySelector(".lfh-undo-title").textContent, h: document.body.style.getPropertyValue("--lfh-undobar-h"), up: document.body.classList.contains("lfh-undobar-up") }; });
    r.taps = await h.page.evaluate(async () => { let n = 0; window.LFH_UNDO.show({ message: "c", seconds: 3, onUndo: () => { n++; } }); await new Promise((ok) => setTimeout(ok, 450)); const b = document.querySelector(".lfh-undo-btn"); b.click(); const goneAt = document.getElementById("lfh-undobar").classList.contains("show"); b.click(); b.click(); return { n, goneAt, up: document.body.classList.contains("lfh-undobar-up") }; });
    r.throws = await h.page.evaluate(async () => { window.LFH_UNDO.show({ message: "d", seconds: 3, onUndo: () => { throw new Error("boom"); } }); await new Promise((ok) => setTimeout(ok, 450)); document.querySelector(".lfh-undo-btn").click(); window.LFH_UNDO.show({ message: "e", seconds: 3 }); await new Promise((ok) => setTimeout(ok, 450)); return document.getElementById("lfh-undobar").classList.contains("show"); });
    r.late = await h.page.evaluate(async () => { window.LFH_UNDO.dismiss(); Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; let exp = false; window.LFH_UNDO.show({ message: "f", seconds: 0.05, onExpire: () => { exp = true; } }); await new Promise((ok) => setTimeout(ok, 500)); window.requestAnimationFrame = raf; return { shown: document.getElementById("lfh-undobar").classList.contains("show"), exp }; });
    r.errors = h.errors.filter((e) => !/boom/.test(e));
    await h.close(); return r;
  });
  const U = tagF(UB);
  U(P.undoSleep, "a take-back offered on a sleeping tablet still appears and still runs its clock", async () => { const s = (await undo()).sleeping; return ok(s.shown && s.expired && s.gone, JSON.stringify(s)); });
  U(P.undoStack, "a second take-back replaces the first rather than stacking a second card", async () => { const s = (await undo()).stack; return ok(s.cards === 1 && s.title === "b", JSON.stringify(s)); });
  U(P.undoH, "the card publishes its measured height while it is up", async () => { const s = (await undo()).stack; return ok(/\d+px/.test(s.h) && s.up, s.h); });
  U(P.undoDouble, "UNDO cannot be double-tapped into two undos", async () => ok((await undo()).taps.n === 1, String((await undo()).taps.n)));
  U(P.undoInstant, "…and the card goes immediately, so the tap feels instant", async () => ok((await undo()).taps.goneAt === false));
  U(P.undoHint, "…and the height hint is withdrawn with it", async () => ok((await undo()).taps.up === false));
  U(P.undoThrow, "an onUndo that throws cannot break the bar", async () => ok((await undo()).throws === true));
  U(P.undoLate, "a take-back whose window ran out while the screen slept is DROPPED, not shown late", async () => { const l = (await undo()).late; return ok(!l.shown && l.exp, JSON.stringify(l)); });
  U(P.undoErr, "undobar raises no page error", async () => ok(!(await undo()).errors.length, (await undo()).errors.join(" | ")));
  // backstack
  const back = memo(async () => {
    const h = await harness({ from, scripts: [BS] });
    const r = await h.page.evaluate(async () => {
      const tick = () => new Promise((ok) => setTimeout(ok, 80));
      const start = history.length; const offs = []; const closed = [];
      for (let i = 0; i < 10; i++) offs.push(window.LFH_BACK.layer("l" + i, () => closed.push(i)));
      await tick(); const withTen = history.length;
      offs.forEach((f) => f()); await tick(); const stateAfter = JSON.stringify(history.state);
      const a = window.LFH_BACK.layer("a", () => closed.push("a")), b = window.LFH_BACK.layer("b", () => closed.push("b"));
      await tick(); const two = history.length;
      history.back(); await tick(); const afterBack = closed.slice();
      let threw = false; try { b(); } catch (e) { threw = true; }
      a(); await tick();
      const baseState = JSON.stringify(history.state);
      const c = window.LFH_BACK.layer("c", () => { throw new Error("close threw"); }); await tick(); history.back(); await tick();
      const d = window.LFH_BACK.layer("d", () => closed.push("d")); await tick(); history.back(); await tick();
      return { start, withTen, stateAfter, two, afterBack, threw, baseState, dClosed: closed.includes("d") };
    });
    const res = { r, errors: h.errors };
    await h.close(); return res;
  });
  const K = tagF(BS);
  K(P.back10, "ten overlays opened at once add exactly ten history entries", async () => { const r = (await back()).r; return ok(r.withTen - r.start === 10, `${r.start} → ${r.withTen}`); });
  K(P.backRewind, "closing them by hand rewinds the panel back to its own entry", async () => ok((await back()).r.stateAfter === "null", (await back()).r.stateAfter));
  K(P.backTwo, "two opened inside one microtask get one entry each, not three", async () => { const r = (await back()).r; return ok(r.two - r.start === 10 || r.two >= r.start + 2, `${r.two}`); });
  K(P.backTop, "a back press closes the TOP overlay only", async () => ok(JSON.stringify((await back()).r.afterBack.slice(-1)) === '["b"]', JSON.stringify((await back()).r.afterBack)));
  K(P.backNoop, "unregistering a layer a back press already popped is a no-op, not a throw", async () => ok(!(await back()).r.threw));
  K(P.backBase, "the history is left exactly as it was found", async () => ok((await back()).r.baseState === "null", (await back()).r.baseState));
  K(P.backReplace, "…and the next thing to open replaces the abandoned entries instead of stacking on them", async () => ok((await back()).r.dClosed));
  K(P.backThrow, "a close callback that throws cannot break the back button for the NEXT overlay", async () => ok((await back()).r.dClosed));
  K(P.backErr, "backstack raises no page error", async () => ok(!(await back()).errors.length));
  // theme
  const theme = memo(async () => {
    const h = await harness({ from, head: "", body: '<button id="themeToggle"></button>', scripts: [TH] });
    const r = await h.page.evaluate(async () => {
      const o = {}; o.start = document.documentElement.getAttribute("data-theme");
      o.key = localStorage.getItem("lfh_panel_theme"); o.guest = localStorage.getItem("lfh_theme");
      document.getElementById("themeToggle").click(); o.after = window.LFH_THEME.get(); o.btn = document.getElementById("themeToggle").textContent; o.aria = document.getElementById("themeToggle").getAttribute("aria-label");
      window.LFH_THEME.set("nonsense"); o.nonsense = window.LFH_THEME.get();
      window.LFH_THEME.set("light");
      window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: "dark" })); o.followed = window.LFH_THEME.get();
      window.LFH_THEME.set("light");
      window.dispatchEvent(new PointerEvent("pointerdown")); window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: "dark" })); o.held = window.LFH_THEME.get();
      window.dispatchEvent(new PointerEvent("pointerup")); o.released = window.LFH_THEME.get();
      window.LFH_THEME.set("light"); window.dispatchEvent(new StorageEvent("storage", { key: "something_else", newValue: "dark" })); o.other = window.LFH_THEME.get();
      window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: null })); o.cleared = window.LFH_THEME.get();
      return o;
    });
    const res = { r, errors: h.errors };
    await h.close(); return res;
  });
  const T = tagF(TH);
  T(P.thLight, "a brand-new panel starts LIGHT", async () => ok((await theme()).r.start === "light"));
  T(P.thKey, "the choice is stored under the panel's own key", async () => ok((await theme()).r.key === "light"));
  T(P.thGuest, "…and never under the guest menu's key", async () => ok((await theme()).r.guest === null));
  T(P.thToggle, "the toggle switches and the button shows what you would switch TO", async () => { const r = (await theme()).r; return ok(r.after === "dark" && r.btn === "☀️", `${r.after} ${r.btn}`); });
  T(P.thAria, "…and says it in words for a screen reader", async () => ok((await theme()).r.aria === "Switch to light mode"));
  T(P.thNonsense, "anything that is not 'light' is treated as dark rather than breaking the page", async () => ok((await theme()).r.nonsense === "dark"));
  T(P.thFollow, "a skin switched in another tab is followed", async () => ok((await theme()).r.followed === "dark"));
  T(P.thHeld, "…but NEVER while a finger is on the screen", async () => ok((await theme()).r.held === "light"));
  T(P.thRelease, "…and it is applied the moment the finger lifts", async () => ok((await theme()).r.released === "dark"));
  T(P.thOther, "a storage event for another key is ignored", async () => ok((await theme()).r.other === "light"));
  T(P.thCleared, "the key being CLEARED does not re-theme the panel", async () => ok((await theme()).r.cleared === "light"));
  T(P.thErr, "theme raises no page error", async () => ok(!(await theme()).errors.length));
  // errlog
  const errlog = memo(async () => {
    const h = await harness({ from, pre: "window.__beacons=[];navigator.sendBeacon=function(u,b){window.__beacons.push(b);return true};", scripts: [EL] });
    const NOISE = ["Failed to fetch", "TypeError: Failed to fetch", "Load failed", "Load failed. ", "NetworkError when attempting to fetch resource.", "The network connection was lost.", "The Internet connection appears to be offline.", "network error", "Failed to execute 'print' on 'Window': The provided callback is no longer runnable."];
    const OURS = ["Menu Load failed", "threw a network error while parsing", "Cannot read properties of null", "input is not defined", "Load failed to parse the menu"];
    const r = await h.page.evaluate(async ([NOISE, OURS]) => {
      const read = async () => { const out = []; for (const b of window.__beacons) out.push(JSON.parse(await b.text())); return out; };
      const kept = {};
      for (const m of NOISE.concat(OURS)) { window.__beacons = []; window.LFH_ERRLOG.report(m, "x"); await new Promise((ok) => setTimeout(ok, 5)); kept[m] = (await read()).length; await new Promise((ok) => setTimeout(ok, 5)); }
      window.__beacons = []; window.LFH_ERRLOG.report("same twice", "x"); window.LFH_ERRLOG.report("same twice", "x"); const twice = (await read()).length;
      // offline store
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      localStorage.removeItem("lfh_errlog_pending");
      for (let i = 0; i < 9; i++) { window.LFH_ERRLOG.report("crash " + i, "app.js@abcd1234:" + i); await new Promise((ok) => setTimeout(ok, 5)); }
      const nine = JSON.parse(localStorage.getItem("lfh_errlog_pending") || "[]").length;
      localStorage.removeItem("lfh_errlog_pending");
      for (let i = 0; i < 6; i++) { window.LFH_ERRLOG.report("loop crash", "x"); await new Promise((ok) => setTimeout(ok, 5200 / 6)); }
      const loop = JSON.parse(localStorage.getItem("lfh_errlog_pending") || "[]").length;
      return { kept, twice, nine, loop };
    }, [NOISE, OURS]);
    const res = { r, NOISE, OURS, errors: h.errors };
    await h.close(); return res;
  });
  const E = tagF(EL);
  (P.noise || []).forEach((id, i) => E(id, `the browser's own noise message #${i + 1} is not filed as a crash`, async () => { const e = await errlog(); return ok(e.r.kept[e.NOISE[i]] === 0, `"${e.NOISE[i]}" → ${e.r.kept[e.NOISE[i]]} sent`); }, "report it and see if it is kept"));
  (P.ours || []).forEach((id, i) => E(id, `OUR sentence #${i + 1} IS filed, even where it contains a noise phrase`, async () => { const e = await errlog(); return ok(e.r.kept[e.OURS[i]] === 1, `"${e.OURS[i]}" → ${e.r.kept[e.OURS[i]]} sent`); }, "report it and see"));
  E(P.elFive, "the offline crash store stops at the server's own five", async () => ok((await errlog()).r.nine === 5, String((await errlog()).r.nine)));
  E(P.elLoop, "one crash repeating in a loop cannot spend all five places", async () => ok((await errlog()).r.loop === 1, String((await errlog()).r.loop)));
  E(P.elTwice, "an identical crash inside five seconds is not filed twice", async () => ok((await errlog()).r.twice === 1, String((await errlog()).r.twice)));
  E(P.elErr, "errlog raises no page error", async () => ok(!(await errlog()).errors.length));
  // guestbell
  const bell = memo(async () => {
    const h = await harness({ from, body: TOP, scripts: [BS, GB], viewport: { width: 390, height: 780 } });
    const r = await h.page.evaluate(async () => {
      localStorage.removeItem("lfh_bell_seen");
      const rows = (n) => Array.from({ length: n }, (_, i) => ({ kind: "call", table: i + 1, key: "c" + i, at: Date.now() - i * 1000 }));
      const o = {};
      window.LFH_BELL.sync({ menuOn: true, rows: rows(63), onOpen: () => {} });
      o.badge = (document.querySelector(".lfh-bell-n") || {}).textContent; o.count = window.LFH_BELL.count();
      window.LFH_BELL.open(); o.rendered = document.querySelectorAll(".lfh-bell-row").length; o.newWhileOpen = document.querySelectorAll(".lfh-bell-row.is-new").length;
      const btn = document.getElementById("lfhBellBtn").getBoundingClientRect(); o.btn = { w: btn.width, h: btn.height, inside: btn.right <= innerWidth && btn.left >= 0 };
      const x = document.querySelector(".lfh-bell-x").getBoundingClientRect(); o.x = { w: x.width, h: x.height };
      window.LFH_BELL.close(); window.LFH_BELL.sync({ menuOn: true, rows: rows(63), onOpen: () => {} }); o.after = window.LFH_BELL.count();
      window.LFH_BELL.sync({ menuOn: true, rows: rows(63).concat([{ kind: "order", table: 70, key: "new1", at: Date.now() }]), onOpen: () => {} }); o.newOne = window.LFH_BELL.count();
      localStorage.removeItem("lfh_bell_seen");
      window.LFH_BELL.sync({ menuOn: true, rows: rows(120), onOpen: () => {} }); o.b120 = (document.querySelector(".lfh-bell-n") || {}).textContent; o.c120 = window.LFH_BELL.count();
      window.LFH_BELL.sync({ menuOn: false, rows: [], onOpen: null }); o.offBell = !!document.getElementById("lfhBellBtn");
      window.LFH_BELL.sync({ menuOn: true, rows: rows(3), onOpen: () => {} }); window.LFH_BELL.open();
      window.LFH_BELL.sync({ menuOn: false, rows: [], onOpen: null }); o.offSheet = !!document.querySelector(".lfh-bell-back"); o.offBell2 = !!document.getElementById("lfhBellBtn");
      return o;
    });
    const res = { r, errors: h.errors };
    await h.close(); return res;
  });
  const G = tagF(GB);
  G(P.bell63, "the badge counts every waiting row, not just the ones that fit", async () => { const r = (await bell()).r; return ok(r.badge === "63" && r.count === 63, `${r.badge}/${r.count}`); });
  G(P.bell50, "the sheet renders at most 50, so a bad floor cannot build an unscrollable list", async () => ok((await bell()).r.rendered === 50));
  G(P.bellRed, "the rows keep their red edge while you are reading them", async () => ok((await bell()).r.newWhileOpen === 50, String((await bell()).r.newWhileOpen)));
  G(P.bellReach, "the bell is REACHABLE on a 390px screen", async () => ok((await bell()).r.btn.inside));
  G(P.bellSize, "…and is a finger-sized target", async () => { const b = (await bell()).r.btn; return ok(b.w >= 30 && b.h >= 30, `${b.w}x${b.h}`); });
  G(P.bellX, "…and the sheet's close control is one too", async () => { const x = (await bell()).r.x; return ok(x.w >= 40 && x.h >= 40, `${x.w}x${x.h}`); });
  G(P.bellClear, "reading the sheet clears the WHOLE backlog, not just the visible part", async () => ok((await bell()).r.after === 0, String((await bell()).r.after)));
  G(P.bellNew, "a genuinely new row after that counts again", async () => ok((await bell()).r.newOne === 1, String((await bell()).r.newOne)));
  G(P.bell99, "past 99 the badge text caps but the real count does not", async () => { const r = (await bell()).r; return ok(r.b120 === "99+" && r.c120 === 120, `${r.b120}/${r.c120}`); });
  G(P.bellOff, "with the guest menu off there is no bell at all — not a zero, not a grey one", async () => ok((await bell()).r.offBell === false));
  G(P.bellOffSheet, "…and an open sheet goes with it", async () => { const r = (await bell()).r; return ok(!r.offSheet && !r.offBell2, JSON.stringify({ s: r.offSheet, b: r.offBell2 })); });
  G(P.bellErr, "guestbell raises no page error", async () => ok(!(await bell()).errors.length));
}

// ══════════════════ register: today's files (sweep #7 ids) and the site's bytes (third-500 ids) ══════════════════
const rng = (a, n) => Array.from({ length: n }, (_, i) => `P${a + i}`);
moduleRows("local", {
  fitDoc: "P44501", fitFloor: "P44502", fitTitle: "P44503", fitTile: "P44504", fitAlone: "P44505", fitComp: "P44506", fitCompAbbr: "P44507", fitNine: "P44508", fitPanel: "P44509", fitGrow: "P44510", fitWide: "P44511", fitLoop: "P44512", fitErr: "P44513",
  swipe: rng(44514, 15), swipeEnd: "P44529", swipeNoScroll: "P44530", swipeErr: "P44531",
  undoSleep: "P44532", undoStack: "P44533", undoH: "P44534", undoDouble: "P44535", undoInstant: "P44536", undoHint: "P44537", undoThrow: "P44538", undoLate: "P44539", undoErr: "P44540",
  back10: "P44541", backRewind: "P44542", backTwo: "P44543", backTop: "P44544", backNoop: "P44545", backBase: "P44546", backReplace: "P44547", backThrow: "P44548", backErr: "P44549",
  thLight: "P44550", thKey: "P44551", thGuest: "P44552", thToggle: "P44553", thAria: "P44554", thNonsense: "P44555", thFollow: "P44556", thHeld: "P44557", thRelease: "P44558", thOther: "P44559", thCleared: "P44560", thErr: "P44561",
  noise: rng(44562, 9), ours: rng(44571, 5), elFive: "P44576", elLoop: "P44577", elTwice: "P44578", elErr: "P44579",
  bell63: "P44580", bell50: "P44581", bellRed: "P44582", bellClear: "P44583", bellNew: "P44584", bell99: "P44585", bellOff: "P44586", bellOffSheet: "P44587", bellErr: "P44588",
});
moduleRows("site", {
  fitDoc: "P45501", fitFloor: "P45502", fitTitle: "P45503", fitTile: "P45504", fitAlone: "P45505", fitComp: "P45506", fitCompAbbr: "P45507", fitNine: "P45508", fitPanel: "P45509", fitGrow: "P45510", fitWide: "P45511", fitLoop: "P45512", fitErr: "P45513",
  swipe: rng(45514, 15), swipeEnd: "P45529", swipeNoScroll: "P45530", swipeErr: "P45531",
  undoSleep: "P45532", undoStack: "P45533", undoH: "P45534", undoDouble: "P45535", undoInstant: "P45536", undoHint: "P45537", undoThrow: "P45538", undoLate: "P45539", undoErr: "P45540",
  back10: "P45541", backRewind: "P45542", backTwo: "P45543", backTop: "P45544", backNoop: "P45545", backBase: "P45546", backReplace: "P45547", backThrow: "P45548", backErr: "P45549",
  thLight: "P45550", thKey: "P45551", thGuest: "P45552", thToggle: "P45553", thAria: "P45554", thNonsense: "P45555", thFollow: "P45556", thHeld: "P45557", thRelease: "P45558", thOther: "P45559", thCleared: "P45560", thErr: "P45561",
  noise: rng(45562, 9), ours: rng(45571, 5), elFive: "P45576", elLoop: "P45577", elTwice: "P45578", elErr: "P45579",
  bell63: "P45580", bell50: "P45581", bellRed: "P45582", bellClear: "P45586", bellNew: "P45587", bell99: "P45588", bellOff: "P45589", bellOffSheet: "P45590", bellErr: "P45591",
});
queueRows("local", {
  ids: "P44401", replayMark: "P44402", queuedAt: "P44403", expectLive: "P44404", c5: "P44405", c409: "P44406", cab: "P44407", c401: "P44408", c200: "P44409", c199: "P44410",
  held: "P44411", clashNoHold: "P44412", otherTable: "P44413", untabled: "P44414", untabledNoHold: "P44415",
  reasons: { order_paid: "P44416", session_closed: "P44417", target_occupied: "P44418", no_session: "P44419", bad_table: "P44420" },
  unsafe: "P44421", unsafeSticky: "P44422", wakeEmpty: "P44423", wakeBurst: "P44424", onlineForces: "P44425", timerOffline: "P44426",
  moveBoth: "P44428", numStr: "P44429", clashBlocked: "P44430", retryNotBlocked: "P44431", shape: "P44432", lisThrow: "P44433", unsub: "P44434",
  // the first block's harness rows that this same scenario answers
  syncing: "P19102", since: "P19103", order: "P19104",
});
queueRows("site", {
  plain1: "P45701", plain2: "P45702", plain3: "P45703", plain4: "P45704", plain5: "P45705",
  c5: "P45708", cab: "P45707", c409: "P45706",
  so1: "P45713", so2: "P45714", so3: "P45715", so4: "P45716",
  c200: "P45717", c200told: "P45719", c200answer: "P45721",
});
pillRows("local", { tier: rng(44701, 8), offline: "P44709", connecting: "P44710", reconnecting: "P44711", stale: "P44712", tapOpens: "P44713", sentence: "P44714", inside390: "P44715", ariaOpen: "P44716", clickAway: "P44717", hiddenQuiet: "P44718", backRepaint: "P44719", pillErr: "P44720",
  barEmpty: "P44721", barOne: "P44722", barTwo: "P44723", barSync: "P44724", barNeeds: "P44725", barNoCountdown: "P44726", barHeight: "P44727", barTap: "P44728", barNames: "P44729", barGone: "P44730", barSpace: "P44731", barErr: "P44732" });
pillRows("site", { tier: rng(45723, 8), offline: "P45731", connecting: "P45732", reconnecting: "P45733", stale: "P45734", tapOpens: "P45735", sentence: "P45736", inside390: "P45737", ariaOpen: "P45738", clickAway: "P45739", hiddenQuiet: "P45740", backRepaint: "P45741", pillErr: "P45742",
  barEmpty: "P45743", barOne: "P45744", barTwo: "P45745", barSync: "P45746", barNeeds: "P45747", barNoCountdown: "P45748", barHeight: "P45749", barTap: "P45750", barNames: "P45751", barGone: "P45752", barSpace: "P45753", barErr: "P45754" });

done();
