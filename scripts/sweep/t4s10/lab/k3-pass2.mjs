// Block K, part C — checks for the breaks still alive after pass 2 of the deliberate-break test
// (sweep #10 T4 round 2): a basket that must stop syncing on EVERY ending, a table card that must not
// repeat "session ended", the location check's exact edge, and a forced close that writes to live orders only.
import { check, load, FILES, W, resetWorld } from "../lib.mjs";
import { install, reset, phone } from "../phone.mjs";
import { openLab, json } from "./page.mjs";
import { HOW } from "./how.mjs";
const STUB = "STUB — real file in memory, stand-in database / phone (round 2: written for a surviving break)";
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const SK = "lfh_session:french-house";
const GUEST = { table: "7", token: "tok-guest", memberId: "m", role: "guest" };
const until = async (L, pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await L.wait(60); } return false; };

// ── the shared basket stops on EVERY ending, not just "session closed" ──────────────────────────────
const L1 = { id: "a", sig: "[]", qty: 1 }, L2 = { id: "b", sig: "[]", qty: 1 };
for (const why of ["removed", "invalid_token"]) {
  check(FILES.cartSync, `once the table answers '${why}', a later change on this phone stays on this phone`, HOW, () => with_({ mount: ["cartSync"], storage: { [SK]: GUEST },
    rpc: { lfh_get_cart: (a, n) => (n === 1 ? json({ ok: true, open: true, approved: true, cart: [L1], cart_updated_at: "t" }) : json({ ok: false, reason: why })), lfh_merge_cart: () => json({ ok: true }) } }, async (L) => {
    await until(L, async () => calls(L, "lfh_get_cart").length >= 1); await L.wait(200); await L.fire("lfh:rt-tick"); await until(L, async () => calls(L, "lfh_get_cart").length >= 2); await L.wait(200);
    await L.page.evaluate((v) => { localStorage.setItem("lfh_cart:french-house", JSON.stringify(v)); window.dispatchEvent(new Event("lfh:cart-updated")); }, [L1, L2]); await L.wait(1100);
    return { ok: calls(L, "lfh_merge_cart").length === 0, note: `${calls(L, "lfh_merge_cart").length} sends` };
  }));
}

// ── the table card says "session ended" ONCE ────────────────────────────────────────────────────────
const open = () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [] });
for (const [what, end] of [["the session ended", json({ ok: false, reason: "session_closed" })], ["the diner was removed", json({ ok: false, reason: "removed" })], ["the session stopped being open", json({ ok: true, session: { table_number: "7", status: "closed" }, member: { role: "guest", approved: true } })]]) {
  check(FILES.card, `after ${what} (and was said once), an OLD table note that turns up later is dropped quietly — no second message`, HOW, () => with_({ mount: ["card"], storage: { [SK]: GUEST, lfh_sess_widget_collapsed: "0" },
    rpc: { lfh_session_state: (a, n) => (n === 1 ? open() : a.p_token === "tok-old" ? json({ ok: false, reason: "session_closed" }) : end) } }, async (L) => {
    await until(L, async () => !!(await L.page.$(".ssw-card, .ssw-bubble"))); await L.fire("lfh:rt-tick"); await until(L, async () => (await L.toasts()).length >= 1);
    await L.page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ table: "9", token: "tok-old", memberId: "m2", role: "guest" })), SK); await L.fire("lfh:rt-tick"); await L.wait(600);
    const t = (await L.toasts()).map((x) => x.message); return { ok: t.length === 1 && (await L.ls(SK)) === null, note: t.join(" / ") };
  }));
}
check(FILES.card, "after the diner LEFT, an old table note that turns up later is dropped quietly too", HOW, () => with_({ mount: ["card"], storage: { [SK]: GUEST, lfh_sess_widget_collapsed: "0" },
  rpc: { lfh_session_state: (a) => (a.p_token === "tok-old" ? json({ ok: false, reason: "session_closed" }) : open()), lfh_leave_session: () => json({ ok: true }) } }, async (L) => {
  await until(L, async () => !!(await L.page.$("text=Leave / own cart"))); await L.page.click("text=Leave / own cart"); await L.page.click("text=Yes, leave"); await L.wait(400);
  await L.page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ table: "9", token: "tok-old", memberId: "m2", role: "guest" })), SK); await L.fire("lfh:rt-tick"); await L.wait(600);
  const t = (await L.toasts()).map((x) => x.message); return { ok: t.length === 1 && t[0] === "You left the table", note: t.join(" / ") };
}));

