// Round 2 · Block J2 — the saved-work queue, PER KIND (order · call · leave), through every way a send
// can stall: the server busy six times, the request dropped six times, "still handling it" six times.
// Each must end with the diner TOLD, in words about the thing THEY did, and with nothing left ticking.
import { check } from "./lib.mjs";
import { phone, lists } from "./phone.mjs";

const F = "lib/guestOutbox.ts";
const HOW = "STUB — real lib/guestOutbox.ts on a fake phone, six rounds per stall";
const FH = "00000000-0000-0000-0000-000000000001";
const SAVE = {
  order: (M) => M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [], lines: [{ id: "a", title: "Tea" }], track: { tableNumber: "4", total: 105, itemCount: 1, items: [{ title: "Tea", qty: 1 }] } }),
  call: (M) => M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" }),
  leave: (M) => M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }),
};
const WORDS = { order: /order again/, call: /member of staff/, leave: /tell a member of staff you've left/ };
const STALLS = [
  ["the server answering 5xx", () => ({ status: 503, json: { ok: false } }), "refused"],
  ["the request dropping while online", () => new TypeError("Failed to fetch"), "unreachable"],
  ["the server saying it is still handling it", () => ({ status: 409, json: { retry: true } }), "stillBusy"],
];
async function S(opts, fn) { const P = await phone(opts); try { return await fn(P); } finally { P.restore(); } }
let n = 172805;
for (const kind of ["order", "call", "leave"]) {
  for (const [label, answer] of STALLS) {
    check(`P${n++}`, F, `a saved ${kind} stalled by ${label} six times is TOLD to the diner in ${kind} words, and nothing keeps ticking`, HOW, () => S({ online: false, respond: answer }, async (P) => {
      await SAVE[kind](P.M); P.setOnline(true);
      for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
      const L = lists(P); const e = L.failed[0]?.error || "";
      return { ok: L.failed.length === 1 && WORDS[kind].test(e) && P.pending().length === 0, note: `${e} · ${P.pending().length} timer(s)` };
    }));
  }
  check(`P${n++}`, F, `a saved ${kind} that has stalled FIVE times is still waiting (the sixth is the one that tells)`, HOW, () => S({ online: false, respond: () => ({ status: 503, json: { ok: false } }) }, async (P) => {
    await SAVE[kind](P.M); P.setOnline(true);
    for (let i = 0; i < 5; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
    const L = lists(P); return { ok: L.queued.length === 1 && L.failed.length === 0 && P.pending().length === 1, note: `tries ${L.queued[0]?.tries}` };
  }));
  check(`P${n++}`, F, `a server's retryAfter is honoured while draining a ${kind}, not only an order`, HOW, () => S({ online: false, respond: () => ({ status: 502, json: { ok: false, reason: "server_busy", retryAfter: 40 } }) }, async (P) => {
    await SAVE[kind](P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
    const ms = Math.max(0, ...P.pending().map((t) => t.ms)); return { ok: ms >= 40000, note: `${ms}ms` };
  }));
  check(`P${n++}`, F, `a delivered ${kind} is deleted from the phone's storage and leaves no timer`, HOW, () => S({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o1" } }) }, async (P) => {
    await SAVE[kind](P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle(60);
    return { ok: P.idb._dump().length === 0 && P.pending().length === 0 && lists(P).count === 0, note: `${P.idb._dump().length} stored` };
  }));
  check(`P${n++}`, F, `only an ORDER becomes a tracked order — a delivered ${kind} ${kind === "order" ? "IS" : "is NOT"} added to the strip`, HOW, () => S({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o1" } }) }, async (P) => {
    await SAVE[kind](P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
    const tracked = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]").length;
    return { ok: tracked === (kind === "order" ? 1 : 0), note: `${tracked} tracked` };
  }));
  check(`P${n++}`, F, `'Try again' on a failed ${kind} sends it straight away, with all three counters back at zero`, HOW, () => S({ online: false, respond: () => ({ status: 503, json: { ok: false } }) }, async (P) => {
    await SAVE[kind](P.M); P.setOnline(true);
    for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
    let sent = 0; globalThis.fetch = async () => { sent++; return new Promise(() => {}); };
    void P.M.retryGuestFailed(lists(P).failed[0].id); await P.settle();
    const q = lists(P).queued[0]; return { ok: sent === 1 && q && q.tries === 0 && q.netTries === 0 && q.busyTries === 0, note: `${sent} send(s)` };
  }));
}
// n = 172829
check("P172829", F, "the 26th saved LEAVE pushes the oldest out with a sentence about leaving", HOW, () => S({ online: false }, async (P) => {
  for (let i = 0; i < 26; i++) await P.M.enqueueGuestLeave({ token: "tok-" + i, restaurantId: FH });
  const L = lists(P); return { ok: L.queued.length === 25 && L.failed.length === 1 && /tell a member of staff/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172830", F, "the 26th saved CALL (26 tables) pushes the oldest out with a sentence about calling staff", HOW, () => S({ online: false }, async (P) => {
  for (let i = 0; i < 26; i++) await P.M.enqueueGuestCall({ mode: "public", table: String(i + 1), restaurantId: FH, reason: "Water" });
  const L = lists(P); return { ok: L.queued.length === 25 && L.failed.length === 1 && /member of staff/.test(L.failed[0].error) && !/order it again/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172831", F, "a saved call exactly at its ten-minute edge (9 min 59 s) still goes", HOW, () => S({ online: false, respond: () => ({ status: 200, json: { ok: true } }) }, async (P) => {
  await SAVE.call(P.M); lists(P).queued[0].at = Date.now() - (10 * 60_000 - 1000); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle(); return P.fetches.length === 1;
}));
check("P172832", F, "a stale call is turned away on the phone WITHOUT costing a network request", HOW, () => S({ online: false }, async (P) => {
  await SAVE.call(P.M); lists(P).queued[0].at = Date.now() - 20 * 60_000; P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle(); return P.fetches.length === 0 && lists(P).failed.length === 1;
}));
check("P172833", F, "a saved leave is never treated as stale by age — leaving an hour ago is still true", HOW, () => S({ online: false, respond: () => ({ status: 200, json: { ok: true } }) }, async (P) => {
  await SAVE.leave(P.M); lists(P).queued[0].at = Date.now() - 60 * 60_000; P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle(); return P.fetches.length === 1 && lists(P).count === 0;
}));
check("P172834", F, "a saved session ORDER keeps its token and sends no table (identity is the token)", HOW, () => S({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o1" } }) }, async (P) => {
  await P.M.enqueueGuestOrder({ mode: "session", token: "tok-9", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [] }); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle(); const b = P.fetches[0].body; return b.token === "tok-9" && !b.table;
}));
check("P172835", F, "the action id on every send of one saved row is the SAME across its retries", HOW, () => S({ online: false, respond: (u, i, k) => (k < 2 ? { status: 503, json: { ok: false } } : { status: 200, json: { ok: true, order_id: "o1" } }) }, async (P) => {
  await SAVE.order(P.M); P.setOnline(true);
  for (let i = 0; i < 3; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const ids = new Set(P.fetches.map((f) => f.headers["X-LFH-Action-Id"])); return { ok: P.fetches.length === 3 && ids.size === 1, note: `${P.fetches.length} sends, ${ids.size} id(s)` };
}));
check("P172836", F, "a 409 'still handling it' that then succeeds counts as one order, tracked once", HOW, () => S({ online: false, respond: (u, i, k) => (k === 0 ? { status: 409, json: { retry: true } } : { status: 200, json: { ok: true, duplicate: true, order_id: "o7" } }) }, async (P) => {
  await SAVE.order(P.M); P.setOnline(true);
  for (let i = 0; i < 2; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]"); return { ok: t.length === 1 && t[0].id === "o7" && lists(P).count === 0, note: `${t.length} tracked` };
}));
