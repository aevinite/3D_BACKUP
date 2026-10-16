// Block J, part 4 — the table sheet (SessionGate) in the screen lab (sweep #10 T4 round 2): every screen it
// can put up, every way in, and every ending — said in words a diner can act on.
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr, settingsOn, FH_ID, FX } from "./page.mjs";
import { HOW } from "./how.mjs";
const G = FILES.gate;
const SK = "lfh_session:french-house", NK = "lfh_nickname:french-house";
const SAK = { ...FX.lfh_guest_restaurant, id: "cccccccc-0000-4000-8000-0000000000aa", slug: "sakura-sushi", name: "Sakura Sushi" };
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const sheet = async (L) => ((await L.text(".sg-box")) || "").replace(/\s+/g, " ");
const title = (L) => L.page.$eval(".sg-box .sg-title", (t) => t.textContent).catch(() => null);
const done = async (L) => (await L.events("lfh:session-done")).map((e) => e.detail);
const toasts = async (L) => (await L.toasts()).map((t) => t.message);
const go = (L, d) => L.fire("lfh:session-do", d);
const TS = (open, members = 0) => () => json({ ok: true, open, members, session_id: "s1" });
const JOIN = (extra = {}) => () => json({ ok: true, token: "tok-new", member_id: "m-new", role: "guest", approved: true, session_id: "s1", ...extra });
const ST = (o = {}) => json({ ok: true, session: { id: "s1", table_number: "7", status: o.status || "open" }, member: { id: "m", role: o.role || "guest", approved: o.approved !== false }, members: [{}], calls: [], items: [], orders: [] });
const SEAT = { table: "7", token: "tok-seat", memberId: "m-seat", role: "guest" };
const seated = (o = {}) => ({ mount: ["gate"], storage: { [SK]: SEAT, [NK]: { token: "tok-seat", name: "Ravi" }, ...(o.storage || {}) }, online: o.online, clock: o.clock, api: o.api,
  rpc: { lfh_session_state: () => ST(), ...(o.rpc || {}) } });
const ORDER = { action: "order", table: "7", payload: { items: [{ id: "d1", qty: 1 }], allergies: [], lines: [{ id: "d1", title: "Croissant" }] } };

// ── the way in: which table? ─────────────────────────────────────────────────────────────────────────
check(G, "asking to join with no table known opens 'Which table are you at?', under French House's own name", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(500); const t = await sheet(L); const k = (await L.text(".sg-box .sg-kicker")) || "";
  return { ok: /Which table are you at\?/.test(t) && /My Little French House/i.test(k) && calls(L, "lfh_table_status").length === 0, note: `kicker "${k}"` };
}));
check(G, "…on another restaurant it wears THAT restaurant's name, never French House's", HOW, () => with_({ mount: ["gate"], path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: () => json(SAK) } }, async (L) => {
  await L.wait(700); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(600); const t = await sheet(L);
  return { ok: /Sakura Sushi/i.test(t) && !/French House/i.test(t), note: t.slice(0, 80) };
}));
check(G, "a table that does not exist is refused in a sentence naming the real range, and nothing is asked", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.fill(".sg-input", "99"); await L.page.click("text=Continue"); await L.wait(300);
  const n = await L.text(".sg-note-bad"); return { ok: /Table 99 doesn.t exist — we have tables 1–30/.test(n || "") && calls(L, "lfh_table_status").length === 0, note: n };
}));
check(G, "…a real table number (Enter works too) goes on to ask the restaurant about that table, for THIS restaurant", HOW, () => with_({ mount: ["gate"], rpc: { lfh_table_status: TS(false) } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.fill(".sg-input", "7"); await L.page.press(".sg-input", "Enter"); await L.wait(600);
  const q = calls(L, "lfh_table_status")[0]; return { ok: !!q && q.args.p_table === "7" && q.args.p_restaurant_id === FH_ID && /Your table isn.t open yet/.test(await sheet(L)), note: JSON.stringify(q && q.args) };
}));
check(G, "…the little ✕ clears the box AND the remembered table, and tells the basket", HOW, () => with_({ mount: ["gate"], storage: { "lfh_table:french-house": "5" } }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.fill(".sg-input", "5"); await L.page.click(".sg-input-clear"); await L.wait(150);
  const v = await L.page.$eval(".sg-input", (i) => i.value); return { ok: v === "" && (await L.ls("lfh_table:french-house")) !== "5" && (await L.events("lfh:table-scanned")).length >= 1, note: `box "${v}"` };
}));
check(G, "an order or a waiter call that names no table is ignored — no sheet, nothing asked", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "order", table: "", payload: {} }); await go(L, { action: "call", table: "", payload: {} }); await L.wait(500);
  return { ok: !(await L.page.$(".sg-box")) && calls(L, "lfh_guest_settings").length === 0 && calls(L, "lfh_table_status").length === 0, note: `${calls(L, "lfh_guest_settings").length} settings reads` };
}));

