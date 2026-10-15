// Block A — lib/guestOutbox.ts, the saved-work queue, DRIVEN in memory on a fake phone.
// Every row bundles the REAL file fresh (an empty queue), scripts the network, and reads the result
// the way the screen does (the useGuestOutbox snapshot), the phone's storage, and what was sent.
import { check } from "./lib.mjs";
import { phone, lists } from "./phone.mjs";

// SAVED N ms AGO — by saving it while the clock reads N ms ago (re-pointed sweep #10 T3 round 3). These checks
// used to age a saved row by editing it in the published list (lists(P).queued[0].at = …). Round 3 made that
// list a COPY (item 32 — React's contract), so the edit no longer reached the queue: the "too old" checks went
// red and the "still fresh" one passed while testing nothing. The clock is the honest way to age it.
async function savedAgo(ms, save) { const real = Date.now; Date.now = () => real() - ms; try { return await save(); } finally { Date.now = real; } }

const F = "lib/guestOutbox.ts";
const HOW = "STUB — real lib/guestOutbox.ts on a fake phone";
const FH = "00000000-0000-0000-0000-000000000001";
const ORDER = (o = {}) => ({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 2 }, { id: "b", qty: 1 }], allergies: [], lines: [{ id: "a", title: "Coffee" }, { id: "b", title: "Croissant" }], track: { tableNumber: "4", total: 362.25, itemCount: 3, items: [{ title: "Coffee", qty: 2 }, { title: "Croissant", qty: 1 }] }, ...o });
const ok = (j, status = 200) => ({ status, json: j });
/** Run one scenario, always restoring the real timers. */
async function S(opts, fn) { const P = await phone(opts); try { return await fn(P); } finally { P.restore(); } }
/** Enqueue offline, then come online and drain once. */
async function sendOnce(respond, order = ORDER(), extra = {}) {
  return S({ online: false, respond, ...extra }, async (P) => {
    const r = await P.M.enqueueGuestOrder(order);
    await P.settle();
    P.setOnline(true);
    await P.M.flushGuestOutbox(); await P.settle();
    return { P, r, L: lists(P) };
  });
}

// ── A1. reasonMsg — every code, both tenses, all three kinds (P172001–P172060) ────────────────────
const CODES = ["session_closed", "not_approved", "blocked", "otp_required", "invalid_token", "sold_out", "unknown_item",
  "staff_priced_item", "hidden_item", "empty_order", "rate_limited", "server_busy", "call_too_old", "unknown_restaurant",
  "unknown_table", "off_plan_table", "bad_body", "order_too_big", "allergies_too_long"];
let n = 172001;
for (const code of CODES) {
  const id = `P${n++}`;
  check(id, F, `reasonMsg("${code}") answers a sentence a diner can read — never the code, never empty, both tenses`, HOW, async () => S({}, async (P) => {
    const live = P.M.reasonMsg(code), saved = P.M.reasonMsg(code, { queued: true });
    const bad = [live, saved].find((s) => !s || (code.includes("_") && s.includes(code)) || /[a-z]+_[a-z]+/.test(s));
    return { ok: !bad, note: `live: ${live} · saved: ${saved}` };
  }));
}
// 172020
check("P172020", F, "an unknown code gets the honest general sentence, never the code itself", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("pgrst_116_whatever"), q = P.M.reasonMsg("pgrst_116_whatever", { queued: true });
  return { ok: !/pgrst/i.test(s + q) && /try again/.test(s) && /order again/.test(q), note: `${s} · ${q}` };
}));
check("P172021", F, "rate_limited never says 'try again' (that trips the same limit and pings the owner again)", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("rate_limited");
  return { ok: /wait/i.test(s) && !/try again/i.test(s), note: s };
}));
check("P172022", F, "a saved CALL refused for a non-shared code is worded as a call, not as an order", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("rate_limited", { queued: true, kind: "call" });
  return { ok: /call/i.test(s) && !/order/i.test(s), note: s };
}));
check("P172023", F, "a saved LEAVE refused for a non-shared code is worded as leaving, not as an order", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("bad_body", { queued: true, kind: "leave" });
  return { ok: /left/i.test(s) && !/order/i.test(s), note: s };
}));
n = 172151;   // the nine shared codes take P172151–P172159
for (const code of ["session_closed", "not_approved", "blocked", "otp_required", "invalid_token", "server_busy", "call_too_old", "off_plan_table", "unknown_table"]) {
  check(`P${n++}`, F, `the shared code "${code}" says the SAME true sentence for an order, a call and a leave`, HOW, async () => S({}, async (P) => {
    const o = P.M.reasonMsg(code, { queued: true }), c = P.M.reasonMsg(code, { queued: true, kind: "call" }), l = P.M.reasonMsg(code, { queued: true, kind: "leave" });
    return { ok: o === c && c === l && !/\border\b/i.test(c.replace(/order again/, "")), note: c };
  }));
}
check("P172029", F, "the two 'not one of our tables' codes share one sentence, so they cannot drift apart", HOW, async () => S({}, async (P) =>
  P.M.reasonMsg("unknown_table") === P.M.reasonMsg("off_plan_table") && /table number/i.test(P.M.reasonMsg("unknown_table"))));
