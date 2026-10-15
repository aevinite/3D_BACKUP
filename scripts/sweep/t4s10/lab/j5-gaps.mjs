// Block J, part 5 — the paths the coverage measurement (cover.mjs --lab) showed no check had taken
// (sweep #10 T4 round 2). Appended after parts 1–4 so no earlier id moves.
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr, settingsOn } from "./page.mjs";
import { HOW } from "./how.mjs";
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const sheet = async (L) => ((await L.text(".sg-box")) || "").replace(/\s+/g, " ");
const title = (L) => L.page.$eval(".sg-box .sg-title", (t) => t.textContent).catch(() => null);
const go = (L, d) => L.fire("lfh:session-do", d);
const SK = "lfh_session:french-house";
const G = FILES.gate, W = FILES.card, S = FILES.cartSync, TB = FILES.tbill, O = FILES.owner;
const TS = (open, members = 0) => () => json({ ok: true, open, members, session_id: "s1" });
const ST = (o = {}) => json({ ok: true, session: { id: "s1", table_number: "7", status: "open" }, member: { id: "m", role: o.role || "guest", approved: o.approved !== false }, members: [{}], calls: [], items: [], orders: [] });
const ask = async (L) => { await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(600); };
const noStore = { fn: () => { Object.defineProperty(window, "indexedDB", { configurable: true, get: () => undefined }); }, arg: null };

// ── the table sheet ───────────────────────────────────────────────────────────────────────────────────
check(G, "while a diner waits for staff, a table that opens WITH people already at it asks their name to join", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: (a, n) => (n === 1 ? json({ ok: true, open: false }) : json({ ok: true, open: true, members: 2, session_id: "s1" })), lfh_request: () => json({ ok: true }) } }, async (L) => {
  // the watcher starts the moment "isn't open yet" shows; the table opening WITH people moves the sheet on by itself
  await ask(L); await L.wait(1500); return { ok: (await title(L)) === "This table's already open" && calls(L, "lfh_join_session").length === 0 && calls(L, "lfh_table_status").length >= 2, note: await title(L) };
}));
check(G, "…and closing the sheet while it waits stops the watching — no more table checks", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: TS(false), lfh_request: () => json({ ok: true }) } }, async (L) => {
  await ask(L); await L.page.click(".sg-x"); await L.wait(200); const n = calls(L, "lfh_table_status").length; await L.wait(2600); return { ok: calls(L, "lfh_table_status").length === n, note: `${n} → ${calls(L, "lfh_table_status").length}` };
}));
check(G, "the table check itself failing (busy restaurant) gives 'The restaurant's system is busy', not a guess about the table", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: () => pgErr("57014", "canceling statement due to statement timeout") } }, async (L) => {
  await ask(L); return { ok: (await title(L)) === "The restaurant's system is busy" && /this one.s on us/.test(await sheet(L)), note: await title(L) };
}));
check(G, "…a table the restaurant has blocked shows the blocked screen straight away", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: () => json({ ok: false, reason: "blocked" }) } }, async (L) => { await ask(L); return /Access blocked/.test(await sheet(L)); }));
for (const [why, ans, re] of [["the table is blocked", () => json({ ok: false, reason: "blocked" }), /Access blocked/], ["they seem too far", () => json({ ok: false, reason: "too_far" }), /Let us bring a waiter over.*You seem too far/], ["the table closed in between", () => json({ ok: false, reason: "no_open_session" }), /Your table isn.t open yet/]]) {
  check(G, `the HEAD's opening refused because ${why} goes to the same screen a guest would get`, HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: TS(true, 0), lfh_join_session: ans } }, async (L) => {
    await ask(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Open table 7"); await L.wait(600); return { ok: re.test(await sheet(L)), note: (await sheet(L)).slice(0, 70) };
  }));
}
const geoLab = (errCode) => ({ mount: ["gate"], storage: { "lfh_loc_consent:french-house": "1" }, rpc: { lfh_guest_settings: () => json(settingsOn({ require_location: true, geo_lat: 19.07, geo_lng: 72.87, geo_radius_m: 250 })), lfh_table_status: TS(false), lfh_request: () => json({ ok: true }) },
  init: { fn: (code) => { window.__geoAsks = 0; Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok, err) => { window.__geoAsks++; setTimeout(() => err({ code, message: "x", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30); } } }); }, arg: errCode } });
