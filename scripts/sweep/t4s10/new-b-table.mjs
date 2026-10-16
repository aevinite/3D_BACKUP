// Block B — lib/table.ts and lib/tableConnection.ts RUN on a stand-in phone (P173081…).
// The table-number checker all three doors share, the scanned-table memory, and the add-to-cart gate
// (with sweep #10 item 2's retrying "are table sessions on here?" reader).
import { check, band, load, FILES, W, resetWorld } from "./lib.mjs";
import { install, reset, phone, listenerCount } from "./phone.mjs";
const FT = FILES.table, FC = FILES.conn;
const HOW = "STUB — real file on a stand-in phone";
band(173081);
install();
const T = async (path = "/r/aangan/menu") => { reset({ path }); return load(FT); };
const C = async (path = "/r/aangan/menu") => { reset({ path }); resetWorld(); return load(FC); };
const RANGE = (n) => `Table ${n} doesn't exist — we have tables 1–30. Please check your number.`;
const cases = [
  ["7", 30, true, "7", "the ordinary case"], [" 7 ", 30, true, "7", "spaces around it are not part of the number"],
  ["007", 30, true, "7", "a padded number is the table the floor knows"], ["0007", 30, true, "7", "…however much padding"],
  ["7\n", 30, true, "7", "a stray newline from a paste is trimmed"], ["1", 30, true, "1", "the first table"],
  ["30", 30, true, "30", "the last table is INSIDE the range"], ["31", 30, false, RANGE(31), "one past the last is refused, naming the number typed"],
  ["9999", 30, false, RANGE(9999), "…and so is a typo"], ["9999", 0, true, "9999", "…but not when the table count is unknown (0)"],
  ["", 30, false, "Please enter your table number first.", "an empty box is told to type something"],
  ["   ", 30, false, "Please enter your table number first.", "…and so is one holding only spaces"],
  ["0", 30, false, "Please enter a valid table number.", "there is no table zero"], ["00", 30, false, "Please enter a valid table number.", "…nor a padded one"],
  ["-3", 30, false, "Please enter a valid table number.", "a negative number is refused"], ["3.5", 30, false, "Please enter a valid table number.", "half a table is refused"],
  ["7.0", 30, false, "Please enter a valid table number.", "…even written as a whole one"], ["1a", 30, false, "Please enter a valid table number.", "letters mixed in are refused"],
  ["abc", 30, false, "Please enter a valid table number.", "letters alone are refused"], ["+7", 30, false, "Please enter a valid table number.", "a leading plus is refused"],
  ["1e3", 30, false, "Please enter a valid table number.", "scientific notation is refused, not read as 1000"],
  ["Infinity", 30, false, "Please enter a valid table number.", "…and so is infinity"], ["7 8", 30, false, "Please enter a valid table number.", "two numbers in one box are refused"],
  ["١٢", 30, false, "Please enter a valid table number.", "digits from another script are refused rather than mis-read"],
  ["7​", 30, false, "Please enter a valid table number.", "an invisible character glued to a 7 is refused, not silently dropped"],
  ["99999999999999999999", 0, false, "Please enter a valid table number.", "a number too big for a phone to hold exactly is not turned into a DIFFERENT number"],
  ["9007199254740993", 0, false, "Please enter a valid table number.", "…including the first whole number past 2^53"],
  ["9007199254740991", 0, true, "9007199254740991", "…while the largest exact one still passes with the count unknown (no real table, but the rule is exact)"],
];
for (const [raw, n, ok, want, what] of cases) {
  check(FT, `validateTable(${JSON.stringify(raw)}, ${n}) — ${what}`, HOW, async () => {
    const t = await T(); const r = t.validateTable(raw, n);
    return { ok: r.ok === ok && (ok ? r.value === want && r.message === undefined : r.value === "" && r.message === want), note: JSON.stringify(r) };
  });
}
check(FT, "validateTable(undefined) — a missing value is the empty-box sentence, never a crash", HOW, async () => { const t = await T(); const r = t.validateTable(undefined, 30); return r.ok === false && r.message === "Please enter your table number first."; });
check(FT, "validateTable is the same every time for the same input (no hidden state)", HOW, async () => { const t = await T(); const a = JSON.stringify(t.validateTable("007", 30)); return a === JSON.stringify(t.validateTable("007", 30)) && a === JSON.stringify(t.validateTable("007", 30)); });
check(FT, "flagTableInput says it out loud — one lfh:toast, kicker 'table', marked as an error", HOW, async () => {
  const t = await T(); t.flagTableInput("tbl", "Please enter a valid table number.");
  const e = phone.events.filter((x) => x.type === "lfh:toast"); return { ok: e.length === 1 && e[0].detail.kicker === "table" && e[0].detail.variant === "error", note: JSON.stringify(e[0] && e[0].detail) };
});
check(FT, "…and copes with a box that is not on the page (no throw)", HOW, async () => { const t = await T(); try { t.flagTableInput("missing", "x"); return true; } catch { return false; } });
check(FT, "…and when the box IS there it focuses it and flashes the error class, then clears it", HOW, async () => {
  const t = await T(); const cls = new Set(); let focused = 0; const el = { focus: () => focused++, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } };
  const g = globalThis.document.getElementById; globalThis.document.getElementById = () => el; const realST = globalThis.setTimeout; let later = null;
  globalThis.setTimeout = (fn) => { later = fn; return 0; };
  try { t.flagTableInput("tbl", "m"); const during = cls.has("table-input-error"); later && later(); return { ok: focused === 1 && during && !cls.has("table-input-error"), note: `focused ${focused}` }; }
  finally { globalThis.document.getElementById = g; globalThis.setTimeout = realST; }
});
check(FT, "the scanned table is remembered under THIS restaurant (lfh_table:<slug>)", HOW, async () => { const t = await T("/r/sakura-sushi/menu"); t.setScannedTable("7"); return phone.ls.get("lfh_table:sakura-sushi") === "7" && t.getScannedTable() === "7"; });
check(FT, "…setting it to nothing clears it rather than storing an empty string", HOW, async () => { const t = await T(); t.setScannedTable("7"); t.setScannedTable(""); return !phone.ls.has("lfh_table:aangan") && t.getScannedTable() === ""; });
check(FT, "…a table scanned at ANOTHER restaurant never pre-fills here", HOW, async () => { const t = await T("/r/sakura-sushi/menu"); t.setScannedTable("9"); phone.path = "/r/aangan/menu"; return t.getScannedTable() === ""; });
// RE-AIMED 2026-10-16: since T3 round 4 item 47 a refused write is kept for the page, so the scan is remembered while it is open.
check(FT, "…and with storage switched off the scan is kept for this page only (no throw, nothing on the phone)", HOW, async () => { const t = await T(); phone.lsBlocked = true; try { t.setScannedTable("4"); return { ok: t.getScannedTable() === "4" && phone.ls.size === 0, note: `${t.getScannedTable()} · phone keys ${phone.ls.size}` }; } catch (e) { return { ok: false, note: "threw " + e.message }; } });
check(FT, "the scanned-table key is the one the rest of the app names (lfh_table)", HOW, async () => { const t = await T(); return t.SCANNED_TABLE_KEY === "lfh_table"; });

