// Block M — ROUND 2 (2026-10-16): checks for what pass 4 of the deliberate-break test (EVERY never-tried
// point of the table sheet and the table card) showed no check asked (P173975…). P173967–P173974 are left
// free for block l's live checks.
import { check, band, FILES } from "./lib.mjs";
import { openLab, json } from "./lab/page.mjs";
import { HOW } from "./lab/how.mjs";
band(173975);
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const until = async (L, pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await L.wait(60); } return false; };
const go = (L, d) => L.fire("lfh:session-do", d);
const sheet = async (L) => ((await L.text(".sg-box")) || "").replace(/\s+/g, " ");
const SK = "lfh_session:french-house";
const G = FILES.gate, W = FILES.card;
const SEAT = { table: "7", token: "tok-seat", memberId: "m", role: "guest" };
const seated = (o = {}) => ({ mount: ["gate"], storage: { [SK]: SEAT, "lfh_nickname:french-house": { token: "tok-seat", name: "Ravi" } }, api: o.api,
  rpc: { lfh_session_state: () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true } }), ...(o.rpc || {}) } });
const openTS = (members = 2) => () => json({ ok: true, open: true, members, session_id: "s1" });

// ── the table sheet ───────────────────────────────────────────────────────────────────────────────────
check(G, "an order whose basket carries NO allergy list is sent with an empty one — online, and when it is saved for later", HOW, async () => {
  const sent = await with_(seated({ api: { "/api/guest/place-order": () => json({ ok: true, order_id: "o" }) } }), async (L) => {
    await L.wait(500); await go(L, { action: "order", table: "7", payload: { items: [{ id: "d1", qty: 1 }] } }); await until(L, async () => L.apiLog.some((x) => x.path === "/api/guest/place-order")); await L.wait(200);
    return L.apiLog.find((x) => x.path === "/api/guest/place-order").body; });
  const saved = await with_(seated({ api: { "/api/guest/place-order": () => ({ status: 503, contentType: "application/json", body: "{}" }) } }), async (L) => {
    await L.wait(500); await go(L, { action: "order", table: "7", payload: { items: [{ id: "d1", qty: 1 }] } }); await L.wait(1200);
    return L.page.evaluate(() => new Promise((res) => { const r = indexedDB.open("lfh_guest_outbox", 1); r.onupgradeneeded = () => r.result.createObjectStore("orders", { keyPath: "id" }); r.onsuccess = () => { const g = r.result.transaction("orders").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.map((x) => x.allergies)); }; })); });
  return { ok: Array.isArray(sent.allergies) && sent.allergies.length === 0 && saved.length >= 1 && saved.every((a) => Array.isArray(a) && a.length === 0), note: `sent ${JSON.stringify(sent.allergies)} · saved ${JSON.stringify(saved)}` };
});
check(G, "a stored seat the table answers 'removed' or 'session closed' for is dropped, and the diner starts over for that table", HOW, async () => {
  const out = [];
  for (const why of ["removed", "session_closed"]) out.push(await with_(seated({ rpc: { lfh_session_state: () => json({ ok: false, reason: why }), lfh_table_status: () => json({ ok: true, open: false }) } }), async (L) => {
    await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await until(L, async () => /isn.t open yet/.test(await sheet(L)));
    return (await L.ls(SK)) === null && /Your table isn.t open yet/.test(await sheet(L)); }));
  return { ok: out.every(Boolean), note: out.join(",") };
});
const waitLab = (o = {}) => ({ mount: ["gate"], storage: o.storage, rpc: { lfh_table_status: openTS(2), lfh_join_session: () => json({ ok: true, token: "tok-w", member_id: "m", role: "guest", approved: false, session_id: "s1" }),
  lfh_session_state: () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: false } }), lfh_request: o.req || (() => json({ ok: true })) } });
check(G, "two quick taps on 'Call a waiter instead' send ONE request", HOW, () => with_(waitLab({ storage: { "lfh_my_name:french-house": "Raj" }, req: async () => { await new Promise((r) => setTimeout(r, 800)); return json({ ok: true }); } }), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Call a waiter instead")));
  await L.page.$eval("text=Call a waiter instead", (b) => b.click()); await L.wait(80); await L.page.$eval("text=Call a waiter instead", (b) => b.click()).catch(() => null); await L.wait(1300);
  return { ok: calls(L, "lfh_request").length === 1, note: `${calls(L, "lfh_request").length} requests` };
}));
check(G, "…and after a waiter request that FAILED, asking again really sends again", HOW, () => with_(waitLab({ storage: { "lfh_my_name:french-house": "Raj" }, req: (a, n) => (n === 1 ? json({ ok: false, reason: "weird" }) : json({ ok: true })) }), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Call a waiter instead")));
  await L.page.click("text=Call a waiter instead"); await L.wait(600); await L.page.click("text=Call a waiter instead"); await L.wait(600);
  return { ok: calls(L, "lfh_request").length === 2 && /We.ve let the staff know/.test(await sheet(L)), note: `${calls(L, "lfh_request").length} requests` };
}));
check(G, "a name the diner typed on the join screen is the name staff are given — they are not asked for it again", HOW, () => with_(waitLab(), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input")));
  await L.page.fill(".sg-input", "Zoya"); await L.page.click("text=Call a waiter instead"); await L.wait(600); const q = calls(L, "lfh_request")[0];
  return { ok: !!q && q.args.p_name === "Zoya" && !/Calling a waiter/i.test(await sheet(L)), note: JSON.stringify(q && q.args.p_name) };
}));
check(G, "asking for a waiter instead reports the held action as CANCELLED, so a held dish does not wait for a join that is not coming", HOW, () => with_(waitLab({ storage: { "lfh_my_name:french-house": "Raj" } }), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Call a waiter instead"))); await L.page.click("text=Call a waiter instead"); await L.wait(600);
  const d = (await L.events("lfh:session-done")).map((e) => e.detail); return { ok: d.some((x) => x.ok === false && x.reason === "cancelled" && x.action === "connect"), note: JSON.stringify(d) };
}));
const scanLab = (raw) => ({ mount: ["gate"], holdNav: true, rpc: { lfh_table_status: () => json({ ok: true, open: false }) }, init: { fn: (r) => {
  window.BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: r }]); } };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => { const c = document.createElement("canvas"); c.width = 4; c.height = 4; c.getContext("2d").fillRect(0, 0, 4, 4); return Promise.resolve(c.captureStream(5)); } } });
}, arg: raw } });
const scanned = (raw) => with_(scanLab(raw), async (L) => { await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.click("text=Scan QR"); await L.wait(1400);
  return { box: await L.page.$eval(".sg-input", (i) => i.value).catch(() => null), nav: L.navs[0] || null, note: (await L.text(".sg-note-bad")) || "" }; });
