// Family A — RANDOM SEQUENCES against the offline queue (outbox.js), model-based.
//
// Each check is one seed: 14–26 random steps drawn from — make a change on a random table · lose /
// regain the signal · RELOAD the page mid-flight · flip how the server answers ONE table (fine / busy
// 503 / refuses 400 / a clash 409 / a 200 that says ok:false / the connection drops / slow) · a wake
// (focus, online) · let time pass. Then the server is made healthy, the person taps "Try again" on
// whatever can be retried, and these must ALL hold:
//   1. NOTHING IS LOST — every change was delivered, is listed as failed, or was refused to the
//      person's face (a live 4xx thrown to the screen).
//   2. ONE CHANGE, ONE ACTION ID — every time a change reaches the server it carries the SAME id, and a
//      repeat is marked as a replay. The queue is at-least-once BY DESIGN: a reload can resend a change
//      whose first answer never came back, and every route it writes to runs a given id at most once
//      (lib/idempotency.ts, withIdempotency on editor / kitchen / tablet / inventory / panel-profile).
//      Two different ids for one change would defeat that — that is the fault this rule catches. (The
//      first full 200-seed run counted 9 seeds where one id was accepted twice, each after a reload or a
//      slow answer in flight: the designed case, not a double charge.)
//   3. ORDER PER TABLE — on every table, accepted changes arrive in the order they were made.
//   4. EVERYTHING LISTED READS AS WORDS — no id, no raw path in any label.
//   5. THE PAGE NEVER THROWS, and the queue is settled (nothing left waiting).
import { C, rng } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";

const PACE = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};";
const PAGE = page("queue", {
  pre: PACE + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});",
  body: '<div class="topbar"></div>', scripts: ["outbox.js"],
  after: "window.__out = window.__out || [];",
});
const MODES = ["ok", "ok", "ok", "busy", "refuse", "clash", "okfalse", "drop", "slow"];
const KINDS = ["discount", "pay", "tag", "order"];