// ── a table nobody has opened yet ───────────────────────────────────────────────────────────────────
const notOpen = (o = {}) => ({ mount: ["gate"], clock: o.clock, rpc: { lfh_table_status: o.ts || TS(false), lfh_request: o.req || (() => json({ ok: true })), ...(o.rpc || {}) } });
const toNotOpen = async (L) => { await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(600); };
check(G, "a table staff have not opened: ONE screen — add your name and ask a waiter to open it", HOW, () => with_(notOpen(), async (L) => {
  await toNotOpen(L); const t = await sheet(L); return { ok: /Your table isn.t open yet/.test(t) && /ready at table 7/.test(t) && !!(await L.page.$("text=Request a waiter")), note: t.slice(0, 90) };
}));
check(G, "…asking with no name is refused in words and sends nothing", HOW, () => with_(notOpen(), async (L) => {
  await toNotOpen(L); await L.page.click("text=Request a waiter"); await L.wait(200); return { ok: /Add your name so staff know who.s asking\./.test((await L.text(".sg-note-bad")) || "") && calls(L, "lfh_request").length === 0 };
}));
check(G, "…with a name it asks staff to OPEN table 7 for this restaurant, keeps the name, and promises the auto-send", HOW, () => with_(notOpen(), async (L) => {
  await toNotOpen(L); await L.page.fill(".sg-input", " Mia "); await L.page.click("text=Request a waiter"); await L.wait(500); const q = calls(L, "lfh_request")[0]; const t = await sheet(L);
  return { ok: !!q && q.args.p_type === "open" && q.args.p_name === "Mia" && q.args.p_table === "7" && q.args.p_restaurant_id === FH_ID && /We.ve let the staff know/.test(t) && /brought in and your order sent automatically/.test(t) && (await L.ls("lfh_my_name:french-house")) === "Mia", note: JSON.stringify(q && q.args) };
}));
for (const [what, ans, re] of [
  ["timed out", () => pgErr("57014", "timeout"), /^The restaurant.s system isn.t answering — nobody has been told yet\./],
  ["was over the limit", () => json({ ok: false, reason: "rate_limited" }), /^That.s a lot of requests in a row/],
  ["was refused for this table", () => json({ ok: false, reason: "blocked" }), /^We can.t call staff from this table/],
  ["failed some other way", () => json({ ok: false, reason: "weird" }), /^We couldn.t tell the staff just now/]]) {
  check(G, `…a request that ${what} is said as exactly that — on the toast AND under the box — and does not claim it landed`, HOW, () => with_(notOpen({ req: ans }), async (L) => {
    await toNotOpen(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Request a waiter"); await L.wait(500); const t = await toasts(L); const n = (await L.text(".sg-note-bad")) || "";
    return { ok: t.some((m) => re.test(m)) && re.test(n) && !/We.ve let the staff know/.test(await sheet(L)), note: n };
  }));
}
check(G, "…a request staff ALREADY have counts as landed — the diner is not sent tapping again", HOW, () => with_(notOpen({ req: () => json({ ok: false, reason: "already_sent" }) }), async (L) => {
  await toNotOpen(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Request a waiter"); await L.wait(500); return { ok: /We.ve let the staff know/.test(await sheet(L)) && (await L.toasts()).length === 0 };
}));
check(G, "…two quick taps on 'Request a waiter' send ONE request", HOW, () => with_(notOpen({ req: async () => { await new Promise((r) => setTimeout(r, 700)); return json({ ok: true }); } }), async (L) => {
  await toNotOpen(L); await L.page.fill(".sg-input", "Mia"); await L.page.$eval(".sg-btn.gold", (b) => { b.click(); b.click(); }); await L.wait(1000); return { ok: calls(L, "lfh_request").length === 1, note: `${calls(L, "lfh_request").length}` };
}));
check(G, "…'Asked a minute ago' appears once a minute has passed, then counts the minutes", HOW, () => with_(notOpen({ clock: true }), async (L) => {
  await L.clock.runFor(800); await go(L, { action: "connect", table: "7", payload: {} }); await L.clock.runFor(800); await L.wait(80); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Request a waiter"); await L.clock.runFor(500); await L.wait(80);
  const a = await sheet(L); await L.clock.runFor(61000); await L.wait(80); const b = await sheet(L); await L.clock.runFor(120000); await L.wait(80); const c = await sheet(L);
  return { ok: !/Asked/.test(a) && /Asked a minute ago\./.test(b) && /Asked 3 minutes ago\./.test(c), note: `${/Asked[^.]*/.exec(b)} / ${/Asked[^.]*/.exec(c)}` };
}));
check(G, "…while they wait, the sheet keeps watching — the moment staff open the empty table, the diner is seated as its head", HOW, () => with_(notOpen({ ts: (a, n) => (n <= 2 ? json({ ok: true, open: false }) : json({ ok: true, open: true, members: 0, session_id: "s1" })), rpc: { lfh_join_session: JOIN({ role: "owner" }) } }), async (L) => {
  await toNotOpen(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Request a waiter"); await L.wait(3500); const j = calls(L, "lfh_join_session")[0]; const d = await done(L);
  return { ok: !!j && j.args.p_name === "Mia" && d.some((x) => x.ok && x.action === "connect") && !(await L.page.$(".sg-box")), note: JSON.stringify(d) };
}));
check(G, "…'Scan another table' starts over with the remembered table forgotten", HOW, () => with_(notOpen(), async (L) => {
  await toNotOpen(L); await L.page.click("text=Scan another table"); await L.wait(200); return { ok: /Which table are you at\?/.test(await sheet(L)) && !(await L.ls("lfh_table:french-house")) };
}));

// ── an open table: the head, or a guest asking to join ─────────────────────────────────────────────────
const open = (members, o = {}) => ({ mount: ["gate"], storage: o.storage, rpc: { lfh_table_status: TS(true, members), lfh_join_session: o.join || JOIN(), lfh_session_state: o.state || (() => ST()), ...(o.rpc || {}) } });
const ask = async (L) => { await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(600); };
check(G, "the first person at an empty open table is asked their name before it opens ('You'll be the head')", HOW, () => with_(open(0), async (L) => {
  await ask(L); const t = await sheet(L); await L.page.click("text=Open table 7"); await L.wait(200);
  return { ok: /Opening table 7/i.test(t) && /You.ll be the head of this table/.test(t) && /Add your name so the table shows who opened it\./.test((await L.text(".sg-note-bad")) || "") && calls(L, "lfh_join_session").length === 0, note: t.slice(0, 70) };
}));
check(G, "…with a name they open it as head: their session, their name for the table, their ONE name — and the sheet closes", HOW, () => with_(open(0, { join: JOIN({ role: "owner" }) }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Open table 7"); await L.wait(700); const s = await L.lsJSON(SK); const j = calls(L, "lfh_join_session")[0];
  return { ok: s && s.token === "tok-new" && s.role === "owner" && j.args.p_name === "Mia" && j.args.p_restaurant_id === FH_ID && (await L.ls("lfh_my_name:french-house")) === "Mia" && (await done(L)).some((x) => x.ok && x.action === "connect") && !(await L.page.$(".sg-box")), note: JSON.stringify(s) };
}));
check(G, "a table someone already opened asks THIS diner's name, so the head can recognise them", HOW, () => with_(open(2), async (L) => {
  await ask(L); const t = await sheet(L); await L.page.click("text=Ask to join this table"); await L.wait(200);
  return { ok: /This table.s already open/.test(t) && /Add your name to join the table\./.test((await L.text(".sg-note-bad")) || "") && calls(L, "lfh_join_session").length === 0 };
}));
check(G, "…a guest the table lets straight in is seated and the sheet closes", HOW, () => with_(open(2), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.press(".sg-input", "Enter"); await L.wait(700);
  return { ok: (await L.lsJSON(SK))?.token === "tok-new" && (await done(L)).some((x) => x.ok && x.action === "connect") && !(await L.page.$(".sg-box")) };
}));
check(G, "…a guest the head must approve waits on 'Waiting for the table to let you in…', and is seated the moment they're approved", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: (a, n) => ST({ approved: n >= 2 }) }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(500); const w = await title(L); await L.wait(2600);
  return { ok: w === "Waiting for the table to let you in…" && (await done(L)).some((x) => x.ok) && !(await L.page.$(".sg-box")), note: w };
}));
check(G, "…the head saying no is said plainly ('The table didn't let you in'), with a waiter and another table offered", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: () => json({ ok: false, reason: "removed" }) }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(1500); const t = await sheet(L);
  return { ok: /The table didn.t let you in/.test(t) && /Call a waiter/.test(t) && /Another table/.test(t) && (await L.ls(SK)) === null && (await done(L)).some((x) => x.ok === false && x.reason === "denied"), note: t.slice(0, 60) };
}));
check(G, "…staff closing the table while they waited is NOT a refusal ('nothing to do with you'), and 'Try this table again' starts over", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: () => json({ ok: false, reason: "session_closed" }) }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(1500); const t = await sheet(L); const n = calls(L, "lfh_table_status").length;
  await L.page.click("text=Try this table again"); await L.wait(600);
  return { ok: /This table.s session ended/.test(t) && /nothing to do with you/.test(t) && calls(L, "lfh_table_status").length === n + 1 && (await done(L)).some((x) => x.ok === false && x.reason === "table_closed"), note: t.slice(0, 60) };
}));
check(G, "…a blip while waiting keeps them waiting (no screen change, still asking)", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: (a, n) => (n <= 2 ? pgErr("57014", "t") : ST({ approved: false })) }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(3200);
  return { ok: (await title(L)) === "Waiting for the table to let you in…" && calls(L, "lfh_session_state").length >= 2 && (await L.ls(SK)) !== null, note: `${calls(L, "lfh_session_state").length} asks` };
}));
check(G, "…'Call a waiter instead' from the waiting screen asks staff for help at this table", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: () => ST({ approved: false }), rpc: { lfh_request: () => json({ ok: true }) } }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(500); await L.page.click("text=Call a waiter instead"); await L.wait(500);
  const q = calls(L, "lfh_request")[0]; return { ok: !!q && q.args.p_type === "access" && q.args.p_name === "Raj" && /A waiter is on the way/.test(await sheet(L)), note: JSON.stringify(q && q.args) };
}));
check(G, "a diner coming back to the SAME session is let in under the name they used, without being asked again", HOW, () => with_(open(2, { storage: { "lfh_table_name:french-house": { table: "7", sessionId: "s1", name: "Raj" } } }), async (L) => {
  await ask(L); await L.wait(300); const j = calls(L, "lfh_join_session")[0]; return { ok: !!j && j.args.p_name === "Raj" && !(await L.page.$(".sg-input")), note: JSON.stringify(j && j.args.p_name) };
}));
check(G, "…a name remembered for a DIFFERENT session of that table is not reused", HOW, () => with_(open(2, { storage: { "lfh_table_name:french-house": { table: "7", sessionId: "s-old", name: "Raj" } } }), async (L) => {
  await ask(L); return { ok: calls(L, "lfh_join_session").length === 0 && /This table.s already open/.test(await sheet(L)) };
}));
const joinFails = (ans) => with_(open(2, { join: ans }), async (L) => { await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(600); return { t: await sheet(L), n: (await L.text(".sg-note-bad")) || "" }; });
check(G, "a join refused because the table is blocked shows the blocked screen", HOW, async () => { const r = await joinFails(() => json({ ok: false, reason: "blocked" })); return { ok: /Access blocked/.test(r.t), note: r.t.slice(0, 50) }; });
check(G, "…because they seem too far away offers a waiter instead ('Let us bring a waiter over')", HOW, async () => { const r = await joinFails(() => json({ ok: false, reason: "too_far" })); return { ok: /Let us bring a waiter over/.test(r.t) && /You seem too far from the restaurant\./.test(r.t), note: r.t.slice(0, 80) }; });
check(G, "…because the table closed in between goes back to 'Your table isn't open yet'", HOW, async () => { const r = await joinFails(() => json({ ok: false, reason: "no_open_session" })); return /Your table isn.t open yet/.test(r.t); });
check(G, "…because of too many tries says to WAIT, not that the restaurant couldn't be reached (round 2 fix)", HOW, async () => { const r = await joinFails(() => json({ ok: false, reason: "rate_limited" })); return { ok: /^That.s a lot of tries in a row — please wait a moment/.test(r.n) && !/reach/.test(r.n), note: r.n }; });
check(G, "…because this phone was banned says to speak to staff — not to keep trying (round 2 fix)", HOW, async () => { const r = await joinFails(() => json({ ok: false, reason: "banned" })); return { ok: /speak to a member of staff/.test(r.n) && !/try again|reach/.test(r.n), note: r.n }; });
check(G, "…because the restaurant's system is busy says 'this one's on us', and keeps the diner on the name screen", HOW, async () => { const r = await joinFails(() => pgErr("57014", "timeout")); return { ok: /this one.s on us/.test(r.n) && /This table.s already open/.test(r.t), note: r.n }; });
check(G, "…because the phone lost its signal says the phone seems offline", HOW, async () => { const r = await joinFails(() => "abort"); return { ok: /phone seems to be offline/.test(r.n), note: r.n }; });
check(G, "…for any other reason blames nobody: 'We couldn't reach the restaurant's system just now'", HOW, async () => { const r = await joinFails(() => pgErr("XX000", "internal")); return { ok: /^We couldn.t reach the restaurant.s system just now\./.test(r.n) && !/internet|offline|on us/.test(r.n), note: r.n }; });
check(G, "a HEAD whose opening failed is put back on the table screen with table 7 still filled in, and told why", HOW, () => with_(open(0, { join: () => pgErr("57014", "timeout") }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Open table 7"); await L.wait(600);
  return { ok: /Which table are you at\?/.test(await sheet(L)) && (await L.page.$eval(".sg-input", (i) => i.value)) === "7" && /on us/.test((await L.text(".sg-note-bad")) || "") };
}));
check(G, "two quick taps on 'Ask to join' make ONE membership", HOW, () => with_(open(2, { join: async () => { await new Promise((r) => setTimeout(r, 700)); return json({ ok: true, token: "t", member_id: "m", role: "guest", approved: true, session_id: "s1" }); } }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.$eval(".sg-btn.gold", (b) => { b.click(); b.click(); }); await L.wait(1200); return { ok: calls(L, "lfh_join_session").length === 1, note: `${calls(L, "lfh_join_session").length}` };
}));