// ── lib/tableConnection.ts — the add-to-cart gate ─────────────────────────────────────────────────
check(FC, "before anything is known the gate assumes sessions are OFF, so a tap is never blocked by ignorance", HOW, async () => { const c = await C(); return JSON.stringify(c.getTableConnection()) === '{"sessionsEnabled":false,"connected":false}'; });
check(FC, "getTableConnection reports exactly what setTableConnection was told", HOW, async () => { const c = await C(); c.setTableConnection({ sessionsEnabled: true, connected: true }); return c.getTableConnection().sessionsEnabled === true && c.getTableConnection().connected === true; });
check(FC, "sessions off → the dish goes straight in the basket, with no pop-up asked for", HOW, async () => {
  const c = await C(); let n = 0; c.gateAddToCart(() => n++); return { ok: n === 1 && !phone.events.some((e) => e.type === "lfh:session-do"), note: `run ${n}` };
});
check(FC, "a diner already at their table adds with no pop-up at all", HOW, async () => {
  const c = await C(); c.setTableConnection({ sessionsEnabled: true, connected: true }); let n = 0; c.gateAddToCart(() => n++); return n === 1 && !phone.events.some((e) => e.type === "lfh:session-do");
});
check(FC, "a diner NOT yet at a table does not get the dish yet — the join flow opens instead, asking for a CONNECT", HOW, async () => {
  const c = await C(); c.setTableConnection({ sessionsEnabled: true, connected: false }); let n = 0; c.gateAddToCart(() => n++);
  const e = phone.events.filter((x) => x.type === "lfh:session-do"); return { ok: n === 0 && e.length === 1 && e[0].detail.action === "connect", note: JSON.stringify(e[0] && e[0].detail) };
});
check(FC, "…carrying the table from the sticker they scanned", HOW, async () => {
  const c = await C(); phone.ls.set("lfh_table:aangan", "9"); c.setTableConnection({ sessionsEnabled: true, connected: false }); c.gateAddToCart(() => {});
  return phone.events.find((x) => x.type === "lfh:session-do").detail.table === "9";
});
check(FC, "…preferring the table they are actually sitting at over an older sticker", HOW, async () => {
  const c = await C(); phone.ls.set("lfh_table:aangan", "9"); phone.ls.set("lfh_session:aangan", JSON.stringify({ table: "4", token: "t", memberId: "m", role: "guest" }));
  c.setTableConnection({ sessionsEnabled: true, connected: false }); c.gateAddToCart(() => {}); return phone.events.find((x) => x.type === "lfh:session-do").detail.table === "4";
});
check(FC, "…and an unknown table is sent as '' so the sheet asks which one", HOW, async () => {
  const c = await C(); c.setTableConnection({ sessionsEnabled: true, connected: false }); c.gateAddToCart(() => {}); return phone.events.find((x) => x.type === "lfh:session-do").detail.table === "";
});
check(FC, "intendedTable(): null when neither a session nor a sticker is known — never a guess", HOW, async () => { const c = await C(); return c.intendedTable() === null; });
check(FC, "…and ANOTHER restaurant's session is not this restaurant's table", HOW, async () => {
  const c = await C(); phone.ls.set("lfh_session:sakura-sushi", JSON.stringify({ table: "4", token: "t", memberId: "m", role: "guest" })); return c.intendedTable() === null;
});
check(FC, "…and a saved session with no token is not a session", HOW, async () => { const c = await C(); phone.ls.set("lfh_session:aangan", JSON.stringify({ table: "4" })); return c.intendedTable() === null; });
const held = async (c) => { c.setTableConnection({ sessionsEnabled: true, connected: false }); const ran = []; for (const k of ["a", "b", "c"]) c.gateAddToCart(() => ran.push(k)); return ran; };
const done = (detail) => globalThis.window.dispatchEvent(new globalThis.CustomEvent("lfh:session-done", { detail }));
check(FC, "the held dishes go in the moment they are let in, in the order they were tapped", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: true, action: "connect" }); return { ok: ran.join("") === "abc", note: ran.join("") }; });
check(FC, "a diner who backs out of joining does NOT silently get the dish", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: false, reason: "cancelled", action: "connect" }); return ran.length === 0; });
check(FC, "…and the abandoned dishes do not come back on a LATER successful join", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: false, action: "connect" }); done({ ok: true, action: "connect" }); return ran.length === 0; });
check(FC, "an ORDER finishing is not a reason to release a held dish", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: true, action: "order" }); return ran.length === 0; });
check(FC, "…and neither is a waiter call", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: true, action: "call" }); return ran.length === 0; });
check(FC, "…and a second connect cannot add the same dishes twice", HOW, async () => { const c = await C(); const ran = await held(c); done({ ok: true, action: "connect" }); done({ ok: true, action: "connect" }); return ran.join("") === "abc"; });
check(FC, "the resume listener is wired ONCE however many dishes are held", HOW, async () => { const c = await C(); await held(c); await held(c); return { ok: listenerCount("lfh:session-done") === 1, note: `${listenerCount("lfh:session-done")} listener(s)` }; });
check(FC, "once they are in, the next tap adds at once, and the one held earlier still arrives", HOW, async () => {
  const c = await C(); c.setTableConnection({ sessionsEnabled: true, connected: false }); const ran = []; c.gateAddToCart(() => ran.push("held"));
  c.setTableConnection({ sessionsEnabled: true, connected: true }); c.gateAddToCart(() => ran.push("now")); done({ ok: true, action: "connect" }); return ran.join(",") === "now,held";
});
// ── watchSessionsSwitch (item 2) ─────────────────────────────────────────────────────────────────
const REAL_ST = globalThis.setTimeout;
const RID = "11111111-2222-4333-8444-555555555555";
const fakeClock = () => { const real = REAL_ST; const waits = []; globalThis.setTimeout = (fn, ms) => { waits.push(ms); return real(fn, 0); }; return { waits, restore: () => { globalThis.setTimeout = real; } }; };
const settled = (ms = 400) => new Promise((r) => REAL_ST(r, ms));
check(FC, "watchSessionsSwitch: a healthy read is answered once, with this restaurant's switch", HOW, async () => {
  const c = await C(); W.rpc.lfh_guest_settings = { data: { sessions_enabled: true }, error: null }; const got = [];
  const stop = c.watchSessionsSwitch(RID, (s) => got.push(s.sessionsEnabled)); await settled(100); stop();
  const call = W.rpcLog.find((x) => x.fn === "lfh_guest_settings"); return { ok: got.join() === "true" && call && call.args.p_restaurant_id === RID, note: got.join() };
});
check(FC, "…a read that fails twice is answered on the third ask (it used to be taken as 'off' for the visit)", HOW, async () => {
  const c = await C(); let n = 0; W.rpc.lfh_guest_settings = () => (++n <= 2 ? { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } } : { data: { sessions_enabled: true }, error: null });
  const clk = fakeClock(); const got = []; let fails = 0;
  try { const stop = c.watchSessionsSwitch(RID, (s) => got.push(s.sessionsEnabled), () => fails++); await settled(200); stop(); } finally { clk.restore(); }
  return { ok: got.join() === "true" && n === 3 && fails === 1, note: `asks ${n}, answers ${got}, first-failure calls ${fails}, waits ${clk.waits.join("/")}` };
});
check(FC, "…the waits widen (≈2s then ≈5s), jittered, and never shorter than the floor", HOW, async () => {
  const c = await C(); let n = 0; W.rpc.lfh_guest_settings = () => (++n <= 2 ? { data: null, error: { message: "x" } } : { data: { sessions_enabled: false }, error: null });
  const clk = fakeClock(); try { const stop = c.watchSessionsSwitch(RID, () => {}); await settled(200); stop(); } finally { clk.restore(); }
  const [a, b] = clk.waits; return { ok: a >= 1500 && a <= 2500 && b >= 3750 && b <= 6250, note: clk.waits.join("/") };
});
check(FC, "…after four widening waits it settles on the shared 60-second backstop — never a fast poll", HOW, async () => {
  const c = await C(); let n = 0; W.rpc.lfh_guest_settings = () => (++n <= 6 ? { data: null, error: { message: "x" } } : { data: { sessions_enabled: true }, error: null });
  const clk = fakeClock(); try { const stop = c.watchSessionsSwitch(RID, () => {}); await settled(300); stop(); } finally { clk.restore(); }
  const w = clk.waits; return { ok: w.length >= 6 && w[4] >= 45000 && w[4] <= 75000 && w[5] >= 45000, note: w.join("/") };
});
check(FC, "…a reader stopped before it answers never calls back, and never asks again", HOW, async () => {
  const c = await C(); let n = 0; W.rpc.lfh_guest_settings = () => { n++; return { data: null, error: { message: "x" } }; };
  const clk = fakeClock(); let got = 0; try { const stop = c.watchSessionsSwitch(RID, () => got++); await settled(20); stop(); const before = n; await settled(150); return { ok: got === 0 && n === before, note: `asks ${before}→${n}` }; } finally { clk.restore(); }
});
check(FC, "…a caller's own failure handler that throws does not stop the retry", HOW, async () => {
  const c = await C(); let n = 0; W.rpc.lfh_guest_settings = () => (++n <= 1 ? { data: null, error: { message: "x" } } : { data: { sessions_enabled: true }, error: null });
  const clk = fakeClock(); const got = []; try { const stop = c.watchSessionsSwitch(RID, (s) => got.push(s), () => { throw new Error("caller bug"); }); await settled(200); stop(); } finally { clk.restore(); }
  return got.length === 1;
});
