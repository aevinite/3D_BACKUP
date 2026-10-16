// Block J, part 1 — BotTrap, the ban wall and the restaurant context, in the screen lab (sweep #10 T4
// round 2). Each check opens the REAL screen in Chromium with the database's answers held in the page.
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr, FH_ID, FX } from "./page.mjs";
import { HOW } from "./how.mjs";
export { HOW };
const SAK = { ...FX.lfh_guest_restaurant, id: "cccccccc-0000-4000-8000-0000000000aa", slug: "sakura-sushi", name: "Sakura Sushi" };
const lookup = (rows) => (a) => json(rows[a.p_slug] ?? null);
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);

// ── BotTrap ──────────────────────────────────────────────────────────────────────────────────────
const T = FILES.trap;
check(T, "BotTrap puts its two fields inside the form under the agreed names — the trap empty, the timer counting up", HOW, () => with_({ mount: ["trap"] }, async (L) => {
  const a = await L.page.evaluate(() => window.__labBotFields(document.getElementById("lab-form"))); await L.wait(1100);
  const b = await L.page.evaluate(() => window.__labBotFields(document.getElementById("lab-form")));
  return { ok: a.trap === "" && b.trap === "" && Number(b.elapsed) >= 900 && Number(b.elapsed) > Number(a.elapsed), note: `${a.elapsed} → ${b.elapsed} ms` };
}));
check(T, "…and no person can see or reach them: off-screen, out of the Tab order, hidden from a screen reader, no autofill", HOW, () => with_({ mount: ["trap"] }, async (L) => {
  const r = await L.page.evaluate(() => { const ins = [...document.querySelectorAll("#lab-form input")]; const box = ins[0].parentElement; const rc = ins[0].getBoundingClientRect();
    return { n: ins.length, tab: ins.every((i) => i.tabIndex === -1), ac: ins.every((i) => i.autocomplete === "off"), aria: box.getAttribute("aria-hidden"), off: rc.right <= 0 || rc.bottom <= 0 || rc.width <= 1 || rc.height <= 1 }; });
  return { ok: r.n === 2 && r.tab && r.ac && r.aria === "true" && r.off, note: JSON.stringify(r) };
}));
check(T, "…a bot that fills the hidden field is visible to the form reader; a missing form reads as two empty values", HOW, () => with_({ mount: ["trap"] }, async (L) => {
  await L.page.evaluate(() => { document.querySelector('#lab-form input[name="lfh_hp_ref"]').value = "http://spam"; });
  const r = await L.page.evaluate(() => ({ f: window.__labBotFields(document.getElementById("lab-form")), n: window.__labBotFields(null) }));
  return { ok: r.f.trap === "http://spam" && r.n.trap === "" && r.n.elapsed === "", note: JSON.stringify(r) };
}));
check(T, "…and when the form goes away its timer is stopped, not left ticking", HOW, () => with_({ mount: ["trap"] }, async (L) => {
  const before = await L.intervals(); await L.unmount(); await L.wait(100); const after = await L.intervals();
  return { ok: before >= 1 && after === before - 1 && L.errors.length === 0, note: `${before} → ${after} timers` };
}));

