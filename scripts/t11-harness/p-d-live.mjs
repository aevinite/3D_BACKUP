// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION D — staying live. P180931–P180948.
// Realtime breadcrumbs (fired through the panel's OWN handlers, captured as realtime.js hands them over), the chime,
// the first read going wrong in each way, a blocked device, a lost login, the admin's "viewing as" ribbon, and the
// gentle poll a screen falls back to when realtime.js is missing altogether.
/* global state, load, api -- the kitchen screen's own globals, used only inside functions that run IN THE PAGE (page.evaluate) */
import { open, board, order, item, plat, k, sleep } from "./p-lib.mjs";

const T = (o = {}) => board({ orders: [order("c1", { kot_no: 12, table_number: 7 }), order("c2", { kot_no: 13, table_number: 8 })], items: [item("a1", "c1"), item("b1", "c2")], ...o });
const toasts = () => [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent);
// Count the chime's oscillators (two per chime) — the sound itself cannot be heard in a headless browser.
const spyChime = () => { const o = AudioContext.prototype.createOscillator; window.__osc = 0; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; };

export default async function sectionD() {
  // ── a breadcrumb naming tables: a TARGETED read, merged ──────────────────────────────────────────
  let P = await open({ S: { board: T() } });
  await P.ev(spyChime);
  await P.ev(() => { window.__c2 = document.querySelector('.ticket[data-ticket="c2"]'); });
  P.S.board = T({ orders: [order("c1", { kot_no: 12, table_number: 7 }), order("c2", { kot_no: 13, table_number: 8 }), order("n1", { status: "received", kot_no: 14, table_number: 7 })], items: [item("a1", "c1", { status: "ready" }), item("b1", "c2"), item("n1a", "n1", { status: "received" })], tableTags: { 7: "vip" } });
  const r0 = P.reads(/^\/board$/).length;
  await P.ev(() => window.__rt.handlers.ops({ tables: ["7"] })); await sleep(300);
  const tr = P.reads(/^\/board$/).slice(r0).map((c) => JSON.stringify(c.query));
  const tg = await P.ev(() => ({ n1: !!document.querySelector('.ticket[data-ticket="n1"]'), c1lane: document.querySelector('.ticket[data-ticket="c1"]').parentElement.id, c2same: window.__c2 === document.querySelector('.ticket[data-ticket="c2"]'), vip: !!document.querySelector('.ticket[data-ticket="c1"] .ttag'), osc: window.__osc }));
  const targeted = tr.filter((x) => /table/.test(x));
  k("P180931", "a breadcrumb naming table 7 reads ONLY table 7 (one targeted read, no queue while auto-print is off), merges it in, and leaves table 8's card untouched",
    JSON.stringify(targeted) === '["{\\"table\\":\\"7\\"}"]' && tg.n1 && tg.c1lane === "list-ready" && tg.c2same && tg.vip, JSON.stringify([tr, tg]));
  k("P180932", "a NEW order arriving that way rings the chime (once: two notes)", tg.osc === 2, String(tg.osc));
  P.S.board = T({ orders: [order("c1", { kot_no: 12, table_number: 7 }), order("c2", { kot_no: 13, table_number: 8 }), order("n1", { status: "received", kot_no: 14, table_number: 7 }), order("w1", { kot_no: 15, table_number: 7 }), order("g1", { kot_no: 16, table_number: 7, guest: 1 })], items: [item("a1", "c1"), item("w1a", "w1"), item("g1a", "g1")], tableTags: {} });
  await P.ev(() => window.__rt.handlers.ops({ tables: ["7"] })); await sleep(300);
  const t2 = await P.ev(() => ({ osc: window.__osc, vip: !!document.querySelector('.ticket[data-ticket="c1"] .ttag'), n1: !!document.querySelector('.ticket[data-ticket="n1"]') }));
  k("P180933", "a waiter's own order stays silent, a GUEST's order rings, a ticket already seen does not ring again, and a table mark removed disappears", t2.osc === 4 && !t2.vip && t2.n1, JSON.stringify(t2));
  P.S.slice = () => ({ status: 503, body: { error: "busy", busy: true } });
  const r1 = P.reads(/^\/board$/).filter((c) => c.query.autojobs).length;
  await P.ev(() => window.__rt.handlers.ops({ tables: ["8"] })); await sleep(400);
  k("P180934", "a targeted read that fails falls back to ONE whole-board read (never a silent miss)", P.reads(/^\/board$/).filter((c) => c.query.autojobs).length === r1 + 1);
  P.S.slice = null;
  const r2 = P.reads(/^\/board$/).filter((c) => c.query.autojobs).length;
  await P.ev(() => { window.__rt.handlers.menu(); window.__rt.handlers.menu(); window.__rt.handlers.ops({ full: true }); window.__rt.handlers.ops({}); }); await sleep(4600);
  const full = P.reads(/^\/board$/).filter((c) => c.query.autojobs).length - r2;
  k("P180935", "a burst of breadcrumbs that cannot name a table collapses to at most TWO whole-board reads over four seconds, and at least one (nothing is dropped)", full >= 1 && full <= 2, String(full));
  k("P180936", "the screen keeps its live connection while hidden ONLY when it is the printer", (await P.ev(() => window.__rt.keepAlive())) === false && await P.ev(() => { state.autoPrintKot = true; return window.__rt.keepAlive(); }));
  // the delivery chime, mute, and the events that ask for a fresh read
  P.S.board = T({ platform: [plat("p9", { status: "new" })] });
  await P.ev(() => load()); await sleep(200);
  const pc = await P.ev(() => window.__osc);
  await P.page.click("#muteBtn");
  P.S.board = T({ orders: [order("c1"), order("c2"), order("n7", { status: "received", kot_no: 70 })] });
  await P.ev(() => load()); await sleep(200);
  const muted = await P.ev(() => ({ osc: window.__osc, btn: document.getElementById("muteBtn").textContent, saved: localStorage.getItem("kds_muted") }));
  k("P180937", "a new delivery order rings too; 🔔 → 🔕 mutes (remembered on this device) and a muted screen rings for nothing", pc === 6 && muted.osc === 6 && muted.btn === "🔕" && muted.saved === "1", JSON.stringify([pc, muted]));
  const fullReads = () => P.reads(/^\/board$/).filter((c) => c.query.autojobs).length;
  const after = async (fn) => { const n0 = fullReads(); await P.ev(fn); await sleep(400); return fullReads() - n0; };
  const ev1 = await after(() => window.dispatchEvent(new Event("lfh:stale-refresh")));
  const ev2 = await after(() => window.dispatchEvent(new Event("lfh:outbox-flushed")));
  await P.ev(() => { state.autoPrintKot = false; Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); });
  const ev3 = await after(() => document.dispatchEvent(new Event("visibilitychange")));
  await P.ev(() => { state.autoPrintKot = true; });
  const ev4 = await after(() => document.dispatchEvent(new Event("visibilitychange")));
  k("P180938", "'this was saved data' and 'the queue just drained' each ask for ONE fresh read; coming back to the window asks for one only when this screen is the printer",
    ev1 === 1 && ev2 === 1 && ev3 === 0 && ev4 >= 1 && ev4 <= 2, JSON.stringify([ev1, ev2, ev3, ev4]) + " (the printer's return may add the coalescer's one trailing read — never more)");
  await P.close();

  // ── the first read going wrong ───────────────────────────────────────────────────────────────────
  // (2.2 s: public/panels/netretry.js quietly retries a busy read twice before the screen hears of it.)
  const first = async (ans) => { const Q = await open({ wait: false, S: { boardAnswer: ans } }); await sleep(2200); const t = await Q.ev(toasts); await Q.close(); return t; };
  const busy = await first(() => ({ status: 503, body: { error: "The system is very busy", busy: true }, headers: { "X-LFH-Busy": "1" } }));
  const odd = await first(() => ({ status: 500, body: { error: "Something went wrong at our end." } }));
  const none = await first(() => ({ abort: true }));
  k("P180939", "a first read that fails: a busy server says 'the board will fill in by itself'; any other fault says 'Couldn't load the board'; no signal at all says nothing (the offline bar does)",
    busy.some((x) => /very busy right now — the board will fill in by itself/.test(x)) && odd.some((x) => /^Couldn't load the board — try again\. Something went wrong/.test(x)) && !none.some((x) => /Couldn't load|busy/.test(x)), JSON.stringify([busy, odd, none]));

  // ── a blocked device, a lost login ───────────────────────────────────────────────────────────────
  P = await open({ wait: false, S: { boardAnswer: () => ({ status: 403, body: { error: "This device has been blocked by staff.", reason: "device_blocked", blocked: true } }) } });
  await sleep(700);
  const wall = await P.ev(() => { const w = document.getElementById("lfh-blocked-wall"); return w ? { text: w.innerText.replace(/\s+/g, " "), z: getComputedStyle(w).zIndex, cover: w.getBoundingClientRect().width >= innerWidth } : null; });
  const before = P.S.calls.length;
  const tried = await P.ev(() => api("POST", "/items/a1/status", { status: "ready" }).then(() => "sent", (e) => e.blocked ? "blocked" : e.message));
  await P.ev(() => document.body.appendChild(Object.assign(document.createElement("div"), { id: "late" }))); await sleep(3300);
  const front = await P.ev(() => document.body.lastElementChild.id);
  k("P180940", "a BLOCKED device goes black over everything ('This device has been blocked · Ask a manager to unblock it'), stops talking to the server, and stays in front of anything painted later",
    wall && /This device has been blocked Ask a manager to unblock it/.test(wall.text) && wall.cover && tried === "blocked" && P.S.calls.length === before && front === "lfh-blocked-wall", JSON.stringify([wall, tried, front]));
  await P.close();
  P = await open({ wait: false, S: { boardAnswer: () => ({ status: 401, body: { error: "login" } }) } });
  await sleep(900);
  k("P180941", "a lost login sends the whole screen to /login (never a sign-in form inside the panel)", /\/login$/.test(new URL(P.page.url()).pathname), P.page.url());
  await P.close();

  // ── the admin's "viewing as" ribbon ──────────────────────────────────────────────────────────────
  P = await open({ query: { rid: "R1" }, S: { board: T(), whoami: { higherView: true, actor: "admin" } } });
  await sleep(300);
  const rb = await P.ev(() => { const r = document.getElementById("xrayRibbon"); return r ? { t: r.textContent.replace(/\s+/g, " "), rest: (document.getElementById("xrayRest") || {}).textContent, sim: (document.getElementById("xraySimBtn") || {}).textContent } : null; });
  k("P180942", "the console viewing a kitchen: an amber 'Admin view' ribbon with Dashboard › French House › Kitchen panel, 'nothing is restricted on this screen', 'See actual panel' and 'Exit view'",
    rb && /^Admin view\s*Dashboard\s*›\s*French House\s*›\s*Kitchen panel\s*· nothing is restricted on this screen/.test(rb.t) && /See actual panel/.test(rb.sim) && /Exit view/.test(rb.t), JSON.stringify(rb));
  k("P180943", "every request from that tab carries ?rid= so it never drifts to another restaurant", P.S.calls.length > 0 && P.S.calls.every((c) => c.query.rid === "R1"), JSON.stringify(P.S.calls.map((c) => c.query.rid)));
  await P.page.click("#xraySimBtn"); await P.page.waitForURL(/view=real/, { timeout: 5000 }).catch(() => {});
  const u = new URL(P.page.url());
  k("P180944", "'See actual panel' reloads this tab as the real kitchen screen (?view=real), keeping the restaurant", u.searchParams.get("view") === "real" && u.searchParams.get("rid") === "R1", P.page.url());
  await P.close();
  P = await open({ query: { rid: "R1", view: "real", as: "S7" }, S: { board: T(), whoami: { simulated: true, actor: "admin", asName: "Ravi" } } });
  await sleep(300);
  const sim = await P.ev(() => ({ t: document.getElementById("xrayRibbon").textContent.replace(/\s+/g, " "), b: document.getElementById("xraySimBtn").textContent }));
  const q = P.S.calls.find((c) => c.sub === "/board");
  await P.page.click("#xraySimBtn"); await P.page.waitForURL((x) => !/view=real/.test(x.toString()), { timeout: 5000 }).catch(() => {});
  const back = new URL(P.page.url());
  k("P180945", "viewing a named cook's screen: 'Admin view · as Ravi', every call carries view=real and as=; going back to the full view drops BOTH (the full view is nobody's screen)",
    /^Admin view · as Ravi/.test(sim.t) && /See full admin view/.test(sim.b) && q.query.view === "real" && q.query.as === "S7" && !back.searchParams.has("view") && !back.searchParams.has("as") && back.searchParams.get("rid") === "R1", JSON.stringify([sim, q.query, back.search]));
  await P.close();
  P = await open({ query: { rid: "R1" }, S: { board: T(), whoami: { higherView: true, actor: "admin" } } });
  await sleep(300);
  await P.page.click("#xrayExit"); await sleep(600);
  k("P180946", "'Exit view' first stops acting as the restaurant (act-as cleared), then leaves for the console's restaurant list", P.S.actAs.length === 1 && P.S.actAs[0].clear === true && /\/aevinite\/restaurants$/.test(new URL(P.page.url()).pathname), JSON.stringify([P.S.actAs, P.page.url()]));
  await P.close();
  P = await open({ S: { board: T(), whoami: { higherView: true, actor: "owner" } } });
  await sleep(300);
  k("P180947", "the OWNER looking at the kitchen gets 'Owner view' with the restaurant's plain name — no console crumbs, no actual-panel button; a cook gets no ribbon at all",
    await P.ev(() => { const r = document.getElementById("xrayRibbon"); return !!r && /^Owner view\s*French House/.test(r.textContent.replace(/\s+/g, " ")) && !document.getElementById("xrayHome") && !document.getElementById("xraySimBtn"); }));
  await P.close();

  // ── no realtime.js at all: the gentle poll ───────────────────────────────────────────────────────
  P = await open({ S: { board: T() }, ctx: {}, block: ["/panels/realtime.js"] });
  await sleep(5200);
  const okTimes = P.reads(/^\/board$/).map((c) => c.at);
  P.S.boardAnswer = () => ({ status: 503, body: { error: "busy", busy: true } });
  const t0 = Date.now(); await sleep(13000);
  // A poll that fails is THREE requests close together (public/panels/netretry.js retries a busy read twice), so
  // count POLLS — bursts more than 1.5 s apart — and look at the gaps between them.
  const bursts = []; for (const c of P.reads(/^\/board$/).filter((c) => c.at >= t0)) { if (!bursts.length || c.at - bursts[bursts.length - 1].last > 1500) bursts.push({ first: c.at, last: c.at }); else bursts[bursts.length - 1].last = c.at; }
  const gaps = bursts.slice(1).map((b, i) => b.first - bursts[i].first);
  const okGaps = okTimes.slice(1).map((x, i) => x - okTimes[i]);
  k("P180948", "with no realtime at all the screen polls gently (~every 2 s, with jitter) and BACKS OFF while reads fail — each gap longer than the last, never a fixed fast hammer",
    okTimes.length >= 2 && okTimes.length <= 5 && okGaps.every((g) => g >= 1500) && gaps.length >= 1 && gaps.every((g, i) => g >= 3000 && (i === 0 || g >= gaps[i - 1] * 1.4)), `ok gaps=${okGaps.join(",")} · failing poll gaps=${gaps.join(",")}`);
  await P.close();
}