check(G, "a phone that cannot read its location ('Couldn't read your location.') is offered a waiter, and 'Try location again' asks again", HOW, () => with_(geoLab(2), async (L) => {
  await ask(L); await L.wait(300); const t = await sheet(L); await L.page.click("text=Try location again"); await L.wait(300);
  return { ok: /Couldn.t read your location\./.test(t) && /Let us bring a waiter over/.test(t) && (await L.page.evaluate(() => window.__geoAsks)) === 2, note: t.slice(0, 80) };
}));
check(G, "…a diner who refused location sharing is told 'Location was blocked.'", HOW, () => with_(geoLab(1), async (L) => { await ask(L); await L.wait(300); return /Location was blocked\./.test(await sheet(L)); }));
check(G, "'Not at the restaurant? Call a waiter' on the location screen asks staff for help, under the diner's name", HOW, () => with_({ ...geoLab(2), storage: { ...geoLab(2).storage, "lfh_my_name:french-house": "Mia" } }, async (L) => {
  await ask(L); await L.wait(300); await L.page.click("text=Request a waiter"); await L.wait(500); const q = calls(L, "lfh_request")[0];
  return { ok: !!q && q.args.p_type === "access" && q.args.p_name === "Mia" && /A waiter is on the way/.test(await sheet(L)), note: JSON.stringify(q && q.args) };
}));
check(G, "…the first-time location explainer has its own 'Not at the restaurant? Call a waiter'", HOW, () => with_({ ...geoLab(2), storage: { "lfh_my_name:french-house": "Mia" } }, async (L) => {
  await L.page.evaluate(() => localStorage.removeItem("lfh_loc_consent:french-house")); await ask(L); await L.page.click("text=Not at the restaurant? Call a waiter"); await L.wait(500);
  return { ok: calls(L, "lfh_request").length === 1 && /We.ve let the staff know/.test(await sheet(L)) };
}));
const openGuest = (o = {}) => ({ mount: ["gate"], storage: { "lfh_my_name:french-house": "Raj" }, rpc: { lfh_table_status: TS(true, 2), lfh_join_session: () => json({ ok: true, token: "t", member_id: "m", role: "guest", approved: false, session_id: "s1" }), lfh_session_state: o.state || (() => ST({ approved: false })), lfh_request: () => json({ ok: true }) } });
check(G, "'Call a waiter instead' on the join screen asks staff for help without joining", HOW, () => with_(openGuest(), async (L) => {
  await ask(L); await L.page.click("text=Call a waiter instead"); await L.wait(500); return { ok: calls(L, "lfh_request").length === 1 && calls(L, "lfh_join_session").length === 0 && calls(L, "lfh_request")[0].args.p_name === "Raj" };
}));
check(G, "'Call a waiter' after the head said no asks staff for help", HOW, () => with_(openGuest({ state: () => json({ ok: false, reason: "removed" }) }), async (L) => {
  await ask(L); await L.page.click("text=Ask to join this table"); await L.wait(1500); await L.page.click("text=Call a waiter"); await L.wait(500); return calls(L, "lfh_request").length === 1;
}));
check(G, "'Call a waiter instead' after staff closed the table asks staff for help", HOW, () => with_(openGuest({ state: () => json({ ok: false, reason: "session_closed" }) }), async (L) => {
  await ask(L); await L.page.click("text=Ask to join this table"); await L.wait(1500); await L.page.click("text=Call a waiter instead"); await L.wait(500); return calls(L, "lfh_request").length === 1;
}));
check(G, "while the tab is hidden the wait-for-the-head check pauses — it reads nothing until the diner is back", HOW, () => with_(openGuest(), async (L) => {
  await ask(L); await L.page.click("text=Ask to join this table"); await L.wait(900); await L.page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  // hidden: the next check waits 8 s (HIDDEN) instead of the 1.5 s → 15 s backoff, so over 8 s at most the one
  // already on its way lands — a sheet that ignored "hidden" would ask two or three more times in that window
  const n = calls(L, "lfh_session_state").length; await L.wait(8000); const m = calls(L, "lfh_session_state").length; return { ok: m <= n + 1, note: `${n} → ${m} while hidden` };
}));
const seatedNoStore = (o) => ({ mount: ["gate"], online: false, init: noStore, storage: { [SK]: { table: "7", token: "tok-seat", memberId: "m", role: "guest" }, "lfh_nickname:french-house": { token: "tok-seat", name: "Ravi" } }, rpc: { lfh_session_state: () => ST(), ...(o || {}) } });
check(G, "with no signal AND no phone storage, a waiter call is still kept for this page — and the diner is told to keep it open", HOW, () => with_(seatedNoStore(), async (L) => {
  await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(900); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.includes("Saved — keep this page open and we'll call them"), note: t.join(" / ") };
}));
check(G, "…and an order is kept for this page the same way ('keep it open until it sends')", HOW, () => with_(seatedNoStore(), async (L) => {
  await L.wait(500); await go(L, { action: "order", table: "7", payload: { items: [{ id: "d1", qty: 1 }], allergies: [] } }); await L.wait(900); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.includes("Saved on this page — keep it open until it sends"), note: t.join(" / ") };
}));

