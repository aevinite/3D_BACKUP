// Block J, part 3 — the floating table card (SessionStatusWidget) in the screen lab (sweep #10 T4 round 2):
// who you are at the table, the open requests, leaving / changing table, the "order on its way" stop,
// the heartbeat, dragging, and what the add-to-cart gate is told.
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr, settingsOn, FX } from "./page.mjs";
import { HOW } from "./how.mjs";
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const W = FILES.card;
const SK = "lfh_session:french-house";
const GUEST = { table: "7", token: "tok-g", memberId: "m-g", role: "guest" };
const HEAD = { table: "7", token: "tok-h", memberId: "m-h", role: "owner" };
const MIN = 60_000;
const recent = () => new Date(Date.now() - 5 * MIN).toISOString();
const st = ({ role = "guest", approved = true, status = "open", table = "7", members = 1, calls: c = [], items = [], orders = [] } = {}) =>
  json({ ok: true, session: { id: "s1", table_number: table, status }, member: { id: "m", role, approved }, members: Array.from({ length: members }, (_, i) => ({ id: "m" + i })), calls: c, items, orders, bill: { subtotal: 0, tax: 0, total: 0 } });
const lab = (o = {}) => ({ mount: ["card"], storage: { [SK]: o.who || GUEST, lfh_sess_widget_collapsed: "0", ...(o.storage || {}) }, clock: o.clock, online: o.online,
  rpc: { lfh_session_state: o.state || (() => st()), ...(o.rpc || {}) }, api: o.api });
const card = (L) => L.text(".ssw-card");
const conn = (L) => L.lib("getTableConnection");
const titleSub = (L) => L.page.evaluate(() => ({ t: document.querySelector(".ssw-title")?.textContent, s: document.querySelector(".ssw-sub")?.textContent, i: document.querySelector(".ssw-avatar i")?.className, pend: !!document.querySelector(".ssw-live.pending") }));