// ── already at the table ───────────────────────────────────────────────────────────────────────────
check(G, "a diner already seated and approved who asks to connect is simply done — no sheet at all", HOW, () => with_(seated(), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(600); return { ok: !(await L.page.$(".sg-box")) && (await done(L)).some((x) => x.ok && x.action === "connect") && calls(L, "lfh_table_status").length === 0 };
}));
check(G, "…a seated diner not yet approved waits for the head", HOW, () => with_(seated({ rpc: { lfh_session_state: () => ST({ approved: false }) } }), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(700); return (await title(L)) === "Waiting for the table to let you in…";
}));
check(G, "…a stored seat the restaurant no longer knows is dropped and the diner starts over for that table", HOW, () => with_(seated({ rpc: { lfh_session_state: () => json({ ok: false, reason: "invalid_token" }), lfh_table_status: TS(false) } }), async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "7", payload: {} }); await L.wait(800); return { ok: (await L.ls(SK)) === null && /Your table isn.t open yet/.test(await sheet(L)) };
}));
check(G, "…a stored seat whose session is no longer open starts over too", HOW, () => with_(seated({ rpc: { lfh_session_state: () => ST({ status: "closed" }), lfh_table_status: TS(false) } }), async (L) => {
  await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(800); return { ok: (await L.ls(SK)) === null && /Your table isn.t open yet/.test(await sheet(L)) };
}));
for (const [what, ans, ttl, re] of [["the restaurant's system is busy", () => pgErr("57014", "t"), "The restaurant's system is busy", /this one.s on us\. Your spot at the table is safe\./],
  ["the phone lost its signal", () => "abort", "Connection trouble", /phone seems to be offline.*Your spot at the table is safe\./],
  ["something else went wrong", () => pgErr("XX000", "x"), "That didn't go through", /^We couldn.t reach the restaurant.s system just now\. Your spot at the table is safe\./]]) {
  check(G, `a seated diner's check that failed because ${what}: '${ttl}', their spot is safe, with Retry and Close`, HOW, () => with_(seated({ rpc: { lfh_session_state: ans } }), async (L) => {
    await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(800); const p = (await L.page.$eval(".sg-box .sg-sub", (x) => x.textContent).catch(() => "")) || "";
    const btns = await L.page.$$eval(".sg-box .sg-btn", (b) => b.map((x) => x.textContent.trim()));
    return { ok: (await title(L)) === ttl && re.test(p) && btns.join() === "Close,Retry" && (await L.ls(SK)) !== null, note: p };
  }));
}
check(G, "…Retry asks again and carries on once the restaurant answers", HOW, () => with_(seated({ rpc: { lfh_session_state: (a, n) => (n === 1 ? pgErr("57014", "t") : ST()), lfh_call_waiter: () => json({ ok: true }) } }), async (L) => {
  await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(700); await L.page.click("text=Retry"); await L.wait(900);
  return { ok: (await toasts(L)).includes("On our way!") && calls(L, "lfh_call_waiter").length === 1 };
}));
check(G, "a seated diner with no name yet is asked once ('What should we call you?') — and the call goes through after", HOW, () => with_(seated({ storage: { [NK]: { token: "someone-else", name: "X" } }, rpc: { lfh_call_waiter: () => json({ ok: true }), lfh_set_member_name: () => json({ ok: true }) } }), async (L) => {
  await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(700); const t = await sheet(L); await L.page.click("text=Continue"); await L.wait(200); const n = await L.text(".sg-note-bad");
  await L.page.fill(".sg-input", "Ravi"); await L.page.press(".sg-input", "Enter"); await L.wait(800); const m = calls(L, "lfh_set_member_name")[0];
  return { ok: /One quick thing/i.test(t) && /Add a name so we know who you are\./.test(n || "") && !!m && m.args.p_name === "Ravi" && m.args.p_token === "tok-seat" && calls(L, "lfh_call_waiter").length === 1, note: t.slice(0, 50) };
}));