check("P172030", F, "sold_out names the dish in quotes when it is known, and the generic sentence when not", HOW, async () => S({}, async (P) => {
  const a = P.M.reasonMsg("sold_out", { dish: "Paneer Tikka" }), b = P.M.reasonMsg("sold_out");
  return { ok: a.includes("“Paneer Tikka”") && !b.includes("“"), note: `${a} · ${b}` };
}));
check("P172031", F, "hidden_item never promises the dish is coming back (that is sold_out's wording)", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("hidden_item", { dish: "Soup" });
  return { ok: !/sold out/i.test(s) && /menu/i.test(s), note: s };
}));
check("P172032", F, "a past-tense saved refusal says 'while you were offline' only where that is true", HOW, async () => S({}, async (P) => {
  const s = P.M.reasonMsg("session_closed", { queued: true }), live = P.M.reasonMsg("session_closed");
  return { ok: /while you were offline/.test(s) && !/offline/.test(live), note: `${s} · ${live}` };
}));

// ── A2. refusalOf / dishFor — reading a refusal (P172033–P172045) ───────────────────────────────
check("P172033", F, "refusalOf pulls the CODE out of 'Order failed: sold_out (Soup)'", HOW, async () => S({}, async (P) => {
  const r = P.M.refusalOf(new Error("Order failed: sold_out (Soup)"));
  return r.reason === "sold_out" && r.dish === "Soup";
}));
check("P172034", F, "refusalOf on an error with no code returns no reason (so the general sentence is said)", HOW, async () => S({}, async (P) => {
  const r = P.M.refusalOf(new Error("Failed to fetch"));
  return r.reason === undefined && r.dish === undefined;
}));
check("P172035", F, "refusalOf survives a non-Error (null, a string, an object) without throwing", HOW, async () => S({}, async (P) => {
  for (const x of [null, undefined, "x", { message: 5 }]) P.M.refusalOf(x);
  return true;
}));
check("P172036", F, "dishFor maps an unknown_item ID back to the NAME the diner can see", HOW, async () => S({}, async (P) =>
  P.M.dishFor("unknown_item", "fh__a1b2c3d4", [{ id: "fh__a1b2c3d4", title: "Paneer Tikka" }]) === "Paneer Tikka"));
check("P172037", F, "dishFor names NOTHING when an unknown_item id matches nothing on the phone (never the raw id)", HOW, async () => S({}, async (P) =>
  P.M.dishFor("unknown_item", "fh__a1b2c3d4", [{ id: "other", title: "Soup" }]) === undefined));
check("P172038", F, "dishFor passes a sold_out TITLE straight through", HOW, async () => S({}, async (P) =>
  P.M.dishFor("sold_out", "Soup", []) === "Soup"));
check("P172039", F, "dishFor with no token answers nothing", HOW, async () => S({}, async (P) =>
  P.M.dishFor("sold_out", undefined, []) === undefined && P.M.dishFor("unknown_item", "", []) === undefined));

// ── A3. saving — enqueue (P172040–P172069) ──────────────────────────────────────────────────────
check("P172040", F, "an order saved offline is in the queue the screen reads, with count 1", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  const L = lists(P); return L.count === 1 && L.queued.length === 1 && L.failed.length === 0;
}));
check("P172041", F, "…and really reached the phone's storage (persisted: true, one row in IndexedDB)", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  return r.persisted === true && P.idb._dump().length === 1;
}));
check("P172042", F, "storage that refuses the write is REPORTED (persisted: false), the order still queued in memory", HOW, async () => S({ online: false, idb: { failWrites: true } }, async (P) => {
  const r = await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  return { ok: r.persisted === false && lists(P).count === 1, note: `persisted=${r.persisted}` };
}));
check("P172043", F, "a saved order reuses the at-most-once id it was handed (the online attempt's)", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestOrder(ORDER({ actionId: "11111111-2222-4333-8444-555555555555" }));
  return r.action_id === "11111111-2222-4333-8444-555555555555" && lists(P).queued[0].id === r.action_id;
}));
check("P172044", F, "…and mints a fresh uuid when it was handed none", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestOrder(ORDER());
  return /^[0-9a-f-]{36}$/.test(r.action_id);
}));
check("P172045", F, "the saved row is marked status 'queued' with the moment it was saved", HOW, async () => S({ online: false }, async (P) => {
  const t0 = Date.now(); await P.M.enqueueGuestOrder(ORDER());
  const q = lists(P).queued[0]; return q.status === "queued" && q.at >= t0 && q.at <= Date.now();
}));
check("P172046", F, "the saved row remembers its OWN restaurant's slug (so the tracker lands under it later)", HOW, async () => S({ online: false, path: "/r/french-house/menu" }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); return lists(P).queued[0].restaurantSlug === "french-house";
}));
check("P172047", F, "a queue with something in it ALWAYS has a retry timer behind it", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  return { ok: P.pending().length === 1, note: `${P.pending().length} timer(s)` };
}));
check("P172048", F, "the FIRST retry is short (5s ± 25% jitter), not the 15s base", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  const ms = P.pending()[0]?.ms; return { ok: ms >= 3750 && ms <= 6250, note: `${ms}ms` };
}));
check("P172049", F, "two saves in a row do not stack two timers (one queue, one timer)", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.M.enqueueGuestOrder(ORDER({ table: "5" })); await P.settle();
  return { ok: P.pending().length === 1 && lists(P).count === 2, note: `${P.pending().length} timers, ${lists(P).count} saved` };
}));
check("P172050", F, "the 26th saved order pushes the OLDEST to 'couldn't send' with a sentence — nothing vanishes", HOW, async () => S({ online: false }, async (P) => {
  for (let i = 0; i < 26; i++) await P.M.enqueueGuestOrder(ORDER({ table: String(i + 1) }));
  const L = lists(P);
  return { ok: L.queued.length === 25 && L.failed.length === 1 && L.failed[0].table === "1" && /waited too long/.test(L.failed[0].error || ""), note: `${L.queued.length} queued · ${L.failed.length} failed` };
}));
check("P172051", F, "saving announces lfh:guest-outbox-changed so the badge repaints", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); return P.events.some((e) => e.type === "lfh:guest-outbox-changed");
}));
check("P172052", F, "the saved row keeps the basket as a PERSON sees it (id + name per line)", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); const q = lists(P).queued[0];
  return Array.isArray(q.lines) && q.lines.length === 2 && q.lines[0].title === "Coffee";
}));
check("P172053", F, "the saved row carries no price from the phone in the payload sent to the server", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); const q = lists(P).queued[0];
  return !JSON.stringify(q.items).match(/price|total/i);
}));

