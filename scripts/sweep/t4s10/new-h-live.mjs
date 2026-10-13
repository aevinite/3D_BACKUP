// Block H — LIVE on this terminal's own production build (port 4404, never 4000), driven like a diner
// (P173522…). Every test restaurant has table sessions OFF on the dev database today, so the session
// screens are reached by holding the DATABASE'S ANSWERS in the browser (Playwright routes on the public
// client's RPC calls) — the page, its components and its network code are the real built app; only
// what the database would have said is chosen. NOT ONE ROW IS WRITTEN by this block.
import { check, band, FILES, REAL_FETCH } from "./lib.mjs";
const fetch = (...a) => REAL_FETCH(...a);
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.T4_BASE || "http://localhost:4404";
const SHOTS = process.env.T4_SHOTS || "/Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/shots/S10-T4";
mkdirSync(SHOTS, { recursive: true });
const HOW = `LIVE — the built app on ${BASE.replace("http://", "")}, headless Chromium`;
const HOWS = `${HOW}; database answers held in the browser, no row written`;
band(173522);
const FH = "french-house", FH_ID = "00000000-0000-0000-0000-000000000001";
const memo = new Map();
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
let browser;
const B = async () => (browser ||= await chromium.launch());
process.on("exit", () => { try { browser && browser.close(); } catch {} });
const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };
const IPAD = { viewport: { width: 1194, height: 834 }, hasTouch: true };
const MACHINE = /undefined|NaN|\[object Object\]|\$\{|-->/;
const pg500 = (code, message) => ({ status: 500, contentType: "application/json", body: JSON.stringify({ code, message, details: null, hint: null }) });
const okJson = (v) => ({ status: 200, contentType: "application/json", body: JSON.stringify(v) });
/** A page whose RPC answers are chosen. h[fn] = (args, n) => fulfil-object | "real" | "abort" | "sessionsOn". */
async function stubbed(opts, h, setup) {
  const ctx = await (await B()).newContext(opts);
  const log = []; const counts = {};
  await ctx.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0]; let args = {}; try { args = route.request().postDataJSON() || {}; } catch {}
    counts[fn] = (counts[fn] || 0) + 1; log.push({ fn, args, n: counts[fn] });
    const f = h[fn]; const v = typeof f === "function" ? f(args, counts[fn]) : f;
    if (v === undefined || v === "real") return route.continue();
    if (v === "abort") return route.abort("internetdisconnected");
    if (v === "sessionsOn") { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, sessions_enabled: true, require_location: false } }); }
    return route.fulfill(v);
  });
  if (setup) await ctx.addInitScript(setup.fn, setup.arg);
  await ctx.addInitScript(() => { window.__done = []; window.__toasts = []; window.addEventListener("lfh:session-done", (e) => window.__done.push(e.detail)); window.addEventListener("lfh:toast", (e) => window.__toasts.push(e.detail)); });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  return { ctx, page, log, errors };
}
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const sheetText = (p) => p.evaluate(() => (document.querySelector(".sg-box") || {}).innerText || "");
const fire = (p, detail) => p.evaluate((d) => window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: d })), detail);
const seed = (session, extra = {}) => ({ fn: ({ s, x }) => { try { if (s) localStorage.setItem("lfh_session:french-house", JSON.stringify(s)); for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); } catch {} }, arg: { s: session, x: extra } });