// ── in memory: the location check's exact edge, and a forced close's every write ───────────────────
install();
const P = async (rel, path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(rel); };
const geo = (lat, lng) => ({ getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lng } }) });
check(FILES.sess, "checkLocation: 251 m north of the café is FAR and 249 m is NEAR with a 250 m radius — and the same holds east-west", STUB, async () => {
  const s = await P(FILES.sess); const M = 1 / 111195, E = M / Math.cos(19 * Math.PI / 180); const r = [];
  for (const [dl, dg] of [[249 * M, 0], [251 * M, 0], [0, 249 * E], [0, 251 * E]]) { phone.geo = geo(19 + dl, 72.8 + dg); r.push((await s.checkLocation(19, 72.8, 250)).reason); }
  return { ok: r.join() === "near,far,near,far", note: r.join(" / ") };
});
const RID = "aaaaaaaa-0000-4000-8000-000000000001";
const has = (st, kind, col, val) => !!st && st.filters.some((f) => f.kind === kind && f.col === col && (val === undefined || f.val === val));
check(FILES.close, "a forced close of an unpaid table writes ONLY to this session's live orders — every orders write is scoped and skips archived ones", STUB, async () => {
  const m = await P(FILES.close);
  W.from.sessions = (st) => (st.op === "select" ? { data: { id: "s1" }, error: null } : { data: [{ id: "s1", restaurant_id: RID, table_number: "4" }], error: null });
  W.from.orders = (st) => (st.op === "select" ? { data: /payment_status/.test(st.cols || "") ? [] : [{ id: "o1", total: 100, discount: 0, subtotal: 100, tax: 0, khata_at: null }], error: null } : { data: [], error: null });
  W.from.session_members = { data: [], error: null }; W.from.waiter_calls = { data: [], error: null }; W.from.requests = { data: [], error: null };
  await m.closeSession("s1", { force: true }, { panel: "editor", restaurantId: RID, deviceId: "d" });
  const ups = W.fromLog.filter((x) => x.table === "orders" && x.op === "update");
  return { ok: ups.length >= 1 && ups.every((u) => has(u, "eq", "session_id", "s1") && has(u, "eq", "restaurant_id", RID) && has(u, "eq", "archived", false)), note: `${ups.length} orders write(s): ${ups.map((u) => u.filters.map((f) => `${f.col}=${f.val}`).join("&")).join(" | ")}` };
});