// ── BanGate ──────────────────────────────────────────────────────────────────────────────────────
const BG = FILES.ban;
const banned = (extra = {}) => json({ ok: true, banned: true, reason: null, unban_requested: false, ...extra });
const wall = (L) => L.text(".ban-card");
check(BG, "a device that is NOT blocked sees no wall, and the menu is asked about exactly once, for THIS restaurant", HOW, () => with_({ mount: ["ban"] }, async (L) => {
  await L.wait(600); const c = calls(L, "lfh_check_ban");
  return { ok: !(await L.page.$(".ban-overlay")) && c.length === 1 && c[0].args.p_restaurant_id === FH_ID, note: `${c.length} check(s)` };
}));
check(BG, "on another restaurant's menu the one check names THAT restaurant — never restaurant #1 first", HOW, () => with_({ mount: ["ban"], path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: lookup({ "sakura-sushi": SAK }) } }, async (L) => {
  await L.wait(800); const c = calls(L, "lfh_check_ban");
  return { ok: c.length === 1 && c[0].args.p_restaurant_id === SAK.id, note: c.map((x) => x.args.p_restaurant_id).join(", ") };
}));
check(BG, "…and while that restaurant is still being looked up, nothing is asked at all", HOW, () => with_({ mount: ["ban"], path: "/r/sakura-sushi/menu",
  rpc: { lfh_guest_restaurant: async (a) => { await new Promise((r) => setTimeout(r, 900)); return json(a.p_slug === "sakura-sushi" ? SAK : null); } } }, async (L) => {
  await L.wait(400); const early = calls(L, "lfh_check_ban").length; await L.wait(1000); const late = calls(L, "lfh_check_ban");
  return { ok: early === 0 && late.length === 1 && late[0].args.p_restaurant_id === SAK.id, note: `${early} before, ${late.length} after` };
}));
check(BG, "a blocked device sees a full-screen modal wall with the staff's reason after a dash", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned({ reason: "rude to staff" }) } }, async (L) => {
  await L.wait(600); const t = await wall(L); const dlg = await L.page.evaluate(() => { const d = document.querySelector(".ban-overlay"); return d && d.getAttribute("role") + "|" + d.getAttribute("aria-modal") + "|" + d.getAttribute("aria-label"); });
  return { ok: /You.ve been blocked/.test(t) && /this device — rude to staff\./.test(t) && dlg === "dialog|true|Access blocked", note: dlg };
}));
check(BG, "…with no reason given, no dangling dash", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned() } }, async (L) => {
  await L.wait(600); const t = await wall(L); return { ok: /from this device\. If you think/.test(t) && !/device —/.test(t), note: t.slice(0, 90) };
}));
check(BG, "…a device that already asked to be unblocked is told so, with no form to ask twice", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned({ unban_requested: true }) } }, async (L) => {
  await L.wait(600); return { ok: /request has been sent/.test(await wall(L)) && !(await L.page.$(".ban-input")) };
}));
check(BG, "…the button stays off until a real number (5+ characters) is typed, and a short one sends nothing", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned() } }, async (L) => {
  await L.wait(500); await L.page.fill(".ban-input", "123 "); const off = await L.page.$eval(".ban-btn", (b) => b.disabled);
  await L.page.$eval(".ban-btn", (b) => b.click()); await L.wait(200); await L.page.fill(".ban-input", "12345"); const on = await L.page.$eval(".ban-btn", (b) => !b.disabled);
  return { ok: off && on && calls(L, "lfh_request_unban").length === 0 };
}));
const tryUnban = (answer) => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned(), lfh_request_unban: answer } }, async (L) => {
  await L.wait(500); await L.page.fill(".ban-input", "  98765 43210  "); await L.page.click(".ban-btn"); await L.wait(700);
  return { fail: await L.text(".ban-fail"), done: await L.text(".ban-done"), sent: calls(L, "lfh_request_unban") };
});
check(BG, "a request the database matched to no block says the NUMBER didn't match — and only then", HOW, async () => { const r = await tryUnban(() => json({ ok: false, reason: "not_blocked" })); return { ok: /couldn.t match that number/.test(r.fail || ""), note: r.fail }; });
check(BG, "a request that timed out says the restaurant's system isn't answering — not the number, not the phone", HOW, async () => { const r = await tryUnban(() => pgErr("57014", "canceling statement due to statement timeout")); return { ok: /isn.t answering right now/.test(r.fail || "") && !/match|offline|connection/.test(r.fail), note: r.fail }; });
check(BG, "a request that died because the phone has no signal says the phone seems offline", HOW, async () => { const r = await tryUnban(() => "abort"); return { ok: /phone seems to be offline/.test(r.fail || ""), note: r.fail }; });
check(BG, "any other failure is 'not sent, try again' — blaming neither the number nor the connection", HOW, async () => { const r = await tryUnban(() => pgErr("XX000", "internal error")); return { ok: /couldn.t send that just now/.test(r.fail || "") && !/match|connection|internet/.test(r.fail), note: r.fail }; });
check(BG, "a request the server took says so, replaces the form, and sent the number trimmed, for THIS restaurant", HOW, async () => {
  const r = await tryUnban(() => json({ ok: true, recorded: 1 })); const a = r.sent[0] && r.sent[0].args;
  return { ok: /request has been sent/.test(r.done || "") && !!a && a.p_phone === "98765 43210" && a.p_restaurant_id === FH_ID, note: JSON.stringify(a) };
});
check(BG, "while a request is on its way the button says 'Sending…' and a second tap sends nothing more", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned(), lfh_request_unban: async () => { await new Promise((r) => setTimeout(r, 900)); return json({ ok: true }); } } }, async (L) => {
  await L.wait(500); await L.page.fill(".ban-input", "9876543210"); await L.page.click(".ban-btn"); await L.wait(150);
  const label = await L.page.$eval(".ban-btn", (b) => `${b.textContent}|${b.disabled}`); await L.page.$eval(".ban-btn", (b) => b.click()); await L.wait(1100);
  return { ok: label === "Sending…|true" && calls(L, "lfh_request_unban").length === 1, note: label };
}));
check(BG, "trying again after a failure clears the old sentence while the new request is on its way", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => banned(), lfh_request_unban: async (a, n) => { if (n === 1) return json({ ok: false, reason: "not_blocked" }); await new Promise((r) => setTimeout(r, 700)); return json({ ok: true }); } } }, async (L) => {
  await L.wait(500); await L.page.fill(".ban-input", "9876543210"); await L.page.click(".ban-btn"); await L.wait(400); const first = await L.text(".ban-fail");
  await L.page.click(".ban-btn"); await L.wait(150); const during = await L.text(".ban-fail");
  return { ok: /match/.test(first || "") && during === null, note: `${first} → ${during}` };
}));
check(BG, "a ban check that FAILED shows no wall — a normal guest is never walled by a database blip", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => pgErr("57014", "timeout") } }, async (L) => { await L.wait(600); return !(await L.page.$(".ban-overlay")); }));
check(BG, "coming back to the tab asks again once — visibility and focus together are ONE ask, a later focus is another", HOW, () => with_({ mount: ["ban"], clock: true }, async (L) => {
  await L.clock.runFor(800); const n0 = calls(L, "lfh_check_ban").length; await L.clock.runFor(2500);
  await L.page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); }); await L.clock.runFor(300); await L.wait(100);
  const n1 = calls(L, "lfh_check_ban").length; await L.clock.runFor(2500); await L.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await L.clock.runFor(300); await L.wait(100);
  const n2 = calls(L, "lfh_check_ban").length; return { ok: n0 === 1 && n1 === 2 && n2 === 3, note: `${n0} → ${n1} → ${n2}` };
}));
check(BG, "…a tab that is hidden never asks", HOW, () => with_({ mount: ["ban"], clock: true }, async (L) => {
  await L.clock.runFor(3000); await L.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await L.clock.runFor(300); await L.wait(100);
  return { ok: calls(L, "lfh_check_ban").length === 1 };
}));
check(BG, "…and the moment staff unblock the device, its next look lifts the wall", HOW, () => with_({ mount: ["ban"], clock: true, rpc: { lfh_check_ban: (a, n) => (n === 1 ? banned() : json({ ok: true, banned: false })) } }, async (L) => {
  await L.clock.runFor(800); const up = !!(await L.page.$(".ban-overlay")); await L.clock.runFor(2500); await L.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await L.clock.runFor(400); await L.wait(150);
  return { ok: up && !(await L.page.$(".ban-overlay")), note: `wall ${up}` };
}));
check(BG, "…and once the wall is gone from the page, returning to the tab asks nothing more", HOW, () => with_({ mount: ["ban"], clock: true }, async (L) => {
  await L.clock.runFor(800); await L.unmount(); await L.clock.runFor(3000); await L.page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); }); await L.clock.runFor(300); await L.wait(100);
  return { ok: calls(L, "lfh_check_ban").length === 1 };
}));