// ── H1 · the four endpoints, over the wire ─────────────────────────────────────────────────────────
const E = () => once("E", async () => {
  const md = await fetch(`${BASE}/api/r/${FH}/menu-data`); const mdj = await md.json(); const tag = md.headers.get("etag");
  const md304 = await fetch(`${BASE}/api/r/${FH}/menu-data`, { headers: { "if-none-match": tag } });
  const nf = await fetch(`${BASE}/api/r/definitely-not-a-restaurant/menu-data`); const nfj = await nf.json();
  const rt = await fetch(`${BASE}/api/rt-config?rid=cccccccc-0000-4000-8000-000000000003`); const rtj = await rt.json();
  const bl = await fetch(`${BASE}/api/blocked`); const blj = await bl.json();
  const bp = await fetch(`${BASE}/api/blocked`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ip: "1.1.1.1", message: "hi" }) }); const bpj = await bp.json();
  const role = (() => { try { return JSON.parse(Buffer.from(String(rtj.anonKey).split(".")[1], "base64url").toString()).role; } catch { return "?"; } })();
  return { md, mdj, tag, md304, md304body: await md304.text(), nf, nfj, rt, rtj, role, bl, blj, bp, bpj };
});
check(FILES.menuData, "the menu bundle answers 200 with exactly { items, categories }", HOW, async () => { const e = await E(); return { ok: e.md.status === 200 && Object.keys(e.mdj).sort().join() === "categories,items", note: Object.keys(e.mdj).join(",") }; });
check(FILES.menuData, "…with French House's real dishes on it", HOW, async () => { const e = await E(); return { ok: e.mdj.items.length > 20 && e.mdj.categories.length > 3, note: `${e.mdj.items.length} dishes, ${e.mdj.categories.length} categories` }; });
check(FILES.menuData, "…no-store, so no edge cache sits in front of the one an owner's edit can purge", HOW, async () => (await E()).md.headers.get("cache-control") === "no-store");
check(FILES.menuData, "…and no staff-only column reaches a diner's phone (no cost, stock, notes, supplier, margin)", HOW, async () => {
  const e = await E(); const keys = [...new Set(e.mdj.items.flatMap((i) => Object.keys(i)))]; const bad = keys.filter((k) => /cost|stock|supplier|margin|internal|staff|purchase|note_staff/i.test(k)); return { ok: bad.length === 0, note: `${keys.length} fields` };
});
check(FILES.menuData, "a phone already holding this version gets 304 with no body (the 60-second net is ~free)", HOW, async () => { const e = await E(); return { ok: e.md304.status === 304 && e.md304body === "" && !!e.tag, note: e.tag }; });
check(FILES.menuData, "an unknown restaurant is 404 saying only 'not found' — not a crash and not a hint", HOW, async () => { const e = await E(); return e.nf.status === 404 && JSON.stringify(e.nfj) === '{"error":"not found"}'; });
check(FILES.rt, "rt-config signed out: the two PUBLIC values and ONE restaurant (#1), no-store — and a ?rid= cannot move it", HOW, async () => { const e = await E(); return { ok: e.rt.status === 200 && Object.keys(e.rtj).sort().join() === "anonKey,restaurantId,url" && e.rtj.restaurantId === FH_ID && e.rt.headers.get("cache-control") === "no-store", note: e.rtj.restaurantId }; });
check(FILES.rt, "…and the key it hands out decodes to the public role, never the powerful one", HOW, async () => { const e = await E(); return { ok: e.role === "anon", note: `role=${e.role}` }; });
check(FILES.blocked, "/api/blocked, a device that is not blocked → told so, with no login and no cookie", HOW, async () => { const e = await E(); return { ok: e.bl.status === 200 && e.blj.blocked === false && e.blj.remaining === 3, note: JSON.stringify(e.blj) }; });
check(FILES.blocked, "…and asking to be unblocked while not blocked writes nothing and says why (an ip in the body is ignored)", HOW, async () => { const e = await E(); return e.bpj.ok === false && e.bpj.reason === "not_blocked"; });

// ── H2 · the plain guest menu: sessions really OFF ─────────────────────────────────────────────────
const P = () => once("P", async () => {
  const { ctx, page, log, errors } = await stubbed(PHONE, {});
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 1500);
  const r = await page.evaluate(() => ({ sg: !!document.querySelector(".sg-overlay"), card: !!document.querySelector(".ssw-card,.ssw-bubble"), ban: !!document.querySelector(".ban-overlay") }));
  await page.locator('button[aria-label="Add Caffè Latte to cart"]').first().click(); await settle(page, 800);
  const after = await page.evaluate(() => ({ sg: !!document.querySelector(".sg-overlay"), cart: Object.keys(localStorage).filter((k) => k.startsWith("lfh_cart:")).map((k) => [k, (JSON.parse(localStorage.getItem(k) || "[]") || []).length]) }));
  const fns = [...new Set(log.map((x) => x.fn))]; const settingsRid = (log.find((x) => x.fn === "lfh_guest_settings") || {}).args?.p_restaurant_id;
  await ctx.close(); return { r, after, fns, settingsRid, errors };
});
check(FILES.card, "with sessions OFF the table card draws nothing on French House's menu", HOW, async () => !(await P()).r.card);
check(FILES.gate, "…and the table sheet draws nothing either", HOW, async () => !(await P()).r.sg);
check(FILES.ban, "…and a guest who is not banned never sees the ban wall", HOW, async () => !(await P()).r.ban);
check(FILES.conn, "…and tapping '+' puts the dish straight in THIS restaurant's basket, no sheet", HOW, async () => { const a = (await P()).after; return { ok: !a.sg && a.cart.some(([k, n]) => k === "lfh_cart:french-house" && n === 1), note: JSON.stringify(a.cart) }; });
check(FILES.ctx, "…every restaurant-keyed read on the page names French House (no #1 guess for another tenant, and none asked twice)", HOW, async () => { const p = await P(); return { ok: p.settingsRid === FH_ID, note: p.fns.join(",") }; });
check(FILES.sess, "…the guest app makes only RPC calls it is allowed (settings, ban check, greeting) — none of the session ones on a plain load", HOW, async () => { const p = await P(); return { ok: !p.fns.some((f) => /session|join|table_status|cart/.test(f)), note: p.fns.join(",") }; });
check(FILES.gate, "…no page error on the plain load", HOW, async () => { const e = (await P()).errors; return { ok: e.length === 0, note: e.slice(0, 2).join(" | ") }; });