// ── the table sheet: what pass 2 showed no check asked ───────────────────────────────────────────────
const sheetT = (L) => L.page.$eval(".sg-box .sg-title", (t) => t.textContent).catch(() => null);
const go = (L, d) => L.fire("lfh:session-do", d);
check(FILES.gate, "closing the sheet while a table check is still on its way stops the watching — nothing more is asked", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: async (a, n) => { if (n >= 2) await new Promise((r) => setTimeout(r, 600)); return json({ ok: true, open: false }); }, lfh_request: () => json({ ok: true }) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => calls(L, "lfh_table_status").length >= 2); await L.page.click(".sg-x"); const n = calls(L, "lfh_table_status").length; await L.wait(4000);
  return { ok: calls(L, "lfh_table_status").length === n, note: `${n} → ${calls(L, "lfh_table_status").length}` };
}));
check(FILES.gate, "after the sheet is closed and opened again, asking for a waiter really sends a NEW request", HOW, () => with_({ mount: ["gate"], storage: { "lfh_my_name:french-house": "Raj" }, rpc: { lfh_table_status: () => json({ ok: true, open: true, members: 2, session_id: "s1" }), lfh_request: () => json({ ok: true }) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Call a waiter instead"))); await L.page.click("text=Call a waiter instead"); await L.wait(400); await L.page.click(".sg-x");
  await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Call a waiter instead"))); await L.page.click("text=Call a waiter instead"); await L.wait(500);
  return { ok: calls(L, "lfh_request").length === 2, note: `${calls(L, "lfh_request").length} requests` };
}));
check(FILES.gate, "two quick taps on 'Open table 7' open it ONCE", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: () => json({ ok: true, open: true, members: 0, session_id: "s1" }), lfh_join_session: async () => { await new Promise((r) => setTimeout(r, 700)); return json({ ok: true, token: "t", member_id: "m", role: "owner", approved: true, session_id: "s1" }); } } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia");
  await L.page.$eval(".sg-btn.gold", (b) => b.click()); await L.wait(80); await L.page.$eval(".sg-btn.gold", (b) => b.click()).catch(() => null); await L.wait(1200);
  return { ok: calls(L, "lfh_join_session").length === 1, note: `${calls(L, "lfh_join_session").length} joins` };
}));
check(FILES.gate, "a head whose opening failed can try again — the second tap really sends", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: () => json({ ok: true, open: true, members: 0, session_id: "s1" }), lfh_join_session: (a, n) => (n === 1 ? json({ ok: false, reason: "rate_limited" }) : json({ ok: true, token: "t", member_id: "m", role: "owner", approved: true, session_id: "s1" })) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia"); await L.page.click(".sg-btn.gold"); await L.wait(500);
  await L.page.click(".sg-btn.gold"); await until(L, async () => calls(L, "lfh_table_status").length >= 2); await L.wait(300); await L.page.fill(".sg-input", "Mia").catch(() => null); await L.page.click(".sg-btn.gold").catch(() => null); await L.wait(700);
  return { ok: calls(L, "lfh_join_session").length === 2, note: `${calls(L, "lfh_join_session").length} joins` };
}));
check(FILES.gate, "once a waited-for table opens with people at it, the sheet stops checking that table every few seconds", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: (a, n) => (n === 1 ? json({ ok: true, open: false }) : json({ ok: true, open: true, members: 2, session_id: "s1" })) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => (await sheetT(L)) === "This table's already open"); const n = calls(L, "lfh_table_status").length; await L.wait(5000);
  return { ok: calls(L, "lfh_table_status").length === n, note: `${n} → ${calls(L, "lfh_table_status").length}` };
}));