// ── ordering from the table ──────────────────────────────────────────────────────────────────────────
const orderRun = (api, o = {}) => with_(seated({ api: { "/api/guest/place-order": api }, online: o.online }), async (L) => {
  await L.wait(500); await go(L, ORDER); await L.wait(900); return { t: await toasts(L), d: await done(L), s: await sheet(L), api: L.apiLog.filter((x) => x.path === "/api/guest/place-order") };
});
check(G, "a seated order goes to the kitchen through our own route (session token, items, this restaurant) and says 'Order placed'", HOW, async () => {
  const r = await orderRun(() => json({ ok: true, order_id: "o-1" })); const b = r.api[0] && r.api[0].body;
  return { ok: r.t.includes("Order placed") && r.d.some((x) => x.ok && x.orderId === "o-1") && !!b && b.mode === "session" && b.token === "tok-seat" && b.restaurantId === FH_ID && b.items.length === 1, note: JSON.stringify(b) };
});
check(G, "…a restaurant too busy to take it (5xx) SAVES it to send by itself, and says so", HOW, async () => { const r = await orderRun(() => ({ status: 503, contentType: "application/json", body: "{}" })); return { ok: r.t.includes("Saved — sending your order now") && r.d.some((x) => x.ok === true && x.queued === true && x.action === "order"), note: r.t.join(" / ") }; });
check(G, "…a REFUSAL (a dish sold out) is said as that refusal — it is not saved for later", HOW, async () => { const r = await orderRun(() => ({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "sold_out", item: "Croissant" }) })); return { ok: !r.t.some((m) => /^Saved/.test(m)) && r.d.some((x) => x.ok === false && x.reason) && r.t.length === 1, note: r.t.join(" / ") }; });
check(G, "…an order refused because the table is blocked shows the blocked screen", HOW, async () => { const r = await orderRun(() => ({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "blocked" }) })); return { ok: /Access blocked/.test(r.s) && r.d.some((x) => x.ok === false && x.reason === "blocked" && x.action === "order"), note: r.s.slice(0, 40) }; });
check(G, "…with no signal at all it is saved on the phone straight away ('will send when you're back online')", HOW, async () => { const r = await orderRun(() => json({ ok: true, order_id: "x" }), { online: false }); return { ok: r.t.some((m) => /^Saved — will send when you.re back online|^Saved on this page/.test(m)) && r.api.length === 0, note: r.t.join(" / ") }; });
check(G, "…sending the SAME basket twice (a retry) carries the same order id, so the kitchen never gets it twice", HOW, () => with_(seated({ api: { "/api/guest/place-order": () => ({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "sold_out" }) }) } }), async (L) => {
  await L.wait(500); await go(L, ORDER); await L.wait(800); await go(L, ORDER); await L.wait(800);
  const a = L.apiLog.filter((x) => x.path === "/api/guest/place-order"); return { ok: a.length === 2 && !!a[0].actionId && a[0].actionId === a[1].actionId, note: `${a.length} sends · ${a.map((x) => (x.actionId || "none").slice(0, 8)).join(" / ")}` };
}));
check(G, "closing the sheet while an order is already on its way does NOT report it cancelled", HOW, () => with_(seated({ api: { "/api/guest/place-order": async () => { await new Promise((r) => setTimeout(r, 1200)); return json({ ok: true, order_id: "o-2" }); } } }), async (L) => {
  await L.wait(500); await go(L, ORDER); await L.wait(400); await L.page.click(".sg-x").catch(() => null); await L.wait(1400); const d = await done(L);
  return { ok: !d.some((x) => x.reason === "cancelled") && d.some((x) => x.ok && x.orderId === "o-2"), note: JSON.stringify(d) };
}));