// ── H3 · sessions ON: the "Which table are you at?" sheet ──────────────────────────────────────────
const A = () => once("A", async () => {
  const out = {};
  const { ctx, page, log, errors } = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn", lfh_table_status: () => okJson({ ok: true, open: false, members: 0 }), lfh_request: () => okJson({ ok: true }) });
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 1200);
  await page.locator('button[aria-label="Add Caffè Latte to cart"]').first().click(); await settle(page, 1200);
  out.opened = await sheetText(page);
  out.kicker = await page.evaluate(() => (document.querySelector(".sg-kicker") || {}).textContent || "");
  out.input = await page.evaluate(() => { const i = document.querySelector(".sg-input"); return i ? { mode: i.getAttribute("inputmode"), type: i.type, focused: document.activeElement === i } : null; });
  out.clearBefore = await page.locator(".sg-input-clear").count();
  await page.fill(".sg-input", "5"); out.clearAfter = await page.locator(".sg-input-clear").count();
  await page.click(".sg-input-clear"); out.afterClear = await page.inputValue(".sg-input");
  await page.fill(".sg-input", "99"); await page.click(".sg-btn.gold"); await settle(page, 300); out.range = await sheetText(page); out.stillOpen = await page.locator(".sg-overlay").count(); out.kept = await page.inputValue(".sg-input");
  await page.fill(".sg-input", ""); await page.click(".sg-btn.gold"); await settle(page, 300); out.empty = await sheetText(page);
  await page.fill(".sg-input", "007"); await page.press(".sg-input", "Enter"); await settle(page, 1500);
  out.wire = (log.find((x) => x.fn === "lfh_table_status") || {}).args; out.notOpen = await sheetText(page);
  out.remembered = await page.evaluate(() => localStorage.getItem("lfh_table:french-house"));
  const box = await page.locator(".sg-box").boundingBox(); out.box = box;
  out.btnH = await page.evaluate(() => [...document.querySelectorAll(".sg-btn")].map((b) => Math.round(b.getBoundingClientRect().height)));
  await page.screenshot({ path: `${SHOTS}/a35-not-open.png` });
  await page.locator(".sg-input").fill("");
  await page.click(".sg-btn.gold"); await settle(page, 300); out.nameRefusal = await sheetText(page);
  await page.goBack().catch(() => {}); await settle(page, 600); out.afterBack = { open: await page.locator(".sg-overlay").count(), url: page.url() };
  out.done = await page.evaluate(() => window.__done);
  out.errors = errors; await ctx.close(); return out;
});
check(FILES.gate, "a diner tapping '+' with no table known gets the 'Which table are you at?' sheet at once", HOWS, async () => { const a = await A(); return { ok: /Which table are you at\?/.test(a.opened), note: a.opened.slice(0, 60).replace(/\n/g, " · ") }; });
check(FILES.gate, "…headed with THIS restaurant's own name, never a hard-coded brand", HOWS, async () => { const a = await A(); return { ok: /my little french house/i.test(a.kicker), note: a.kicker }; });
check(FILES.gate, "…a numeric keypad, and the box has focus already", HOWS, async () => { const a = await A(); return { ok: a.input && a.input.mode === "numeric" && a.input.focused, note: JSON.stringify(a.input) }; });
check(FILES.gate, "…the clear ✕ is absent while the box is empty, appears once something is typed, and empties it", HOWS, async () => { const a = await A(); return a.clearBefore === 0 && a.clearAfter === 1 && a.afterClear === ""; });
check(FILES.table, "…a table the restaurant does not have is refused BY NAME, with the real range (1–30, French House's own count)", HOWS, async () => { const a = await A(); return { ok: /Table 99 doesn't exist — we have tables 1–30\. Please check your number\./.test(a.range), note: a.range.split("\n").find((l) => /Table 99/.test(l)) || "" }; });
check(FILES.gate, "…and the sheet stays open with the number still typed, so nothing is lost", HOWS, async () => { const a = await A(); return a.stillOpen === 1 && a.kept === "99"; });
check(FILES.table, "…an empty box is told to type something", HOWS, async () => /Please enter your table number first\./.test((await A()).empty));
check(FILES.table, "…'007' typed and sent with the keyboard's Go key reaches the database as table 7", HOWS, async () => { const a = await A(); return { ok: a.wire && a.wire.p_table === "7" && a.wire.p_restaurant_id === FH_ID, note: JSON.stringify(a.wire) }; });
check(FILES.gate, "…a table nobody has opened yet is ONE screen: add your name and we tell staff", HOWS, async () => /Your table isn.t open yet/.test((await A()).notOpen));
check(FILES.table, "…and the remembered table is the canonical number too", HOWS, async () => (await A()).remembered === "7");
check(FILES.gate, "…'Request a waiter' with an empty name refuses by name and stays put", HOWS, async () => /Add your name so staff know who.s asking\./.test((await A()).nameRefusal));
check(FILES.gate, "…the sheet fits inside a 360 px phone with room either side and above the bottom", HOWS, async () => { const b = (await A()).box; return { ok: b && b.x >= 8 && b.x + b.width <= 352 && b.y + b.height <= 780, note: b && `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}` }; });
check(FILES.gate, "…its buttons are finger-sized (≥ 44 px tall)", HOWS, async () => { const h = (await A()).btnH; return { ok: h.length > 0 && h.every((x) => x >= 44), note: h.join(",") }; });
check(FILES.gate, "…the phone's Back button closes the sheet instead of leaving the menu", HOWS, async () => { const a = await A(); return { ok: a.afterBack.open === 0 && /\/r\/french-house\/menu/.test(a.afterBack.url), note: JSON.stringify(a.afterBack) }; });
check(FILES.conn, "…and closing it reports the held dish as a cancelled CONNECT, so the gate drops it", HOWS, async () => { const d = (await A()).done; return { ok: d.some((x) => x && x.action === "connect" && x.ok === false && x.reason === "cancelled"), note: JSON.stringify(d) }; });
check(FILES.gate, "…no machine text anywhere on the sheet, and no page error", HOWS, async () => { const a = await A(); return { ok: !MACHINE.test(a.opened + a.range + a.notOpen) && a.errors.length === 0, note: a.errors.join(" | ") }; });

// ── H4 · item 1 live: a busy restaurant is not the diner's wifi ────────────────────────────────────
const GUEST = { table: "7", token: "t4-live-not-a-real-token", memberId: "m-live", role: "guest" };
const NICK = { "lfh_nickname:french-house": JSON.stringify({ token: GUEST.token, name: "Ravi" }) };
const busyRun = (stateAnswer) => once("busy-" + stateAnswer, async () => {
  const { ctx, page, errors } = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn", lfh_session_state: () => (stateAnswer === "timeout" ? pg500("57014", "canceling statement due to statement timeout") : stateAnswer === "odd" ? pg500("XX000", "internal error") : "abort") }, seed(GUEST, NICK));
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 800);
  await fire(page, { action: "call", table: "7", payload: { reason: "Water" } }); await settle(page, 2500);
  const t = await sheetText(page); const btns = await page.evaluate(() => [...document.querySelectorAll(".sg-btn")].map((b) => b.textContent.trim()));
  if (stateAnswer === "timeout") await page.screenshot({ path: `${SHOTS}/a35-busy-on-us.png` });
  await ctx.close(); return { t, btns, errors };
});
check(FILES.gate, "a seated diner whose table check TIMES OUT (the restaurant's system is busy) is told 'this one's on us' — not to check their wifi (item 1)", HOWS, async () => { const r = await busyRun("timeout"); return { ok: /this one.s on us/.test(r.t) && !/check your internet/i.test(r.t), note: r.t.split("\n").slice(1, 3).join(" · ") }; });
check(FILES.gate, "…and their spot at the table is still safe, with Retry and Close offered", HOWS, async () => { const r = await busyRun("timeout"); return /your spot at the table is safe/i.test(r.t) && r.btns.includes("Retry") && r.btns.includes("Close"); });
check(FILES.gate, "…while a phone that genuinely lost its signal IS told to check its internet", HOWS, async () => { const r = await busyRun("abort"); return { ok: /phone seems to be offline/.test(r.t) && /check your internet/i.test(r.t) && !/on us/.test(r.t), note: r.t.split("\n").slice(1, 3).join(" · ") }; });
const joinRun = () => once("join", async () => {
  const { ctx, page, errors } = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn", lfh_table_status: () => okJson({ ok: true, open: true, members: 2, session_id: "s-live" }), lfh_join_session: () => pg500("53300", "sorry, too many clients already") });
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 800);
  await fire(page, { action: "connect", table: "7", payload: {} }); await settle(page, 1500);
  const first = await sheetText(page); await page.fill(".sg-input", "Mia"); await page.click(".sg-btn.gold"); await settle(page, 1500);
  const t = await sheetText(page); await ctx.close(); return { first, t, errors };
});
check(FILES.gate, "asking to join a table someone else holds asks this diner's name first", HOWS, async () => /This table.s already open/.test((await joinRun()).first));
check(FILES.gate, "…and a join the busy restaurant could not take keeps their name typed and says 'this one's on us' (item 1)", HOWS, async () => { const r = await joinRun(); return { ok: /this one.s on us/.test(r.t) && /This table.s already open/.test(r.t) && !/check your internet/i.test(r.t), note: r.t.split("\n").slice(-3).join(" · ") }; });

// ── H5 · item 4 live: the ban wall says which refusal ──────────────────────────────────────────────
const banRun = () => once("ban", async () => {
  let unban = "timeout";
  const { ctx, page, errors } = await stubbed(PHONE, { lfh_check_ban: () => okJson({ ok: true, banned: true, reason: "testing the wall", unban_requested: false }), lfh_request_unban: () => (unban === "timeout" ? pg500("57014", "canceling statement due to statement timeout") : unban === "nomatch" ? okJson({ ok: false, reason: "not_blocked" }) : okJson({ ok: true, recorded: 1 })) });
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 1200);
  const wall = await page.evaluate(() => (document.querySelector(".ban-card") || {}).innerText || "");
  await page.fill(".ban-input", "9876543210"); await page.click(".ban-btn"); await settle(page, 1200); const t1 = await page.evaluate(() => (document.querySelector(".ban-fail") || {}).textContent || "");
  await page.screenshot({ path: `${SHOTS}/a35-ban-busy.png` });
  unban = "nomatch"; await page.click(".ban-btn"); await settle(page, 1200); const t2 = await page.evaluate(() => (document.querySelector(".ban-fail") || {}).textContent || "");
  unban = "ok"; await page.click(".ban-btn"); await settle(page, 1200); const t3 = await page.evaluate(() => (document.querySelector(".ban-done") || {}).textContent || "");
  await ctx.close(); return { wall, t1, t2, t3, errors };
});
check(FILES.ban, "a banned device sees the full-screen wall, with the staff's reason", HOWS, async () => { const r = await banRun(); return { ok: /You.ve been blocked/.test(r.wall) && /testing the wall/.test(r.wall), note: r.wall.slice(0, 80).replace(/\n/g, " · ") }; });
check(FILES.ban, "…an unblock request that TIMED OUT says the restaurant's system isn't answering — not that the number didn't match (item 4)", HOWS, async () => { const r = await banRun(); return { ok: /isn.t answering right now/.test(r.t1) && !/match/.test(r.t1), note: r.t1 }; });
check(FILES.ban, "…only the database's own 'not_blocked' answer says the number didn't match", HOWS, async () => { const r = await banRun(); return { ok: /couldn.t match that number/.test(r.t2), note: r.t2 }; });
check(FILES.ban, "…and a request that went in says so, and only then", HOWS, async () => { const r = await banRun(); return { ok: /request has been sent/.test(r.t3), note: r.t3 }; });