// calls
const CALL = (o = {}) => ({ mode: "public", table: "4", restaurantId: FH, reason: "Water", ...o });
check("P172054", F, "a bell tap with no signal is saved as kind 'call', with the words the diner tapped", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); const q = lists(P).queued[0];
  return q.kind === "call" && q.reason === "Water" && q.items.length === 0;
}));
check("P172055", F, "five taps on the bell for the same table collapse into ONE saved call", HOW, async () => S({ online: false }, async (P) => {
  for (let i = 0; i < 5; i++) await P.M.enqueueGuestCall(CALL());
  return { ok: lists(P).count === 1, note: `${lists(P).count} saved` };
}));
check("P172056", F, "…and the collapsed call takes the NEWEST words", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestCall(CALL({ reason: "Water" })); await P.M.enqueueGuestCall(CALL({ reason: "Bring the bill" }));
  return lists(P).queued[0].reason === "Bring the bill";
}));
check("P172057", F, "…and keeps its at-most-once id, so a call already in flight cannot ring twice", HOW, async () => S({ online: false }, async (P) => {
  const a = await P.M.enqueueGuestCall(CALL()), b = await P.M.enqueueGuestCall(CALL({ reason: "Napkins" }));
  return a.action_id === b.action_id;
}));
check("P172058", F, "a call for a DIFFERENT table is its own saved call", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); await P.M.enqueueGuestCall(CALL({ table: "5" }));
  return lists(P).count === 2;
}));
check("P172059", F, "a saved call does not collapse into a saved ORDER for the same table", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.M.enqueueGuestCall(CALL());
  return lists(P).count === 2 && lists(P).queued.filter((x) => x.kind === "call").length === 1;
}));
check("P172060", F, "a session call and a QR call for the same table number are kept apart (different token)", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); await P.M.enqueueGuestCall({ mode: "session", token: "tok-1", restaurantId: FH, reason: "Water" });
  return lists(P).count === 2;
}));
// leave
check("P172061", F, "'I've left' is saved as kind 'leave' with its token", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }); const q = lists(P).queued[0];
  return q.kind === "leave" && q.token === "tok-1" && q.mode === "session";
}));
check("P172062", F, "leaving twice saves ONE leave (the same fact)", HOW, async () => S({ online: false }, async (P) => {
  const a = await P.M.enqueueGuestLeave({ token: "tok-1" }), b = await P.M.enqueueGuestLeave({ token: "tok-1" });
  return lists(P).count === 1 && a.action_id === b.action_id;
}));
check("P172063", F, "a saved leave also has a timer behind it", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1" }); await P.settle(); return P.pending().length === 1;
}));

