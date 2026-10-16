// Block J, part 2 — the head's approve prompt (SessionOwner), the shared basket (SessionCartSync) and the
// table bill (SessionTableBill), in the screen lab (sweep #10 T4 round 2).
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr, settingsOn, FX } from "./page.mjs";
import { HOW } from "./how.mjs";
const SAK = { ...FX.lfh_guest_restaurant, id: "cccccccc-0000-4000-8000-0000000000aa", slug: "sakura-sushi", name: "Sakura Sushi" };
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const SK = "lfh_session:french-house";
const HEAD = { table: "7", token: "tok-head", memberId: "m-head", role: "owner" };
const GUEST = { table: "7", token: "tok-guest", memberId: "m-guest", role: "guest" };
const state = ({ role = "owner", approved = true, status = "open", table = "7", pending = [], members = 2, calls: c = [], items = [], orders = [], bill = null } = {}) =>
  json({ ok: true, session: { id: "s1", table_number: table, status }, member: { id: "m-x", role, approved }, pending, members: Array.from({ length: members }, (_, i) => ({ id: "m" + i })), calls: c, items, orders, bill });
const MIA = { id: "m-mia", name: "Mia" };

// ── SessionOwner: the head's "someone wants to join" prompt ────────────────────────────────────────
const O = FILES.owner;
const ownerLab = (o = {}) => ({ mount: ["owner"], storage: { [SK]: HEAD }, ...o, rpc: { lfh_session_state: () => state({ pending: [MIA] }), ...(o.rpc || {}) } });
const prompt = (L) => L.text(".sg-box");
check(O, "a diner who is NOT the head is never shown the prompt, and the prompt reads nothing for them", HOW, () => with_({ mount: ["owner"], storage: { [SK]: GUEST }, rpc: { lfh_session_state: () => state({ role: "guest", pending: [MIA] }) } }, async (L) => {
  await L.wait(900); return { ok: !(await L.page.$(".sg-box")) && calls(L, "lfh_session_state").length === 0 };
}));
check(O, "the head sees who is waiting, by name, at which table — with Not them / Let them in / let anyone join", HOW, () => with_(ownerLab(), async (L) => {
  await L.wait(900); const t = await prompt(L); const btns = await L.page.$$eval(".sg-box button", (b) => b.map((x) => x.textContent.trim()));
  return { ok: /Mia wants to join/.test(t) && /join table 7/.test(t) && ["Not them", "Let them in", "Let anyone join automatically"].every((x) => btns.includes(x)) && !/more waiting/.test(t), note: btns.join(" | ") };
}));
check(O, "…someone who gave no name is 'Someone wants to join', and a queue says how many more are waiting", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: () => state({ pending: [{ id: "m-a", name: null }, MIA, { id: "m-b", name: "Raj" }] }) } }), async (L) => {
  await L.wait(900); const t = await prompt(L); return { ok: /Someone wants to join/.test(t) && /2 more waiting\./.test(t), note: t.slice(0, 120) };
}));
check(O, "with table sessions switched OFF at this restaurant the prompt never reads anything", HOW, () => with_(ownerLab({ rpc: { lfh_guest_settings: () => json(settingsOn({ sessions_enabled: false })), lfh_session_state: () => state({ pending: [MIA] }) } }), async (L) => {
  await L.wait(1200); return { ok: !(await L.page.$(".sg-box")) && calls(L, "lfh_session_state").length === 0 };
}));
check(O, "'Let them in' approves THAT person by id and name with the head's token, re-reads, and the prompt goes", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: (a, n) => state({ pending: n <= 1 ? [MIA] : [] }), lfh_approve_member: () => json({ ok: true }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let them in"); await L.wait(700); const a = calls(L, "lfh_approve_member")[0];
  return { ok: !!a && a.args.p_owner_token === "tok-head" && a.args.p_member_id === "m-mia" && a.args.p_name === "Mia" && !(await L.page.$(".sg-box")) && calls(L, "lfh_session_state").length >= 2, note: JSON.stringify(a && a.args) };
}));
check(O, "…a head who has lost the role is told 'You're not the host of this table any more'", HOW, () => with_(ownerLab({ rpc: { lfh_approve_member: () => json({ ok: false, reason: "not_owner" }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let them in"); await L.wait(500); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.includes("You're not the host of this table any more."), note: t.join(" / ") };
}));
check(O, "…any other failure says it couldn't let them in JUST NOW — try again — and does not pretend", HOW, () => with_(ownerLab({ rpc: { lfh_approve_member: () => pgErr("57014", "timeout") } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let them in"); await L.wait(500); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.includes("We couldn't let them in just now — please try again in a moment.") && !!(await L.page.$(".sg-box")), note: t.join(" / ") };
}));
check(O, "'Not them' turns THAT person down by id with the head's token; a failure says so", HOW, () => with_(ownerLab({ rpc: { lfh_remove_member: (a, n) => (n === 1 ? pgErr("57014", "timeout") : json({ ok: true })) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Not them"); await L.wait(500); const t = (await L.toasts()).map((x) => x.message); const r = calls(L, "lfh_remove_member")[0];
  return { ok: !!r && r.args.p_owner_token === "tok-head" && r.args.p_member_id === "m-mia" && t.includes("We couldn't turn that request down just now — please try again in a moment."), note: t.join(" / ") };
}));
check(O, "'Let anyone join automatically' switches it on AND lets in everyone already waiting", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: () => state({ pending: [MIA, { id: "m-raj", name: "Raj" }] }), lfh_set_auto_approve: () => json({ ok: true }), lfh_approve_member: () => json({ ok: true }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let anyone join automatically"); await L.wait(700); const s = calls(L, "lfh_set_auto_approve")[0]; const ids = calls(L, "lfh_approve_member").map((x) => x.args.p_member_id);
  return { ok: !!s && s.args.p_value === true && s.args.p_owner_token === "tok-head" && ids.join() === "m-mia,m-raj" && (await L.toasts()).length === 0, note: ids.join() };
}));
check(O, "…if the switch did not go on, the head is told so", HOW, () => with_(ownerLab({ rpc: { lfh_set_auto_approve: () => pgErr("57014", "timeout"), lfh_approve_member: () => json({ ok: true }) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let anyone join automatically"); await L.wait(600); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.includes("We couldn't switch that on just now — please try again in a moment."), note: t.join(" / ") };
}));
check(O, "…if it went on but someone already waiting could not be let in, the head is told to try those again", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: () => state({ pending: [MIA, { id: "m-raj", name: "Raj" }] }), lfh_set_auto_approve: () => json({ ok: true }), lfh_approve_member: (a) => (a.p_member_id === "m-raj" ? pgErr("57014", "t") : json({ ok: true })) } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let anyone join automatically"); await L.wait(700); const t = (await L.toasts()).map((x) => x.message);
  return { ok: t.some((m) => /^Anyone new can join now, but we couldn't let everyone already waiting in/.test(m)), note: t.join(" / ") };
}));
check(O, "while one choice is on its way every button is off, and a second tap sends nothing more", HOW, () => with_(ownerLab({ rpc: { lfh_approve_member: async () => { await new Promise((r) => setTimeout(r, 900)); return json({ ok: true }); } } }), async (L) => {
  await L.wait(900); await L.page.click("text=Let them in"); await L.wait(150); const off = await L.page.$$eval(".sg-box .sg-btn, .sg-box .sg-link", (b) => b.every((x) => x.disabled));
  await L.page.$$eval(".sg-box .sg-btn", (b) => b.forEach((x) => x.click())); await L.wait(1100);
  return { ok: off && calls(L, "lfh_approve_member").length === 1 && calls(L, "lfh_remove_member").length === 0 };
}));
check(O, "'Later' (✕) and a tap outside the card both put the prompt away; a tap inside the card does not", HOW, () => with_(ownerLab(), async (L) => {
  await L.wait(900); await L.page.click(".sg-box .sg-title"); await L.wait(150); const inside = !!(await L.page.$(".sg-box"));
  await L.page.click(".sg-x"); await L.wait(150); const x = !(await L.page.$(".sg-box"));
  return { ok: inside && x };
}));
check(O, "…the backdrop tap is the same 'Later'", HOW, () => with_(ownerLab(), async (L) => {
  await L.wait(900); await L.page.mouse.click(5, 5); await L.wait(150); return !(await L.page.$(".sg-box"));
}));
check(O, "…and 'Later' lasts about 20 seconds — then the prompt comes back while the person still waits", HOW, () => with_(ownerLab({ clock: true }), async (L) => {
  await L.clock.runFor(1200); await L.page.click(".sg-x"); await L.clock.runFor(9000); await L.wait(80); const mid = !!(await L.page.$(".sg-box"));
  await L.clock.runFor(16000); await L.wait(120); return { ok: !mid && !!(await L.page.$(".sg-box")), note: `at 9 s ${mid ? "shown" : "hidden"}` };
}));
check(O, "the phone's back button puts the prompt away without leaving the menu", HOW, () => with_(ownerLab(), async (L) => {
  await L.wait(1000); const url = L.page.url(); await L.page.goBack().catch(() => null); await L.wait(500);
  return { ok: !(await L.page.$(".sg-box")) && L.page.url() === url, note: L.page.url() };
}));
check(O, "a meal that has ended (the session is not open) clears this phone's table and shows nothing", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: () => state({ status: "closed", pending: [MIA] }) } }), async (L) => {
  await L.wait(900); return { ok: !(await L.page.$(".sg-box")) && (await L.ls(SK)) === null };
}));
check(O, "…a token the restaurant no longer knows is cleared too", HOW, () => with_(ownerLab({ rpc: { lfh_session_state: () => json({ ok: false, reason: "invalid_token" }) } }), async (L) => {
  await L.wait(900); return { ok: !(await L.page.$(".sg-box")) && (await L.ls(SK)) === null };
}));
check(O, "…but a read that only FAILED keeps the prompt and the table — a blip is not an answer", HOW, () => with_(ownerLab({ clock: true, rpc: { lfh_session_state: (a, n) => (n === 1 ? state({ pending: [MIA] }) : pgErr("57014", "timeout")) } }), async (L) => {
  await L.clock.runFor(1200); await L.clock.runFor(4500); await L.wait(150);
  return { ok: !!(await L.page.$(".sg-box")) && (await L.ls(SK)) !== null && calls(L, "lfh_session_state").length >= 2 };
}));
check(O, "becoming the head, a realtime nudge, and returning to the tab each ask at once — not on the 4 s timer", HOW, () => with_(ownerLab({ clock: true }), async (L) => {
  await L.clock.runFor(1000); const n0 = calls(L, "lfh_session_state").length;
  await L.fire("lfh:session-changed"); await L.wait(80); await L.fire("lfh:rt-tick"); await L.wait(80); await L.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await L.wait(80);
  return { ok: calls(L, "lfh_session_state").length === n0 + 3, note: `${n0} → ${calls(L, "lfh_session_state").length}` };
}));
check(O, "…while the tab is hidden its 4-second check reads nothing", HOW, () => with_(ownerLab({ clock: true }), async (L) => {
  await L.clock.runFor(1000); const n0 = calls(L, "lfh_session_state").length; await L.page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await L.clock.runFor(13000); await L.wait(80); return { ok: calls(L, "lfh_session_state").length === n0, note: `${n0} → ${calls(L, "lfh_session_state").length}` };
}));
check(O, "when the prompt's screen goes away, it stops: no timer left, and no event makes it read again", HOW, () => with_(ownerLab({ clock: true }), async (L) => {
  await L.clock.runFor(1000); await L.unmount(); const n0 = calls(L, "lfh_session_state").length; const iv = await L.intervals();
  await L.fire("lfh:session-changed"); await L.fire("lfh:rt-tick"); await L.clock.runFor(9000); await L.wait(80);
  return { ok: calls(L, "lfh_session_state").length === n0 && iv === 0, note: `${iv} timers` };
}));
check(O, "on another restaurant's menu nothing is read until that restaurant is known — then its own switch is asked", HOW, () => with_(ownerLab({ path: "/r/sakura-sushi/menu", storage: { "lfh_session:sakura-sushi": HEAD }, rpc: { lfh_guest_restaurant: async () => { await new Promise((r) => setTimeout(r, 800)); return json(SAK); }, lfh_session_state: () => state({ pending: [MIA] }) } }), async (L) => {
  await L.wait(300); const early = calls(L, "lfh_guest_settings").length + calls(L, "lfh_session_state").length; await L.wait(1400); const s = calls(L, "lfh_guest_settings");
  return { ok: early === 0 && s.length >= 1 && s.every((x) => x.args.p_restaurant_id === SAK.id) && !!(await L.page.$(".sg-box")), note: `${early} early` };
}));

// ── SessionCartSync: one basket for the whole table ─────────────────────────────────────────────────
const S = FILES.cartSync;
const CK = "lfh_cart:french-house";
const L1 = { id: "dish-a", sig: "[]", qty: 1, title: "Latte" }, L2 = { id: "dish-b", sig: "[]", qty: 2, title: "Croissant" };
const cartLab = (o = {}) => {
  const box = { server: o.server ?? [], at: 0, sets: [], merges: [] };
  return { box, opts: { mount: ["cartSync"], storage: { [SK]: GUEST, ...(o.local ? { [CK]: o.local } : {}) }, clock: o.clock, rpc: {
    lfh_get_cart: o.get || (() => json({ ok: true, open: true, approved: true, cart: box.server, cart_updated_at: "t" + box.at })),
    lfh_set_cart: o.set || ((a) => { box.sets.push(a); box.server = a.p_cart; box.at++; return json({ ok: true }); }),
    lfh_merge_cart: o.merge || ((a) => { box.merges.push(a); return json({ ok: true, cart: o.mergeReply ?? null }); }),
    ...(o.rpc || {}) } } };
};
const localIds = async (L) => ((await L.lsJSON(CK)) || []).map((l) => `${l.id}x${l.qty}`).join(",");
const setLocal = (L, lines) => L.page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new Event("lfh:cart-updated")); }, [CK, lines]);
check(S, "a diner not at a table keeps a purely local basket — the table's basket is never read", HOW, () => with_({ mount: ["cartSync"], storage: { [CK]: [L1] } }, async (L) => { await L.wait(900); return calls(L, "lfh_get_cart").length === 0 && (await localIds(L)) === "dish-ax1"; }));
check(S, "…nor where the restaurant has table sessions switched off", HOW, () => { const c = cartLab({ local: [L1] }); c.opts.rpc.lfh_guest_settings = () => json(settingsOn({ sessions_enabled: false })); return with_(c.opts, async (L) => { await L.wait(900); return calls(L, "lfh_get_cart").length === 0; }); });
check(S, "joining a table whose basket is EMPTY keeps the dishes you brought, and sends them to the table", HOW, () => { const c = cartLab({ local: [L1] }); return with_(c.opts, async (L) => {
  await L.wait(900); return { ok: (await localIds(L)) === "dish-ax1" && c.box.sets.length === 1 && c.box.sets[0].p_cart.map((l) => l.id).join() === "dish-a", note: JSON.stringify(c.box.sets.map((s) => s.p_cart.length)) };
}); });
check(S, "joining with an EMPTY basket adopts the table's basket on this phone, and sends nothing back", HOW, () => { const c = cartLab({ server: [L2] }); return with_(c.opts, async (L) => {
  await L.wait(900); return { ok: (await localIds(L)) === "dish-bx2" && c.box.sets.length === 0, note: await localIds(L) };
}); });
check(S, "joining with dishes of your own AND a table basket keeps both — the table's version of a shared line wins", HOW, () => { const c = cartLab({ server: [{ ...L1, qty: 3 }], local: [L1, L2] }); return with_(c.opts, async (L) => {
  await L.wait(900); const ids = await localIds(L); return { ok: ids === "dish-ax3,dish-bx2" && c.box.sets.length === 1 && c.box.sets[0].p_seen === "t0", note: `${ids} · seen ${c.box.sets[0] && c.box.sets[0].p_seen}` };
}); });
check(S, "…if someone else changed the table's basket first ('cart_moved'), the merge is done again against theirs", HOW, () => { const c = cartLab({ server: [L2], local: [L1], set: (a, n) => (n === 1 ? json({ ok: false, reason: "cart_moved" }) : json({ ok: true })) }); return with_(c.opts, async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(600); return { ok: calls(L, "lfh_set_cart").length === 2 && /dish-a/.test(await localIds(L)), note: `${calls(L, "lfh_set_cart").length} writes` };
}); });
check(S, "…and a busy second at the join no longer costs the diner their dishes — they reach the table next refresh (round 2 fix)", HOW, () => { const c = cartLab({ server: [L2], local: [L1] }); const ok = c.opts.rpc.lfh_set_cart; c.opts.rpc.lfh_set_cart = (a, n) => (n === 1 ? pgErr("57014", "timeout") : ok(a)); return with_(c.opts, async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(700); const ids = await localIds(L);
  return { ok: /dish-a/.test(ids) && c.box.server.some((l) => l.id === "dish-a"), note: `phone ${ids} · table ${c.box.server.map((l) => l.id).join(",")}` };
}); });
check(S, "a later change on this phone is sent as a DELTA — what was added, what changed quantity, what was removed", HOW, () => { const c = cartLab({ server: [L1, L2], local: [] }); return with_(c.opts, async (L) => {
  await L.wait(900); await setLocal(L, [{ ...L1, qty: 4 }, { id: "dish-c", sig: "[]", qty: 1, title: "Tea" }]); await L.wait(900); const m = c.box.merges[0];
  return { ok: !!m && m.p_added.map((l) => l.id).join() === "dish-c" && m.p_qty.map((l) => `${l.id}x${l.qty}`).join() === "dish-ax4" && m.p_removed.map((l) => l.id).join() === "dish-b" && m.p_token === "tok-guest", note: JSON.stringify(m && { a: m.p_added.length, q: m.p_qty.length, r: m.p_removed.length }) };
}); });
check(S, "…several quick taps inside half a second go out as ONE change, not one per tap", HOW, () => { const c = cartLab({ server: [L1], local: [] }); return with_(c.opts, async (L) => {
  await L.wait(900); for (const q of [2, 3, 4]) { await setLocal(L, [{ ...L1, qty: q }]); await L.wait(80); } await L.wait(900);
  return { ok: c.box.merges.length === 1 && c.box.merges[0].p_qty[0].qty === 4, note: `${c.box.merges.length} sends` };
}); });
check(S, "…a change that is no change (the same basket written again) sends nothing", HOW, () => { const c = cartLab({ server: [L1], local: [] }); return with_(c.opts, async (L) => {
  await L.wait(900); await setLocal(L, [L1]); await L.wait(800); return c.box.merges.length === 0;
}); });
check(S, "…when the table answers with its merged basket, this phone shows exactly that", HOW, () => { const c = cartLab({ server: [L1], local: [], mergeReply: [L1, L2] }); return with_(c.opts, async (L) => {
  await L.wait(900); await setLocal(L, [L1, { ...L2, qty: 1 }]); await L.wait(900); return { ok: (await localIds(L)) === "dish-ax1,dish-bx2", note: await localIds(L) };
}); });
check(S, "…a change the table did NOT take is merged again on the next refresh — never silently forgotten", HOW, () => { const c = cartLab({ server: [L1], local: [], merge: () => pgErr("57014", "timeout") }); return with_(c.opts, async (L) => {
  await L.wait(900); await setLocal(L, [L1, L2]); await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(700);
  return { ok: calls(L, "lfh_set_cart").length === 1 && c.box.sets[0].p_cart.some((l) => l.id === "dish-b"), note: `${calls(L, "lfh_set_cart").length} re-merge write(s)` };
}); });
check(S, "a co-diner's change arriving on a refresh is written to this phone, and that write is not echoed back", HOW, () => { const c = cartLab({ server: [L1], local: [] }); return with_(c.opts, async (L) => {
  await L.wait(900); c.box.server = [L1, L2]; await L.fire("lfh:rt-tick"); await L.wait(900);
  return { ok: (await localIds(L)) === "dish-ax1,dish-bx2" && c.box.merges.length === 0, note: `${await localIds(L)} · ${c.box.merges.length} echoes` };
}); });
check(S, "once the table's session ends, a later change on this phone stays on this phone", HOW, () => { const c = cartLab({ server: [L1], local: [], get: (a, n) => (n === 1 ? json({ ok: true, open: true, approved: true, cart: [L1], cart_updated_at: "t" }) : json({ ok: false, reason: "session_closed" })) }); return with_(c.opts, async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(400); await setLocal(L, [L1, L2]); await L.wait(900); return c.box.merges.length === 0;
}); });
check(S, "…and a diner still waiting for the head's OK keeps their own basket — nothing is shared yet", HOW, () => { const c = cartLab({ local: [L1], get: () => json({ ok: true, open: true, approved: false, cart: [L2], cart_updated_at: "t" }) }); return with_(c.opts, async (L) => {
  await L.wait(900); return { ok: (await localIds(L)) === "dish-ax1" && c.box.sets.length === 0, note: await localIds(L) };
}); });
check(S, "…a table read that only FAILED keeps everything as it was and tries again later", HOW, () => { const c = cartLab({ local: [L1], get: (a, n) => (n === 1 ? pgErr("57014", "timeout") : json({ ok: true, open: true, approved: true, cart: [], cart_updated_at: "t" })) }); return with_(c.opts, async (L) => {
  await L.wait(900); const mid = await localIds(L); await L.fire("lfh:rt-tick"); await L.wait(700); return { ok: mid === "dish-ax1" && c.box.sets.length === 1, note: mid };
}); });
check(S, "…a settings read that failed means no sync yet — the next refresh asks the switch again", HOW, () => { const c = cartLab({ local: [L1] }); c.opts.rpc.lfh_guest_settings = (a, n) => (n === 1 ? pgErr("57014", "timeout") : json(settingsOn())); return with_(c.opts, async (L) => {
  await L.wait(900); const before = calls(L, "lfh_get_cart").length; await L.fire("lfh:rt-tick"); await L.wait(700); return { ok: before === 0 && calls(L, "lfh_get_cart").length === 1, note: `${before} → ${calls(L, "lfh_get_cart").length}` };
}); });
check(S, "joining a new table (session changed) merges again for that table", HOW, () => { const c = cartLab({ local: [L1] }); return with_(c.opts, async (L) => {
  await L.wait(900); c.box.server = [L2]; // the NEW table already has a dish of its own
  await L.page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [SK, { ...GUEST, token: "tok-new" }]); await L.fire("lfh:session-changed"); await L.wait(700);
  return { ok: c.box.sets.length === 2 && c.box.sets[1].p_token === "tok-new", note: c.box.sets.map((s) => s.p_token).join() };
}); });
check(S, "a basket on this phone that is corrupt text is treated as empty — the menu keeps working", HOW, () => { const c = cartLab({ server: [L2] }); c.opts.storage[CK] = "{not json"; return with_(c.opts, async (L) => {
  await L.wait(900); return { ok: (await localIds(L)) === "dish-bx2" && L.errors.length === 0, note: await localIds(L) };
}); });
check(S, "when the basket's screen goes away the sync stops: no timer, no reads, no sends", HOW, () => { const c = cartLab({ server: [L1], local: [] }); return with_(c.opts, async (L) => {
  await L.wait(900); await L.unmount(); const n = calls(L, "lfh_get_cart").length; await setLocal(L, [L1, L2]); await L.fire("lfh:rt-tick"); await L.wait(900);
  return { ok: calls(L, "lfh_get_cart").length === n && c.box.merges.length === 0 && (await L.intervals()) === 0 };
}); });