// ── H6 · the table card, as the head and mid-meal ──────────────────────────────────────────────────
const HEAD = { table: "7", token: "t4-live-head", memberId: "m-head", role: "owner" };
const stateFor = ({ items = [], orders = [], members = 3, calls = [{ note: "Water" }], role = "owner", approved = true } = {}) => okJson({ ok: true, session: { id: "s-live", table_number: "7", status: "open" }, member: { id: "m-head", role, approved }, members: Array.from({ length: members }, (_, i) => ({ id: "m" + i })), calls, items, orders, bill: { subtotal: 0, tax: 0, total: 0 } });
const cardRun = (opts, key, viewport = PHONE, theme = "dark") => once("card-" + key, async () => {
  const { ctx, page, errors } = await stubbed(viewport, { lfh_guest_settings: "sessionsOn", lfh_session_state: () => stateFor(opts), lfh_touch_session: () => okJson({ ok: true }) }, seed(HEAD, { lfh_theme: theme, "lfh_sess_widget_collapsed": "0" }));
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" });
  // The card plays its intro for 2 s and then shrinks to a bubble by design; a real tap on the bubble
  // reopens it (pointerdown + pointerup with no movement). Wait for whichever is on screen.
  await page.waitForSelector(".ssw-card,.ssw-bubble", { timeout: 15000 }).catch(() => {}); await settle(page, 2600);
  if (await page.locator(".ssw-bubble").count()) { await page.locator(".ssw-bubble").click({ force: true }); await settle(page, 500); }
  const t = await page.evaluate(() => (document.querySelector(".ssw-card") || {}).innerText || "");
  const box = await page.locator(".ssw-card").boundingBox().catch(() => null);
  await page.screenshot({ path: `${SHOTS}/${key}.png` });
  let leave = "";
  if (t && await page.locator(".ssw-btn.danger").count()) { await page.locator(".ssw-btn.danger").first().click(); await settle(page, 500); leave = await page.evaluate(() => ((document.querySelector(".popup.active") || {}).innerText || "") + " " + ((document.querySelector(".ssw-confirm-q") || {}).textContent || "")); }
  await ctx.close(); return { t, box, leave, errors };
});
check(FILES.card, "the head's table card names the table and how many are at it", HOWS, async () => { const r = await cardRun({}, "a35-card-head"); return { ok: /Hosting Table 7/.test(r.t) && /3 at this table/.test(r.t), note: r.t.replace(/\n/g, " · ").slice(0, 90) }; });
check(FILES.card, "…labels the open requests as the TABLE's, not this diner's", HOWS, async () => { const r = await cardRun({}, "a35-card-head"); return /This table asked for/i.test(r.t) && /Water/.test(r.t) && !/You called for/i.test(r.t); });
check(FILES.card, "…sits inside the 360 px phone, both directions", HOWS, async () => { const b = (await cardRun({}, "a35-card-head")).box; return { ok: b && b.x >= 0 && b.x + b.width <= 360 && b.y >= 0 && b.y + b.height <= 780, note: b && `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}` }; });
check(FILES.card, "…with no food in flight, Leave asks 'are you sure' and says the order stays with the bill", HOWS, async () => { const r = await cardRun({}, "a35-card-head"); return { ok: /Leave this table\? Your order stays with the table for the bill/.test(r.leave), note: r.leave.trim().slice(0, 80) }; });
check(FILES.card, "…mid-meal (a dish cooking, ordered 10 min ago) Leave is refused with the reason and a waiter offered", HOWS, async () => { const r = await cardRun({ items: [{ id: "i1", status: "preparing" }], orders: [{ created_at: new Date(Date.now() - 10 * 60000).toISOString() }] }, "a35-card-midmeal"); return { ok: /Your order.s on its way/.test(r.leave), note: r.leave.trim().slice(0, 60) }; });
check(FILES.card, "…and a meal whose newest order is 200 min old lets go (the 90-minute expiry, sweep #9 item 9)", HOWS, async () => { const r = await cardRun({ items: [{ id: "i1", status: "preparing" }], orders: [{ created_at: new Date(Date.now() - 200 * 60000).toISOString() }] }, "a35-card-stale"); return { ok: /Leave this table\?/.test(r.leave) && !/on its way/.test(r.leave), note: r.leave.trim().slice(0, 60) }; });
check(FILES.card, "…the card in the LIGHT skin reads the same, nothing machine-looking, no page error", HOWS, async () => { const r = await cardRun({}, "a35-card-light", PHONE, "light"); return { ok: /Hosting Table 7/.test(r.t) && !MACHINE.test(r.t) && r.errors.length === 0, note: r.errors.join(" | ") }; });
check(FILES.card, "…and on a desktop", HOWS, async () => { const r = await cardRun({}, "desk-card-head", DESK); return { ok: /Hosting Table 7/.test(r.t) && r.box && r.box.x + r.box.width <= 1280, note: r.box && `${Math.round(r.box.x)},${Math.round(r.box.y)}` }; });
check(FILES.tbill, "a partner the head never accepted sees no live table card at all (approved:false)", HOWS, async () => { const r = await cardRun({ role: "guest", approved: false }, "a35-card-pending"); return { ok: /Waiting for the host to let you in/.test(r.t) || r.t === "", note: r.t.slice(0, 60) }; });