// ── lib/restaurant-context.tsx ───────────────────────────────────────────────────────────────────
const C = FILES.ctx;
const ctxOf = (L) => L.page.evaluate(() => JSON.parse(document.getElementById("lab-ctx").textContent));
check(C, "French House's own address is restaurant #1 and settled at once, with no lookup", HOW, () => with_({ mount: ["ctx"] }, async (L) => {
  await L.wait(300); const c = await ctxOf(L); return { ok: c.id === FH_ID && c.hookId === FH_ID && c.ready === true && c.slug === "french-house" && calls(L, "lfh_guest_restaurant").length === 0, note: JSON.stringify(c) };
}));
check(C, "the bare /menu address is restaurant #1 by definition, settled from the first moment", HOW, () => with_({ mount: ["ctx"], path: "/menu" }, async (L) => {
  const c = await ctxOf(L); return { ok: c.id === FH_ID && c.ready === true && calls(L, "lfh_guest_restaurant").length === 0, note: JSON.stringify(c) };
}));
check(C, "another restaurant's address is looked up by its slug, and settles on ITS id and name", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: lookup({ "sakura-sushi": SAK }) } }, async (L) => {
  await L.wait(500); const c = await ctxOf(L); const q = calls(L, "lfh_guest_restaurant");
  return { ok: c.id === SAK.id && c.hookId === SAK.id && c.name === "Sakura Sushi" && c.ready && q.length === 1 && q[0].args.p_slug === "sakura-sushi", note: JSON.stringify(c) };
}));
check(C, "…an address typed in capitals is the same restaurant (the slug is folded before the lookup)", HOW, () => with_({ mount: ["ctx"], path: "/r/Sakura-SUSHI/menu", rpc: { lfh_guest_restaurant: lookup({ "sakura-sushi": SAK }) } }, async (L) => {
  await L.wait(500); const c = await ctxOf(L); return { ok: c.id === SAK.id && c.slug === "sakura-sushi", note: JSON.stringify(c) };
}));
check(C, "…a restaurant with no display name settles with name null, never 'undefined'", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: lookup({ "sakura-sushi": { ...SAK, name: "" } }) } }, async (L) => {
  await L.wait(500); const c = await ctxOf(L); return { ok: c.id === SAK.id && c.name === null && c.ready, note: JSON.stringify(c) };
}));
check(C, "while the lookup is on its way, the hook every widget reads answers '' — nothing acts on a guess", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", rpc: { lfh_guest_restaurant: async () => { await new Promise((r) => setTimeout(r, 1200)); return json(SAK); } } }, async (L) => {
  await L.wait(300); const c = await ctxOf(L); return { ok: c.hookId === "" && c.ready === false, note: JSON.stringify(c) };
}));
check(C, "a slug NOBODY owns is no restaurant at all — no id, never ready, never restaurant #1 (round 2 fix)", HOW, () => with_({ mount: ["ctx"], path: "/r/nobody-owns-this/menu", rpc: { lfh_guest_restaurant: () => json(null) } }, async (L) => {
  await L.wait(600); const c = await ctxOf(L); return { ok: c.id === "" && c.hookId === "" && c.ready === false && c.id !== FH_ID, note: JSON.stringify(c) };
}));
check(C, "a lookup that FAILED is 'we do not know' — no id, not ready — and the diner is told once, in words", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", clock: true, rpc: { lfh_guest_restaurant: () => pgErr("57014", "timeout") } }, async (L) => {
  await L.clock.runFor(800); await L.wait(100); const c = await ctxOf(L); const t = (await L.toasts()).map((x) => x.message);
  return { ok: c.id === "" && c.ready === false && t.length === 1 && t[0] === "We couldn't load this restaurant", note: `${JSON.stringify(c)} · ${t.join(" / ")}` };
}));
check(C, "…it tries again by itself, and a later answer settles the page — still told only once", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", clock: true, rpc: { lfh_guest_restaurant: (a, n) => (n === 1 ? pgErr("57014", "timeout") : json(SAK)) } }, async (L) => {
  await L.clock.runFor(800); await L.clock.runFor(3000); await L.wait(150); const c = await ctxOf(L);
  return { ok: c.id === SAK.id && c.ready && calls(L, "lfh_guest_restaurant").length === 2 && (await L.toasts()).length === 1, note: JSON.stringify(c) };
}));
check(C, "…and after four more failures (about a minute) it stops and says plainly to reload or ask staff", HOW, () => with_({ mount: ["ctx"], path: "/r/sakura-sushi/menu", clock: true, rpc: { lfh_guest_restaurant: () => pgErr("57014", "timeout") } }, async (L) => {
  for (let i = 0; i < 8; i++) { await L.clock.runFor(10000); await L.wait(40); }
  const n = calls(L, "lfh_guest_restaurant").length; const t = (await L.toasts()).map((x) => x.message); await L.clock.runFor(60000); await L.wait(50);
  return { ok: n === 5 && t.length === 2 && t[1] === "Still can't load this restaurant" && calls(L, "lfh_guest_restaurant").length === 5, note: `${n} asks · ${t.join(" / ")}` };
}));