// ── the table card ────────────────────────────────────────────────────────────────────────────────────
const cardLab = (state, o = {}) => ({ mount: ["card"], storage: { [SK]: { table: "7", token: "tok-g", memberId: "m", role: "guest" }, lfh_sess_widget_collapsed: "0", ...(o.storage || {}) }, init: o.init, rpc: { lfh_session_state: state } });
check(W, "each kind of request wears its own mark — water, napkins, cleaning, cutlery, the bill — and anything else a bell", HOW, () => with_(cardLab(() => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: ["Water", "Napkins", "Clean the table", "Cutlery", "Check please", "Help", null].map((note) => ({ note })), items: [], orders: [] })), async (L) => {
  await L.wait(900); const chips = await L.page.$$eval(".ssw-called-chip", (c) => c.map((x) => x.textContent.trim().split(" ")[0]));
  return { ok: chips.join("") === "💧🧻🧹🍴🧾🔔🔔", note: chips.join(" ") };
}));
check(W, "a state answer missing its table, people, requests and orders still shows the diner's own table — no crash, no 'undefined'", HOW, () => with_(cardLab(() => json({ ok: true, session: { status: "open" }, member: { role: "guest", approved: true } })), async (L) => {
  await L.wait(900); const t = await L.text(".ssw-card"); return { ok: /^Table 7/.test(t || "") && !/undefined|NaN/.test(t || "") && L.errors.length === 0, note: (t || "").slice(0, 40) };
}));
check(W, "a saved card position that is corrupt text is ignored — the card sits in its usual spot", HOW, () => with_(cardLab(() => ST(), { storage: { lfh_sess_widget_pos_v2: "{bad" } }), async (L) => {
  await L.wait(900); return { ok: /ssw-anchor/.test(await L.page.$eval(".ssw-card", (c) => c.className)) && L.errors.length === 0 };
}));
check(W, "a phone that refuses to save (private mode) can still fold and drag the card — nothing breaks", HOW, () => with_(cardLab(() => ST(), { init: { fn: () => { window.addEventListener("load", () => { Storage.prototype.setItem = () => { throw new DOMException("QuotaExceededError"); }; }); }, arg: null } }), async (L) => {
  await L.wait(900); const h = await (await L.page.$(".ssw-head")).boundingBox(); await L.page.mouse.move(h.x + 20, h.y + 8); await L.page.mouse.down(); await L.page.mouse.move(h.x - 40, h.y + 120, { steps: 3 }); await L.page.mouse.up(); await L.wait(100);
  await L.page.click(".ssw-collapse"); await L.wait(150); return { ok: !!(await L.page.$(".ssw-bubble")) && L.errors.length === 0, note: L.errors.join(" / ") };
}));
check(W, "a guest still waiting for the head has a bubble that says so (it wears 'waiting')", HOW, () => with_(cardLab(() => ST({ approved: false }), { storage: { lfh_sess_widget_collapsed: "1" } }), async (L) => {
  await L.wait(3200); return { ok: /\bwaiting\b/.test(await L.page.$eval(".ssw-bubble", (b) => b.className).catch(() => "")) };
}));
check(W, "the phone's back button closes the 'Leave this table?' question without leaving the table", HOW, () => with_(cardLab(() => ST()), async (L) => {
  await L.wait(900); await L.page.click("text=Leave / own cart"); await L.wait(300); await L.page.goBack().catch(() => null); await L.wait(400);
  return { ok: !(await L.text(".ssw-confirm-q")) && calls(L, "lfh_leave_session").length === 0 && (await L.ls(SK)) !== null };
}));