// ── calling a waiter from the table ──────────────────────────────────────────────────────────────────
const callRun = (ans, o = {}) => with_(seated({ online: o.online, rpc: { lfh_call_waiter: ans } }), async (L) => {
  await L.wait(500); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(900); return { t: await toasts(L), d: await done(L), s: await sheet(L), c: calls(L, "lfh_call_waiter") };
});
check(G, "a waiter call that landed says 'On our way!' and sent what was asked for", HOW, async () => { const r = await callRun(() => json({ ok: true })); return { ok: r.t.includes("On our way!") && r.c[0].args.p_reason === "Water" && r.c[0].args.p_token === "tok-seat" && r.d.some((x) => x.ok === true && x.action === "call") }; });
for (const [what, ans, re] of [["timed out", () => pgErr("57014", "t"), /^We couldn.t reach the restaurant just now — please try again in a moment\.$/],
  ["was over the limit", () => json({ ok: false, reason: "rate_limited" }), /^That.s a lot of calls in a row/], ["was from a banned phone", () => json({ ok: false, reason: "banned" }), /^Please speak to a member of staff\.$/],
  ["failed some other way", () => json({ ok: false, reason: "odd" }), /^Couldn.t reach staff$/]]) {
  check(G, `…a call that ${what} is said as exactly that`, HOW, async () => { const r = await callRun(ans); return { ok: r.t.some((m) => re.test(m)) && r.d.some((x) => x.ok === false), note: r.t.join(" / ") }; });
}
check(G, "…a call refused for a blocked table shows the blocked screen", HOW, async () => { const r = await callRun(() => json({ ok: false, reason: "blocked" })); return /Access blocked/.test(r.s) && r.d.some((x) => x.ok === false && x.reason === "blocked" && x.action === "call"); });
check(G, "…with no signal the call is saved and rung when there is signal", HOW, async () => { const r = await callRun(() => json({ ok: true }), { online: false }); return { ok: r.t.some((m) => /^Saved — (we.ll call them|keep this page open)/.test(m)) && r.c.length === 0 && r.d.some((x) => x.ok === true && x.queued === true && x.action === "call"), note: r.t.join(" / ") }; });