// ── H7 · item 2 live: a failed first read of the switch is asked again ─────────────────────────────
const blipRun = () => once("blip", async () => {
  const { ctx, page, log, errors } = await stubbed(PHONE, { lfh_guest_settings: (_a, n) => (n <= 2 ? pg500("57014", "canceling statement due to statement timeout") : "sessionsOn"), lfh_session_state: () => stateFor({}), lfh_touch_session: () => okJson({ ok: true }) }, seed(HEAD, { "lfh_sess_widget_collapsed": "0" }));
  const t0 = Date.now(); await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" });
  let seen = 0; for (let i = 0; i < 30 && !seen; i++) { await settle(page, 500); if (await page.locator(".ssw-card,.ssw-bubble").count()) seen = Date.now() - t0; }
  const asks = log.filter((x) => x.fn === "lfh_guest_settings").length; await ctx.close(); return { seen, asks, errors };
});
check(FILES.card, "item 2, on the real page: the restaurant's switch read FAILS twice at load, and the table card still appears once it answers", HOWS, async () => { const r = await blipRun(); return { ok: r.seen > 0, note: `card after ${r.seen} ms, ${r.asks} settings asks` }; });
check(FILES.conn, "…the retry waited and widened rather than hammering (a handful of asks in ~15 s, never a fast poll)", HOWS, async () => { const r = await blipRun(); return { ok: r.asks >= 3 && r.asks <= 8, note: `${r.asks} asks` }; });