// ── A4. sending — flush (P172064–P172130) ───────────────────────────────────────────────────────
check("P172064", F, "a saved ORDER goes to /api/guest/place-order, POST, JSON", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  const f = P.fetches[0]; return f && f.url === "/api/guest/place-order" && f.init.method === "POST";
});
check("P172065", F, "…carrying the SAME at-most-once id it was saved under", HOW, async () => {
  const { P, r } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  return P.fetches[0].headers["X-LFH-Action-Id"] === r.action_id;
});
check("P172066", F, "…marked as a replay with the time it was SAVED, so the server can refuse a table that moved on", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  const h = P.fetches[0].headers; return h["X-LFH-Replay"] === "1" && !Number.isNaN(Date.parse(h["X-LFH-Queued-At"]));
});
check("P172067", F, "…with a send deadline (an abort signal), so a hung Wi-Fi cannot wedge the queue", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  return !!P.fetches[0].signal && typeof P.fetches[0].signal.aborted === "boolean";
});
check("P172068", F, "…and a body of exactly mode/token/table/restaurantId/items/allergies — nothing priced", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  const keys = Object.keys(P.fetches[0].body).sort().join(",");
  return { ok: keys === "allergies,items,mode,restaurantId,table", note: keys };
});
check("P172069", F, "a placed order leaves the queue and lands in THIS restaurant's tracker list, once", HOW, async () => {
  const { P, L } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]");
  return { ok: L.count === 0 && t.length === 1 && t[0].id === "o1" && t[0].status === "received", note: `${t.length} tracked` };
});
check("P172070", F, "…with the diner's own summary (table, total, item lines) the cart saved", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house"))[0];
  return t.tableNumber === "4" && t.total === 362.25 && t.itemCount === 3 && t.items[0].title === "Coffee";
});
check("P172071", F, "…and wakes the tracker (lfh:order-placed)", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  return P.events.some((e) => e.type === "lfh:order-placed");
});
check("P172072", F, "…and is deleted from the phone's storage", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  await P.settle(); return P.idb._dump().length === 0;
});
check("P172073", F, "an order saved at restaurant A but sent while the tab is on B is tracked under A", HOW, async () => S({ online: false, path: "/r/french-house/menu" }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.win.location.pathname = "/r/aangan-garden-restaurant/menu"; P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return !!P.ls.getItem("lfh_active_orders:french-house") && !P.ls.getItem("lfh_active_orders:aangan-garden-restaurant");
}));
check("P172074", F, "a reply already tracked (same order id) is not added to the tracker twice", HOW, async () => S({ online: false, respond: () => ok({ ok: true, order_id: "o1" }) }, async (P) => {
  P.ls.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "o1", status: "preparing" }]));
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house")); return t.length === 1 && t[0].status === "preparing";
}));
check("P172075", F, "a DUPLICATE reply (the reply to the first send was lost) still tracks the original order", HOW, async () => {
  const { P, L } = await sendOnce(() => ok({ ok: true, order_id: "o9", duplicate: true }));
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]");
  return L.count === 0 && t.length === 1 && t[0].id === "o9";
});
check("P172076", F, "a duplicate that says ok:false is a REFUSAL the diner sees, never a silent removal", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, duplicate: true, reason: "session_closed" }));
  return { ok: L.failed.length === 1 && /closed/.test(L.failed[0].error), note: L.failed[0]?.error };
});
check("P172077", F, "a 409 'still handling this id' keeps the order queued and counts the round", HOW, async () => {
  const { L } = await sendOnce(() => ok({ error: "sync_in_progress", retry: true }, 409));
  return L.queued.length === 1 && L.queued[0].busyTries === 1 && L.failed.length === 0;
});
check("P172078", F, "…and after SIX such rounds it stops being a spinner and becomes the diner's decision", HOW, async () => S({ online: false, respond: () => ok({ retry: true }, 409) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const L = lists(P); return { ok: L.failed.length === 1 && /still busy/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172079", F, "a 409 with a clash sentence (the table moved on) moves it to 'couldn't send' with THAT sentence", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, clash: { plain: "That table was paid and closed while you were offline." } }, 409));
  return L.failed.length === 1 && L.failed[0].error === "That table was paid and closed while you were offline.";
});
check("P172080", F, "a 5xx keeps the order queued (busy is not a refusal) and counts the round", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "server_busy", retryAfter: 30 }, 502));
  return L.queued.length === 1 && L.queued[0].tries === 1;
});
check("P172081", F, "…and after SIX 5xx rounds the diner is told, with the order's own wording", HOW, async () => S({ online: false, respond: () => ok({ ok: false }, 503) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const L = lists(P); return { ok: L.failed.length === 1 && /didn't take this one — please order again/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172082", F, "a request that never completes (dropped) while ONLINE is counted, not retried in silence", HOW, async () => {
  const { L } = await sendOnce(() => new TypeError("Failed to fetch"));
  return L.queued.length === 1 && L.queued[0].netTries === 1;
});
check("P172083", F, "…and after SIX such rounds the diner reads 'We couldn't reach the restaurant'", HOW, async () => S({ online: false, respond: () => new TypeError("Failed to fetch") }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const L = lists(P); return { ok: L.failed.length === 1 && /couldn't reach the restaurant/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172084", F, "a drop that happens because the phone went OFFLINE is not counted at all — that is what the queue is for", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  globalThis.fetch = async () => { P.setOnline(false); throw new TypeError("Failed to fetch"); };
  await P.M.flushGuestOutbox(); await P.settle();
  const q = lists(P).queued[0]; return { ok: !!q && !q.netTries, note: `netTries=${q?.netTries}` };
}));
check("P172085", F, "the attempt counters are written to storage, so a reload cannot reset them", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: false }, 502));
  await P.settle(); const row = P.idb._dump()[0]; return row && row.tries === 1;
});
check("P172086", F, "a 4xx refusal (sold out) moves the order to 'couldn't send' with the dish NAMED", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "sold_out", item: "Croissant" }));
  return { ok: L.failed.length === 1 && L.failed[0].error.includes("“Croissant” sold out while you were offline"), note: L.failed[0]?.error };
});
check("P172087", F, "…and remembers WHICH line, by name and by id, so 'Order the rest' can work", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "sold_out", item: "Croissant" }));
  return L.failed[0].blocked === "Croissant" && L.failed[0].blockedId === "b";
});
check("P172088", F, "an unknown_item refusal names the dish from the phone's own basket, not the id", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "unknown_item", item: "b" }));
  return { ok: L.failed[0].error.includes("“Croissant”") && !L.failed[0].error.includes("“b”"), note: L.failed[0].error };
});
check("P172089", F, "a refusal that names no dish sets no 'Order the rest' line", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "session_closed" }));
  return !L.failed[0].blocked && !L.failed[0].blockedId;
});
check("P172090", F, "a 200 with ok:true but NO order id is not counted as placed (nothing to track, no silent removal)", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: true }));
  return { ok: L.count === 1, note: `queued ${L.queued.length} · failed ${L.failed.length} · ${L.failed[0]?.error || ""}` };
});
check("P172091", F, "a reply whose body is not JSON at all is surfaced, not swallowed", HOW, async () => {
  const { L } = await sendOnce(() => ({ status: 400, raw: "<html>bad gateway</html>" }));
  return { ok: L.failed.length === 1 && !!L.failed[0].error, note: L.failed[0]?.error };
});
check("P172092", F, "a server's retryAfter LENGTHENS the next wait", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: false, reason: "server_busy", retryAfter: 40 }, 502));
  const ms = P.pending().map((t) => t.ms).sort((a, b) => b - a)[0]; return { ok: ms >= 40000, note: `${ms}ms` };
});
check("P172093", F, "…but can never stretch it past five minutes", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: false, reason: "server_busy", retryAfter: 99999 }, 502));
  const ms = Math.max(...P.pending().map((t) => t.ms)); return { ok: ms <= 300000 && ms >= 299000, note: `${ms}ms` };
});
check("P172094", F, "…and junk in retryAfter (text, negative, NaN) is ignored, not turned into a hammering zero", HOW, async () => S({}, async (P) => {
  for (const v of ["abc", -5, NaN, null, 0]) P.M.noteServerRetryAfter(v);
  await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  const ms = P.pending()[0]?.ms; return { ok: ms >= 3750 && ms <= 6250, note: `${ms}ms` };
}));
check("P172095", F, "the backoff grows each round and is capped at two minutes (± jitter)", HOW, async () => S({ online: false, respond: () => ok({ ok: false }, 502) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  const waits = [];
  for (let i = 0; i < 5; i++) { await P.tick(); const p = P.pending()[0]; if (p) waits.push(p.ms); }
  const grows = waits.length >= 3 && waits[2] > waits[0];
  return { ok: grows && Math.max(...waits) <= 150000, note: waits.join(",") };
}));
check("P172096", F, "two phones do not retry on the same beat — the jitter differs run to run", HOW, async () => {
  const ms = [];
  for (let i = 0; i < 6; i++) await S({ online: false }, async (P) => { await P.M.enqueueGuestOrder(ORDER()); await P.settle(); ms.push(P.pending()[0].ms); });
  return { ok: new Set(ms).size >= 4, note: ms.join(",") };
});
check("P172097", F, "a phone that reports OFFLINE does not touch the network but still leaves a timer", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle();
  await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches.length === 0 && P.pending().length >= 1;
}));
check("P172098", F, "an empty queue clears its timer — nothing ticks for nothing", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }));
  return { ok: P.pending().length === 0, note: `${P.pending().length} pending` };
});
check("P172099", F, "one stuck order does not hold the next: the second is sent in the same round", HOW, async () => S({ online: false, respond: (u, i, k) => (k === 0 ? ok({ ok: false }, 502) : ok({ ok: true, order_id: "o2" })) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER({ table: "1" })); await P.M.enqueueGuestOrder(ORDER({ table: "2" })); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  const L = lists(P); return { ok: P.fetches.length === 2 && L.queued.length === 1 && L.queued[0].table === "1", note: `${P.fetches.length} sends` };
}));
check("P172100", F, "saved orders drain oldest first", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER({ table: "1" })); await P.settle(5); await P.M.enqueueGuestOrder(ORDER({ table: "2" })); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches.map((f) => f.body.table).join(",") === "1,2";
}));
check("P172101", F, "a flush already running is not started twice (no double send)", HOW, async () => S({ online: false, respond: async () => { await new Promise((r) => setTimeout(r, 20)); return ok({ ok: true, order_id: "o1" }); } }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true);
  await Promise.all([P.M.flushGuestOutbox(), P.M.flushGuestOutbox(), P.M.flushGuestOutbox()]); await P.settle(60);
  return { ok: P.fetches.length === 1, note: `${P.fetches.length} sends` };
}));
check("P172102", F, "coming back ONLINE (the browser event) drains the queue by itself", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle(); P.setOnline(true); P.emit("online"); await P.settle(60);
  return { ok: P.fetches.length === 1 && lists(P).count === 0, note: `${P.fetches.length} sends` };
}));
check("P172103", F, "unlocking the phone (focus) drains it too", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle(); P.setOnline(true); P.emit("focus"); await P.settle(60);
  return P.fetches.length === 1;
}));
check("P172104", F, "the tab becoming visible drains it too", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle(); P.setOnline(true); P.emit("visibilitychange"); await P.settle(60);
  return P.fetches.length === 1;
}));
check("P172105", F, "a Wi-Fi that never fires 'online' still gets the order out on the retry timer", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); await P.settle(); P.setOnline(true); await P.tick();
  return { ok: P.fetches.length === 1 && lists(P).count === 0, note: `${P.fetches.length} sends` };
}));
// calls on the wire
check("P172106", F, "a saved CALL goes to /api/guest/call-waiter, never to place-order", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches.length === 1 && P.fetches[0].url === "/api/guest/call-waiter";
}));
check("P172107", F, "…carrying when the diner TAPPED (at), so the server can refuse a stale call", HOW, async () => S({ online: false }, async (P) => {
  const t0 = Date.now(); await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const b = P.fetches[0].body; return typeof b.at === "number" && b.at >= t0 && b.reason === "Water";
}));
check("P172108", F, "…and its own at-most-once id, so a replay rings the floor once", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches[0].headers["X-LFH-Action-Id"] === r.action_id;
}));
check("P172109", F, "a delivered call leaves the queue and is NOT recorded as an order to track", HOW, async () => S({ online: false, respond: () => ok({ ok: true }) }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return lists(P).count === 0 && !P.ls.getItem("lfh_active_orders:french-house");
}));
check("P172110", F, "a call answered 'already_sent' (a waiter is already coming) is finished with", HOW, async () => S({ online: false, respond: () => ok({ ok: true, reason: "already_sent" }) }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return lists(P).count === 0;
}));
check("P172111", F, "a call answered 'capped' (six calls already stacked) is finished with", HOW, async () => S({ online: false, respond: () => ok({ ok: true, reason: "capped" }) }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return lists(P).count === 0;
}));
check("P172112", F, "a call answered ok:true + 'rate_limited' (nobody is coming) is SHOWN, never removed in silence", HOW, async () => S({ online: false, respond: () => ok({ ok: true, reason: "rate_limited" }) }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const L = lists(P); return { ok: L.failed.length === 1 && /call/i.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172113", F, "a call older than ten minutes is not sent at all — the diner is told it was too old", HOW, async () => S({ online: false }, async (P) => {
  await savedAgo(11 * 60_000, () => P.M.enqueueGuestCall(CALL())); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  const L = lists(P); return { ok: P.fetches.length === 0 && L.failed.length === 1 && /too old/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("P172114", F, "a call nine minutes old still goes", HOW, async () => S({ online: false, respond: () => ok({ ok: true }) }, async (P) => {
  await savedAgo(9 * 60_000, () => P.M.enqueueGuestCall(CALL())); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches.length === 1 && lists(P).count === 0;
}));
check("P172115", F, "a call the server keeps answering 5xx is told in CALL words after six rounds", HOW, async () => S({ online: false, respond: () => ok({ ok: false }, 502) }, async (P) => {
  await P.M.enqueueGuestCall(CALL()); P.setOnline(true);
  for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
  const e = lists(P).failed[0]?.error || ""; return { ok: /your call/.test(e) && /member of staff/.test(e) && !/order again/.test(e), note: e };
}));
// leave on the wire
check("P172116", F, "a saved LEAVE goes to /api/guest/leave with just its token and restaurant", HOW, async () => S({ online: false, respond: () => ok({ ok: true }) }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const f = P.fetches[0]; return f.url === "/api/guest/leave" && Object.keys(f.body).sort().join(",") === "restaurantId,token" && !!f.headers["X-LFH-Action-Id"];
}));
check("P172117", F, "a saved leave is DROPPED, unsent, when the diner has re-joined that very table", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH });
  P.ls.setItem("lfh_session:french-house", JSON.stringify({ token: "tok-1", table: "4" })); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return { ok: P.fetches.length === 0 && lists(P).count === 0, note: `${P.fetches.length} sends` };
}));
check("P172118", F, "…but sent when the phone now holds a DIFFERENT session", HOW, async () => S({ online: false, respond: () => ok({ ok: true }) }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH });
  P.ls.setItem("lfh_session:french-house", JSON.stringify({ token: "tok-2" })); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return P.fetches.length === 1;
}));
check("P172119", F, "a leave refused for a non-shared reason is worded as leaving, with the step that works", HOW, async () => S({ online: false, respond: () => ok({ ok: false, reason: "bad_body" }, 400) }, async (P) => {
  await P.M.enqueueGuestLeave({ token: "tok-1" }); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const e = lists(P).failed[0]?.error || ""; return { ok: /left/.test(e) && /member of staff/.test(e), note: e };
}));

