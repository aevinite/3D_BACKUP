// Round 3 · B — THE SAVED-WORK QUEUE AGAINST RULES THAT MUST HOLD AFTER EVERY STEP OF ANY SEQUENCE.
//
// lib/guestOutbox.ts, the REAL file (./hooks.mjs), on ../phone.mjs's fake phone. Each sequence is a
// seeded random walk over everything a diner, a dropped signal and a struggling server can do to it:
// save an order / a call / an "I've left", lose and regain signal, change how the server answers (fine,
// busy 5xx, "still handling" 409, the request dropped, a refusal, a duplicate, the call limit), the
// retry timer firing, the tab being RELOADED (a new copy of the file on the same storage), Try again,
// Dismiss, cancelling a saved call, and the clock moving on. After every step the rules below are
// checked; a broken one prints the seed and the step so the exact walk can be replayed.
import { check, real, rng } from "./h.mjs";
import { phone, lists } from "../phone.mjs";

const RIDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-00000000aaaa"];
const MODES = ["ok", "503", "409", "drop", "refuse", "dup", "rate"];
const realNow = Date.now;
const load = () => real("lib/guestOutbox.ts");

/** The fake restaurant: answers by the current mode, and remembers every action id it ACCEPTED. */
function server(st) {
  return (url, init, n, call) => {
    const id = call.headers["X-LFH-Action-Id"];
    st.sent.push({ id, url, online: st.online(), after: st.accepted.has(id) });
    const kind = url.includes("call-waiter") ? "call" : url.includes("leave") ? "leave" : "order";
    switch (st.mode) {
      case "ok": st.accepted.add(id); return { status: 200, json: kind === "order" ? { ok: true, order_id: "o-" + id.slice(0, 8) } : { ok: true } };
      case "dup": st.accepted.add(id); return { status: 200, json: { ok: true, duplicate: true, order_id: kind === "order" ? "o-" + id.slice(0, 8) : undefined } };
      case "rate": return kind === "order" ? { status: 200, json: { ok: false, reason: "rate_limited" } } : { status: 200, json: { ok: true, reason: "rate_limited" } };
      case "503": return { status: 503, json: { ok: false, reason: "server_busy", retryAfter: 2 } };
      case "409": return { status: 409, json: { retry: true } };
      case "drop": return new TypeError("Failed to fetch");
      default: return { status: 400, json: { ok: false, reason: "sold_out", item: "Tea" } };
    }
  };
}