// ── H8 · two phones at one table: a friend asks to join, the head decides ─────────────────────────
const twoRun = (decision) => once("two-" + decision, async () => {
  const shared = { approved: false, removed: false, pending: [] };
  const head = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn", lfh_touch_session: () => okJson({ ok: true }),
    lfh_session_state: () => okJson({ ok: true, session: { id: "s2", table_number: "7", status: "open" }, member: { id: "m-head", role: "owner", approved: true }, members: [{ id: "m-head" }], pending: shared.pending, calls: [], items: [], orders: [] }),
    lfh_approve_member: () => { shared.approved = true; shared.pending = []; return okJson({ ok: true }); },
    lfh_remove_member: () => { shared.removed = true; shared.pending = []; return okJson({ ok: true }); } }, seed(HEAD));
  const guest = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn",
    lfh_table_status: () => okJson({ ok: true, open: true, members: 1, session_id: "s2" }),
    lfh_join_session: (a) => { shared.pending = [{ id: "m-mia", name: a.p_name }]; return okJson({ ok: true, token: "t-mia", member_id: "m-mia", role: "guest", approved: false, session_id: "s2" }); },
    lfh_session_state: () => (shared.removed ? okJson({ ok: false, reason: "removed" }) : okJson({ ok: true, session: { id: "s2", table_number: "7", status: "open" }, member: { id: "m-mia", role: "guest", approved: shared.approved }, members: [], calls: [], items: [], orders: [] })) });
  await head.page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await guest.page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" });
  await settle(guest.page, 800); await fire(guest.page, { action: "connect", table: "7", payload: {} }); await settle(guest.page, 1200);
  await guest.page.fill(".sg-input", "Mia"); await guest.page.click(".sg-btn.gold"); await settle(guest.page, 1200);
  const waiting = await sheetText(guest.page);
  let prompt = ""; for (let i = 0; i < 20 && !/wants to join/.test(prompt); i++) { await settle(head.page, 500); prompt = await head.page.evaluate(() => (document.querySelector(".sg-box") || {}).innerText || ""); }
  await head.page.screenshot({ path: `${SHOTS}/a35-head-prompt.png` });
  await head.page.click(decision === "approve" ? ".sg-btn.gold" : ".sg-btn.ghost"); await settle(head.page, 600);
  let end = ""; for (let i = 0; i < 30; i++) { await settle(guest.page, 500); const d = await guest.page.evaluate(() => window.__done); end = JSON.stringify(d) + " " + (await sheetText(guest.page)); if (/"ok":true|didn.t let you in/.test(end)) break; }
  const out = { waiting, prompt, end, he: head.errors, ge: guest.errors }; await head.ctx.close(); await guest.ctx.close(); return out;
});
check(FILES.gate, "TWO PHONES: a friend asking to join an open table waits on 'Waiting for the table to let you in…'", HOWS, async () => { const r = await twoRun("approve"); return { ok: /Waiting for the table to let you in/.test(r.waiting), note: r.waiting.split("\n").slice(1, 2).join("") }; });
check(FILES.owner, "…the head's phone shows '<name> wants to join' — the prompt every earlier sweep could not reach", HOWS, async () => { const r = await twoRun("approve"); return { ok: /Mia wants to join/.test(r.prompt) && /table 7/i.test(r.prompt), note: r.prompt.split("\n").slice(1, 3).join(" · ") }; });
check(FILES.gate, "…'Let them in' carries the friend in by itself — their held dish goes through (connect ok)", HOWS, async () => { const r = await twoRun("approve"); return { ok: /"action":"connect"[^}]*"ok":true|"ok":true[^}]*"action":"connect"/.test(r.end), note: r.end.slice(0, 100) }; });
check(FILES.gate, "…and 'Not them' shows the friend 'The table didn't let you in', never a forever spinner", HOWS, async () => { const r = await twoRun("deny"); return { ok: /didn.t let you in/.test(r.end), note: r.end.slice(-80) }; });
check(FILES.owner, "…no page error on either phone through the whole exchange", HOWS, async () => { const a = await twoRun("approve"), d = await twoRun("deny"); const e = [...a.he, ...a.ge, ...d.he, ...d.ge]; return { ok: e.length === 0, note: e.slice(0, 2).join(" | ") }; });