// ── A5. the diner's controls — retry / remove / order the rest / not needed (P172120–P172150) ───
async function failedOne(respond = () => ok({ ok: false, reason: "sold_out", item: "Croissant" })) {
  const P = await phone({ online: false, respond });
  await P.M.enqueueGuestOrder(ORDER()); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  return P;
}
check("P172120", F, "'Try again' puts a failed order back in the queue and sends it at once", HOW, async () => {
  const P = await failedOne(); try {
    const id = lists(P).failed[0].id; let k = 0; globalThis.fetch = async () => { k++; return new Response(JSON.stringify({ ok: true, order_id: "o2" }), { status: 200 }); };
    await P.M.retryGuestFailed(id); await P.settle(60);
    return { ok: k === 1 && lists(P).count === 0, note: `${k} sends` };
  } finally { P.restore(); }
});
check("P172121", F, "'Try again' clears ALL three attempt counters, not only the 5xx one", HOW, async () => {
  const P = await failedOne(() => new TypeError("x")); try {
    for (let i = 0; i < 6; i++) { await P.M.flushGuestOutbox(); await P.settle(); }
    const it = lists(P).failed[0]; globalThis.fetch = async () => new Promise(() => {}); // never answers: read the row as it was reset
    void P.M.retryGuestFailed(it.id); await P.settle();
    const q = lists(P).queued[0]; return { ok: q && q.tries === 0 && q.netTries === 0 && q.busyTries === 0, note: JSON.stringify(q && { t: q.tries, n: q.netTries, b: q.busyTries }) };
  } finally { P.restore(); }
});
check("P172122", F, "'Try again' clears the dish the LAST refusal named, so 'Order the rest' cannot outlive it", HOW, async () => {
  const P = await failedOne(); try {
    const id = lists(P).failed[0].id; globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, reason: "session_closed" }), { status: 200 });
    await P.M.retryGuestFailed(id); await P.settle(60);
    const f = lists(P).failed[0]; return { ok: f && !f.blocked && !f.blockedId, note: JSON.stringify(f && { b: f.blocked }) };
  } finally { P.restore(); }
});
check("P172123", F, "'Remove' takes a failed order off the list AND off the phone", HOW, async () => {
  const P = await failedOne(); try {
    await P.M.dismissGuestFailed(lists(P).failed[0].id); await P.settle();
    return lists(P).count === 0 && P.idb._dump().length === 0;
  } finally { P.restore(); }
});
check("P172124", F, "'Order the rest' sends the basket WITHOUT the sold-out dish", HOW, async () => {
  const P = await failedOne(); try {
    const id = lists(P).failed[0].id; const sent = []; globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, order_id: "o3" }), { status: 200 }); };
    const r = await P.M.orderRestWithout(id); await P.settle(60);
    return { ok: r.ok && r.left === 1 && sent.length === 1 && sent[0].items.map((x) => x.id).join() === "a", note: JSON.stringify(sent[0]?.items) };
  } finally { P.restore(); }
});
check("P172125", F, "…under a NEW at-most-once id (the old one carries the server's memory of the refusal)", HOW, async () => {
  const P = await failedOne(); try {
    const id = lists(P).failed[0].id; const ids = []; globalThis.fetch = async (u, init) => { ids.push(init.headers["X-LFH-Action-Id"]); return new Response(JSON.stringify({ ok: true, order_id: "o3" }), { status: 200 }); };
    await P.M.orderRestWithout(id); await P.settle(60); return ids.length === 1 && ids[0] !== id;
  } finally { P.restore(); }
});
check("P172126", F, "…keeping the REAL quantities in the diner's own summary (2 × Coffee, not 1 ×)", HOW, async () => {
  const P = await failedOne(); try {
    const id = lists(P).failed[0].id; globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, order_id: "o3" }), { status: 200 });
    await P.M.orderRestWithout(id); await P.settle(60);
    const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house"))[0]; return { ok: t.items[0].qty === 2 && t.items[0].title === "Coffee", note: JSON.stringify(t.items) };
  } finally { P.restore(); }
});
check("P172127", F, "'Order the rest' on an order no dish was blamed for refuses — it never re-sends the same basket", HOW, async () => {
  const P = await failedOne(() => ok({ ok: false, reason: "session_closed" })); try {
    const r = await P.M.orderRestWithout(lists(P).failed[0].id); return r.ok === false && P.fetches.length === 1;
  } finally { P.restore(); }
});
check("P172128", F, "'Order the rest' when the blamed dish was the ONLY line refuses rather than sending nothing", HOW, async () => S({ online: false, respond: () => ok({ ok: false, reason: "sold_out", item: "Coffee" }) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER({ items: [{ id: "a", qty: 1 }], lines: [{ id: "a", title: "Coffee" }] })); P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  const r = await P.M.orderRestWithout(lists(P).failed[0].id); return r.ok === false && lists(P).failed.length === 1;
}));
check("P172129", F, "'Order the rest' drops by ID, so two dishes sharing a name are not both dropped", HOW, async () => S({ online: false, respond: () => ok({ ok: false, reason: "unknown_item", item: "b" }) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER({ items: [{ id: "a", qty: 1 }, { id: "b", qty: 1 }, { id: "c", qty: 1 }], lines: [{ id: "a", title: "Tea" }, { id: "b", title: "Tea" }, { id: "c", title: "Cake" }] }));
  P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  const sent = []; globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, order_id: "o4" }), { status: 200 }); };
  const r = await P.M.orderRestWithout(lists(P).failed[0].id); await P.settle(60);
  return { ok: r.ok && sent[0]?.items.map((x) => x.id).join() === "a,c", note: JSON.stringify(sent[0]?.items) };
}));
check("P172130", F, "'Not needed' takes back a queued CALL that has not rung anything yet", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestCall(CALL()); const x = await P.M.cancelQueuedCall(r.action_id);
  return x.ok === true && lists(P).count === 0;
}));
check("P172131", F, "'Not needed' REFUSES a saved order (the kitchen may already hold it), by kind, with a reason", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestOrder(ORDER()); const x = await P.M.cancelQueuedCall(r.action_id);
  return x.ok === false && x.reason === "not_a_call" && lists(P).count === 1;
}));
check("P172132", F, "'Not needed' on a call that already went answers not_found, so the screen can say so", HOW, async () => S({ online: false }, async (P) => {
  const x = await P.M.cancelQueuedCall("gone"); return x.ok === false && x.reason === "not_found";
}));
check("P172133", F, "'Not needed' also refuses a saved LEAVE (it is not a call)", HOW, async () => S({ online: false }, async (P) => {
  const r = await P.M.enqueueGuestLeave({ token: "t" }); const x = await P.M.cancelQueuedCall(r.action_id);
  return x.ok === false && x.reason === "not_a_call";
}));

