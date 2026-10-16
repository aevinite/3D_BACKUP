// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION C — paper. P180912–P180930.
// The 🖨 on a ticket, the automatic queue (claim → print → done), the self-healing net, the 🖨❗ sheet and its badge,
// ☰ → Settings. The print frame's print() is replaced when it is attached (p-lib.mjs), so the paper a cook would get
// is READ, and a printer that refuses can be played on cue.
/* global state -- the kitchen screen's own globals, used only inside functions that run IN THE PAGE (page.evaluate) */
import { open, board, order, item, plat, AGO, k, sleep } from "./p-lib.mjs";

const T = (o = {}) => board({ orders: [order("c1", { kot_no: 12, table_number: 7, allergies: ["nuts"] })], items: [item("a1", "c1", { title: "Naan", qty: 2 })], tableNames: { 7: "Patio" }, platform: [plat("p1")], ...o });
const toasts = () => [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent);
const paper = () => window.__prints.slice();

export default async function sectionC() {
  // ── the 🖨 on a ticket ─────────────────────────────────────────────────────────────────────────
  let P = await open({ S: { board: T() } });
  await P.page.click('[data-reprint="c1"]'); await sleep(500);
  const p1 = await P.ev(paper), t1 = await P.ev(toasts), send1 = P.writes(/^\/print\/send$/)[0];
  k("P180912", "🖨 with no computer named: the screen asks the server first (one plain request, reprint:false), then prints HERE — the paper names the restaurant, KOT #12, the table's own name, the dish, and NO duplicate banner",
    send1 && send1.body.orderId === "c1" && send1.body.reprint === false && p1.length === 1 && /French House/.test(p1[0]) && /KOT #12/.test(p1[0]) && /Patio/.test(p1[0]) && /Naan/i.test(p1[0]) && !/Duplicate/i.test(p1[0]) && t1.includes("Printing KOT #12 · Patio"),
    JSON.stringify([send1 && send1.body, (p1[0] || "").slice(0, 120), t1]));
  await P.page.click('[data-reprint="c1"]'); await sleep(500);
  const p2 = await P.ev(paper), send2 = P.writes(/^\/print\/send$/)[1];
  k("P180913", "the second 🖨 on the same ticket is a DUPLICATE — on the paper, in the request, and in the message — and the screen remembers it across a reload",
    send2.body.reprint === true && /Reprint · Duplicate/i.test(p2[1] || "") && (await P.ev(toasts)).includes("Reprinting (marked DUPLICATE) KOT #12 · Patio") && await P.ev(() => JSON.parse(localStorage.getItem("kds_printed_ids") || "[]").includes("c1")), (p2[1] || "").slice(0, 80));
  await P.page.click('[data-plat-reprint="p1"]'); await sleep(500);
  const pp = (await P.ev(paper))[2] || "";
  k("P180914", "🖨 on a delivery ticket prints its channel and customer where a table would be ('ZOMATO · Ramesh'), asked as aggId", /ZOMATO · Ramesh/i.test(pp) && P.writes(/^\/print\/send$/)[2].body.aggId === "p1" && (await P.ev(toasts)).some((x) => /Printing KOT #900 · ZOMATO · Ramesh/i.test(x)), pp.slice(0, 120));
  P.S.printSend = () => ({ status: 200, body: { queued: true, note: "Sent to POS_80" } });
  await P.page.click('[data-reprint="c1"]'); await sleep(400);
  const q = { n: (await P.ev(paper)).length, t: await P.ev(toasts) };
  P.S.printSend = () => ({ status: 409, body: { error: "That KOT was cancelled — there is nothing to reprint." } });
  await P.page.click('[data-reprint="c1"]'); await sleep(400);
  const rf = { n: (await P.ev(paper)).length, t: await P.ev(toasts) };
  k("P180915", "when a computer owns the slips the 🖨 prints NOTHING here and says where it went; a refusal is shown in words and prints nothing either",
    q.n === 3 && q.t.includes("Sent to POS_80") && rf.n === 3 && rf.t.includes("That KOT was cancelled — there is nothing to reprint."), JSON.stringify([q, rf]));
  P.S.printSend = () => ({ status: 502, body: { error: "bad gateway" } });
  await P.page.click('[data-reprint="c1"]'); await sleep(400);
  P.S.printSend = () => ({ abort: true });
  await P.page.click('[data-reprint="c1"]'); await sleep(400);
  k("P180916", "a server having a bad moment (5xx) or no reply at all does not cost the cook a ticket: it prints HERE", (await P.ev(paper)).length === 5);
  await P.ev(() => { state.orders = []; }); await P.ev(() => document.querySelector('[data-reprint="c1"]').click()); await sleep(200);
  k("P180917", "🖨 on a ticket that just left the board says so instead of printing a stale ticket", (await P.ev(toasts)).includes("That order isn't on the board any more.") && (await P.ev(paper)).length === 5);
  await P.close();

  // ── a printer that refuses ─────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  await P.ev(() => { window.__printMode = "throw"; });
  await P.page.click('[data-reprint="c1"]'); await sleep(900);
  await P.page.click('[data-reprint="c1"]'); await sleep(900);
  const tr = { t: await P.ev(toasts), ev: P.writes(/^\/printer-events$/).map((c) => c.body.kind), log: P.S.errlog.map((e) => JSON.stringify(e)).join(" "), ids: await P.ev(() => JSON.parse(localStorage.getItem("kds_printed_ids") || "[]")) };
  k("P180918", "a print call that fails AFTER the 'Printing…' message is not silent: the ticket is un-recorded (the next 🖨 is not a false duplicate), the manager is told ONCE (auto_fail), the cook is told once a minute, and it is in the error log",
    tr.ev.filter((x) => x === "auto_fail").length === 1 && tr.t.filter((x) => /aren't printing/.test(x)).length === 1 && /KOT print failed/.test(tr.log) && !tr.ids.includes("c1") && P.writes(/^\/print\/send$/).every((c) => c.body.reprint === false), JSON.stringify(tr).slice(0, 220));
  await P.close();

  // ── the automatic queue ────────────────────────────────────────────────────────────────────────
  const JOB = (id, o = {}) => ({ id, order: order("c1", { kot_no: 12, table_number: 7 }), items: [item("a1", "c1", { title: "Naan" })], reprint: false, attempts: 0, ...o });
  P = await open({ S: { board: T({ autoPrintKot: true, printJobs: [JOB("j1"), JOB("j2", { order: order("c2", { kot_no: 13 }), items: [] })] }) } });
  await sleep(1200);
  const auto = { claim: P.writes(/^\/print-jobs\/claim$/).map((c) => c.body.ids.join()), paper: await P.ev(paper), done: P.writes(/^\/print-jobs\/j\d\/done$/).map((c) => c.sub + ":" + c.body.ok) };
  k("P180919", "a screen that is the printer claims the queued tickets in ONE request, prints each (no duplicate banner on a first try), and reports each done",
    JSON.stringify(auto.claim) === '["j1,j2"]' && auto.paper.length === 2 && !/Duplicate/i.test(auto.paper.join()) && JSON.stringify(auto.done.sort()) === '["/print-jobs/j1/done:true","/print-jobs/j2/done:true"]', JSON.stringify(auto).slice(0, 220));
  await P.setBoard(T({ autoPrintKot: true, printJobs: [JOB("j1"), JOB("j2")] })); await sleep(600);
  k("P180920", "the same jobs riding later board reads are asked for again but never printed twice (the server's claim makes it exactly once)", (await P.ev(paper)).length === 2, String((await P.ev(paper)).length));
  await P.close();
  P = await open({ S: { board: T({ autoPrintKot: true, printJobs: [JOB("j1"), JOB("j3", { attempts: 2 })] }), claim: (ids) => ids.filter((x) => x === "j3") } });
  await sleep(900);
  const lost = { paper: await P.ev(paper), done: P.writes(/\/done$/).map((c) => c.sub) };
  k("P180921", "a job another screen won is never printed here; a RETRY (attempts > 0) is printed with the duplicate banner", lost.paper.length === 1 && /Reprint · Duplicate/i.test(lost.paper[0]) && JSON.stringify(lost.done) === '["/print-jobs/j3/done"]', JSON.stringify(lost.done));
  await P.close();
  let claims = 0, failing = true;
  P = await open({ S: { board: T({ autoPrintKot: true, printJobs: [JOB("j1")] }), claim: (ids) => (++claims, failing ? { status: 500, body: { error: "x" } } : ids) } });
  await sleep(700); const firstPaper = (await P.ev(paper)).length, failedClaims = claims; failing = false;
  await P.setBoard(T({ autoPrintKot: true, printJobs: [JOB("j1")] })); await sleep(900);
  k("P180922", "a claim that fails prints nothing and is tried again on the next board read (the job is not stuck 'in flight') — and once won it prints exactly once", firstPaper === 0 && failedClaims >= 1 && (await P.ev(paper)).length === 1 && claims > failedClaims, `claims=${failedClaims}→${claims} paper=${firstPaper}`);
  await P.ev(() => { window.__printMode = "throw"; });
  await P.setBoard(T({ autoPrintKot: true, printJobs: [JOB("j7")] })); await sleep(1200);
  const jd = P.writes(/^\/print-jobs\/j7\/done$/)[0];
  k("P180923", "a queued ticket whose print fails is reported done { ok: false } with the reason, so the server requeues it", jd && jd.body.ok === false && /print call failed/.test(jd.body.error || ""), JSON.stringify(jd && jd.body));
  await P.close();

  // ── the self-healing net ───────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T({ autoPrintKot: true, orders: [order("c1", { created_at: AGO(9e5) })], queuedFor: [] }) } });
  await sleep(300); const seeded = (await P.ev(paper)).length;
  await P.setBoard(T({ autoPrintKot: true, queuedFor: ["q1"], orders: [order("c1", { created_at: AGO(9e5) }), order("n9", { status: "received", created_at: AGO(30000), kot_no: 31 }), order("n8", { created_at: AGO(5000), kot_no: 32 }), order("q1", { created_at: AGO(60000), kot_no: 33 }), order("s9", { status: "served", created_at: AGO(60000), kot_no: 34 }), order("z9", { created_at: "garbage", kot_no: 35 })] }));
  await sleep(900); const net = await P.ev(paper);
  k("P180924", "the net: on opening, tickets already on the board are NOT retro-printed; later it prints only a live ticket with no queue row that is over 20 s old — never a fresh one, a queued one, a served one or an undateable one",
    seeded === 0 && net.length === 1 && /KOT #31/.test(net[0]), JSON.stringify([seeded, net.map((x) => (x.match(/KOT #\d+/) || [])[0])]));
  await P.setBoard(T({ autoPrintKot: true, queuedFor: null, orders: [order("m1", { created_at: AGO(60000), kot_no: 40 })] })); await sleep(500);
  await P.setBoard(T({ autoPrintKot: false, queuedFor: [], orders: [order("m2", { created_at: AGO(60000), kot_no: 41 })] })); await sleep(500);
  k("P180925", "the net stands down when the server does not say what is queued (an older server), and whenever auto-print is off", (await P.ev(paper)).length === 1);
  await P.close();

  // ── 🖨❗ the printer sheet and its badge ────────────────────────────────────────────────────────
  P = await open({ S: { board: T({ autoPrintKot: true, station: { mine: true, active: { label: "Kitchen screen" } }, waiting: { n: 12, oldestMs: 5 * 60000 } }) } });
  const badge = await P.ev(() => { const b = document.getElementById("printerBtn"); return [(b.querySelector(".prbadge") || {}).textContent, b.title, b.dataset.stuck]; });
  await P.page.click("#printerBtn");
  const sheet = await P.ev(() => document.querySelector("#prSheet .prsheet-status").innerText.replace(/\s+/g, " "));
  k("P180926", "12 tickets stuck for 5 min: the 🖨❗ button wears '12' and says the whole sentence; the sheet reads ON · this screen · THIS screen · '12 tickets — oldest 5 min ago' and tells the cook to cook from the screen",
    badge[0] === "12" && /12 kitchen tickets waiting to print, oldest 5 min ago/.test(badge[1]) && /Automatic printing ON/.test(sheet) && /Tickets print on this screen/.test(sheet) && /Printing right now THIS screen/.test(sheet) && /12 tickets — oldest 5 min ago/.test(sheet) && /read the orders off this screen/.test(sheet), JSON.stringify([badge, sheet.slice(0, 200)]));
  await P.setBoard(T({ autoPrintKot: true, station: { mine: false, active: { label: "Counter PC", claimed_by: "Ravi" }, stale: true }, waiting: { n: 150, oldestMs: 3 * 86400000 } })); await sleep(200);
  const live = await P.ev(() => [document.querySelector("#prSheet .prsheet-status").innerText.replace(/\s+/g, " "), document.querySelector("#printerBtn .prbadge").textContent]);
  k("P180927", "an OPEN sheet stays truthful when the board changes under it: another screen gone quiet, '150 tickets — oldest 3d ago', the badge capped at 99+", /Counter PC \(gone quiet\)/.test(live[0]) && /150 tickets — oldest 3d ago/.test(live[0]) && live[1] === "99+", JSON.stringify(live));
  const rows = [];
  for (const [b, re] of [
    [{ helper: { owned: true, printer: "POS_80", agent: "Shop's PC", connected: false, secondsAgo: 600 } }, /POS_80 — from Shop's PC[\s\S]*Shop's PC — asleep[\s\S]*not been heard from for 10 min/],
    [{ printRefused: "paused" }, /nobody right now — printing is stopped/],
    [{ printRefused: "other_person" }, /one named person's screen — not this one/],
    [{ printRefused: "off" }, /kitchen slips are switched off/],
    [{ kotPrintTarget: "counter" }, /the counter screen — not this one[\s\S]*tickets come out at the counter/],
    [{ autoPrintKot: false, waiting: { n: 0 } }, /Automatic printing OFF[\s\S]*none — everything has printed[\s\S]*Nothing prints by itself yet/],
  ]) { await P.setBoard(T(b)); await sleep(120); const t = await P.ev(() => document.querySelector("#prSheet .prsheet-status").innerText.replace(/\s+/g, " ")); if (!re.test(t)) rows.push(t.slice(0, 120)); }
  k("P180928", "the sheet names where paper comes out in every case: a computer (and that it is asleep, for how long), stopped, a named person, switched off, the counter, auto-print off", rows.length === 0, rows.join(" | "));
  const noBadge = await P.ev(() => !document.querySelector("#printerBtn .prbadge") && !document.getElementById("printerBtn").dataset.stuck);
  await P.page.click('[data-prkind="paper_out"]'); await sleep(300);
  const rep = { w: P.writes(/^\/printer-events$/).map((c) => c.body.kind), t: await P.ev(toasts), open: await P.ev(() => !!document.getElementById("prSheet")) };
  k("P180929", "nothing waiting → no badge; 'Paper roll finished' sends one report (paper_out), tells the cook 'The manager has been told ✓' and closes the sheet",
    noBadge && JSON.stringify(rep.w) === '["paper_out"]' && rep.t.includes("The manager has been told ✓") && !rep.open, JSON.stringify(rep));
  P.S.answer = () => ({ status: 400, body: { error: "invalid problem kind" } });
  await P.page.click("#printerBtn"); await P.page.click('[data-prkind="jam"]'); await sleep(300);
  const rep2 = await P.ev(() => [[...document.querySelectorAll("[data-prkind]")].every((b) => !b.disabled), [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent).pop()]);
  await P.page.click("[data-prsettings]"); await sleep(100);
  k("P180930", "a report the server refuses leaves the sheet open with its buttons usable and says 'Couldn't send that — try again'; 'Where printing stands' opens ⚙️ Settings",
    rep2[0] === true && /Couldn't send that — try again\. invalid problem kind/.test(rep2[1]) && await P.ev(() => !document.getElementById("prSheet") && !!document.querySelector(".kset-ov")), JSON.stringify(rep2));
  await P.close();
}
