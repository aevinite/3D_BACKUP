// Round 2 · Block J — the saved-work queue, EVERY kind × EVERY kind of answer, on the fake phone.
// For each cell: where the row ends up (sent / still waiting / "couldn't send"), that "couldn't send"
// always carries a sentence, and the rule this project lives by — a queue that holds anything has a
// timer behind it, and an empty one has none.
import { check } from "./lib.mjs";
import { phone, lists } from "./phone.mjs";

const F = "lib/guestOutbox.ts";
const HOW = "STUB — real lib/guestOutbox.ts on a fake phone, one answer per cell";
const FH = "00000000-0000-0000-0000-000000000001";
const SAVE = {
  order: (M) => M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 1 }, { id: "b", qty: 1 }], allergies: [], lines: [{ id: "a", title: "Tea" }, { id: "b", title: "Cake" }], track: { tableNumber: "4", total: 210, itemCount: 2, items: [] } }),
  call: (M) => M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" }),
  leave: (M) => M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }),
};
const ANSWERS = [
  ["200 ok with an order id", () => ({ status: 200, json: { ok: true, order_id: "o1" } }), { order: "sent", call: "sent", leave: "sent" }],
  ["200 ok with no order id", () => ({ status: 200, json: { ok: true } }), { order: "failed", call: "sent", leave: "sent" }],
  ["200 ok + rate_limited", () => ({ status: 200, json: { ok: true, reason: "rate_limited" } }), { order: "failed", call: "failed", leave: "failed" }],
  ["a duplicate that placed", () => ({ status: 200, json: { ok: true, duplicate: true, order_id: "o1" } }), { order: "sent", call: "sent", leave: "sent" }],
  ["a duplicate of a refusal", () => ({ status: 200, json: { ok: false, duplicate: true, reason: "session_closed" } }), { order: "failed", call: "failed", leave: "failed" }],
  ["409 still handling it", () => ({ status: 409, json: { retry: true } }), { order: "waiting", call: "waiting", leave: "waiting" }],
  ["409 with a clash sentence", () => ({ status: 409, json: { ok: false, clash: { plain: "That table was closed." } } }), { order: "failed", call: "failed", leave: "failed" }],
  ["a 4xx refusal", () => ({ status: 400, json: { ok: false, reason: "bad_body" } }), { order: "failed", call: "failed", leave: "failed" }],
  ["a 5xx busy", () => ({ status: 502, json: { ok: false, reason: "server_busy", retryAfter: 30 } }), { order: "waiting", call: "waiting", leave: "waiting" }],
  ["a dropped request while online", () => new TypeError("Failed to fetch"), { order: "waiting", call: "waiting", leave: "waiting" }],
  ["a reply that is not JSON", () => ({ status: 502, raw: "<html>gateway</html>" }), { order: "waiting", call: "waiting", leave: "waiting" }],
];
let n = 172761;
for (const kind of ["order", "call", "leave"]) {
  for (const [label, answer, expect] of ANSWERS) {
    const want = expect[kind];
    check(`P${n++}`, F, `a saved ${kind.toUpperCase()} answered "${label}" ends ${want === "sent" ? "SENT and off the list" : want === "waiting" ? "still WAITING, with a timer" : "in 'couldn't send' WITH a sentence"}`, HOW, async () => {
      const P = await phone({ online: false, respond: answer });
      try {
        await SAVE[kind](P.M); P.setOnline(true);
        await P.M.flushGuestOutbox(); await P.settle();
        const L = lists(P); const timers = P.pending().length;
        const got = L.count === 0 ? "sent" : L.failed.length ? "failed" : "waiting";
        const sentence = got !== "failed" || (typeof L.failed[0].error === "string" && L.failed[0].error.length > 10 && !/[a-z]+_[a-z]+/.test(L.failed[0].error));
        const timerRule = (L.queued.length > 0) === (timers > 0);
        return { ok: got === want && sentence && timerRule, note: `${got}${got === "failed" ? `: ${L.failed[0].error}` : ""} · ${timers} timer(s)` };
      } finally { P.restore(); }
    });
  }
}
// n = 172794
check("P172794", F, "a 'couldn't send' row of every kind offers Try again (retryGuestFailed puts it back with a timer)", HOW, async () => {
  const out = [];
  for (const kind of ["order", "call", "leave"]) {
    const P = await phone({ online: false, respond: () => ({ status: 400, json: { ok: false, reason: "bad_body" } }) });
    try {
      await SAVE[kind](P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
      const id = lists(P).failed[0].id; globalThis.fetch = async () => new Promise(() => {});
      void P.M.retryGuestFailed(id); await P.settle();
      out.push(lists(P).queued.length === 1 && P.pending().length >= 0);
    } finally { P.restore(); }
  }
  return { ok: out.every(Boolean), note: out.join(",") };
});
check("P172795", F, "Remove works on a 'couldn't send' row of every kind, and leaves no timer behind", HOW, async () => {
  const out = [];
  for (const kind of ["order", "call", "leave"]) {
    const P = await phone({ online: false, respond: () => ({ status: 400, json: { ok: false, reason: "bad_body" } }) });
    try {
      await SAVE[kind](P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
      await P.M.dismissGuestFailed(lists(P).failed[0].id); await P.settle();
      out.push(lists(P).count === 0 && P.idb._dump().length === 0);
    } finally { P.restore(); }
  }
  return { ok: out.every(Boolean), note: out.join(",") };
});
check("P172796", F, "a mixed queue (order + call + leave) drains all three in ONE round when the network is good", HOW, async () => {
  const P = await phone({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o1" } }) });
  try {
    await SAVE.order(P.M); await SAVE.call(P.M); await SAVE.leave(P.M); P.setOnline(true);
    await P.M.flushGuestOutbox(); await P.settle();
    return { ok: lists(P).count === 0 && P.fetches.length === 3, note: P.fetches.map((f) => f.url.split("/").pop()).join(",") };
  } finally { P.restore(); }
});
check("P172797", F, "in a mixed queue, a busy order does not hold back the call behind it", HOW, async () => {
  const P = await phone({ online: false, respond: (u) => (u.endsWith("place-order") ? { status: 502, json: { ok: false } } : { status: 200, json: { ok: true } }) });
  try {
    await SAVE.order(P.M); await SAVE.call(P.M); P.setOnline(true);
    await P.M.flushGuestOutbox(); await P.settle();
    const L = lists(P); return { ok: L.queued.length === 1 && L.queued[0].kind !== "call" && P.fetches.length === 2, note: `${L.queued.length} waiting` };
  } finally { P.restore(); }
});
check("P172798", F, "item 19 — calls for table 4 at TWO restaurants stay two saved calls, each sent to its own restaurant", HOW, async () => {
  const P = await phone({ online: false, respond: () => ({ status: 200, json: { ok: true } }) });
  try {
    await P.M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" });
    await P.M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: "6c6fadb6-da23-4ab3-9f90-d164773f60b3", reason: "Water" });
    const two = lists(P).count === 2; P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
    const rids = P.fetches.map((f) => f.body.restaurantId).sort().join();
    return { ok: two && P.fetches.length === 2 && new Set(P.fetches.map((f) => f.body.restaurantId)).size === 2, note: rids };
  } finally { P.restore(); }
});
check("P172799", F, "item 19 — and two taps at the SAME restaurant still collapse into one", HOW, async () => {
  const P = await phone({ online: false });
  try { for (let i = 0; i < 3; i++) await P.M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" }); return lists(P).count === 1; }
  finally { P.restore(); }
});
const SAVED = (o = {}) => ({ id: "11111111-1111-4111-8111-111111111111", mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [], at: Date.now() - 60000, status: "queued", ...o });
check("P172800", F, "item 15 — a row memory already moved to 'couldn't send' is NOT put back in the send list by a late restore", HOW, async () => {
  // the restore reads storage that still says 'queued' for a row memory has since failed
  const P = await phone({ online: false, idb: { preload: [SAVED()] } });
  try {
    // memory first: save the same id and push it to failed before the async restore lands
    await P.M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [], actionId: SAVED().id });
    P.setOnline(true);
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, reason: "bad_body" }), { status: 400 });
    await P.M.flushGuestOutbox();
    await P.settle(80);
    const L = lists(P); const inBoth = L.queued.some((q) => L.failed.some((f) => f.id === q.id));
    return { ok: !inBoth && L.failed.length === 1 && L.queued.length === 0, note: `queued ${L.queued.length} · failed ${L.failed.length}` };
  } finally { P.restore(); }
});
check("P172801", F, "item 15 — a stored row memory has never seen is still restored (the merge did not become a filter)", HOW, async () => {
  const P = await phone({ online: false, idb: { preload: [SAVED({ id: "22222222-2222-4222-8222-222222222222" })] } });
  try { P.M.useGuestOutbox(); await P.settle(60); return lists(P).queued.length === 1; } finally { P.restore(); }
});
check("P172802", F, "a saved call's at-most-once id survives being collapsed, sent, and answered 'already_sent'", HOW, async () => {
  const P = await phone({ online: false, respond: () => ({ status: 200, json: { ok: true, reason: "already_sent" } }) });
  try {
    const a = await SAVE.call(P.M); const b = await SAVE.call(P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
    return a.action_id === b.action_id && P.fetches.length === 1 && P.fetches[0].headers["X-LFH-Action-Id"] === a.action_id && lists(P).count === 0;
  } finally { P.restore(); }
});
check("P172803", F, "a phone whose storage refuses every write still sends what it holds once online", HOW, async () => {
  const P = await phone({ online: false, idb: { failWrites: true }, respond: () => ({ status: 200, json: { ok: true, order_id: "o9" } }) });
  try { await SAVE.order(P.M); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle(); return lists(P).count === 0 && P.fetches.length === 1; }
  finally { P.restore(); }
});
check("P172804", F, "the queue never sends while the phone says it is offline, however many times it is woken", HOW, async () => {
  const P = await phone({ online: false });
  try { await SAVE.order(P.M); for (const e of ["online", "focus", "visibilitychange"]) P.emit(e); for (let i = 0; i < 3; i++) await P.M.flushGuestOutbox(); await P.settle(); return P.fetches.length === 0 && lists(P).count === 1 && P.pending().length >= 1; }
  finally { P.restore(); }
});