check(G, "an old sticker using the short ?t=12 form still fills in table 12", HOW, async () => { const r = await scanned("https://t4lab.test/menu?t=12"); return { ok: r.box === "12", note: JSON.stringify(r) }; });
check(G, "a /q/ code of 6 characters (the shortest a sticker carries) opens its page; one of 17 is not ours and is refused", HOW, async () => {
  const a = await scanned("https://t4lab.test/q/abc123"), b = await scanned("https://t4lab.test/q/ABCDEFGHIJKLMNOPQ");
  return { ok: a.nav === "/q/ABC123" && b.nav === null && /doesn.t say which table/.test(b.note), note: `${a.nav} / ${b.nav} ${b.note.slice(0, 40)}` };
});
check(G, "the phone keyboard's Go/Enter submits on every name screen — 'isn't open yet', 'Opening table 7' and 'Calling a waiter'", HOW, async () => {
  const notOpen = await with_({ mount: ["gate"], rpc: { lfh_table_status: () => json({ ok: true, open: false }), lfh_request: () => json({ ok: true }) } }, async (L) => {
    await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia"); await L.page.press(".sg-input", "Enter"); await L.wait(500); return calls(L, "lfh_request").length === 1; });
  const head = await with_({ mount: ["gate"], rpc: { lfh_table_status: openTS(0), lfh_join_session: () => json({ ok: true, token: "t", member_id: "m", role: "owner", approved: true, session_id: "s1" }) } }, async (L) => {
    await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia"); await L.page.press(".sg-input", "Enter"); await L.wait(600); return calls(L, "lfh_join_session").length === 1; });
  const access = await with_({ mount: ["gate"], storage: { "lfh_loc_consent:french-house": "1" }, init: { fn: () => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok, err) => setTimeout(() => err({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30) } }); }, arg: null },
    rpc: { lfh_guest_settings: async () => json((await import("./lab/page.mjs")).settingsOn({ require_location: true, geo_lat: 19, geo_lng: 72.8, geo_radius_m: 250 })), lfh_request: () => json({ ok: true }) } }, async (L) => {
    await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$("text=Request a waiter"))); await L.page.click("text=Request a waiter");
    await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia"); await L.page.press(".sg-input", "Enter"); await L.wait(500); return calls(L, "lfh_request").length === 1; });
  return { ok: notOpen && head && access, note: `not open ${notOpen} · head ${head} · waiter ${access}` };
});

// ── the table card ────────────────────────────────────────────────────────────────────────────────────
const cardLab = (who, st) => ({ mount: ["card"], storage: { [SK]: who, lfh_sess_widget_collapsed: "0" }, rpc: { lfh_session_state: () => json({ ok: true, session: { table_number: "7", status: "open" }, ...st }) } });
const HEAD = { table: "7", token: "tok-h", memberId: "m", role: "owner" };
check(W, "a head whose state answer carries no member list reads 'You opened this table' — never a made-up '2 at this table'", HOW, () => with_(cardLab(HEAD, { member: { role: "owner", approved: true } }), async (L) => {
  await until(L, async () => !!(await L.page.$(".ssw-sub"))); return { ok: (await L.text(".ssw-sub")) === "You opened this table", note: await L.text(".ssw-sub") };
}));
check(W, "food still cooking on a table whose orders carry no times still holds the diner at the table", HOW, () => with_(cardLab(SEAT, { member: { role: "guest", approved: true }, members: [{}], calls: [], items: [{ status: "preparing" }], orders: [{ created_at: null }, {}] }), async (L) => {
  await until(L, async () => !!(await L.page.$("text=Leave / own cart"))); await L.page.click("text=Leave / own cart"); await L.wait(200); return !!(await L.page.$(".popup.active"));
}));
check(W, "a table with no open requests shows no 'This table asked for' line at all", HOW, () => with_(cardLab(SEAT, { member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [] }), async (L) => {
  await until(L, async () => !!(await L.page.$(".ssw-card"))); return !(await L.page.$(".ssw-called"));
}));
check(G, "on 'Your table isn't open yet', a waiter request that FAILED can be asked again — the second tap really sends", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: () => json({ ok: true, open: false }), lfh_request: (a, n) => (n === 1 ? json({ ok: false, reason: "weird" }) : json({ ok: true })) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await until(L, async () => !!(await L.page.$(".sg-input"))); await L.page.fill(".sg-input", "Mia");
  await L.page.click("text=Request a waiter"); await L.wait(600); await L.page.click("text=Request a waiter"); await L.wait(600);
  return { ok: calls(L, "lfh_request").length === 2 && /We.ve let the staff know/.test(await sheet(L)), note: `${calls(L, "lfh_request").length} requests` };
}));