// ── the restaurant's settings, and knowing the restaurant ───────────────────────────────────────────
const settingsFail = (ans, extraOpts = {}) => with_({ mount: ["gate"], ...extraOpts, rpc: { lfh_guest_settings: ans, lfh_table_status: TS(false) } }, async (L) => {
  await L.wait(600); await go(L, { action: "call", table: "7", payload: { reason: "Water" } }); await L.wait(900); return { ttl: await title(L), s: await sheet(L), L };
});
// the words PostgREST really sends for a busy database ("timeout" alone is not what it says)
const BUSY = () => pgErr("57014", "canceling statement due to statement timeout");
check(G, "settings that could not be read because the restaurant's system is busy: 'The restaurant's system is busy' — on us", HOW, async () => { const r = await settingsFail(BUSY); return { ok: r.ttl === "The restaurant's system is busy" && /this one.s on us/.test(r.s) && /system isn.t answering/.test(r.s) && !/still/.test(r.s), note: r.s.slice(0, 90) }; });
check(G, "…because the phone has no signal: 'Connection trouble' — the phone seems offline", HOW, async () => { const r = await settingsFail(() => "abort"); return { ok: r.ttl === "Connection trouble" && /phone seems to be offline/.test(r.s), note: r.s.slice(0, 90) }; });
check(G, "…for another reason: 'That didn't go through' — blaming nobody", HOW, async () => { const r = await settingsFail(() => pgErr("XX000", "x")); return { ok: r.ttl === "That didn't go through" && !/internet|offline|on us/.test(r.s), note: r.s.slice(0, 90) }; });
check(G, "…a settings read that never answers is given up after 8 seconds as the restaurant's — not left spinning", HOW, () => with_({ mount: ["gate"], clock: true, rpc: { lfh_guest_settings: () => "hang" } }, async (L) => {
  await L.clock.runFor(800); await go(L, { action: "call", table: "7", payload: {} }); await L.clock.runFor(9000); await L.wait(120); return { ok: (await title(L)) === "The restaurant's system is busy" && /isn.t answering/.test(await sheet(L)), note: await title(L) };
}));
check(G, "…Retry reads the settings again; a second failure says the system STILL isn't answering", HOW, () => with_({ mount: ["gate"], rpc: { lfh_guest_settings: BUSY } }, async (L) => {
  await L.wait(600); await go(L, { action: "call", table: "7", payload: {} }); await L.wait(800); await L.page.click("text=Retry"); await L.wait(800);
  return { ok: /still isn.t answering right now — this one.s on us\. Please try again in a moment\./.test(await sheet(L)) && calls(L, "lfh_guest_settings").length === 2, note: (await sheet(L)).slice(0, 100) };
}));
check(G, "…and a Retry that gets the settings carries on with the action", HOW, () => with_({ mount: ["gate"], rpc: { lfh_guest_settings: (a, n) => (n === 1 ? pgErr("57014", "t") : json(settingsOn())), lfh_table_status: TS(false) } }, async (L) => {
  await L.wait(600); await go(L, { action: "call", table: "7", payload: {} }); await L.wait(800); await L.page.click("text=Retry"); await L.wait(900); return /Your table isn.t open yet/.test(await sheet(L));
}));
check(G, "…a settings read that fails AFTER one has worked uses the restaurant's last known settings — no error screen", HOW, () => with_({ mount: ["gate"], rpc: { lfh_guest_settings: (a, n) => (n === 3 ? pgErr("57014", "t") : json(settingsOn())), lfh_table_status: TS(false) } }, async (L) => {
  await L.wait(600); await go(L, { action: "call", table: "7", payload: {} }); await L.wait(700); await L.page.click(".sg-x"); await L.wait(200); await go(L, { action: "call", table: "7", payload: {} }); await L.wait(800);
  return { ok: /Your table isn.t open yet/.test(await sheet(L)), note: `${calls(L, "lfh_guest_settings").length} reads` };
}));
check(G, "a page whose restaurant cannot be settled within 6 seconds says so ('couldn't tell which restaurant') — never acts for #1", HOW, () => with_({ mount: ["gate"], clock: true, path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: () => "hang" } }, async (L) => {
  await L.clock.runFor(800); await go(L, { action: "call", table: "7", payload: {} }); await L.clock.runFor(7000); await L.wait(120); const t = await sheet(L);
  await L.page.click("text=Retry"); await L.clock.runFor(7000); await L.wait(120);
  return { ok: /couldn.t tell which restaurant this is/.test(t) && (await title(L)) === "That didn't go through" && calls(L, "lfh_guest_settings").length === 0 && calls(L, "lfh_table_status").length === 0, note: t.slice(0, 80) };
}));