// ── what pass 3's fresh never-tried sample found unasked ─────────────────────────────────────────────
const SEAT = { table: "7", token: "tok-seat", memberId: "m", role: "guest" };
const openTS = () => json({ ok: true, open: true, members: 2, session_id: "s1" });
check(FILES.gate, "a diner let in after waiting gets their order placed ONCE — even when the kitchen's answer is slow", HOW, () => with_({ mount: ["gate"], storage: { "lfh_my_name:french-house": "Raj" },
  rpc: { lfh_table_status: openTS, lfh_join_session: () => json({ ok: true, token: "tok-w", member_id: "m", role: "guest", approved: false, session_id: "s1" }), lfh_session_state: (a, n) => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: n >= 2 } }) },
  api: { "/api/guest/place-order": async () => { await new Promise((r) => setTimeout(r, 4000)); return json({ ok: true, order_id: "o-1" }); } } }, async (L) => {
  await L.wait(500); await go(L, { action: "order", table: "7", payload: { items: [{ id: "d1", qty: 1 }], allergies: [] } }); await until(L, async () => !!(await L.page.$("text=Ask to join this table")));
  await L.page.click("text=Ask to join this table"); await L.wait(9000);
  const sends = L.apiLog.filter((x) => x.path === "/api/guest/place-order").length; return { ok: sends === 1, note: `${sends} order send(s)` };
}));
check(FILES.gate, "an order or a waiter call shows 'One moment…' the instant it is tapped — even while the restaurant's settings are still loading", HOW, () => with_({ mount: ["gate"], storage: { [SK]: SEAT, "lfh_nickname:french-house": { token: "tok-seat", name: "Ravi" } },
  rpc: { lfh_guest_settings: async () => { await new Promise((r) => setTimeout(r, 1200)); return json({ ...(await import("./page.mjs")).settingsOn() }); }, lfh_session_state: () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true } }), lfh_call_waiter: () => json({ ok: true }) } }, async (L) => {
  await L.wait(300); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(200); return { ok: (await sheetT(L)) === "One moment…", note: await sheetT(L) };
}));
check(FILES.gate, "a guest whose join failed can try again — the second tap really sends", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: openTS, lfh_join_session: (a, n) => (n === 1 ? json({ ok: false, reason: "rate_limited" }) : json({ ok: true, token: "t", member_id: "m", role: "guest", approved: true, session_id: "s1" })) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Raj");
  await L.page.click("text=Ask to join this table"); await L.wait(600); await L.page.click("text=Ask to join this table"); await L.wait(700);
  return { ok: calls(L, "lfh_join_session").length === 2, note: `${calls(L, "lfh_join_session").length} joins` };
}));
check(FILES.gate, "on 'Let us bring a waiter over', a waiter request that FAILED is never written into the reassuring sentence", HOW, () => with_({ mount: ["gate"], storage: { "lfh_loc_consent:french-house": "1", "lfh_my_name:french-house": "Mia" },
  init: { fn: () => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok, err) => setTimeout(() => err({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30) } }); }, arg: null },
  rpc: { lfh_guest_settings: async () => json((await import("./page.mjs")).settingsOn({ require_location: true, geo_lat: 19, geo_lng: 72.8, geo_radius_m: 250 })), lfh_request: () => json({ ok: false, reason: "weird" }) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Request a waiter"))); await L.page.click("text=Request a waiter"); await L.wait(500);
  const p = (await L.page.$eval(".sg-box .sg-sub", (x) => x.textContent).catch(() => "")) || ""; const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.some((m) => /^We couldn.t tell the staff just now/.test(m)) && !/couldn.t tell the staff/.test(p) && /No problem — we.ll send a staff member/.test(p), note: p.slice(0, 90) };
}));
const cardSt = (o) => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [], ...o });
check(FILES.card, "a refresh that finds the SAME table announces nothing — no 'session changed' on every poll (it would make every widget read again)", HOW, () => with_({ mount: ["card"], storage: { [SK]: GUEST, lfh_sess_widget_collapsed: "0" }, rpc: { lfh_session_state: () => cardSt() } }, async (L) => {
  await until(L, async () => !!(await L.page.$(".ssw-card, .ssw-bubble"))); await L.fire("lfh:rt-tick"); await L.wait(300); await L.fire("lfh:rt-tick"); await L.wait(300);
  return { ok: (await L.events("lfh:session-changed")).length === 0, note: `${(await L.events("lfh:session-changed")).length} announcements` };
}));
check(FILES.card, "the 90-minute rule follows the NEWEST order whatever order they arrive in — a recent order still holds the diner", HOW, () => with_({ mount: ["card"], storage: { [SK]: GUEST, lfh_sess_widget_collapsed: "0" },
  rpc: { lfh_session_state: () => cardSt({ items: [{ status: "preparing" }], orders: [{ created_at: new Date(Date.now() - 5 * 60000).toISOString() }, { created_at: new Date(Date.now() - 100 * 60000).toISOString() }, { created_at: null }] }) } }, async (L) => {
  await until(L, async () => !!(await L.page.$("text=Leave / own cart"))); await L.page.click("text=Leave / own cart"); await L.wait(200); return !!(await L.page.$(".popup.active"));
}));