check(W, "with table sessions switched off there is no card — and the add-to-cart gate is told sessions are off", HOW, () => with_(lab({ rpc: { lfh_guest_settings: () => json(settingsOn({ sessions_enabled: false })) } }), async (L) => {
  await L.wait(900); const c = await conn(L); return { ok: !(await L.page.$(".ssw-card, .ssw-bubble")) && c.sessionsEnabled === false && c.connected === false && calls(L, "lfh_session_state").length === 0, note: JSON.stringify(c) };
}));
check(W, "…if the switch could not be read at all, the gate is told 'off' too — a tap is never held on a guess", HOW, () => with_(lab({ rpc: { lfh_guest_settings: () => pgErr("57014", "timeout") } }), async (L) => {
  await L.wait(900); const c = await conn(L); return { ok: c.sessionsEnabled === false && !(await L.page.$(".ssw-card")), note: JSON.stringify(c) };
}));
check(W, "a diner with no table on this phone sees no card, and nothing is read", HOW, () => with_({ mount: ["card"] }, async (L) => { await L.wait(900); return !(await L.page.$(".ssw-card, .ssw-bubble")) && calls(L, "lfh_session_state").length === 0; }));
check(W, "a guest the head has let in: 'Table 7 · You're in — let in by the host', and the gate is told they're connected", HOW, () => with_(lab(), async (L) => {
  await L.wait(900); const v = await titleSub(L); const c = await conn(L);
  return { ok: /^Table 7/.test(v.t) && v.s === "You’re in — let in by the host" && /fa-user-check/.test(v.i) && !v.pend && c.connected === true, note: JSON.stringify(v) };
}));
check(W, "a guest still waiting: 'Waiting for the host to let you in…', an hourglass, a pending light — and NOT connected", HOW, () => with_(lab({ state: () => st({ approved: false }) }), async (L) => {
  await L.wait(900); const v = await titleSub(L); const c = await conn(L);
  return { ok: v.s === "Waiting for the host to let you in…" && /fa-hourglass-half/.test(v.i) && v.pend && c.connected === false, note: JSON.stringify(v) };
}));
check(W, "the head: 'Hosting Table 7 · You opened this table' with a crown — and how many are at the table once others join", HOW, () => with_(lab({ who: HEAD, state: (a, n) => st({ role: "owner", members: n === 1 ? 1 : 3 }) }), async (L) => {
  await L.wait(900); const a = await titleSub(L); await L.fire("lfh:rt-tick"); await L.wait(300); const b = await titleSub(L);
  return { ok: /^Hosting Table 7/.test(a.t) && a.s === "You opened this table" && /fa-crown/.test(a.i) && b.s === "3 at this table", note: `${a.s} → ${b.s}` };
}));
check(W, "the table's open requests are listed as the TABLE's ('This table asked for'), each with its icon", HOW, () => with_(lab({ state: () => st({ calls: [{ note: "Water" }, { note: "Bill" }] }) }), async (L) => {
  await L.wait(900); const t = (await L.text(".ssw-called")) || ""; const chips = await L.page.$$eval(".ssw-called-chip", (c) => c.length);
  return { ok: /This table asked for/i.test(t) && /Water/.test(t) && /Bill/.test(t) && chips === 2 && !/You called/i.test(t), note: t.replace(/\s+/g, " ") };
}));
check(W, "on a new table the card opens to say hello, then folds itself into a small bubble after about 2 seconds", HOW, () => with_(lab({ clock: true }), async (L) => {
  await L.clock.runFor(1200); await L.wait(60); const open = !!(await L.page.$(".ssw-card")); await L.clock.runFor(2500); await L.wait(80);
  const b = await L.page.$eval(".ssw-bubble", (x) => x.getAttribute("aria-label")).catch(() => null);
  return { ok: open && b === "Table 7 — tap to manage", note: b };
}));
check(W, "…tapping the bubble opens the card again and remembers that; the ⌃ button folds it and remembers that", HOW, () => with_(lab({ clock: true }), async (L) => {
  await L.clock.runFor(4000); await L.wait(60); const bub = await L.page.$(".ssw-bubble"); const bb = await bub.boundingBox();
  await L.page.mouse.move(bb.x + 10, bb.y + 10); await L.page.mouse.down(); await L.page.mouse.up(); await L.wait(120); const reopened = !!(await L.page.$(".ssw-card")); const k1 = await L.ls("lfh_sess_widget_collapsed");
  await L.page.click(".ssw-collapse"); await L.wait(120); const k2 = await L.ls("lfh_sess_widget_collapsed");
  return { ok: reopened && k1 === "0" && !!(await L.page.$(".ssw-bubble")) && k2 === "1", note: `${k1} → ${k2}` };
}));
check(W, "dragging the card moves it (within the screen) and remembers where it was put; a small wobble is a tap, not a drag", HOW, () => with_(lab(), async (L) => {
  await L.wait(900); const h = await (await L.page.$(".ssw-head")).boundingBox(); await L.page.mouse.move(h.x + 20, h.y + 8); await L.page.mouse.down();
  await L.page.mouse.move(h.x + 17, h.y + 10); const wob = await L.ls("lfh_sess_widget_pos_v2"); await L.page.mouse.move(h.x - 60, h.y + 200, { steps: 4 }); await L.page.mouse.up(); await L.wait(150);
  const saved = await L.lsJSON("lfh_sess_widget_pos_v2"); const style = await L.page.$eval(".ssw-card", (c) => c.getAttribute("style") || "");
  return { ok: wob === null && saved && saved.top > 88 && saved.right > 16 && /top:/.test(style), note: JSON.stringify(saved) };
}));
check(W, "…a spot saved earlier is where the card appears; a spot that is not a pair of numbers is ignored", HOW, async () => {
  const a = await with_(lab({ storage: { lfh_sess_widget_pos_v2: JSON.stringify({ right: 40, top: 300 }) } }), async (L) => { await L.wait(900); return L.page.$eval(".ssw-card", (c) => c.getAttribute("style") || ""); });
  const b = await with_(lab({ storage: { lfh_sess_widget_pos_v2: JSON.stringify({ right: "x", top: 3 }) } }), async (L) => { await L.wait(900); return L.page.$eval(".ssw-card", (c) => `${c.getAttribute("style") || ""}|${c.className}`); });
  return { ok: /right: 40px/.test(a) && /top: 300px/.test(a) && /ssw-anchor/.test(b), note: `${a} / ${b}` };
});
check(W, "Leave asks first ('Leave this table? Your order stays with the table'), and Stay changes nothing", HOW, () => with_(lab(), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(100); const q = await card(L); await L.page.click('button.ssw-btn >> text="Stay"'); await L.wait(100);
  return { ok: /Leave this table\? Your order stays with the table for the bill\./.test(q) && calls(L, "lfh_leave_session").length === 0 && !!(await L.page.$("text=Change table")) };
}));
check(W, "'Yes, leave' tells the restaurant, clears this phone's table, basket and saved table, and says 'You left the table'", HOW, () => with_(lab({ storage: { "lfh_cart:french-house": [{ id: "d" }], "lfh_scanned_table:french-house": "7" }, rpc: { lfh_leave_session: () => json({ ok: true }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.page.click("text=Yes, leave"); await L.wait(500); const t = (await L.toasts()).map((x) => x.message);
  const lf = calls(L, "lfh_leave_session")[0];
  return { ok: !!lf && lf.args.p_token === "tok-g" && t.includes("You left the table") && (await L.ls(SK)) === null && (await L.ls("lfh_cart:french-house")) === null && !(await L.page.$(".ssw-card, .ssw-bubble")), note: t.join(" / ") };
}));
check(W, "…if the restaurant could not be told, the leave is SAVED and sent when there is signal — and the diner is told that", HOW, () => with_(lab({ rpc: { lfh_leave_session: () => pgErr("57014", "timeout") } }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.page.click("text=Yes, leave"); await L.wait(700); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.some((m) => /^You've left/.test(m)) && (await L.ls(SK)) === null, note: t.join(" / ") };
}));
check(W, "the head's button says just 'Leave'", HOW, () => with_(lab({ who: HEAD, state: () => st({ role: "owner" }) }), async (L) => { await L.wait(900); return !!(await L.page.$("button.ssw-btn.danger >> text=Leave")) && !(await L.page.$("text=Leave / own cart")); }));
const cooking = (extra = {}) => st({ items: [{ status: "preparing" }, { status: "served" }], orders: [{ created_at: recent() }], ...extra });
check(W, "while the table's food is still coming, Leave and Change table stop with 'Your order's on its way' instead", HOW, () => with_(lab({ state: () => cooking() }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(150); const p = (await L.text(".popup.active")) || ""; await L.page.click("text=Stay at table"); await L.wait(100);
  await L.page.click("text=Change table"); await L.wait(150); const p2 = !!(await L.page.$(".popup.active"));
  return { ok: /Your order.s on its way/.test(p) && /ask a waiter to transfer you/.test(p) && p2 && calls(L, "lfh_leave_session").length === 0, note: p.replace(/\s+/g, " ").slice(0, 80) };
}));
check(W, "…'Call a waiter' there opens the waiter popup — and is not offered where waiter calls are switched off", HOW, async () => {
  const on = await with_(lab({ state: () => cooking() }), async (L) => { await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(150); await L.page.click("text=Call a waiter"); await L.wait(100); return { ev: (await L.events("lfh:chef-call")).length, popup: !!(await L.page.$(".popup.active")) }; });
  const off = await with_(lab({ state: () => cooking(), rpc: { lfh_guest_settings: () => json(settingsOn({ features: { ...FX.lfh_guest_settings.features, waiter_calls: false } })) } }), async (L) => { await L.wait(1100); await L.page.click("text=Leave / own cart"); await L.wait(150); return !!(await L.page.$("text=Call a waiter")); });
  return { ok: on.ev === 1 && on.popup === false && off === false, note: JSON.stringify(on) };
});
check(W, "…the popup also closes by tapping outside it, and by the phone's back button", HOW, () => with_(lab({ state: () => cooking() }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(120); await L.page.mouse.click(5, 700); await L.wait(120); const a = !(await L.page.$(".popup.active"));
  await L.page.click("text=Leave / own cart"); await L.wait(300); await L.page.goBack().catch(() => null); await L.wait(400);
  return { ok: a && !(await L.page.$(".popup.active")), note: `outside ${a}` };
}));
check(W, "a meal whose newest order is over 90 minutes old no longer holds the diner at the table", HOW, () => with_(lab({ state: () => cooking({ orders: [{ created_at: new Date(Date.now() - 95 * MIN).toISOString() }] }), rpc: { lfh_leave_session: () => json({ ok: true }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(150); return { ok: !(await L.page.$(".popup.active")) && /Leave this table\?/.test(await card(L)) };
}));
check(W, "…and a table where everything is served lets them go", HOW, () => with_(lab({ state: () => st({ items: [{ status: "served" }], orders: [{ created_at: recent() }] }) }), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(150); return !(await L.page.$(".popup.active"));
}));
check(W, "'Change table' leaves, clears this phone, and goes back to the menu to pick again", HOW, () => with_({ ...lab({ rpc: { lfh_leave_session: () => json({ ok: true }) } }), holdNav: true }, async (L) => {
  await L.wait(900); await L.page.click("text=Change table"); await L.wait(600);
  return { ok: L.navs[0] === "/menu" && calls(L, "lfh_leave_session").length === 1 && (await L.ls(SK)) === null, note: JSON.stringify(L.navs) };
}));
check(W, "…on another restaurant it goes back to THAT restaurant's menu, and an unheard leave is saved first", HOW, () => with_({ holdNav: true, ...lab({ rpc: { lfh_leave_session: () => pgErr("57014", "t"), lfh_guest_restaurant: () => json({ ...FX.lfh_guest_restaurant, id: "cccccccc-0000-4000-8000-0000000000aa", slug: "sakura-sushi" }) } }), path: "/r/sakura-sushi/menu", storage: { "lfh_session:sakura-sushi": GUEST, lfh_sess_widget_collapsed: "0" } }, async (L) => {
  await L.wait(1100); await L.page.click("text=Change table"); await L.wait(900);
  // the unheard leave lives in the guest outbox (IndexedDB "lfh_guest_outbox") until it is sent — so it is
  // either still saved there, or it has already gone out as POST /api/guest/leave with this diner's token
  const saved = await L.page.evaluate(() => new Promise((res) => { const r = indexedDB.open("lfh_guest_outbox", 1); r.onupgradeneeded = () => r.result.createObjectStore("orders", { keyPath: "id" }); r.onsuccess = () => { try { const g = r.result.transaction("orders").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.filter((x) => x.token === "tok-g").length); g.onerror = () => res(-1); } catch { res(-2); } }; r.onerror = () => res(-3); }));
  const sent = L.apiLog.filter((x) => x.path === "/api/guest/leave" && x.body && x.body.token === "tok-g").length;
  return { ok: L.navs[0] === "/r/sakura-sushi/menu" && saved + sent >= 1, note: `${JSON.stringify(L.navs)} · saved ${saved} · sent ${sent}` };
}));
check(W, "the table's session ending while the diner was in it: they are told, and this phone's table and basket are cleared", HOW, () => with_(lab({ storage: { "lfh_cart:french-house": [{ id: "d" }] }, state: (a, n) => (n === 1 ? st() : json({ ok: false, reason: "session_closed" })) }), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(400); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.some((m) => /^This table’s session ended — scan the QR again/.test(m)) && (await L.ls(SK)) === null && (await L.ls("lfh_cart:french-house")) === null && !(await L.page.$(".ssw-card, .ssw-bubble")), note: t.join(" / ") };
}));
check(W, "…being removed by the head: 'You've been removed from this table'", HOW, () => with_(lab({ state: (a, n) => (n === 1 ? st() : json({ ok: false, reason: "removed" })) }), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(400); return { ok: (await L.toasts()).some((x) => x.message === "You’ve been removed from this table") && (await L.ls(SK)) === null };
}));
check(W, "…a session that is simply no longer open, mid-meal: 'This table's session ended'", HOW, () => with_(lab({ state: (a, n) => st({ status: n === 1 ? "open" : "closed" }) }), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(400); return { ok: (await L.toasts()).some((x) => x.message === "This table’s session ended") && (await L.ls(SK)) === null };
}));
check(W, "an OLD table note on a phone that was never connected is dropped quietly — no 'session ended' surprise", HOW, async () => {
  const out = [];
  for (const s of [json({ ok: false, reason: "session_closed" }), json({ ok: false, reason: "removed" }), json({ ok: false, reason: "invalid_token" }), st({ status: "closed" })]) {
    out.push(await with_(lab({ state: () => s }), async (L) => { await L.wait(900); return (await L.toasts()).length === 0 && (await L.ls(SK)) === null; }));
  }
  return { ok: out.every(Boolean), note: out.join(",") };
});
check(W, "a state read that only FAILED keeps the card and the table — a blip is not the end of the meal", HOW, () => with_(lab({ state: (a, n) => (n === 1 ? st() : pgErr("57014", "timeout")) }), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(400); return { ok: !!(await L.page.$(".ssw-card, .ssw-bubble")) && (await L.ls(SK)) !== null && (await L.toasts()).length === 0 };
}));
check(W, "staff moving the party to table 9 updates this phone's table and tells the other widgets", HOW, () => with_(lab({ state: () => st({ table: "9" }) }), async (L) => {
  await L.wait(900); const s = await L.lsJSON(SK); const ev = (await L.events("lfh:session-changed")).length; const v = await titleSub(L);
  return { ok: s && s.table === "9" && ev >= 1 && /^Table 9/.test(v.t), note: JSON.stringify(s) };
}));
check(W, "becoming the head (the old head left) is saved on this phone and announced, so the approve prompt wakes", HOW, () => with_(lab({ state: () => st({ role: "owner" }) }), async (L) => {
  await L.wait(900); const s = await L.lsJSON(SK); return { ok: s && s.role === "owner" && (await L.events("lfh:session-changed")).length >= 1 && /^Hosting/.test((await titleSub(L)).t), note: JSON.stringify(s) };
}));
check(W, "while connected and in view it tells the restaurant 'still here' at once and every minute — not while the tab is hidden", HOW, () => with_(lab({ clock: true }), async (L) => {
  await L.clock.runFor(1200); await L.wait(60); const a = calls(L, "lfh_touch_session").length; await L.clock.runFor(61000); await L.wait(60); const b = calls(L, "lfh_touch_session").length;
  await L.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await L.clock.runFor(130000); await L.wait(60); const c = calls(L, "lfh_touch_session").length;
  await L.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); }); await L.wait(80); const d = calls(L, "lfh_touch_session").length;
  return { ok: a === 1 && b === 2 && c === 2 && d === 3 && calls(L, "lfh_touch_session").every((x) => x.args.p_token === "tok-g"), note: `${a},${b},${c},${d}` };
}));
check(W, "…a guest who is merely waiting is told 'connected: no', but still keeps their seat with the heartbeat", HOW, () => with_(lab({ state: () => st({ approved: false }) }), async (L) => {
  await L.wait(900); return { ok: (await conn(L)).connected === false && calls(L, "lfh_touch_session").length === 1 };
}));
check(W, "a realtime nudge re-reads the card at once", HOW, () => with_(lab(), async (L) => {
  await L.wait(900); const n = calls(L, "lfh_session_state").length; await L.fire("lfh:rt-tick"); await L.wait(300); return calls(L, "lfh_session_state").length === n + 1;
}));
check(W, "when the card's screen goes away: no timers left, no reads, no heartbeat", HOW, () => with_(lab({ clock: true }), async (L) => {
  await L.clock.runFor(1200); await L.unmount(); const n = calls(L, "lfh_session_state").length, h = calls(L, "lfh_touch_session").length;
  await L.fire("lfh:rt-tick"); await L.clock.runFor(130000); await L.wait(80);
  return { ok: calls(L, "lfh_session_state").length === n && calls(L, "lfh_touch_session").length === h && (await L.intervals()) === 0 };
}));
check(W, "while the restaurant is still being looked up, the card reads nothing at all", HOW, () => with_({ ...lab({ rpc: { lfh_guest_restaurant: async () => { await new Promise((r) => setTimeout(r, 1500)); return json(null); } } }), path: "/r/sakura-sushi/menu", storage: { "lfh_session:sakura-sushi": GUEST } }, async (L) => {
  await L.wait(800); return calls(L, "lfh_guest_settings").length === 0 && calls(L, "lfh_session_state").length === 0;
}));