// ── A6. coming back after a reload — restore (P172134–P172145) ──────────────────────────────────
const SAVED = (o = {}) => ({ id: "11111111-1111-4111-8111-111111111111", mode: "public", table: "4", restaurantId: FH, items: [{ id: "a", qty: 1 }], allergies: [], at: Date.now() - 60000, status: "queued", ...o });
check("P172134", F, "an order saved before a reload is read back and gets its own timer", HOW, async () => S({ online: false, idb: { preload: [SAVED()] } }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(60);
  return { ok: lists(P).queued.length === 1 && P.pending().length >= 1, note: `${lists(P).queued.length} restored, ${P.pending().length} timers` };
}));
check("P172135", F, "…and is SENT on its own once the phone is online", HOW, async () => S({ online: true, idb: { preload: [SAVED()] }, respond: () => ok({ ok: true, order_id: "o5" }) }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(80);
  return { ok: P.fetches.length === 1 && lists(P).count === 0, note: `${P.fetches.length} sends` };
}));
check("P172136", F, "a failed row saved before the reload comes back as 'couldn't send', with its sentence", HOW, async () => S({ online: false, idb: { preload: [SAVED({ status: "failed", error: "Your table was closed while you were offline." })] } }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(60);
  const L = lists(P); return L.failed.length === 1 && L.failed[0].error.includes("closed");
}));
check("P172137", F, "a row written before 'kind' existed is read as an ORDER", HOW, async () => S({ online: true, idb: { preload: [SAVED()] }, respond: () => ok({ ok: true, order_id: "o5" }) }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(80); return P.fetches[0]?.url === "/api/guest/place-order";
}));
check("P172138", F, "restored rows drain oldest first", HOW, async () => S({ online: true, idb: { preload: [SAVED({ id: "b", table: "2", at: Date.now() - 1000 }), SAVED({ id: "a", table: "1", at: Date.now() - 9000 })] }, respond: () => ok({ ok: true, order_id: "o" }) }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(100);
  return { ok: P.fetches.map((f) => f.body.table).join(",") === "1,2", note: P.fetches.map((f) => f.body.table).join(",") };
}));
check("P172139", F, "an order saved in the same instant the restore lands is MERGED, never wiped from the send list", HOW, async () => S({ online: false, idb: { preload: [SAVED()] } }, async (P) => {
  P.M.useGuestOutbox(); await P.M.enqueueGuestOrder(ORDER({ table: "9" })); await P.settle(80);
  const t = lists(P).queued.map((x) => x.table).sort().join(","); return { ok: t === "4,9", note: t };
}));
check("P172140", F, "a phone that NEVER saved anything does not gain a database just by opening the menu", HOW, async () => S({ online: true }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(60); return { ok: P.idb.opened.length === 0, note: `opened ${P.idb.opened.join(",")}` };
}));
check("P172141", F, "…but a browser that cannot list its databases opens it anyway (never lose a saved order)", HOW, async () => S({ online: false, idb: { noDatabases: true, preload: [SAVED()] } }, async (P) => {
  P.M.useGuestOutbox(); await P.settle(60); return P.idb.opened.length === 1 && lists(P).queued.length === 1;
}));
check("P172142", F, "the badge's first read on the server is the EMPTY snapshot (no flash of someone else's queue)", HOW, async () => S({}, async (P) => {
  const s = P.M.useGuestOutbox(); return s.count === 0 && Array.isArray(s.queued) && Array.isArray(s.failed);
}));
check("P172143", F, "the snapshot is a COPY — changing it cannot change what gets sent", HOW, async () => S({ online: false }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER()); const s = lists(P); s.queued.length = 0; P.setOnline(true);
  await P.M.flushGuestOutbox(); await P.settle();
  return { ok: P.fetches.length === 1, note: `${P.fetches.length} send(s) after the screen's copy was emptied` };
}));
check("P172144", F, "the count is queued + failed together, matching what the chip and the badge show", HOW, async () => S({ online: false, respond: () => ok({ ok: false, reason: "session_closed" }) }, async (P) => {
  await P.M.enqueueGuestOrder(ORDER({ table: "1" })); P.setOnline(true); await P.M.flushGuestOutbox(); await P.settle();
  P.setOnline(false); await P.M.enqueueGuestOrder(ORDER({ table: "2" }));
  const L = lists(P); return L.count === 2 && L.queued.length === 1 && L.failed.length === 1;
}));
check("P172145", F, "a saved order's table and restaurant reach the server exactly as the diner saved them", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }), ORDER({ table: "17" }));
  return P.fetches[0].body.table === "17" && P.fetches[0].body.restaurantId === FH && P.fetches[0].body.mode === "public";
});
check("P172146", F, "a session order is sent with its token (identity comes from the token, not the table)", HOW, async () => {
  const { P } = await sendOnce(() => ok({ ok: true, order_id: "o1" }), ORDER({ mode: "session", token: "tok-9", table: undefined }));
  return P.fetches[0].body.token === "tok-9" && P.fetches[0].body.mode === "session";
});
check("P172147", F, "an order refused for allergies_too_long says how to fix it (shorten it, or tell staff)", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "allergies_too_long" }, 400));
  return { ok: /shorten/.test(L.failed[0].error), note: L.failed[0].error };
});
check("P172148", F, "an order refused for unknown_restaurant is told, not filed under restaurant #1", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "unknown_restaurant" }, 400));
  return { ok: /which restaurant/.test(L.failed[0].error), note: L.failed[0].error };
});
check("P172149", F, "an order refused off_plan_table reads 'isn't one this restaurant has', not 'try again'", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "off_plan_table" }, 400));
  return { ok: /isn't one this restaurant has/.test(L.failed[0].error), note: L.failed[0].error };
});
check("P172150", F, "an order refused rate_limited after a reconnect tells the diner to WAIT", HOW, async () => {
  const { L } = await sendOnce(() => ok({ ok: false, reason: "rate_limited" }));
  return { ok: /wait/i.test(L.failed[0].error) && !/try again/i.test(L.failed[0].error), note: L.failed[0].error };
});