// ── the shared basket ─────────────────────────────────────────────────────────────────────────────────
const GUEST = { table: "7", token: "tok-guest", memberId: "m-guest", role: "guest" };
const syncLab = (server, local, o = {}) => ({ mount: ["cartSync"], storage: { [SK]: GUEST, ...(local ? { "lfh_cart:french-house": local } : {}) }, rpc: { lfh_get_cart: o.get || (() => json({ ok: true, open: true, approved: true, cart: server, cart_updated_at: "t" })), lfh_set_cart: () => json({ ok: true }), lfh_merge_cart: () => json({ ok: true }) } });
const setLocal = (L, v) => L.page.evaluate((x) => { localStorage.setItem("lfh_cart:french-house", JSON.stringify(x)); window.dispatchEvent(new Event("lfh:cart-updated")); }, v);
check(S, "a basket line with no options and no quantity is still ONE line with the same dish on the table (no duplicate)", HOW, () => with_(syncLab([{ id: "dish-a", title: "Latte" }], [{ id: "dish-a", sig: "[]", title: "Latte" }]), async (L) => {
  await L.wait(900); const local = (await L.lsJSON("lfh_cart:french-house")) || []; return { ok: local.length === 1 && calls(L, "lfh_set_cart").length === 0, note: JSON.stringify(local) };
}));
check(S, "a table answer with no basket and no timestamp is an empty basket — the diner's own dishes are sent with no timestamp", HOW, () => with_(syncLab(undefined, [{ id: "dish-a", sig: "[]", qty: 1 }], { get: () => json({ ok: true, open: true, approved: true }) }), async (L) => {
  await L.wait(900); const w = calls(L, "lfh_set_cart")[0]; return { ok: !!w && w.args.p_seen === null && w.args.p_cart.length === 1, note: JSON.stringify(w && w.args.p_seen) };
}));
check(S, "only re-ORDERING the basket is not a change — nothing is sent to the table", HOW, () => with_(syncLab([{ id: "a", sig: "[]", qty: 1 }, { id: "b", sig: "[]", qty: 1 }], []), async (L) => {
  await L.wait(900); await setLocal(L, [{ id: "b", sig: "[]", qty: 1 }, { id: "a", sig: "[]", qty: 1 }]); await L.wait(900); return calls(L, "lfh_merge_cart").length === 0;
}));
check(S, "a change made in the last half-second before the basket's screen goes away is not sent to a table nobody is watching", HOW, () => with_(syncLab([{ id: "a", sig: "[]", qty: 1 }], []), async (L) => {
  await L.wait(900); await setLocal(L, [{ id: "a", sig: "[]", qty: 3 }]); await L.wait(100); await L.unmount(); await L.wait(900); return calls(L, "lfh_merge_cart").length === 0;
}));

// ── the table bill and the head's prompt, given an answer with pieces missing ─────────────────────────
check(TB, "a bill answer with pieces missing (no table, no quantities, odd statuses, blank money) shows sensible values — never NaN", HOW, () => with_({ mount: ["tbill"], storage: { [SK]: GUEST }, rpc: { lfh_session_state: () => json({ ok: true, session: { status: "open" }, member: { approved: true },
  orders: [{ items: "not a list" }, null], items: [{ id: "i1", title: "Soup", status: "plated" }, { id: "i2", title: null, status: "served" }], bill: { subtotal: null, discount: 0, tax: undefined, total: "" } }) } }, async (L) => {
  await L.wait(900); const t = (await L.text(".stb")) || ""; return { ok: /plated/.test(t) && /1 of 2 served/.test(t) && !/NaN|undefined/.test(t) && L.errors.length === 0, note: t.replace(/\s+/g, " ").slice(0, 120) };
}));
check(TB, "…a discount on a bill with no subtotal shows the amount but no made-up percentage", HOW, () => with_({ mount: ["tbill"], storage: { [SK]: GUEST }, rpc: { lfh_session_state: () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { approved: true }, items: [{ id: "i", title: "x", qty: 1, status: "served" }], bill: { subtotal: 0, discount: 50, tax: 0, total: 0 } }) } }, async (L) => {
  await L.wait(900); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim())); const d = rows.find((r) => /^Discount/.test(r)) || "";
  return { ok: /^Discount\s*−/.test(d) && !/%/.test(d), note: d };
}));
check(O, "a head's state answer with no table number and no waiting list shows no prompt and does not crash", HOW, () => with_({ mount: ["owner"], storage: { [SK]: { table: "7", token: "tok-h", memberId: "m", role: "owner" } }, rpc: { lfh_session_state: () => json({ ok: true, session: { status: "open" }, member: { role: "owner", approved: true } }) } }, async (L) => {
  await L.wait(900); return !(await L.page.$(".sg-box")) && L.errors.length === 0;
}));