// ── SessionTableBill: what the whole table has ordered, live ───────────────────────────────────────
const TB = FILES.tbill;
const billLab = (st, o = {}) => ({ mount: ["tbill"], storage: { [SK]: GUEST }, ...o, rpc: { lfh_session_state: st, ...(o.rpc || {}) } });
const bill = (L) => L.text(".stb");
const ITEMS = [
  { id: "i1", title: "Croissant", qty: 2, status: "served", options: [{ label: "Warm" }], removed: ["milk"], note: "extra butter" },
  { id: "i2", title: "Water", qty: 1, status: "ready" },
  { id: "i3", title: "Chips", qty: 1, status: "preparing", removed: ["milk", "nuts"] },
];
const ORDERS = [{ items: [{ title: "Water", is_mrp: true }, { title: "Croissant", is_mrp: false }, null] }];
check(TB, "a diner not at a table sees no table bill, and none is read", HOW, () => with_({ mount: ["tbill"] }, async (L) => { await L.wait(800); return !(await L.page.$(".stb")) && calls(L, "lfh_session_state").length === 0; }));
check(TB, "…nor where table sessions are switched off", HOW, () => with_(billLab(() => state({ role: "guest" }), { rpc: { lfh_guest_settings: () => json(settingsOn({ sessions_enabled: false })) } }), async (L) => { await L.wait(800); return !(await L.page.$(".stb")); }));
check(TB, "until the first answer arrives it shows a loading shimmer — never the 'no dishes' line", HOW, () => with_(billLab(() => "hang"), async (L) => {
  await L.wait(800); const t = await bill(L); return { ok: !!(await L.page.$(".stb-loading")) && !/No dishes/.test(t || ""), note: t };
}));
check(TB, "a FIRST read that fails says so plainly, greys the live dot, and offers Try again", HOW, () => with_(billLab(() => pgErr("57014", "timeout")), async (L) => {
  await L.wait(900); const t = await bill(L); const dot = await L.page.$eval(".stb-dot", (d) => d.getAttribute("style") || "");
  return { ok: /can.t reach the restaurant.s system right now/.test(t) && /Nothing is lost/.test(t) && /background: var\(--muted\)/.test(dot) && !!(await L.page.$("text=Try again")), note: dot };
}));
check(TB, "…Try again asks at once, and a good answer replaces the message with the bill", HOW, () => with_(billLab((a, n) => (n === 1 ? pgErr("57014", "t") : state({ role: "guest", items: ITEMS.slice(0, 1) }))), async (L) => {
  await L.wait(900); await L.page.click("text=Try again"); await L.wait(600); const t = await bill(L); return { ok: /Croissant/.test(t) && !/can.t reach/.test(t), note: t.slice(0, 80) };
}));
check(TB, "…and a LATER failed read keeps the last good bill on screen but stops the dot claiming 'live' (round 2 fix)", HOW, () => with_(billLab((a, n) => (n === 1 ? state({ role: "guest", items: ITEMS.slice(0, 1) }) : pgErr("57014", "t"))), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(600); const t = await bill(L); const dot = await L.page.$eval(".stb-dot", (d) => d.getAttribute("style") || "");
  return { ok: /Croissant/.test(t) && !/can.t reach/.test(t) && /background: var\(--muted\)/.test(dot), note: `dot style "${dot}"` };
}));
check(TB, "…and the dot comes back to life the moment a read lands again", HOW, () => with_(billLab((a, n) => (n === 2 ? pgErr("57014", "t") : state({ role: "guest", items: ITEMS.slice(0, 1) }))), async (L) => {
  await L.wait(900); await L.fire("lfh:rt-tick"); await L.wait(500); await L.fire("lfh:rt-tick"); await L.wait(500); const dot = await L.page.$eval(".stb-dot", (d) => d.getAttribute("style") || "");
  return { ok: dot === "", note: `dot style "${dot}"` };
}));
check(TB, "an open table with nothing ordered says 'No dishes sent to the kitchen yet'", HOW, () => with_(billLab(() => state({ role: "guest" })), async (L) => { await L.wait(800); return /No dishes sent to the kitchen yet/.test(await bill(L)); }));
check(TB, "the header names the table, and counts the guests only when more than one shares it", HOW, () => with_(billLab(() => state({ role: "guest", members: 3 })), async (L) => {
  await L.wait(800); const t = await bill(L); return { ok: /Your table · Table 7/i.test(t) && /3 guests/i.test(t), note: t.slice(0, 50) };
}));
check(TB, "…a diner alone at their table is not shown '1 guests'", HOW, () => with_(billLab(() => state({ role: "guest", members: 1 })), async (L) => { await L.wait(800); return !/guests/i.test(await bill(L)); }));
check(TB, "dishes show served-of-total, one bar segment each, and 'ready' reads as still being prepared", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS, orders: ORDERS })), async (L) => {
  await L.wait(800); const t = await bill(L); const bar = await L.page.$eval(".stb-bar", (b) => `${b.getAttribute("aria-valuenow")}/${b.getAttribute("aria-valuemax")}|${[...b.children].map((c) => c.className.replace("stb-seg ", "")).join(",")}`);
  return { ok: /1 of 3 served/.test(t) && bar === "1/3|served,preparing,preparing", note: bar };
}));
check(TB, "…each dish shows its options, the allergens left out (in words), its note, and MRP when its price is final", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS, orders: ORDERS })), async (L) => {
  await L.wait(800); const rows = await L.page.$$eval(".stb-item-name", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  return { ok: /Croissant ×2.*Warm.*No milk.*“extra butter”/.test(rows[0]) && /Water ×1.*MRP/.test(rows[1]) && !/MRP/.test(rows[0]) && /No milk, nuts/.test(rows[2]), note: rows.join(" | ") };
}));
check(TB, "…and the bottom line confirms everything the table left out, once", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS })), async (L) => {
  await L.wait(800); return { ok: /Left out for your table: no milk, nuts$/.test((await L.text(".stb-exclusions")) || ""), note: await L.text(".stb-exclusions") };
}));
check(TB, "the money: subtotal, the discount with its percentage, GST and the table total, in the restaurant's currency", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS.slice(0, 1), bill: { subtotal: 1000, discount: 100, tax: 45, total: 945 } })), async (L) => {
  await L.wait(800); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  return { ok: rows.length === 4 && /^Subtotal.*1,000/.test(rows[0]) && /^Discount \(10%\)/.test(rows[1]) && /^GST/.test(rows[2]) && /^Table total.*945/.test(rows[3]), note: rows.join(" | ") };
}));
check(TB, "…MRP money is shown on its own line only when the server sends it", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS.slice(0, 1), bill: { subtotal: 500, discount: 0, tax: 20, total: 520, nontax: 100 } })), async (L) => {
  await L.wait(800); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  return { ok: rows.some((r) => /^MRP items \(no GST\)/.test(r)) && !rows.some((r) => /^Discount/.test(r)), note: rows.join(" | ") };
}));
check(TB, "…a composition-scheme restaurant prints no GST row and no MRP split — when the server charged no tax", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS.slice(0, 1), bill: { subtotal: 500, discount: 0, tax: 0, total: 500, nontax: 100 } }), { rpc: { lfh_guest_settings: () => json(settingsOn({ price_tax_mode: "composition" })) } }), async (L) => {
  await L.wait(800); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  return { ok: !rows.some((r) => /^GST|^MRP/.test(r)) && rows.some((r) => /^Table total/.test(r)), note: rows.join(" | ") };
}));
check(TB, "…but if the server DID charge tax, the GST row stays — a real charge is never hidden", HOW, () => with_(billLab(() => state({ role: "guest", items: ITEMS.slice(0, 1), bill: { subtotal: 500, discount: 0, tax: 25, total: 525 } }), { rpc: { lfh_guest_settings: () => json(settingsOn({ price_tax_mode: "composition" })) } }), async (L) => {
  await L.wait(800); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim())); return { ok: rows.some((r) => /^GST/.test(r)), note: rows.join(" | ") };
}));
check(TB, "an open waiter call reassures the table — with what was asked for, when anything was", HOW, () => with_(billLab(() => state({ role: "guest", calls: [{ note: "Water" }, { note: "  " }, { note: "Napkins" }] })), async (L) => {
  await L.wait(800); const t = ((await L.text(".stb-called")) || "").replace(/\s+/g, " ").trim(); return { ok: /^Waiter called — on the way · Water, Napkins$/.test(t), note: t };
}));
check(TB, "…a call with no note says only that the waiter is on the way", HOW, () => with_(billLab(() => state({ role: "guest", calls: [{ note: null }] })), async (L) => {
  await L.wait(800); const t = ((await L.text(".stb-called")) || "").replace(/\s+/g, " ").trim(); return { ok: t === "Waiter called — on the way", note: t };
}));
for (const [what, st] of [["the table's session ended", json({ ok: false, reason: "session_closed" })], ["the diner was removed", json({ ok: false, reason: "removed" })], ["the token is unknown", json({ ok: false, reason: "invalid_token" })],
  ["the session is no longer open", state({ role: "guest", status: "closed" })], ["the diner is not approved yet", state({ role: "guest", approved: false })]]) {
  check(TB, `the table bill disappears when ${what}`, HOW, () => with_(billLab(() => st), async (L) => { await L.wait(800); return !(await L.page.$(".stb")); }));
}
check(TB, "a realtime nudge re-reads the bill at once", HOW, () => with_(billLab(() => state({ role: "guest" })), async (L) => {
  await L.wait(800); const n = calls(L, "lfh_session_state").length; await L.fire("lfh:rt-tick"); await L.wait(300); return { ok: calls(L, "lfh_session_state").length === n + 1, note: `${n} → ${calls(L, "lfh_session_state").length}` };
}));
check(TB, "when the basket closes, the bill stops listening: no timer and no reads", HOW, () => with_(billLab(() => state({ role: "guest" })), async (L) => {
  await L.wait(800); await L.unmount(); const n = calls(L, "lfh_session_state").length; await L.fire("lfh:rt-tick"); await L.wait(300);
  return { ok: calls(L, "lfh_session_state").length === n && (await L.intervals()) === 0 };
}));