// ── being at the restaurant (the location check) ────────────────────────────────────────────────────
const HERE = { latitude: 19.07, longitude: 72.87 };
const locLab = (geo, o = {}) => ({ mount: ["gate"], geo, storage: o.storage, rpc: { lfh_guest_settings: () => json(settingsOn({ require_location: true, geo_lat: HERE.latitude, geo_lng: HERE.longitude, geo_radius_m: 250 })), lfh_table_status: TS(false), lfh_request: () => json({ ok: true }) } });
check(G, "the first time a restaurant checks location, the sheet explains WHY before the phone asks", HOW, () => with_(locLab(HERE), async (L) => {
  await ask(L); const t = await sheet(L); return { ok: /You.re at table 7/.test(t) && /Your location is used once, just for this/.test(t) && /I.m here — continue/.test(t), note: t.slice(0, 80) };
}));
check(G, "…at the restaurant: 'I'm here' records the consent and carries on, sending the location with the join", HOW, () => with_(locLab(HERE), async (L) => {
  await ask(L); await L.page.click("text=I’m here — continue").catch(() => L.page.click(".sg-btn.gold")); await L.wait(900);
  return { ok: (await L.ls("lfh_loc_consent:french-house")) === "1" && /Your table isn.t open yet/.test(await sheet(L)) };
}));
check(G, "…a diner who already consented is checked straight away, with no explanation screen", HOW, () => with_(locLab(HERE, { storage: { "lfh_loc_consent:french-house": "1" } }), async (L) => { await ask(L); await L.wait(400); return /Your table isn.t open yet/.test(await sheet(L)); }));
check(G, "…too far away: 'Let us bring a waiter over — You seem too far from the restaurant', and a waiter can be asked for", HOW, () => with_(locLab({ latitude: 18.5, longitude: 73.8 }, { storage: { "lfh_loc_consent:french-house": "1" } }), async (L) => {
  await ask(L); await L.wait(500); const t = await sheet(L); await L.page.click("text=Request a waiter"); await L.wait(400);
  // no name anywhere yet → the waiter request asks for one first (the next check follows that through)
  return { ok: /Let us bring a waiter over/.test(t) && /You seem too far from the restaurant\./.test(t) && /Calling a waiter/i.test(await sheet(L)) && calls(L, "lfh_request").length === 0, note: t.slice(0, 90) };
}));
check(G, "…location refused by the diner: 'Location was blocked.' — with 'Try location again'", HOW, () => with_({ ...locLab(null, { storage: { "lfh_loc_consent:french-house": "1" } }) }, async (L) => {
  await L.ctx.clearPermissions(); await ask(L); await L.wait(900); const t = await sheet(L); return { ok: /Location was blocked\.|Couldn.t read your location\./.test(t) && /Try location again/.test(t), note: t.slice(0, 80) };
}));