// ── H9 · the sheet on three screens and both skins ────────────────────────────────────────────────
const devRun = (name, opts, theme) => once("dev-" + name + theme, async () => {
  const { ctx, page, errors } = await stubbed(opts, { lfh_guest_settings: "sessionsOn" }, seed(null, { lfh_theme: theme }));
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 800);
  await fire(page, { action: "connect", table: "", payload: {} }); await settle(page, 1600);
  const m = await page.evaluate(() => { const b = document.querySelector(".sg-box"); if (!b) return null; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const t = getComputedStyle(b.querySelector(".sg-title"));
    return { x: r.x, y: r.y, w: r.width, h: r.height, op: getComputedStyle(document.querySelector(".sg-overlay")).opacity, bg: cs.backgroundColor, fg: t.color, btn: [...b.querySelectorAll(".sg-btn")].map((x) => x.getBoundingClientRect().height), text: b.innerText }; });
  await page.screenshot({ path: `${SHOTS}/${name}-${theme}-ask-table.png` }); await ctx.close(); return { m, errors, vw: opts.viewport.width, vh: opts.viewport.height };
});
for (const [name, opts] of [["a35", PHONE], ["ipad", IPAD], ["desk", DESK]]) for (const theme of ["dark", "light"]) {
  check(FILES.gate, `the table sheet on ${name} (${opts.viewport.width}×${opts.viewport.height}), ${theme} skin: fully drawn, inside the screen, finger-sized buttons`, HOWS, async () => {
    const r = await devRun(name, opts, theme); const m = r.m; if (!m) return { ok: false, note: "no sheet" };
    return { ok: Number(m.op) === 1 && m.x >= 0 && m.x + m.w <= r.vw && m.y >= 0 && m.y + m.h <= r.vh && m.btn.every((h) => h >= 44), note: `${Math.round(m.w)}×${Math.round(m.h)} at ${Math.round(m.x)},${Math.round(m.y)} · buttons ${m.btn.map(Math.round)}` };
  });
  check(FILES.gate, `…on ${name}, ${theme}: a solid card, text a different colour from it, no machine text, no page error`, HOWS, async () => {
    const r = await devRun(name, opts, theme); const m = r.m; if (!m) return { ok: false, note: "no sheet" };
    return { ok: !/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg) && m.bg !== m.fg && !MACHINE.test(m.text) && r.errors.length === 0, note: `${m.fg} on ${m.bg}` };
  });
}

// ── H10 · a restaurant that is not #1, and a slug nobody owns ─────────────────────────────────────
const SR = () => once("SR", async () => {
  const { ctx, page, log, errors } = await stubbed(PHONE, { lfh_guest_settings: "sessionsOn" });
  await page.goto(`${BASE}/r/spice-route/menu`, { waitUntil: "networkidle" }); await settle(page, 1000);
  await fire(page, { action: "connect", table: "", payload: {} }); await settle(page, 1500);
  const kicker = await page.evaluate(() => (document.querySelector(".sg-kicker") || {}).textContent || "");
  const rids = [...new Set(log.filter((x) => x.args && x.args.p_restaurant_id).map((x) => x.args.p_restaurant_id))];
  await page.fill(".sg-input", "301"); await page.click(".sg-btn.gold"); await settle(page, 300); const range = await sheetText(page);
  await page.screenshot({ path: `${SHOTS}/a35-spice-route-ask-table.png` }); await ctx.close(); return { kicker, rids, range, errors };
});
check(FILES.gate, "on Spice Route (not restaurant #1) the sheet is headed with SPICE ROUTE's name, never French House's", HOWS, async () => { const r = await SR(); return { ok: /spice/i.test(r.kicker) && !/french/i.test(r.kicker), note: r.kicker }; });
check(FILES.ctx, "…every restaurant-keyed call on that page names ONE restaurant, and it is not #1", HOWS, async () => { const r = await SR(); return { ok: r.rids.length === 1 && r.rids[0] !== FH_ID, note: r.rids.join(",") }; });
check(FILES.table, "…and its own table range (1–300) is the one enforced", HOWS, async () => { const r = await SR(); return { ok: /we have tables 1–300/.test(r.range), note: r.range.split("\n").find((l) => /301/.test(l)) || "" }; });
const NF = () => once("NF", async () => {
  const { ctx, page, log, errors } = await stubbed(PHONE, {}); const res = await page.goto(`${BASE}/r/nobody-owns-this-slug-t4/menu`, { waitUntil: "networkidle" }); await settle(page, 1200);
  const r = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 200), gate: !!document.querySelector(".sg-overlay"), card: !!document.querySelector(".ssw-card,.ssw-bubble"), ban: !!document.querySelector(".ban-overlay") }));
  const sessionCalls = log.filter((x) => /session|join|table_status/.test(x.fn)).length; await ctx.close(); return { status: res.status(), r, sessionCalls, errors };
});
check(FILES.ctx, "a slug nobody owns answers a not-found page — and no table-session widget opens on it", HOW, async () => { const r = await NF(); return { ok: r.status === 404 && !r.r.gate && !r.r.card && !r.r.ban && r.sessionCalls === 0, note: `${r.status} · ${r.r.text.replace(/\n/g, " ").slice(0, 70)}` }; });