export async function walk(seed, steps) {
  const r = rng(seed); const pick = (a) => a[Math.floor(r() * a.length)];
  let clock = 0; Date.now = () => realNow() + clock;
  const st = { mode: "ok", accepted: new Set(), sent: [], online: () => true };
  let P = await phone({ online: true, respond: server(st), load });
  st.online = () => P.nav.onLine;
  const broken = []; const seen = { failed: 0, reloads: 0, ticks: 0, delivered: 0 };
  const rule = (ok, what, step) => { if (!ok && broken.length < 3) broken.push(`seed ${seed} step ${step}: ${what}`); };
  try {
    lists(P);
    const TRACE = process.env.T3R3_TRACE === String(seed);
    for (let s = 0; s < steps; s++) {
      const op = r();
      if (TRACE) { const L0 = lists(P); process.stdout.write(`step ${s} op=${op.toFixed(3)} mode=${st.mode} online=${P.nav.onLine} clock=${clock / 60000}m · q=${L0.queued.map((x) => (x.kind || "order")[0] + x.id.slice(0, 4) + (x.error ? "!E" : "") + (x.tries || 0) + "/" + (x.netTries || 0) + "/" + (x.busyTries || 0)).join(",")} f=${L0.failed.map((x) => (x.kind || "order")[0] + x.id.slice(0, 4)).join(",")} timers=${P.pending().map((t) => t.ms).join(",")}\n`); }
      if (op < 0.16) await P.M.enqueueGuestOrder({ mode: "public", table: String(1 + Math.floor(r() * 4)), restaurantId: pick(RIDS), items: [{ id: "tea", qty: 1 }], allergies: [], lines: [{ id: "tea", title: "Tea" }], track: { tableNumber: "1", total: 1.2, itemCount: 1, items: [{ title: "Tea", qty: 1 }] } });
      else if (op < 0.27) await P.M.enqueueGuestCall({ mode: "public", table: String(1 + Math.floor(r() * 4)), restaurantId: pick(RIDS), reason: pick(["Water", "Bill", "Cutlery"]) });
      else if (op < 0.31) await P.M.enqueueGuestLeave({ token: "tok-" + Math.floor(r() * 3), restaurantId: RIDS[0] });
      else if (op < 0.40) P.setOnline(r() < 0.6);
      else if (op < 0.52) st.mode = pick(MODES);
      else if (op < 0.66) await P.M.flushGuestOutbox();
      else if (op < 0.76) { if (await P.tick()) seen.ticks++; }
      else if (op < 0.80) { // RELOAD: the same storage, a brand-new copy of the file
        await P.settle(15);
        const dump = P.idb._dump(); const lsMap = new Map(P.ls._map); const online = P.nav.onLine;
        P.restore();
        P = await phone({ online, respond: server(st), load, idb: { preload: dump } });
        for (const [k, v] of lsMap) P.ls.setItem(k, v);
        st.online = () => P.nav.onLine;
        lists(P); await P.settle(25); seen.reloads++;
      } else if (op < 0.86) { const f = lists(P).failed; if (f.length) await P.M.retryGuestFailed(pick(f).id); }
      else if (op < 0.90) { const f = lists(P).failed; if (f.length) await P.M.dismissGuestFailed(pick(f).id); }
      else if (op < 0.93) { const q = lists(P).queued.filter((x) => x.kind === "call"); if (q.length) await P.M.cancelQueuedCall(pick(q).id); }
      else clock += Math.floor(r() * 8) * 60_000;
      await P.settle(6);
      const L = lists(P), qIds = L.queued.map((x) => x.id), fIds = L.failed.map((x) => x.id);
      rule(!qIds.some((id) => fIds.includes(id)), "a saved thing is listed as BOTH waiting and couldn't-send", s);
      rule(new Set(qIds).size === qIds.length && new Set(fIds).size === fIds.length, "a saved thing is listed twice", s);
      seen.failed = Math.max(seen.failed, L.failed.length);
      rule(L.queued.length <= 25, `more than 25 waiting (${L.queued.length})`, s);
      rule(L.count === L.queued.length + L.failed.length, `the badge count ${L.count} ≠ ${L.queued.length} + ${L.failed.length}`, s);
      for (const x of [...L.queued, ...L.failed]) rule((x.tries || 0) <= 6 && (x.netTries || 0) <= 6 && (x.busyTries || 0) <= 6, `a counter passed six on ${x.kind || "order"}`, s);
      for (const x of L.failed) rule(typeof x.error === "string" && x.error.length > 10, "a couldn't-send row has no sentence", s);
      for (const x of L.queued) rule(!x.error, "a waiting row still carries an old error", s);
      rule(!st.sent.some((c) => c.after), "an action the restaurant had ACCEPTED was sent again", s);
      rule(!st.sent.some((c) => !c.online), "something was sent while the phone had no signal", s);
      rule(P.pending().length <= 1, `${P.pending().length} retry timers at once`, s);
      if (broken.length) break;
    }
    // the end of every walk: signal back, server fine, everything drains, nothing is left ticking
    P.setOnline(true); st.mode = "ok"; clock += 0;
    for (let i = 0; i < 12 && lists(P).queued.length; i++) { await P.M.flushGuestOutbox(); await P.settle(6); if (lists(P).queued.length) await P.tick(); }
    const L = lists(P);
    if (process.env.T3R3_TRACE === String(seed)) process.stdout.write(`END q=${L.queued.length} f=${L.failed.length} timers=${P.pending().map((t) => t.ms + (t.fn.name ? ":" + t.fn.name : "")).join(",")} online=${P.nav.onLine}\n`);
    rule(L.queued.length === 0, `${L.queued.length} still waiting after the server came back`, "end");
    rule(P.pending().length === 0, "a retry timer is still set with nothing to send", "end");
    const tracked = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]");
    rule(new Set(tracked.map((o) => o.id)).size === tracked.length, "an order is tracked twice on the strip", "end");
    const ids = new Set([...L.queued, ...L.failed].map((x) => x.id)), stored = new Set(P.idb._dump().map((x) => x.id));
    rule([...ids].every((id) => stored.has(id)) && [...stored].every((id) => ids.has(id)), "the phone's storage and the list disagree", "end");
    seen.delivered = st.accepted.size;
    return { broken, sent: st.sent.length, seen };
  } finally { P.restore(); Date.now = realNow; }
}

const SEEDS = Number(process.env.T3R3_WALKS || 400), STEPS = Number(process.env.T3R3_STEPS || 32);
for (let band = 0; band < 8; band++) {
  check(`R3-B${String(band + 1).padStart(2, "0")}`, "B", `the saved-work queue keeps all ten rules through ${SEEDS / 8} random walks of ${STEPS} steps (band ${band + 1} of 8)`, async () => {
    let sent = 0; const all = []; const tot = { failed: 0, reloads: 0, ticks: 0, delivered: 0 };
    for (let k = 0; k < SEEDS / 8; k++) { const res = await walk(10_000 + band * 1000 + k, STEPS); sent += res.sent; all.push(...res.broken); for (const x in tot) tot[x] += res.seen?.[x] || 0; if (all.length >= 3) break; }
    // a walk that never reaches a refusal, a reload or a timer proves nothing about them — say so
    // (only at full size — a reduced run, e.g. inside mutate.mjs at 3 walks a band, may simply not wander there)
    const reached = SEEDS / 8 < 25 || (tot.failed > 0 && tot.reloads > 0 && tot.ticks > 0 && tot.delivered > 0);
    return { ok: all.length === 0 && reached, note: all.length ? all.slice(0, 3).join(" · ") : `${sent} sends judged · ${tot.delivered} delivered · ${tot.reloads} reloads · ${tot.ticks} timer firings · couldn't-send rows reached` + (reached ? "" : " — BUT A STATE WAS NEVER REACHED") };
  });
}
