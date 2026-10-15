// Round 3 · F — EVERY LINE AND BRANCH THE COVERAGE METER SAID NOTHING RAN (./cover.mjs), closed one by one.
//
// Each check names the gap it closes. Same harness as B–E: the real files, the fake phone, the
// in-memory database. Nothing leaves the Mac.
import { check, real } from "./h.mjs";
import { phone, lists } from "../phone.mjs";
import { G } from "../stubs/state.mjs";
import { world, call } from "./c-doors.mjs";

const FH = "00000000-0000-0000-0000-000000000001";
const load = () => real("lib/guestOutbox.ts");
async function on(opts, fn) { const P = await phone({ load, ...opts }); try { lists(P); await P.settle(15); return await fn(P, P.M); } finally { P.restore(); } }
const order = (M, extra = {}) => M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea", qty: 2 }, { id: "cake", qty: 1 }], allergies: [], lines: [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }], track: { tableNumber: "4", total: 3, itemCount: 2, items: [{ title: "Tea", qty: 2 }, { title: "Cake", qty: 1 }] }, ...extra });

// ── the four doors ──────────────────────────────────────────────────────────────────────────────
check("R3-F01", "F", "call door: a seated call whose restaurant cannot be worked out still answers — and drops no floor snapshot (L154)", async () => {
  world(); G.RPC.lfh_call_waiter = { ok: true };   // no restaurant in the answer, none in the body, unknown token
  const r = await call("call-waiter", { mode: "session", token: "tok-nobody", reason: "Water" });
  return { ok: r.status === 200 && r.json?.ok === true && G.FLOOR.length === 0, note: `${r.status} · ${G.FLOOR.length} snapshot drop(s)` };
});
check("R3-F02", "F", "call door: a call that did NOT land (refused, already pending, an empty answer) drops no floor snapshot; one that landed does (L51–54)", async () => {
  const out = [];
  for (const [ans, want] of [[{ ok: false, reason: "blocked" }, 0], [{ ok: true, already_active: true, restaurant_id: FH }, 0], [null, 0], [{ ok: true, restaurant_id: FH }, 1]]) {
    world(); G.RPC.lfh_call_waiter = ans; await call("call-waiter", { mode: "session", token: "tok-live", reason: "Water", restaurantId: FH });
    out.push(G.FLOOR.length === want ? "·" : `✗(${JSON.stringify(ans)} → ${G.FLOOR.length})`);
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F03", "F", "call door: the restaurant comes from the answer (either spelling), else the body, else the token (L147–151)", async () => {
  const out = [];
  for (const [ans, body, label] of [[{ ok: true, restaurantId: FH }, {}, "camelCase answer"], [{ ok: true }, { restaurantId: FH }, "body"], [{ ok: true }, {}, "token"]]) {
    world(); G.RPC.lfh_call_waiter = ans; await call("call-waiter", { mode: "session", token: "tok-live", reason: "Water", ...body });
    out.push(G.FLOOR.includes(FH) ? "·" : `✗ ${label}`);
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F04", "F", "call and order doors: an answer of nothing at all is the readable \"empty\", never a crash (L155, L180, L200, L237)", async () => {
  const out = [];
  for (const [door, fn, b] of [["call-waiter", "lfh_call_waiter", { mode: "session", token: "tok-live", reason: "W" }], ["call-waiter", "lfh_call_waiter_table", { mode: "public", table: "4", restaurantId: FH, reason: "W" }], ["place-order", "lfh_place_order", { mode: "session", token: "tok-live", items: [{ id: "tea" }], allergies: [] }], ["place-order", "lfh_place_order_public", { mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea" }], allergies: [] }]]) {
    world(); G.RPC[fn] = null; const r = await call(door, b); out.push(r.status < 500 && r.json?.reason === "empty" ? "·" : `✗ ${door}/${fn} ${r.status}`);
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F05", "F", "leave door: a database that fails answers busy with a Retry-After — the phone keeps the leave and sends it later (L29–33, L51)", async () => {
  world(); G.RPC.lfh_leave_session = { error: { code: "57014", message: "canceling statement due to statement timeout" } };
  const r = await call("leave", { token: "tok-live", restaurantId: FH });
  return { ok: r.status >= 502 && r.json?.reason === "server_busy" && r.json?.retryAfter >= 20 && r.json?.retryAfter <= 45, note: `${r.status} ${r.text.slice(0, 70)}` };
});
check("R3-F06", "F", "leave door: with no restaurant in the body, a landed leave finds it from the token; an empty answer is \"empty\" (L78, L82)", async () => {
  world(); const a = await call("leave", { token: "tok-live" }); const dropped = G.FLOOR.includes(FH);
  world(); G.RPC.lfh_leave_session = null; const b = await call("leave", { token: "tok-live", restaurantId: FH });
  return { ok: a.json?.ok === true && dropped && b.json?.reason === "empty", note: `token→restaurant ${dropped} · empty ${b.json?.reason}` };
});
check("R3-F07", "F", "order door: a table's order limit pings the owner's phone, from the seated and the QR door alike (L34–35)", async () => {
  world(); G.RPC.lfh_place_order_public = { ok: false, reason: "rate_limited" }; await call("place-order", { mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea" }], allergies: [] });
  const a = G.PINGS.length;
  world(); G.RPC.lfh_place_order = { ok: false, reason: "rate_limited", restaurant_id: FH }; await call("place-order", { mode: "session", token: "tok-live", items: [{ id: "tea" }], allergies: [] });
  return { ok: a === 1 && G.PINGS.length === 1 && G.PINGS[0].rid === FH, note: `QR ${a} · seated ${G.PINGS.length}` };
});
check("R3-F08", "F", "order door: a seated order's restaurant comes from the answer, else the body, else the token; an item with no qty counts as one (L46, L148, L172)", async () => {
  const out = [];
  for (const [ans, body, label] of [[{ ok: true, order_id: "o", restaurant_id: FH }, {}, "answer"], [{ ok: true, order_id: "o" }, { restaurantId: FH }, "body"], [{ ok: true, order_id: "o" }, {}, "token"], ["not an object", { restaurantId: FH }, "odd answer"]]) {
    world(); G.RPC.lfh_place_order = ans; const r = await call("place-order", { mode: "session", token: "tok-live", items: [{ id: "tea" }], allergies: [], ...body });
    out.push(r.status < 500 && (label === "odd answer" || G.FLOOR.includes(FH)) ? "·" : `✗ ${label}`);
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F09", "F", "order door: an order replayed after its table moved on is refused with the table's own words, and never placed (L226)", async () => {
  world(); G.CLASH = () => ({ plain: "Table 4 was closed while you were offline — please order again at your table." });
  const r = await call("place-order", { mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea" }], allergies: [] }, { headers: { "X-LFH-Replay": "1" } });
  const placed = G.RPC_CALLS.some((c) => c.name === "lfh_place_order_public");
  return { ok: r.status === 409 && !placed && /closed while you were offline/.test(r.text), note: `${r.status} ${r.text.slice(0, 70)}` };
});
// ── the queue: wording ─────────────────────────────────────────────────────────────────────────
check("R3-F10", "F", "every refusal the database can give is worded both live and saved, names the dish when it has one, and never shows a code (L208–251)", async () => {
  const M = await load(); const bad = [];
  const reasons = ["session_closed", "not_approved", "otp_required", "unknown_item", "staff_priced_item", "hidden_item", "sold_out", "invalid_token", "rate_limited", "order_too_big", "blocked", "call_too_old", "off_plan_table", "unknown_table", "server_busy", "allergies_too_long", "made_up_code"];
  for (const r of reasons) for (const q of [true, false]) for (const kind of ["order", "call", "leave"]) for (const dish of [undefined, "Paneer Tikka"]) {
    const s = M.reasonMsg(r, { queued: q, kind, dish });
    if (!s || /[a-z]+_[a-z]+/.test(s)) bad.push(`${r}/${q}/${kind}: ${s}`);
    if (dish && kind === "order" && ["sold_out", "hidden_item", "unknown_item"].includes(r) && !s.includes(dish)) bad.push(`${r} drops the dish's name`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${reasons.length} reasons × live/saved × 3 kinds × with/without a dish` };
});
check("R3-F11", "F", "a live order's thrown error is read back into its refusal and dish (refusalOf, L311–314)", async () => {
  const M = await load();
  const a = M.refusalOf(new Error("Order failed: sold_out (Paneer Tikka)")), b = M.refusalOf(new Error("something else")), c = M.refusalOf(null);
  return { ok: a.reason === "sold_out" && a.dish === "Paneer Tikka" && !b.reason && !c.reason, note: JSON.stringify([a, b, c]) };
});
check("R3-F12", "F", "a refused dish is named from the basket's own lines — its title, or the line its id points at (dishFor, blockedLineId, L342–345, L591–594)", async () => {
  const M = await load(); const lines = [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }];
  const out = [M.dishFor("unknown_item", "cake", lines), M.dishFor("unknown_item", "nope", lines), M.dishFor("sold_out", "Tea", lines), M.dishFor("sold_out", "", lines)];
  return { ok: out[0] === "Cake" && out[1] === undefined && out[2] === "Tea" && !out[3], note: JSON.stringify(out) };
});
// ── the queue: limits and failures ─────────────────────────────────────────────────────────────
check("R3-F13", "F", "the 26th saved ORDER pushes the oldest out with a sentence about ordering it again (L464–465)", () => on({ online: false }, async (P, M) => {
  for (let i = 0; i < 26; i++) await order(M, { table: String(1 + (i % 9)) });
  const L = lists(P); return { ok: L.queued.length === 25 && L.failed.length === 1 && /order it again/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("R3-F14", "F", "six DROPPED sends in a row move an order to couldn't-send with the no-connection sentence (L703–705)", () => on({ online: false, respond: () => new TypeError("Failed to fetch") }, async (P, M) => {
  await order(M); P.setOnline(true);
  for (let i = 0; i < 6; i++) { await M.flushGuestOutbox(); await P.settle(10); }
  const L = lists(P); return { ok: L.failed.length === 1 && /couldn't reach the restaurant/.test(L.failed[0].error) && L.failed[0].netTries === 6, note: `${L.failed[0]?.error} (${L.failed[0]?.netTries})` };
}));
check("R3-F15", "F", "a saved order whose table moved on while offline fails with the table's own words (L727–728)", () => on({ online: false, respond: () => ({ status: 409, json: { clash: { plain: "Table 4 was closed while you were offline." } } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const L = lists(P); return { ok: L.failed.length === 1 && L.failed[0].error === "Table 4 was closed while you were offline.", note: L.failed[0]?.error };
}));
check("R3-F16", "F", "a duplicate that the server had REFUSED stays refused — not counted as sent (L769–773)", () => on({ online: false, respond: () => ({ status: 200, json: { duplicate: true, ok: false, reason: "sold_out", item: "Tea" } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const L = lists(P), tracked = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]").length;
  return { ok: L.failed.length === 1 && /Tea/.test(L.failed[0].error) && tracked === 0, note: `${L.failed[0]?.error} · ${tracked} tracked` };
}));
check("R3-F17", "F", "a reply that is not JSON at all is a refusal the diner is told about, not a crash (L710)", () => on({ online: false, respond: () => ({ status: 400, raw: "<html>nope</html>" }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const L = lists(P); return { ok: L.failed.length === 1 && L.failed[0].error.length > 10, note: L.failed[0]?.error };
}));
check("R3-F18", "F", "the server's own wait is honoured but not a nonsense one: \"abc\", 0 and -5 are ignored (noteServerRetryAfter, L416)", () => on({ online: false }, async (P, M) => {
  await order(M); const t0 = Math.max(...P.pending().map((t) => t.ms));
  for (const v of ["abc", 0, -5, null]) M.noteServerRetryAfter(v);
  P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);   // the fake answers 200 → the queue empties
  M.noteServerRetryAfter(9999); await order(M, { table: "5" }); P.setOnline(false); await M.flushGuestOutbox(); await P.settle(10);
  const capped = Math.max(...P.pending().map((t) => t.ms));
  return { ok: t0 < 10_000 && capped <= 300_000, note: `first wait ${t0} ms · a 9,999 s request waits ${capped} ms` };
}));
// ── the queue: leave ───────────────────────────────────────────────────────────────────────────
check("R3-F19", "F", "a saved \"I've left\" is DROPPED if the diner sits back down on that same table before it sends (L874–877)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestLeave({ token: "tok-7", restaurantId: FH });
  P.ls.setItem("lfh_session:french-house", JSON.stringify({ table: "7", token: "tok-7" }));
  P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: P.fetches.length === 0 && lists(P).count === 0, note: `${P.fetches.length} sent · ${lists(P).count} left` };
}));
check("R3-F20", "F", "…but sent when the phone holds another table, or its saved session cannot be read (L875, L878)", async () => {
  const out = [];
  for (const sess of [JSON.stringify({ table: "9", token: "tok-OTHER" }), "{not json"]) {
    out.push(await on({ online: false }, async (P, M) => { await M.enqueueGuestLeave({ token: "tok-7", restaurantId: FH }); P.ls.setItem("lfh_session:french-house", sess); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return P.fetches.length === 1; }));
  }
  return { ok: out.every(Boolean), note: JSON.stringify(out) };
});
check("R3-F21", "F", "saving \"I've left\" twice for one table is ONE saved leave (L840)", () => on({ online: false }, async (P, M) => {
  const a = await M.enqueueGuestLeave({ token: "tok-7", restaurantId: FH }), b = await M.enqueueGuestLeave({ token: "tok-7", restaurantId: FH });
  return { ok: a.action_id === b.action_id && lists(P).queued.length === 1, note: `${lists(P).queued.length} saved` };
}));
check("R3-F22", "F", "the 26th saved LEAVE pushes the oldest out with a sentence about telling staff (L853–854)", () => on({ online: false }, async (P, M) => {
  for (let i = 0; i < 26; i++) await M.enqueueGuestLeave({ token: "t" + i, restaurantId: FH });
  const L = lists(P); return { ok: L.queued.length === 25 && /tell a member of staff/.test(L.failed[0]?.error || ""), note: L.failed[0]?.error };
}));
check("R3-F23", "F", "the 26th saved CALL pushes the oldest out with a sentence about staff (L525–526)", () => on({ online: false }, async (P, M) => {
  for (let i = 0; i < 26; i++) await M.enqueueGuestCall({ mode: "public", table: String(i + 1), restaurantId: FH, reason: "Water" });
  const L = lists(P); return { ok: L.queued.length === 25 && /member of staff/.test(L.failed[0]?.error || ""), note: L.failed[0]?.error };
}));
// ── the queue: taking back, sending the rest, trying again ─────────────────────────────────────
check("R3-F24", "F", "taking back a saved call: an unknown id and an order are refused, a call is removed (L883–884)", () => on({ online: false }, async (P, M) => {
  const o = await order(M), c = await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" });
  const a = await M.cancelQueuedCall("nope"), b = await M.cancelQueuedCall(o.action_id), d = await M.cancelQueuedCall(c.action_id);
  return { ok: a.reason === "not_found" && b.reason === "not_a_call" && d.ok && lists(P).queued.length === 1, note: JSON.stringify([a, b, d]) };
}));
check("R3-F25", "F", "\"send the rest\": a sold-out dish is dropped, the rest go under a NEW id with their own quantities (L905–941)", () => on({ online: false, respond: (u, i, n) => (n === 0 ? { status: 400, json: { ok: false, reason: "sold_out", item: "Tea" } } : { status: 200, json: { ok: true, order_id: "o-rest" } }) }, async (P, M) => {
  const first = await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const f = lists(P).failed[0]; const res = await M.orderRestWithout(f.id); await P.settle(30);
  const resent = P.fetches[1]?.body; const newId = P.fetches[1]?.headers["X-LFH-Action-Id"];
  return { ok: f.blocked === "Tea" && f.blockedId === "tea" && res.ok && res.left === 1 && newId && newId !== first.action_id && resent.items.length === 1 && resent.items[0].id === "cake" && lists(P).count === 0,
    note: `${JSON.stringify(res)} · resent ${JSON.stringify(resent?.items)}` };
}));
check("R3-F26", "F", "\"send the rest\" refuses rather than guesses: no refused dish, an unknown id, or nothing left to send (L907, L919–923)", () => on({ online: false, respond: () => ({ status: 400, json: { ok: false, reason: "sold_out", item: "Tea" } }) }, async (P, M) => {
  await M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [], lines: [{ id: "tea", title: "Tea" }] });
  P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const only = lists(P).failed[0];
  const a = await M.orderRestWithout("nope"), b = await M.orderRestWithout(only.id);
  return { ok: !a.ok && !b.ok && lists(P).failed.length === 1, note: JSON.stringify([a, b]) };
}));
check("R3-F27", "F", "Try again on an id that is not there does nothing (L952)", () => on({ online: false }, async (P, M) => {
  await order(M); await M.retryGuestFailed("nope"); return { ok: lists(P).queued.length === 1 && lists(P).failed.length === 0, note: "unchanged" };
}));
// ── the queue: storage and waking up ───────────────────────────────────────────────────────────
check("R3-F28", "F", "the phone's storage refusing to WRITE: the order still waits in memory and says it is not saved (persist → false)", () => on({ online: false, idb: { failWrites: true } }, async (P, M) => {
  const r = await order(M); return { ok: r.persisted === false && lists(P).queued.length === 1, note: JSON.stringify(r) };
}));
check("R3-F29", "F", "the phone's storage refusing to READ or to OPEN after a reload: an empty list, no crash, still able to save (L72, L81–84)", async () => {
  const out = [];
  for (const idb of [{ failReads: true, preload: [{ id: "x1", status: "queued", at: 1, mode: "public", items: [], allergies: [] }] }, { failOpen: true }]) {
    out.push(await on({ online: false, idb }, async (P, M) => { const r = await order(M); return lists(P).queued.length === 1 && r.queued; }));
  }
  return { ok: out.every(Boolean), note: JSON.stringify(out) };
});
check("R3-F30", "F", "a phone that cannot list its databases still restores its saved orders (L1019)", () => on({ online: false, idb: { databasesThrow: true, preload: [{ id: "x1", kind: undefined, status: "queued", at: Date.now(), mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] }] } }, async (P) => {
  await P.settle(30); return { ok: lists(P).queued.some((x) => x.id === "x1"), note: `${lists(P).queued.length} restored` };
}));
check("R3-F31", "F", "a reload that finishes AFTER new saves keeps both the restored and the new ones, once each (L1053–1060)", async () => {
  const pre = [{ id: "old1", status: "queued", at: 1, mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] }, { id: "old2", status: "failed", error: "This one waited too long — please order again.", at: 2, mode: "public", items: [], allergies: [] }];
  const P = await phone({ load, online: false, idb: { preload: pre } });
  try { const M = P.M; const n = await order(M); lists(P); await P.settle(40); const L = lists(P);
    const ids = L.queued.map((x) => x.id).sort();
    return { ok: ids.includes("old1") && ids.includes(n.action_id) && L.failed.length === 1 && L.failed[0].id === "old2" && new Set(ids).size === ids.length, note: `${L.queued.length} waiting · ${L.failed.length} couldn't-send` };
  } finally { P.restore(); }
});
check("R3-F32", "F", "the queue sends by itself when signal returns, when the tab is shown again, and when it gets focus (L990–997)", async () => {
  const out = [];
  for (const ev of ["online", "visibilitychange", "focus"]) {
    out.push(await on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => { await order(M); P.setOnline(true); P.emit(ev); await P.settle(30); return lists(P).count === 0 ? "·" : `✗ ${ev}`; }));
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F33", "F", "a flush asked for while one is running does not start a second one (L661, L436)", () => on({ online: false, respond: () => new Promise((r) => setTimeout(() => r({ status: 200, json: { ok: true, order_id: "o" } }), 40)) }, async (P, M) => {
  await order(M); P.setOnline(true); await Promise.all([M.flushGuestOutbox(), M.flushGuestOutbox(), M.flushGuestOutbox()]); await P.settle(80);
  return { ok: P.fetches.length === 1 && lists(P).count === 0, note: `${P.fetches.length} send(s)` };
}));
check("R3-F34", "F", "a phone with no randomUUID still makes proper at-most-once ids (L103)", () => on({ online: false }, async (P, M) => {
  const d = Object.getOwnPropertyDescriptor(globalThis, "crypto"); Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try { const ids = []; for (let i = 0; i < 5; i++) ids.push((await order(M, { table: String(i + 1) })).action_id);
    return { ok: ids.every((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)) && new Set(ids).size === 5, note: ids[0] };
  } finally { Object.defineProperty(globalThis, "crypto", d); }
}));
check("R3-F35", "F", "a saved order with no saved time still sends a sensible queued-at time; one screen's broken listener never stops the others (L632, L121–122)", () => on({ online: true, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }), idb: { preload: [{ id: "noat-1", status: "queued", mode: "public", table: "4", restaurantId: FH, items: [{ id: "tea", qty: 1 }], allergies: [] }] } }, async (P, M) => {
  P.win.addEventListener("lfh:guest-outbox-changed", () => { throw new Error("a broken screen"); });
  await M.flushGuestOutbox(); await P.settle(30);
  const sent = P.fetches.find((f) => f.headers["X-LFH-Action-Id"] === "noat-1"); const at = sent?.headers["X-LFH-Queued-At"];
  return { ok: !!at && Math.abs(Date.parse(at) - Date.now()) < 60_000 && lists(P).count === 0, note: at || "not sent" };
}));
check("R3-F36", "F", "while the page is drawn on the SERVER the saved list is empty, never this phone's (getServerSnapshot, L1073)", () => on({ online: false }, async (P, M) => {
  await order(M); globalThis.__T3_SSR = true; let s; try { s = M.useGuestOutbox(); } finally { globalThis.__T3_SSR = false; }
  return { ok: s.count === 0 && s.queued.length === 0 && lists(P).count === 1, note: `server ${s.count} · phone ${lists(P).count}` };
}));
check("R3-F37", "F", "no AbortSignal.timeout on an old phone: the send still goes (it simply has no deadline) (L557–558)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  const real = AbortSignal.timeout; AbortSignal.timeout = undefined;
  try { await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return { ok: lists(P).count === 0 && P.fetches.length === 1, note: `${P.fetches.length} sent` }; }
  finally { AbortSignal.timeout = real; }
}));
// ── following an order ─────────────────────────────────────────────────────────────────────────
check("R3-F38", "F", "following an order: once, at the order's own restaurant, and never twice (trackActiveOrder)", async () => {
  const P = await phone({ load }); try {
    const S = await real("lib/orderStatus.ts");
    const a = S.trackActiveOrder({ id: "o1", tableNumber: "4", total: 1, itemCount: 1 }), b = S.trackActiveOrder({ id: "o1", tableNumber: "4", total: 1, itemCount: 1 });
    const c = S.trackActiveOrder({ id: "o2", tableNumber: "2", total: 1, itemCount: 1 }, "aangan-garden-restaurant");
    const here = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]"), there = JSON.parse(P.ls.getItem("lfh_active_orders:aangan-garden-restaurant") || "[]");
    const woke = P.events.filter((e) => e.type === "lfh:order-placed").length;
    return { ok: a && !b && c && here.length === 1 && there.length === 1 && here[0].status === "received" && woke === 2, note: `${here.length} here · ${there.length} there · ${woke} wake-ups` };
  } finally { P.restore(); }
});
// ── second coverage pass: the branches still untaken after F01–F38 ─────────────────────────────
check("R3-F39", "F", "\"the order was empty\" is worded too, live and saved (L251)", async () => {
  const M = await load(); const a = M.reasonMsg("empty_order", { queued: true }), b = M.reasonMsg("empty_order", {});
  return { ok: /empty/.test(a) && /nothing in your order/.test(b), note: `${a} / ${b}` };
});
check("R3-F40", "F", "a duplicate reply with no order id is still \"sent\" — removed, and nothing invented on the strip (L769–773, L351)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, duplicate: true } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const tracked = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]").length;
  return { ok: lists(P).count === 0 && tracked === 0, note: `${lists(P).count} left · ${tracked} tracked` };
}));
check("R3-F41", "F", "an ORDER saved twenty minutes ago still sends — only a call goes stale (L688)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  const real = Date.now; await order(M); Date.now = () => real() + 20 * 60_000;
  try { P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return { ok: P.fetches.length === 1 && lists(P).count === 0, note: `${P.fetches.length} sent` }; } finally { Date.now = real; }
}));
check("R3-F42", "F", "signal lost in the middle of sending: the queue stops and keeps the rest, it does not count it as a failure (L698)", () => on({ online: false, respond: (u, i, n) => { if (n === 0) { globalThis.navigator.onLine = false; return new TypeError("Failed to fetch"); } return { status: 200, json: { ok: true, order_id: "o" } }; } }, async (P, M) => {
  await order(M); await order(M, { table: "5" }); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const L = lists(P); return { ok: P.fetches.length === 1 && L.queued.length === 2 && L.queued.every((x) => !x.netTries), note: `${P.fetches.length} sent · ${L.queued.length} kept · netTries ${L.queued.map((x) => x.netTries || 0)}` };
}));
check("R3-F43", "F", "two calls merge only when they are the SAME table at the SAME restaurant in the SAME mode (L506–507)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" });
  await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Bill" });                       // merges, newest reason wins
  await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: "00000000-0000-0000-0000-00000000aaaa", reason: "Water" });
  await M.enqueueGuestCall({ mode: "session", token: "tok-1", table: "4", restaurantId: FH, reason: "Water" });
  await M.enqueueGuestCall({ mode: "public", table: "5", restaurantId: FH, reason: "Water" });
  const q = lists(P).queued; const fh4 = q.filter((x) => x.mode === "public" && x.table === "4" && x.restaurantId === FH);
  return { ok: q.length === 4 && fh4.length === 1 && fh4[0].reason === "Bill", note: `${q.length} saved · table 4 reason ${fh4[0]?.reason}` };
}));
check("R3-F44", "F", "two saved leaves for DIFFERENT tables stay two (L840)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }); await M.enqueueGuestLeave({ token: "tok-2", restaurantId: FH });
  return { ok: lists(P).queued.length === 2, note: `${lists(P).queued.length}` };
}));
check("R3-F45", "F", "\"send the rest\" on a row saved before dish names were kept: matched by name, quantities default to one (L907–937)", () => on({ online: false, respond: (u, i, n) => (n === 0 ? { status: 400, json: { ok: false, reason: "sold_out", item: "Tea" } } : { status: 200, json: { ok: true, order_id: "o2" } }) }, async (P, M) => {
  await M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "Tea" }, { id: "cake", qty: "x" }], allergies: [], lines: [{ id: "Tea", title: "Tea" }, { id: "cake", title: "Cake" }] });
  P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const f = lists(P).failed[0]; const r = await M.orderRestWithout(f.id); await P.settle(30);
  const sent = P.fetches[1]?.body;
  return { ok: r.ok && r.left === 1 && sent?.items?.[0]?.id === "cake", note: `${JSON.stringify(r)} · ${JSON.stringify(sent?.items)}` };
}));
check("R3-F46", "F", "an empty queue with a timer still set clears it on the next look (L662)", () => on({ online: false }, async (P, M) => {
  const c = await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" });
  await M.dismissGuestFailed(c.action_id);   // removes it from storage, not from the waiting list
  await M.cancelQueuedCall(c.action_id); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: P.pending().length === 0 && lists(P).count === 0, note: `${P.pending().length} timer(s)` };
}));
check("R3-F47", "F", "an id handed in by the caller is the one used on every send (at-most-once across screens) (L459)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  const id = "11111111-2222-4333-8444-555555555555"; const r = await order(M, { actionId: id }); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: r.action_id === id && P.fetches[0].headers["X-LFH-Action-Id"] === id, note: P.fetches[0]?.headers["X-LFH-Action-Id"] };
}));
check("R3-F48", "F", "a leave saved without its restaurant's page name checks the page it is on (L874)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestLeave({ token: "tok-7", restaurantId: FH, restaurantSlug: "" });
  P.ls.setItem("lfh_session:french-house", JSON.stringify({ token: "tok-7" })); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: P.fetches.length === 0 && lists(P).count === 0, note: `${P.fetches.length} sent` };
}));
check("R3-F49", "F", "a page that cannot send events, or a deadline that throws, never stops the queue (L122, L558, orderStatus L137)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  const realT = AbortSignal.timeout; AbortSignal.timeout = () => { throw new Error("no timers here"); };
  const realD = P.win.dispatchEvent; P.win.dispatchEvent = () => { throw new Error("no events here"); };
  try { await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return { ok: lists(P).count === 0 && P.fetches.length === 1, note: `${P.fetches.length} sent` }; }
  finally { AbortSignal.timeout = realT; P.win.dispatchEvent = realD; }
}));
check("R3-F50", "F", "the leave door with a malformed restaurant and a refused leave asks nothing more (L78)", async () => {
  world(); G.RPC.lfh_leave_session = { ok: false, reason: "invalid_token" };
  const r = await call("leave", { token: "tok-live", restaurantId: "nope" });
  const looked = G.READS.some((x) => x.table === "session_members");
  return { ok: r.json?.reason === "invalid_token" && !looked && G.FLOOR.length === 0, note: `${r.json?.reason} · token looked up: ${looked}` };
});
// ── from the first mutation pass: the exact give-up boundary of each counter, per kind ─────────
const SAVE = {
  order: (M) => order(M),
  call: (M) => M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" }),
  leave: (M) => M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH }),
};
const WORDS = { refused: /didn't take/, stillBusy: /still busy/, unreachable: /couldn't reach/ };
const STALL = { refused: () => ({ status: 503, json: { ok: false } }), stillBusy: () => ({ status: 409, json: { retry: true } }), unreachable: () => new TypeError("Failed to fetch") };
const FIELD = { refused: "tries", stillBusy: "busyTries", unreachable: "netTries" };
let fn = 51;
for (const kind of ["order", "call", "leave"]) for (const stall of ["refused", "stillBusy", "unreachable"]) {
  check(`R3-F${fn++}`, "F", `a saved ${kind}: ${stall === "refused" ? "busy (5xx)" : stall === "stillBusy" ? "\"still handling it\" (409)" : "dropped"} five times still waits; the SIXTH moves it to couldn't-send in ${kind} words`, () => on({ online: false, respond: STALL[stall] }, async (P, M) => {
    await SAVE[kind](M); P.setOnline(true);
    for (let i = 0; i < 5; i++) { await M.flushGuestOutbox(); await P.settle(6); }
    const five = lists(P); const waiting = five.queued.length === 1 && five.queued[0][FIELD[stall]] === 5 && five.failed.length === 0;
    await M.flushGuestOutbox(); await P.settle(6);
    const six = lists(P); const e = six.failed[0]?.error || "";
    const kindWords = kind === "order" ? /order again/ : kind === "call" ? /member of staff/ : /you've left/;
    return { ok: waiting && six.queued.length === 0 && six.failed.length === 1 && WORDS[stall].test(e) && kindWords.test(e), note: `after 5: ${five.queued[0]?.[FIELD[stall]]} · after 6: ${e}` };
  }));
}
// ── from the mutation pass: what 115 surviving breaks showed was never pinned down ────────────────
// one round sends EVERYTHING waiting — whatever each one's answer (kills every `continue → break`)
check("R3-F60", "F", "ONE send round tries every saved thing, whatever the server answers each (delivered, busy, still-handling, dropped, refused, limited, clash, duplicate, stale)", () => {
  const plan = ["ok", "503", "409", "drop", "refuse", "rate", "clash", "dupok", "dupno", "ok"];
  let n = 0;
  const respond = (u) => { const m = plan[n++] || "ok";
    if (m === "ok") return { status: 200, json: u.includes("place-order") ? { ok: true, order_id: "o" + n } : { ok: true } };
    if (m === "503") return { status: 503, json: { ok: false } }; if (m === "409") return { status: 409, json: { retry: true } };
    if (m === "drop") return new TypeError("Failed to fetch"); if (m === "refuse") return { status: 400, json: { ok: false, reason: "sold_out", item: "Tea" } };
    if (m === "rate") return { status: 200, json: { ok: true, reason: "rate_limited" } }; if (m === "clash") return { status: 409, json: { clash: { plain: "Table 4 moved on." } } };
    if (m === "dupok") return { status: 200, json: { ok: true, duplicate: true, order_id: "o-d" } }; return { status: 200, json: { ok: true, duplicate: true } }; };
  return on({ online: false, respond }, async (P, M) => {
    const real = Date.now; const t0 = real();
    // a call that will be STALE and a leave the diner has gone back on, at the front: both are judged on the
    // phone, without a request, and must NOT end the round for everything behind them
    await M.enqueueGuestCall({ mode: "public", table: "20", restaurantId: FH, reason: "Old" });
    Date.now = () => t0 + 11 * 60_000;
    try {
      await M.enqueueGuestLeave({ token: "tok-back", restaurantId: FH }); P.ls.setItem("lfh_session:french-house", JSON.stringify({ token: "tok-back" }));
      for (let i = 0; i < 4; i++) await order(M, { table: String(i + 1) });
      await M.enqueueGuestCall({ mode: "public", table: "9", restaurantId: FH, reason: "Water" });
      for (let i = 0; i < 5; i++) await order(M, { table: String(10 + i) });
      lists(P); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(20);
    } finally { Date.now = real; }
    return { ok: n === 10, note: `${n} of 10 live items sent in one round (+ a stale call and a re-joined leave judged on the phone)` };
  });
});
check("R3-F61", "F", "the retry spacing: 5 s, then 15, 30, 60 s… (± a quarter), and back to 5 s once the server answers (L424–427, L759, L761)", () => on({ online: false, respond: (u, i, n) => (n < 6 ? { status: 503, json: { ok: false } } : { status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  await order(M); await order(M, { table: "5" }); P.setOnline(true);
  const waits = [];
  for (let i = 0; i < 3; i++) { await M.flushGuestOutbox(); await P.settle(6); waits.push(Math.max(...P.pending().map((t) => t.ms))); }
  // 6 sends so far all 503 → steps 1..3; now the server answers fine for both → progressed → the backoff resets,
  // so the very next thing saved is retried on the FIRST, short step again
  await M.flushGuestOutbox(); await P.settle(6);
  P.setOnline(false); await order(M, { table: "6" });
  const after = Math.max(...P.pending().map((t) => t.ms));
  const within = (ms, base) => ms >= base * 0.75 && ms <= base * 1.25;
  return { ok: within(waits[0], 15_000) && within(waits[1], 30_000) && within(waits[2], 60_000) && within(after, 5_000), note: `${waits.join(", ")} … then ${after}` };
}));
check("R3-F62", "F", "a server answer of exactly 500 is \"busy\" (kept and retried), never a refusal (L779)", () => on({ online: false, respond: () => ({ status: 500, json: { ok: false } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(6);
  const L = lists(P); return { ok: L.queued.length === 1 && L.queued[0].tries === 1 && L.failed.length === 0, note: `tries ${L.queued[0]?.tries}` };
}));
check("R3-F63", "F", "a saved call exactly ten minutes old still goes; a millisecond more and it is turned away (L688)", async () => {
  const out = [];
  for (const age of [10 * 60_000, 10 * 60_000 + 1]) out.push(await on({ online: false, respond: () => ({ status: 200, json: { ok: true } }) }, async (P, M) => {
    const real = Date.now; const t0 = real(); Date.now = () => t0;
    try { await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "W" }); Date.now = () => t0 + age; P.setOnline(true); await M.flushGuestOutbox(); await P.settle(6); return P.fetches.length; } finally { Date.now = real; }
  }));
  return { ok: out[0] === 1 && out[1] === 0, note: `at 10:00 → ${out[0]} sent · at 10:00.001 → ${out[1]}` };
});
check("R3-F64", "F", "taking back the only saved CALL while an ORDER also waits keeps the order's retry timer (L888)", () => on({ online: false }, async (P, M) => {
  await order(M); const c = await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "W" });
  await M.cancelQueuedCall(c.action_id); return { ok: lists(P).queued.length === 1 && P.pending().length === 1, note: `${P.pending().length} timer(s)` };
}));
check("R3-F65", "F", "a 409 that is neither \"still handling\" nor a clash is a refusal the diner is told about — never a crash (L727)", () => on({ online: false, respond: () => ({ status: 409, json: { ok: false, reason: "session_closed" } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(6);
  const L = lists(P); return { ok: L.failed.length === 1 && /closed/.test(L.failed[0].error), note: L.failed[0]?.error };
}));
check("R3-F66", "F", "a cancelled, a served and a cooking order all read back from the phone as what they were (orderStatus L111)", async () => {
  const P = await phone({ load }); try {
    const S = await real("lib/orderStatus.ts"); const now = Date.now();
    S.writeActiveOrders(["received", "preparing", "served", "cancelled"].map((st, i) => ({ id: "s" + i, tableNumber: "4", total: 1, itemCount: 1, status: st, placedAt: now })));
    const back = S.readActiveOrders().map((o) => o.status);
    return { ok: JSON.stringify(back) === JSON.stringify(["received", "preparing", "served", "cancelled"]), note: back.join(",") };
  } finally { P.restore(); }
});
check("R3-F67", "F", "a junk entry in the saved list is left out however it is broken: no id, an empty id, a numeric id, a list (orderStatus L103)", async () => {
  const P = await phone({ load }); try {
    const S = await real("lib/orderStatus.ts"); const ok = { tableNumber: "4", total: 1, itemCount: 1, status: "preparing", placedAt: Date.now() };
    P.ls.setItem("lfh_active_orders:french-house", JSON.stringify([{ ...ok }, { ...ok, id: "" }, { ...ok, id: 5 }, [ok], { ...ok, id: "good" }]));
    const ids = S.readActiveOrders().map((o) => o.id); return { ok: JSON.stringify(ids) === JSON.stringify(["good"]), note: JSON.stringify(ids) };
  } finally { P.restore(); }
});
check("R3-F68", "F", "\"send the rest\" on a row saved BEFORE line ids were kept matches the dish by name, and keeps the table, allergies and every quantity (L915–937)", () => on({ online: true, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }), idb: { preload: [{ id: "legacy-1", status: "failed", error: "Tea sold out.", blocked: "Tea", at: Date.now(), mode: "public", table: "4", restaurantId: FH, restaurantSlug: "french-house", items: [{ id: "tea", qty: 2 }, { id: "cake", qty: 3 }, { id: "bun", qty: 0 }], allergies: ["nuts"], lines: [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }, { id: "bun", title: "Bun" }], track: { tableNumber: "4", total: 9, itemCount: 3 } }] } }, async (P, M) => {
  await P.settle(30); const r = await M.orderRestWithout("legacy-1"); await P.settle(30);
  const b = P.fetches[0]?.body; const q = lists(P);
  return { ok: r.ok && r.left === 2 && b?.table === "4" && JSON.stringify(b.allergies) === '["nuts"]' && b.items.map((x) => x.id).join() === "cake,bun" && q.count === 0, note: `${JSON.stringify(r)} · sent ${JSON.stringify(b?.items)} for table ${b?.table}` };
}));
check("R3-F69", "F", "…and the rest's own record keeps each dish's quantity, a zero or broken one counted as one (L929–931)", () => on({ online: false, idb: { preload: [{ id: "legacy-2", status: "failed", error: "x", blocked: "Tea", at: Date.now(), mode: "public", table: "4", restaurantId: FH, restaurantSlug: "french-house", items: [{ id: "tea", qty: 2 }, { id: "cake", qty: 3 }, { id: "bun", qty: 0 }], allergies: [], lines: [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }, { id: "bun", title: "Bun" }] }] } }, async (P, M) => {
  await P.settle(30); await M.orderRestWithout("legacy-2"); await P.settle(10);
  const t = lists(P).queued[0]?.track; return { ok: JSON.stringify(t?.items) === JSON.stringify([{ title: "Cake", qty: 3 }, { title: "Bun", qty: 1 }]) && t.itemCount === 2, note: JSON.stringify(t) };
}));
check("R3-F70", "F", "the server's wait: exactly 0 is ignored, 40 s is honoured, and \"wait 9,999 s\" is capped at five minutes (L416–417)", () => on({ online: false }, async (P, M) => {
  await order(M);
  // each value is applied the way it is in real life: noted from a reply, then used by the NEXT scheduling
  const wait = async (v) => { M.noteServerRetryAfter(v); await M.flushGuestOutbox(); await P.settle(6); return Math.max(...P.pending().map((t) => t.ms)); };
  const a = await wait(0), b = await wait(40), c = await wait(9999);
  return { ok: a < 40_000 && b >= 40_000 && b < 300_000 && c === 300_000, note: `0 → ${a} · 40 → ${b} · 9999 → ${c}` };
}));
// the doors: the EXACT answer, not just "some refusal"
check("R3-F71", "F", "a body that is a list, a number, text, true or null is refused as bad_body by every door that takes one (place-order, call, leave)", async () => {
  const bad = [];
  for (const door of ["place-order", "call-waiter", "leave"]) for (const b of [[], [1], 7, "x", true, null]) { world(); const r = await call(door, b); if (r.status !== 400 || r.json?.reason !== "bad_body") bad.push(`${door} ${JSON.stringify(b)} → ${r.status} ${r.json?.reason}`); }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || "18 bodies" };
});
check("R3-F72", "F", "a token or table of the wrong TYPE is bad_body at the order and call doors; a missing token on the seated path is invalid_token", async () => {
  const cases = [["place-order", { mode: "public", restaurantId: FH, table: true, items: [{ id: "t" }], allergies: [] }, "bad_body"], ["place-order", { mode: "session", token: 7, items: [{ id: "t" }], allergies: [] }, "bad_body"], ["place-order", { mode: "public", table: "4", restaurantId: FH, items: [{ id: "t" }], allergies: [7] }, "bad_body"], ["place-order", { mode: "session", items: [{ id: "t" }], allergies: [] }, "invalid_token"],
    ["call-waiter", { mode: "public", table: { t: 1 }, restaurantId: FH }, "bad_body"], ["call-waiter", { mode: "session", token: ["x"] }, "bad_body"], ["call-waiter", { mode: "session" }, "invalid_token"], ["call-waiter", { mode: "public", table: NaN, restaurantId: FH }, "unknown_table"],
    ["leave", { token: 7 }, "invalid_token"], ["leave", {}, "invalid_token"]];
  const bad = []; for (const [door, b, want] of cases) { world(); const r = await call(door, b); if (r.json?.reason !== want) bad.push(`${door} ${JSON.stringify(b)} → ${r.json?.reason}`); }
  return { ok: !bad.length, note: bad.join(" · ") || `${cases.length} cases` };
});
check("R3-F73", "F", "the order door's limits are exact: 200 dishes and 40 allergies of 200 letters go; 201, 41 and 201 letters do not (L134–135)", async () => {
  const it = (n) => Array.from({ length: n }, (_, i) => ({ id: "d" + i, qty: 1 }));
  const send = async (items, allergies) => { world(); return (await call("place-order", { mode: "public", table: "4", restaurantId: FH, items, allergies })).json?.reason || "ok"; };
  const r = [await send(it(200), []), await send(it(201), []), await send(it(1), Array(40).fill("a")), await send(it(1), Array(41).fill("a")), await send(it(1), ["a".repeat(200)]), await send(it(1), ["a".repeat(201)])];
  return { ok: JSON.stringify(r) === JSON.stringify(["ok", "order_too_big", "ok", "allergies_too_long", "ok", "allergies_too_long"]), note: r.join(", ") };
});
check("R3-F74", "F", "the call door: a call with no time, an empty time or a fresh one rings; one older than ten minutes, or with a time that is not a number, does not (L121–125)", async () => {
  const send = async (at) => { world(); const b = { mode: "public", table: "4", restaurantId: FH, reason: "W" }; if (at !== "absent") b.at = at; const r = await call("call-waiter", b); return G.RPC_CALLS.some((c) => c.name === "lfh_call_waiter_table") ? "rang" : r.json?.reason; };
  const now = Date.now(); const r = [await send("absent"), await send(""), await send(null), await send(now - 60_000), await send(now - 11 * 60_000), await send("soon")];
  return { ok: JSON.stringify(r) === JSON.stringify(["rang", "rang", "rang", "rang", "call_too_old", "call_too_old"]), note: r.join(", ") };
});
check("R3-F75", "F", "the call door keeps the first 200 letters of a reason and sends no reason as nothing at all, not \"\" (L134, L195)", async () => {
  world(); await call("call-waiter", { mode: "public", table: "4", restaurantId: FH, reason: "x".repeat(250) }); const a = G.RPC_CALLS.find((c) => c.name === "lfh_call_waiter_table")?.args.p_note;
  world(); await call("call-waiter", { mode: "public", table: "4", restaurantId: FH }); const b = G.RPC_CALLS.find((c) => c.name === "lfh_call_waiter_table")?.args.p_note;
  return { ok: a?.length === 200 && b === null, note: `${a?.length} letters · empty → ${JSON.stringify(b)}` };
});
check("R3-F76", "F", "the limit beacon names the restaurant it was sent for, and none for a malformed one (limit-hit L54)", async () => {
  const ip = { "x-forwarded-for": "10.88.0." + Math.floor(Math.random() * 250) };
  world(); await call("limit-hit", { fn: "lfh_call_waiter_table", rid: FH }, { id: null, headers: ip }); const a = G.PINGS[0]?.rid;
  world(); await call("limit-hit", { fn: "lfh_call_waiter_table", rid: "nope" }, { id: null, headers: ip }); const b = G.PINGS[0]?.rid;
  return { ok: a === FH && b === null && G.PINGS[0]?.key === "waiter_call", note: `${a} · ${b}` };
});
check("R3-F77", "F", "the doors tell the operator (a warning in the server log) when a landed seated action has no restaurant to drop the floor snapshot for", async () => {
  const seen = []; const w = console.warn; console.warn = (...a) => seen.push(a.join(" "));
  try {
    world(); G.RPC.lfh_call_waiter = { ok: true }; await call("call-waiter", { mode: "session", token: "tok-nobody", reason: "W" });
    world(); G.RPC.lfh_place_order = { ok: true, order_id: "o" }; await call("place-order", { mode: "session", token: "tok-nobody", items: [{ id: "t" }], allergies: [] });
    world(); await call("leave", { token: "tok-nobody" });
    world(); G.RPC.lfh_leave_session = { ok: false, reason: "invalid_token" }; await call("leave", { token: "tok-nobody" });   // refused → nothing to warn about
  } finally { console.warn = w; }
  return { ok: seen.length === 3 && seen.every((s) => /no resolvable restaurant/.test(s)), note: `${seen.length} warning(s)` };
});
// ── from mutation pass 2: the 20 survivors that were real missing checks (the rest change nothing observable) ──
const AA = "00000000-0000-0000-0000-00000000aaaa";
check("R3-F78", "F", "call door: a call exactly ten minutes old is still answered; a millisecond more is too old (L125)", async () => {
  const realNow = Date.now; const t = realNow(); Date.now = () => t;
  try { world(); await call("call-waiter", { mode: "public", table: "4", restaurantId: FH, reason: "W", at: t - 600_000 }); const a = G.RPC_CALLS.length;
    world(); const r = await call("call-waiter", { mode: "public", table: "4", restaurantId: FH, reason: "W", at: t - 600_001 });
    return { ok: a === 1 && r.json?.reason === "call_too_old", note: `10:00 → ${a ? "rang" : "refused"} · 10:00.001 → ${r.json?.reason}` };
  } finally { Date.now = realNow; }
});
check("R3-F79", "F", "a QR call with NO table is \"unknown_table\" (a table is needed), not a malformed body (L131)", async () => {
  world(); const a = await call("call-waiter", { mode: "public", restaurantId: FH, reason: "W" });
  world(); const b = await call("call-waiter", { mode: "public", restaurantId: FH, reason: "W", table: null });
  return { ok: a.json?.reason === "unknown_table" && b.json?.reason === "unknown_table", note: `${a.json?.reason} / ${b.json?.reason}` };
});
check("R3-F80", "F", "the restaurant the DATABASE names wins over the body's and the token's — at the call, order and leave doors (call L146, order L46–47, L172, leave L25)", async () => {
  const out = [];
  world(); G.RPC.lfh_call_waiter = { ok: true, restaurant_id: AA }; await call("call-waiter", { mode: "session", token: "tok-live", reason: "W", restaurantId: FH }); out.push(G.FLOOR.join() === AA ? "·" : `✗ call ${G.FLOOR}`);
  world(); G.RPC.lfh_place_order = { ok: true, order_id: "o", restaurant_id: AA }; await call("place-order", { mode: "session", token: "tok-live", items: [{ id: "t" }], allergies: [], restaurantId: FH }); out.push(G.FLOOR.join() === AA ? "·" : `✗ order ${G.FLOOR}`);
  world(); G.RPC.lfh_place_order = { ok: true, order_id: "o" }; await call("place-order", { mode: "session", token: "tok-live", items: [{ id: "t" }], allergies: [], restaurantId: AA }); out.push(G.FLOOR.join() === AA ? "·" : `✗ order-body ${G.FLOOR}`);
  world(); G.RPC.lfh_place_order = "an odd answer"; await call("place-order", { mode: "session", token: "tok-live", items: [{ id: "t" }], allergies: [], restaurantId: AA }); out.push(!G.FLOOR.includes("x") ? "·" : `✗ odd ${G.FLOOR}`);
  world(); await call("leave", { token: "tok-live", restaurantId: AA }); out.push(G.FLOOR.join() === AA ? "·" : `✗ leave-body ${G.FLOOR}`);
  world(); await call("leave", { token: "tok-live", restaurantId: "nope" }); out.push(G.FLOOR.join() === FH ? "·" : `✗ leave-bad-id ${G.FLOOR}`);
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F81", "F", "order door: a seated order with no restaurant anywhere drops NO floor snapshot (never one for a blank restaurant) (L72)", async () => {
  world(); G.RPC.lfh_place_order = { ok: true, order_id: "o" }; await call("place-order", { mode: "session", token: "tok-nobody", items: [{ id: "t" }], allergies: [] });
  return { ok: G.FLOOR.length === 0, note: JSON.stringify(G.FLOOR) };
});
check("R3-F82", "F", "a phone that never saved anything does not even open its saved-work storage (L1012)", async () => {
  const P = await phone({ load, online: true }); try { lists(P); await P.settle(30); return { ok: P.idb.opened.length === 0, note: `${P.idb.opened.length} open(s)` }; } finally { P.restore(); }
});
check("R3-F83", "F", "a refusal that is not shared by every kind is said about the right thing: a CALL in call words, a LEAVE in leaving words (L203)", async () => {
  const M = await load(); const c = M.reasonMsg("sold_out", { kind: "call", queued: true }), l = M.reasonMsg("sold_out", { kind: "leave", queued: true });
  return { ok: /staff/.test(c) && !/left/.test(c) && /left/.test(l), note: `${c} / ${l}` };
});
check("R3-F84", "F", "a delivered saved ORDER appears on the strip once, with its table, total and dishes (L351–364)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o-777" } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const t = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]");
  return { ok: t.length === 1 && t[0].id === "o-777" && t[0].tableNumber === "4" && t[0].total === 3 && t[0].itemCount === 2 && t[0].items?.length === 2, note: JSON.stringify(t[0]).slice(0, 120) };
}));
check("R3-F85", "F", "an order saved at ANOTHER restaurant and sent while the tab is on this one is followed under ITS restaurant (L356, L452)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o-aa" } }) }, async (P, M) => {
  await order(M, { restaurantId: AA, restaurantSlug: "aangan-garden-restaurant" }); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const there = JSON.parse(P.ls.getItem("lfh_active_orders:aangan-garden-restaurant") || "[]"), here = JSON.parse(P.ls.getItem("lfh_active_orders:french-house") || "[]");
  return { ok: there.length === 1 && here.length === 0, note: `${there.length} there · ${here.length} here` };
}));
check("R3-F86", "F", "a call and a leave saved for another restaurant keep that restaurant's page name (L519, L849)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: AA, restaurantSlug: "aangan-garden-restaurant", reason: "W" });
  await M.enqueueGuestLeave({ token: "tok-aa", restaurantId: AA, restaurantSlug: "aangan-garden-restaurant" });
  const s = lists(P).queued.map((x) => x.restaurantSlug); return { ok: s.length === 2 && s.every((x) => x === "aangan-garden-restaurant"), note: s.join(",") };
}));
check("R3-F87", "F", "a saved leave for another restaurant is dropped when the diner is back at THAT restaurant's table — read from that restaurant (L874)", () => on({ online: false }, async (P, M) => {
  await M.enqueueGuestLeave({ token: "tok-aa", restaurantId: AA, restaurantSlug: "aangan-garden-restaurant" });
  P.ls.setItem("lfh_session:aangan-garden-restaurant", JSON.stringify({ token: "tok-aa" })); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: P.fetches.length === 0 && lists(P).count === 0, note: `${P.fetches.length} sent` };
}));
check("R3-F88", "F", "every send carries the 15-second deadline (L555)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  const real = AbortSignal.timeout; const marker = new AbortController().signal; let ms = null; AbortSignal.timeout = (n) => { ms = n; return marker; };
  try { await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return { ok: ms === 15_000 && P.fetches[0]?.signal === marker, note: `deadline ${ms} ms · attached ${P.fetches[0]?.signal === marker}` }; }
  finally { AbortSignal.timeout = real; }
}));
check("R3-F89", "F", "a server wait that is not a number never becomes a zero-second loop: the next retry still waits (L416)", () => on({ online: false }, async (P, M) => {
  await order(M); M.noteServerRetryAfter("abc"); M.noteServerRetryAfter(NaN); await M.flushGuestOutbox(); await P.settle(6);
  const w = P.pending().map((t) => t.ms); return { ok: w.length === 1 && Number.isFinite(w[0]) && w[0] >= 1000, note: JSON.stringify(w) };
}));
check("R3-F90", "F", "the round goes on after a saved thing gives up on its SIXTH try — busy, still-handling or dropped — and after a limited call (L705, L725, L758, L783)", async () => {
  const out = [];
  for (const [field, ans] of [["tries", { status: 503, json: { ok: false } }], ["busyTries", { status: 409, json: { retry: true } }], ["netTries", new TypeError("Failed to fetch")]]) {
    out.push(await on({ online: true, respond: (u, i, n, c) => (c.headers["X-LFH-Action-Id"] === "tired-1" ? ans : { status: 200, json: { ok: true, order_id: "o" } }), idb: { preload: [{ id: "tired-1", status: "queued", at: Date.now() - 2, mode: "public", table: "4", restaurantId: FH, items: [{ id: "t", qty: 1 }], allergies: [], [field]: 5 }, { id: "fresh-1", status: "queued", at: Date.now() - 1, mode: "public", table: "5", restaurantId: FH, items: [{ id: "t", qty: 1 }], allergies: [] }] } }, async (P) => {
      // ONE round only: the reload's own restore sends both. A second round would hide a round that stopped early.
      await P.settle(40); const sentFresh = P.fetches.some((f) => f.headers["X-LFH-Action-Id"] === "fresh-1"); return sentFresh ? "·" : `✗ ${field}`;
    }));
  }
  out.push(await on({ online: false, respond: (u) => (u.includes("call-waiter") ? { status: 200, json: { ok: true, reason: "rate_limited" } } : { status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
    await M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "W" }); await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
    // …and the limited call is TOLD (couldn't-send, in the limit's words) — never dropped as if it had rung
    const f = lists(P).failed; return P.fetches.length === 2 && f.length === 1 && f[0].kind === "call" && /wait|minute|staff/i.test(f[0].error) ? "·" : `✗ limited call (${f.length} failed)`;
  }));
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F91", "F", "a success in a round with a failure resets the spacing to the first, short step (L759, L761, L771 — progressed)", async () => {
  const out = [];
  for (const okAns of [{ status: 200, json: { ok: true } }, { status: 200, json: { ok: true, order_id: "o" } }, { status: 200, json: { ok: true, duplicate: true } }]) {
    out.push(await on({ online: false, respond: (u, i, n, c) => (c.headers["X-LFH-Action-Id"] === "bad-1" ? { status: 503, json: { ok: false } } : okAns) }, async (P, M) => {
      // two failed rounds first, so the spacing has grown
      await M.enqueueGuestOrder({ mode: "public", table: "4", restaurantId: FH, items: [{ id: "t", qty: 1 }], allergies: [], actionId: "bad-1" });
      P.setOnline(true); for (let i = 0; i < 2; i++) { await M.flushGuestOutbox(); await P.settle(6); }
      const grown = Math.max(...P.pending().map((t) => t.ms));
      if (okAns.json.order_id) await order(M, { table: "6" }); else if (okAns.json.duplicate) await order(M, { table: "7" }); else await M.enqueueGuestCall({ mode: "public", table: "8", restaurantId: FH, reason: "W" });
      await M.flushGuestOutbox(); await P.settle(6);
      const after = Math.max(...P.pending().map((t) => t.ms));
      return grown >= 22_000 && after <= 6_250 ? "·" : `✗ ${grown}→${after}`;
    }));
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F92", "F", "a dish refused in a 200 reply still offers \"send the rest\" (L769–770, L800)", () => on({ online: false, respond: () => ({ status: 200, json: { ok: false, reason: "sold_out", item: "Tea" } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const f = lists(P).failed[0]; return { ok: f?.blocked === "Tea" && f.blockedId === "tea", note: `${f?.blocked} / ${f?.blockedId}` };
}));
check("R3-F93", "F", "a refusal that is not about one dish never offers \"send the rest\", even if the reply names something (L800)", () => on({ online: false, respond: () => ({ status: 400, json: { ok: false, reason: "staff_priced_item", item: "Tea" } }) }, async (P, M) => {
  await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  const f = lists(P).failed[0]; return { ok: f && !f.blocked && !f.blockedId, note: `blocked ${f?.blocked}` };
}));
check("R3-F94", "F", "a duplicate that was refused does not end the round for the next saved thing (L770)", () => on({ online: false, respond: (u, i, n) => (n === 0 ? { status: 200, json: { duplicate: true, ok: false, reason: "sold_out", item: "Tea" } } : { status: 200, json: { ok: true, order_id: "o" } }) }, async (P, M) => {
  await order(M); await order(M, { table: "5" }); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10);
  return { ok: P.fetches.length === 2, note: `${P.fetches.length} sent` };
}));
check("R3-F95", "F", "\"send the rest\" refuses when the remaining lines have nothing sendable behind them (L923)", () => on({ online: true, idb: { preload: [{ id: "odd-1", status: "failed", error: "x", blocked: "Tea", blockedId: "tea", at: Date.now(), mode: "public", table: "4", restaurantId: FH, restaurantSlug: "french-house", items: [{ id: "tea", qty: 1 }], allergies: [], lines: [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }] }] } }, async (P, M) => {
  await P.settle(30); const r = await M.orderRestWithout("odd-1"); await P.settle(10);
  return { ok: !r.ok && P.fetches.length === 0 && lists(P).failed.length === 1, note: JSON.stringify(r) };
}));
check("R3-F96", "F", "\"send the rest\" keeps the strip's table and total for the new order (L937)", () => on({ online: false, idb: { preload: [{ id: "keep-1", status: "failed", error: "x", blocked: "Tea", blockedId: "tea", at: Date.now(), mode: "public", table: "4", restaurantId: FH, restaurantSlug: "french-house", items: [{ id: "tea", qty: 1 }, { id: "cake", qty: 1 }], allergies: [], lines: [{ id: "tea", title: "Tea" }, { id: "cake", title: "Cake" }], track: { tableNumber: "4", total: 6 } }] } }, async (P, M) => {
  await P.settle(30); await M.orderRestWithout("keep-1"); await P.settle(10);
  const t = lists(P).queued[0]?.track; return { ok: t?.tableNumber === "4" && t.total === 6, note: JSON.stringify(t) };
}));
check("R3-F97", "F", "a DELIVERED call or leave does not end the round for the next saved thing (L759)", async () => {
  const out = [];
  for (const save of [(M) => M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "W" }), (M) => M.enqueueGuestLeave({ token: "tok-1", restaurantId: FH })]) {
    out.push(await on({ online: false, respond: (u) => (u.includes("place-order") ? { status: 200, json: { ok: true, order_id: "o" } } : { status: 200, json: { ok: true } }) }, async (P, M) => {
      await save(M); await order(M); P.setOnline(true); await M.flushGuestOutbox(); await P.settle(10); return P.fetches.length === 2 && lists(P).count === 0 ? "·" : `✗ ${P.fetches.length}`;
    }));
  }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-F98", "F", "order door: a seated order whose reply is not even an object, with no restaurant anywhere, is warned about — never filed under a made-up restaurant (L46)", async () => {
  const seen = []; const w = console.warn; console.warn = (...a) => seen.push(a.join(" "));
  try { world(); G.RPC.lfh_place_order = "an odd answer"; await call("place-order", { mode: "session", token: "tok-nobody", items: [{ id: "t" }], allergies: [] }); }
  finally { console.warn = w; }
  return { ok: seen.length === 1 && G.FLOOR.length === 0 && G.PINGS.length === 0, note: `${seen.length} warning · ${G.FLOOR.length} floor drops` };
});
// ── from mutation pass 5 (numbers and reason codes) ───────────────────────────────────────────
check("R3-F99", "F", "every refusal at the doors is exactly HTTP 400 — including a body that is not JSON at all (the phone's refusal contract)", async () => {
  const bad = [];
  const cases = [["call-waiter", "{", true], ["call-waiter", { mode: "public", table: true, restaurantId: FH }], ["call-waiter", { mode: "session" }], ["call-waiter", { mode: "public", table: "4" }], ["call-waiter", { mode: "public", restaurantId: FH }], ["call-waiter", { mode: "public", table: "45", restaurantId: FH }],
    ["leave", "{", true], ["leave", {}], ["place-order", "{", true], ["place-order", { items: Array.from({ length: 201 }, () => ({ id: "t" })) }], ["place-order", { allergies: Array(41).fill("a") }], ["place-order", { items: [7] }], ["place-order", { mode: "session", items: [{ id: "t" }] }], ["place-order", { mode: "public", items: [{ id: "t" }] }], ["place-order", { mode: "public", restaurantId: FH, items: [{ id: "t" }] }], ["place-order", { mode: "public", restaurantId: FH, table: "45", items: [{ id: "t" }] }]];
  for (const [door, b, raw] of cases) { world(); const r = await call(door, b, { raw: !!raw }); if (r.status !== 400) bad.push(`${door} ${JSON.stringify(b).slice(0, 40)} → ${r.status}`); }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${cases.length} refusals, all 400` };
});
check("R3-F100", "F", "the busy answer is the same at all three doors — 502 with a Retry-After of 20 to 44 s, spread by chance (L81–84 and twins)", async () => {
  const real = Math.random; const out = [];
  try {
    for (const rv of [0, 0.9999]) { Math.random = () => rv;
      for (const [door, fn, b] of [["call-waiter", "lfh_call_waiter_table", { mode: "public", table: "4", restaurantId: FH }], ["leave", "lfh_leave_session", { token: "tok-live" }], ["place-order", "lfh_place_order_public", { mode: "public", table: "4", restaurantId: FH, items: [{ id: "t" }], allergies: [] }]]) {
        world(); G.RPC[fn] = { error: { code: "57014", message: "timeout" } }; const r = await call(door, b);
        out.push(`${door}:${r.status}/${r.json?.retryAfter}`);
      } }
  } finally { Math.random = real; }
  const ok = out.slice(0, 3).every((x) => x.endsWith(":502/20")) && out.slice(3).every((x) => x.endsWith(":502/44"));
  return { ok, note: out.join(" ") };
});
check("R3-F101", "F", "a server's \"wait 40 s\" is exactly 40,000 ms, not near it (L417)", () => on({ online: false }, async (P, M) => {
  await order(M); M.noteServerRetryAfter(40); await M.flushGuestOutbox(); await P.settle(6);
  const w = Math.max(...P.pending().map((t) => t.ms)); return { ok: w === 40_000, note: `${w}` };
}));
check("R3-F102", "F", "ids made without randomUUID use the whole hex alphabet, not a sliver of it (L103)", () => on({ online: false }, async (P, M) => {
  const d = Object.getOwnPropertyDescriptor(globalThis, "crypto"); Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try { const ids = []; for (let i = 0; i < 25; i++) ids.push((await order(M, { table: String(1 + (i % 9)) })).action_id);
    const chars = new Set(ids.join("").replace(/-/g, "")); const shape = ids.every((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x));
    return { ok: shape && chars.size === 16, note: `${chars.size} of 16 hex digits seen` };
  } finally { Object.defineProperty(globalThis, "crypto", d); }
}));
check("R3-F103", "F", "the phone's saved-work storage is always opened as version 1 — another version breaks every other open tab (L69)", () => on({ online: false }, async (P, M) => {
  await order(M); await P.settle(20); const v = P.idb.versions || []; return { ok: v.length > 0 && v.every((x) => x === 1), note: JSON.stringify(v) };
}));