// ── asking for a waiter, closing, scanning ──────────────────────────────────────────────────────────
check(G, "asking for a waiter with no name anywhere asks for one first ('so the waiter knows who they're looking for')", HOW, () => with_(locLab({ latitude: 18.5, longitude: 73.8 }, { storage: { "lfh_loc_consent:french-house": "1" } }), async (L) => {
  await ask(L); await L.wait(500); await L.page.click("text=Request a waiter"); await L.wait(300); const t = await sheet(L); await L.page.click("text=Request a waiter"); await L.wait(200); const n = await L.text(".sg-note-bad");
  await L.page.fill(".sg-input", "Mia"); await L.page.click("text=Request a waiter"); await L.wait(500);
  return { ok: /Calling a waiter/i.test(t) && /Add your name so staff know who.s asking\./.test(n || "") && calls(L, "lfh_request").length === 1 && (await L.ls("lfh_my_name:french-house")) === "Mia", note: t.slice(0, 60) };
}));
check(G, "…a second ask for help at the same table goes straight to 'We've let the staff know' — one request, not two", HOW, () => with_(open(2, { join: JOIN({ approved: false }), state: () => ST({ approved: false }), rpc: { lfh_request: () => json({ ok: true }) } }), async (L) => {
  await ask(L); await L.page.fill(".sg-input", "Raj"); await L.page.click("text=Ask to join this table"); await L.wait(500); await L.page.click("text=Call a waiter instead"); await L.wait(500);
  await L.page.evaluate(() => { const b = [...document.querySelectorAll(".sg-btn")].find((x) => /Close|Cancel/.test(x.textContent)); if (b) b.click(); }); await L.wait(200); return { ok: calls(L, "lfh_request").length === 1 };
}));
check(G, "the ✕ closes the sheet and reports the action CANCELLED, so nothing waits on it", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.click(".sg-x"); await L.wait(200);
  return { ok: !(await L.page.$(".sg-box")) && (await done(L)).some((x) => x.ok === false && x.reason === "cancelled" && x.action === "connect") };
}));
check(G, "…a tap outside the card closes it too, and a tap inside does not", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.click(".sg-title"); await L.wait(120); const inside = !!(await L.page.$(".sg-box"));
  await L.page.mouse.click(4, 4); await L.wait(150); return { ok: inside && !(await L.page.$(".sg-box")) };
}));
check(G, "…and the phone's back button closes it without leaving the menu", HOW, () => with_({ mount: ["gate"] }, async (L) => {
  await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(500); const url = L.page.url(); await L.page.goBack().catch(() => null); await L.wait(400);
  return { ok: !(await L.page.$(".sg-box")) && L.page.url() === url };
}));
const scanLab = (raw, o = {}) => ({ mount: ["gate"], rpc: { lfh_table_status: TS(false) }, init: { fn: ({ raw, cam }) => {
  window.BarcodeDetector = class { detect() { return Promise.resolve(raw === null ? [] : [{ rawValue: raw }]); } };
  // a camera that really delivers frames (a drawn canvas at 5 fps) — a blank stream never starts playing
  const camStream = () => { const c = document.createElement("canvas"); c.width = 4; c.height = 4; c.getContext("2d").fillRect(0, 0, 4, 4); return c.captureStream(5); };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => (cam ? Promise.resolve(camStream()) : Promise.reject(new Error("NotAllowedError"))) } });
}, arg: { raw, cam: o.cam !== false } } });
const scan = async (L) => { await L.wait(500); await go(L, { action: "connect", table: "", payload: {} }); await L.wait(400); await L.page.click("text=Scan QR"); await L.wait(1200); };
check(G, "a phone that cannot scan says so and leaves the number box to type in", HOW, () => with_({ mount: ["gate"], init: { fn: () => { delete window.BarcodeDetector; }, arg: null } }, async (L) => { await scan(L); return { ok: /Scanning isn.t supported on this phone/.test(await sheet(L)), note: (await L.text(".sg-note-bad")) }; }));
check(G, "…a camera the diner refused says 'Couldn't open the camera — please type the table number'", HOW, () => with_(scanLab("x", { cam: false }), async (L) => { await scan(L); return /Couldn.t open the camera/.test(await sheet(L)); }));
check(G, "…while it looks, it says it is looking ('hold steady'), and 'Type it instead' goes back", HOW, () => with_(scanLab(null), async (L) => {
  await scan(L); const t = await sheet(L); await L.page.click("text=Type it instead"); await L.wait(150); return { ok: /Looking for your table.s code… hold steady\./.test(t) && /Which table are you at\?/.test(await sheet(L)), note: t.slice(0, 60) };
}));
check(G, "…an old sticker with ?table=12 on OUR site fills in table 12", HOW, () => with_(scanLab("https://t4lab.test/menu?table=12"), async (L) => { await scan(L); return (await L.page.$eval(".sg-input", (i) => i.value).catch(() => "")) === "12"; }));
check(G, "…a sticker holding just a number fills in that number", HOW, () => with_(scanLab("Table 14"), async (L) => { await scan(L); return (await L.page.$eval(".sg-input", (i) => i.value).catch(() => "")) === "14"; }));
check(G, "…today's /q/<code> sticker takes the diner to that code's own page", HOW, () => with_({ ...scanLab("https://t4lab.test/q/ab12cd34"), holdNav: true }, async (L) => { await scan(L); await L.wait(500); return { ok: L.navs[0] === "/q/AB12CD34", note: JSON.stringify(L.navs) }; }));
check(G, "…another site's QR is refused ('belongs to another site'); one of ours with no table says it does not say which table", HOW, async () => {
  const a = await with_(scanLab("https://elsewhere.example/menu?table=3"), async (L) => { await scan(L); return (await L.text(".sg-note-bad")) || ""; });
  const b = await with_(scanLab("https://t4lab.test/about"), async (L) => { await scan(L); return (await L.text(".sg-note-bad")) || ""; });
  return { ok: /belongs to another site/.test(a) && /doesn.t say which table/.test(b), note: `${a} / ${b}` };
});