async function runSeed(seed) {
  const R = rng(seed * 7919 + 13);
  const mode = {};                         // table → how the server answers it
  const accepted = new Map();              // action id → count of 2xx
  const idsOf = new Map();                 // change seq → the action ids it was sent with
  const badRepeat = [];                    // a second delivery that was not marked a replay
  const firstOk = [];                      // [table, seq] in arrival order of first acceptance
  setApi((req) => {
    const m = req.path.match(/\/tables\/(\d+)\//); const t = m ? m[1] : "0";
    const aid = req.headers["x-lfh-action-id"] || "";
    let seq = null; try { seq = JSON.parse(req.body || "{}").seq; } catch {}
    const md = mode[t] || "ok";
    if (seq != null) { const set = idsOf.get(seq) || new Set(); set.add(aid); idsOf.set(seq, set); }
    const okAns = () => { const n = (accepted.get(aid) || 0) + 1; accepted.set(aid, n); if (n === 1) firstOk.push([t, seq]); else if (req.headers["x-lfh-replay"] !== "1") badRepeat.push(seq); return { status: 200, body: { ok: true } }; };
    if (md === "ok") return okAns();
    if (md === "slow") return { ...okAns(), delayMs: 250 };
    if (md === "busy") return { status: 503, body: { error: "busy" } };
    if (md === "refuse") return { status: 400, body: { error: "That value isn't allowed." } };
    if (md === "clash") return { status: 409, body: { error: "Someone else changed this", clash: { plain: "Someone else changed this table a moment ago.", todo: "Look at the table and do it again if it's still needed.", retryable: false } } };   // the real shape (lib/clash.ts)
    if (md === "okfalse") return { status: 200, body: { ok: false, reason: "order_paid" } };
    if (md === "drop") return "drop";
    return okAns();
  });
  // (NOT an init script: those run on every load, reloads included, and wiped the queue mid-sequence —
  // the first run of this family reported that as "lost". The store is cleared once, below.)
  const h = await open(PAGE);
  const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await p.reload(); await p.waitForFunction(() => !!window.LFH_OUTBOX);
  const sends = [];                        // { seq, table, outcome }
  let seq = 0;
  const steps = R.int(14, 26), trace = [];
  for (let s = 0; s < steps; s++) {
    const roll = R.next();
    if (roll < 0.45) {
      const t = String(R.int(1, 4)), k = R.pick(KINDS); seq++;
      trace.push(`send T${t}#${seq}`);
      const out = await p.evaluate(async ([t, k, seq]) => {
        try { const r = await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: `/tables/${t}/${k}`, body: { seq }, table: t }); return { kind: r && r.queued ? "queued" : r && r.ok === false ? "refused-in-body" : "sent", aid: r && r.action_id }; }
        catch (e) { return { kind: "thrown", status: e.status || 0 }; }
      }, [t, k, seq]).catch(() => ({ kind: "page-gone" }));
      sends.push({ seq, table: t, outcome: out });
    } else if (roll < 0.57) { const off = R.bool(); trace.push(off ? "offline" : "online"); await p.evaluate((off) => { window.__on = !off; window.dispatchEvent(new Event(off ? "offline" : "online")); }, off); }
    else if (roll < 0.72) { const t = String(R.int(1, 4)), md = R.pick(MODES); mode[t] = md; trace.push(`T${t}=${md}`); }
    else if (roll < 0.80) { trace.push("reload"); await p.reload().catch(() => {}); await p.waitForFunction(() => !!window.LFH_OUTBOX).catch(() => {}); }
    else if (roll < 0.90) { trace.push("wake"); await p.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); }).catch(() => {}); }
    else { const ms = R.int(20, 400); trace.push(`wait${ms}`); await sleep(ms); }
    if (process.env.R3_TRACE) console.log(trace[trace.length - 1].padEnd(14), JSON.stringify(await p.evaluate(() => { const x = window.LFH_OUTBOX.getSnapshot(); return { q: x.queued.map((y) => y.body && y.body.seq), f: x.failed.map((y) => y.body && y.body.seq) }; }).catch(() => "gone")));
  }
  // ── settle: the server is healthy, the device online, and the person taps Try again ──
  for (const t of Object.keys(mode)) mode[t] = "ok";
  await p.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); });
  await until(async () => {
    const s = await p.evaluate(() => { const x = window.LFH_OUTBOX.getSnapshot(); if (x.failed.some((f) => f.retryable !== false)) window.LFH_OUTBOX.retryFailed(); else window.LFH_OUTBOX.flush(); return x.queued.length + x.failed.filter((f) => f.retryable !== false).length; });
    return s === 0;
  }, 12000, 150);
  const snap = await p.evaluate(() => { const x = window.LFH_OUTBOX.getSnapshot(); return { queued: x.queued.map((q) => ({ id: q.id, label: q.label, seq: q.body && q.body.seq })), failed: x.failed.map((q) => ({ id: q.id, label: q.label, seq: q.body && q.body.seq, retryable: q.retryable })) }; });
  const errors = h.errors.slice();
  await h.close();
  // ── the five rules ──
  const okSeqs = new Set(firstOk.map(([, s]) => s)), failedSeqs = new Set(snap.failed.map((f) => f.seq)), queuedSeqs = new Set(snap.queued.map((f) => f.seq));
  // A live answer the screen is handed to show — a thrown 4xx, or a 200 whose body says ok:false — is
  // "told to the person", not lost (each panel's api() caller checks r.ok). Anything else must be
  // accepted or listed.
  const lost = sends.filter((x) => !okSeqs.has(x.seq) && !failedSeqs.has(x.seq) && x.outcome.kind !== "thrown" && x.outcome.kind !== "refused-in-body");
  const twoIds = [...idsOf.entries()].filter(([, set]) => set.size > 1).map(([s]) => s);
  const order = [];
  const byT = {}; for (const [t, s] of firstOk) (byT[t] = byT[t] || []).push(s);
  for (const [t, list] of Object.entries(byT)) for (let i = 1; i < list.length; i++) if (list[i] < list[i - 1]) order.push(`T${t}: #${list[i - 1]} before #${list[i]}`);
  const unreadable = [...snap.queued, ...snap.failed].filter((x) => !/^[A-Z]/.test(x.label || "") || /[0-9a-f]{8}-[0-9a-f]{4}|\/api\//.test(x.label || ""));
  const problems = [];
  if (lost.length) problems.push(`LOST ${lost.map((x) => "#" + x.seq).join(",")}`);
  if (twoIds.length) problems.push(`one change sent under TWO action ids: #${twoIds.join(",#")}`);
  if (badRepeat.length) problems.push(`a repeat not marked as a replay: #${badRepeat.join(",#")}`);
  if (order.length) problems.push(`order: ${order.join("; ")}`);
  if (unreadable.length) problems.push(`unreadable: ${unreadable.map((x) => x.label).join(" | ")}`);
  if (queuedSeqs.size) problems.push(`still queued after settling: ${[...queuedSeqs].join(",")}`);
  if (errors.length) problems.push(`page threw: ${errors[0]}`);
  if (process.env.R3_DEBUG) console.log(JSON.stringify({ sends, firstOk, snap, log: log.map((r) => r.method + " " + r.path + " aid=" + (r.headers["x-lfh-action-id"] || "").slice(0, 8) + " replay=" + (r.headers["x-lfh-replay"] || "") + " body=" + r.body) }, null, 1));
  return { ok: !problems.length, note: problems.length ? problems.join(" · ") + ` · trace: ${trace.join(" ")}` : `${sends.length} changes, ${firstOk.length} accepted, ${snap.failed.length} failed-and-listed, ${sends.filter((x) => x.outcome.kind === "thrown" || x.outcome.kind === "refused-in-body").length} refused live` };
}

const N = Number(process.env.R3_SEEDS_A || 200);
for (let i = 1; i <= N; i++) C("A", "outbox.js", `random sequence, seed ${i}: nothing lost, one action id per change, order kept per table, all named, settles`, () => runSeed(i));