// ── H9 · owner 2026-10-13 "make sure this never happens": a fine phone is never blamed ──────────────
// An answer the phone RECEIVED (a server error that is neither a timeout nor "offline") proves the
// phone's internet works — the sheet must not tell the diner to check it, and must not claim it is ours.
check(FILES.gate, "a server error that is neither busy nor offline blames NOBODY — no 'check your internet', no wifi mark", HOWS, async () => {
  const r = await busyRun("odd");
  return { ok: /couldn.t reach the restaurant.s system just now/i.test(r.t) && !/internet|wi-?fi|offline|connection/i.test(r.t) && !/on us/.test(r.t), note: r.t.split("\n").slice(0, 3).join(" · ") };
});
const banOdd = (mode) => once("ban-" + mode, async () => {
  const { ctx, page, errors } = await stubbed(PHONE, { lfh_check_ban: () => okJson({ ok: true, banned: true, reason: "testing the wall", unban_requested: false }), lfh_request_unban: () => (mode === "abort" ? "abort" : pg500("XX000", "internal error")) });
  await page.goto(`${BASE}/r/${FH}/menu`, { waitUntil: "networkidle" }); await settle(page, 1200);
  await page.fill(".ban-input", "9876543210"); await page.click(".ban-btn"); await settle(page, 1800);
  const t = await page.evaluate(() => (document.querySelector(".ban-fail") || {}).textContent || ""); await ctx.close(); return { t, errors };
});
check(FILES.ban, "the ban wall tells a phone that really lost its signal to check its connection", HOWS, async () => { const r = await banOdd("abort"); return { ok: /phone seems to be offline/i.test(r.t), note: r.t }; });
check(FILES.ban, "…and an odd server error on the ban wall says 'not sent', blaming neither the number nor the connection", HOWS, async () => { const r = await banOdd("odd"); return { ok: /couldn.t send that just now — please try again/i.test(r.t) && !/connection|internet|number/i.test(r.t), note: r.t }; });

// ── H10 · item 10 live: a private window is never told its name was saved ───────────────────────────
// The review's save and the past-review rename are answered in the browser (no row written). A
// private window is a phone whose storage refuses every write — exactly what Safari's used to do.
const reviewRun = (blocked) => once("review-" + blocked, async () => {
  const setup = blocked ? { fn: () => { try { Storage.prototype.setItem = function () { throw new DOMException("QuotaExceededError", "QuotaExceededError"); }; } catch {} }, arg: null } : null;
  const { ctx, page, log, errors } = await stubbed(PHONE, { lfh_submit_review: () => okJson({ ok: true }), lfh_rename_my_reviews: () => okJson({ ok: true, renamed: 0 }) }, setup);
  await page.goto(`${BASE}/r/${FH}/item/arancini-balls`, { waitUntil: "networkidle" }); await settle(page, 1200);
  await page.click(".review-tab-btn >> nth=0"); await settle(page, 500);
  await page.click('[aria-label="Rate 5 stars"]', { force: true }); await page.fill("#review-name", "Mia T4"); await page.fill(".review-textarea", "lovely"); await page.click("#submit-review"); await settle(page, 1800);
  const toasts = await page.evaluate(() => window.__toasts.filter((x) => x && x.kicker === "review").map((x) => `${x.message} / ${x.subtitle}`));
  const renamed = log.some((x) => x.fn === "lfh_rename_my_reviews"); await ctx.close(); return { toasts, renamed, errors };
});
check(FILES.gname, "a normal phone that gives a new name on a review is told 'saved as your name' (item 10)", HOWS, async () => { const r = await reviewRun(false); return { ok: r.toasts.some((x) => /^Review posted \/ saved as your name — Mia T4$/.test(x)), note: r.toasts.join(" · ") }; });
check(FILES.gname, "…a private window (storage refuses every write) is NOT told that — just 'thanks for sharing' — and its past reviews are still renamed (item 10)", HOWS, async () => { const r = await reviewRun(true); return { ok: r.toasts.some((x) => /^Review posted \/ thanks for sharing$/.test(x)) && !r.toasts.some((x) => /saved as your name/.test(x)) && r.renamed, note: `${r.toasts.join(" · ")} · rename sent ${r.renamed}` }; });
