// Block K, part B — screen-lab checks for deliberate breaks that survived the first pass (sweep #10 T4 round 2).
import { check, FILES } from "../lib.mjs";
import { openLab, json, pgErr } from "./page.mjs";
import { HOW } from "./how.mjs";
const with_ = async (o, fn) => { const L = await openLab(o); try { return await fn(L); } finally { await L.close(); } };
const calls = (L, fn) => L.log.filter((x) => x.fn === fn);
const SK = "lfh_session:french-house";
const until = async (L, pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await L.wait(60); } return false; };

// ── BanGate ──────────────────────────────────────────────────────────────────────────────────────
check(FILES.ban, "a normal guest never sees the ban wall — not even for a moment while the check is on its way", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: async () => { await new Promise((r) => setTimeout(r, 600)); return json({ ok: true, banned: false }); } },
  init: { fn: () => { window.__wallSeen = false; new MutationObserver(() => { if (document.querySelector(".ban-overlay")) window.__wallSeen = true; }).observe(document, { subtree: true, childList: true }); }, arg: null } }, async (L) => {
  await L.wait(1200); return { ok: (await L.page.evaluate(() => window.__wallSeen)) === false && calls(L, "lfh_check_ban").length === 1 };
}));
check(FILES.ban, "a number of exactly 5 characters is enough to send (the shortest the wall accepts)", HOW, () => with_({ mount: ["ban"], rpc: { lfh_check_ban: () => json({ ok: true, banned: true, reason: null, unban_requested: false }), lfh_request_unban: () => json({ ok: true }) } }, async (L) => {
  await L.wait(500); await L.page.fill(".ban-input", "12345"); await L.page.click(".ban-btn"); await L.wait(500);
  return { ok: calls(L, "lfh_request_unban").length === 1 && calls(L, "lfh_request_unban")[0].args.p_phone === "12345" };
}));

// ── SessionCartSync ──────────────────────────────────────────────────────────────────────────────
const GUEST = { table: "7", token: "tok-guest", memberId: "m", role: "guest" };
const L1 = { id: "a", sig: "[]", qty: 1, title: "Latte" }, L2 = { id: "b", sig: "[]", qty: 1, title: "Tea" };
check(FILES.cartSync, "a change the table ACCEPTS without sending a basket back leaves this phone's basket exactly as the diner made it", HOW, () => with_({ mount: ["cartSync"], storage: { [SK]: GUEST },
  rpc: { lfh_get_cart: () => json({ ok: true, open: true, approved: true, cart: [L1], cart_updated_at: "t" }), lfh_merge_cart: () => json({ ok: true }) } }, async (L) => {
  await until(L, async () => calls(L, "lfh_get_cart").length >= 1); await L.wait(300);
  await L.page.evaluate((v) => { localStorage.setItem("lfh_cart:french-house", JSON.stringify(v)); window.dispatchEvent(new Event("lfh:cart-updated")); }, [L1, L2]);
  await until(L, async () => calls(L, "lfh_merge_cart").length >= 1); await L.wait(300); const local = await L.lsJSON("lfh_cart:french-house");
  return { ok: Array.isArray(local) && local.map((l) => l.id).join() === "a,b", note: JSON.stringify(local) };
}));
check(FILES.cartSync, "a basket screen that goes away while the table's basket is still being read writes and sends nothing when the answer lands", HOW, () => with_({ mount: ["cartSync"], storage: { [SK]: GUEST, "lfh_cart:french-house": [L1] },
  rpc: { lfh_get_cart: async () => { await new Promise((r) => setTimeout(r, 700)); return json({ ok: true, open: true, approved: true, cart: [L2], cart_updated_at: "t" }); }, lfh_set_cart: () => json({ ok: true }) } }, async (L) => {
  await until(L, async () => calls(L, "lfh_get_cart").length >= 1); await L.unmount(); await L.wait(1200);
  return { ok: calls(L, "lfh_set_cart").length === 0 && (await L.lsJSON("lfh_cart:french-house")).map((l) => l.id).join() === "a", note: JSON.stringify(await L.lsJSON("lfh_cart:french-house")) };
}));

// ── SessionOwner ─────────────────────────────────────────────────────────────────────────────────
const HEAD = { table: "7", token: "tok-head", memberId: "m-head", role: "owner" };
const pend = () => json({ ok: true, session: { id: "s1", table_number: "7", status: "open" }, member: { role: "owner", approved: true }, pending: [{ id: "m-mia", name: "Mia" }], members: [{}, {}] });
const ownerLab = (rpc) => ({ mount: ["owner"], storage: { [SK]: HEAD }, rpc: { lfh_session_state: pend, ...rpc } });
for (const [btn, fn] of [["Let them in", "lfh_approve_member"], ["Not them", "lfh_remove_member"], ["Let anyone join automatically", "lfh_set_auto_approve"]]) {
  check(FILES.owner, `after '${btn}' fails, the head can try again — the buttons come back`, HOW, () => with_(ownerLab({ [fn]: () => pgErr("57014", "canceling statement due to statement timeout"), lfh_approve_member: fn === "lfh_approve_member" ? () => pgErr("57014", "canceling statement due to statement timeout") : () => json({ ok: true }) }), async (L) => {
    await until(L, async () => !!(await L.page.$(".sg-box"))); await L.page.click(`text=${btn}`); await until(L, async () => calls(L, fn).length >= 1); await L.wait(400);
    const on = await L.page.$$eval(".sg-box .sg-btn, .sg-box .sg-link", (b) => b.every((x) => !x.disabled)); await L.page.click(`text=${btn}`); await L.wait(500);
    return { ok: on && calls(L, fn).length === 2, note: `${calls(L, fn).length} tries` };
  }));
}
for (const [btn, fn] of [["Not them", "lfh_remove_member"], ["Let anyone join automatically", "lfh_set_auto_approve"]]) {
  check(FILES.owner, `two quick taps on '${btn}' send it ONCE`, HOW, () => with_(ownerLab({ [fn]: async () => { await new Promise((r) => setTimeout(r, 800)); return json({ ok: true }); }, lfh_approve_member: () => json({ ok: true }) }), async (L) => {
    await until(L, async () => !!(await L.page.$(".sg-box"))); await L.page.click(`text=${btn}`); await L.wait(120); await L.page.click(`text=${btn}`, { force: true, timeout: 1500 }).catch(() => null); await L.wait(1200);
    return { ok: calls(L, fn).length === 1, note: `${calls(L, fn).length} sends` };
  }));
}

// ── SessionStatusWidget ──────────────────────────────────────────────────────────────────────────
const cardLab = (state, rpc = {}) => ({ mount: ["card"], storage: { [SK]: GUEST, lfh_sess_widget_collapsed: "0" }, rpc: { lfh_session_state: state, ...rpc } });
const meal = (minsAgo) => () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [{ status: "preparing" }], orders: [{ created_at: new Date(Date.now() - minsAgo * 60000).toISOString() }] });
check(FILES.card, "the 90-minute line is exact: an order 89½ minutes old still holds the diner, one 90½ minutes old no longer does", HOW, async () => {
  const r = async (m) => with_(cardLab(meal(m)), async (L) => { await until(L, async () => !!(await L.page.$("text=Leave / own cart"))); await L.page.click("text=Leave / own cart"); await L.wait(200); return !!(await L.page.$(".popup.active")); });
  const a = await r(89.5), b = await r(90.5); return { ok: a === true && b === false, note: `89½ → ${a ? "held" : "free"}, 90½ → ${b ? "held" : "free"}` };
});
check(FILES.card, "two quick taps on 'Yes, leave' tell the restaurant ONCE", HOW, () => with_(cardLab(() => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [] }), { lfh_leave_session: async () => { await new Promise((r) => setTimeout(r, 800)); return json({ ok: true }); } }), async (L) => {
  await until(L, async () => !!(await L.page.$("text=Leave / own cart"))); await L.page.click("text=Leave / own cart"); await L.page.$eval("button.ssw-btn.danger", (b) => b.click()); await L.wait(80); await L.page.$eval("button.ssw-btn.danger", (b) => b.click()).catch(() => null); await L.wait(1200);
  return { ok: calls(L, "lfh_leave_session").length === 1, note: `${calls(L, "lfh_leave_session").length}` };
}));
check(FILES.card, "two quick taps on 'Change table' tell the restaurant ONCE", HOW, () => with_({ ...cardLab(() => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [] }), { lfh_leave_session: async () => { await new Promise((r) => setTimeout(r, 800)); return json({ ok: true }); } }), holdNav: true }, async (L) => {
  await until(L, async () => !!(await L.page.$("text=Change table"))); await L.page.$eval("text=Change table", (b) => b.click()); await L.wait(80); await L.page.$eval("text=Change table", (b) => b.click()).catch(() => null); await L.wait(1200);
  return { ok: calls(L, "lfh_leave_session").length === 1, note: `${calls(L, "lfh_leave_session").length}` };
}));
check(FILES.card, "a tap on the folded bubble that wobbles a few pixels is still a TAP — it opens the card, and moves nothing", HOW, () => with_({ ...cardLab(() => json({ ok: true, session: { table_number: "7", status: "open" }, member: { role: "guest", approved: true }, members: [{}], calls: [], items: [], orders: [] })), clock: true }, async (L) => {
  await L.clock.runFor(4000); await L.wait(80); const b = await (await L.page.$(".ssw-bubble")).boundingBox();
  await L.page.mouse.move(b.x + 10, b.y + 10); await L.page.mouse.down(); await L.page.mouse.move(b.x + 13, b.y + 12); await L.page.mouse.up(); await L.wait(120);
  return { ok: !!(await L.page.$(".ssw-card")) && (await L.ls("lfh_sess_widget_pos_v2")) === null };
}));

// ── SessionTableBill ─────────────────────────────────────────────────────────────────────────────
const billLab = (st) => ({ mount: ["tbill"], storage: { [SK]: GUEST }, rpc: { lfh_session_state: st } });
const S1 = (o = {}) => () => json({ ok: true, session: { table_number: "7", status: "open" }, member: { approved: true }, members: [{}], calls: [], items: [{ id: "i1", title: "Soup", qty: 1, status: "served", removed: [] }], ...o });
check(FILES.tbill, "a table with no open waiter call shows no 'Waiter called' line", HOW, () => with_(billLab(S1()), async (L) => { await until(L, async () => !!(await L.page.$(".stb-items"))); return !(await L.page.$(".stb-called")); }));
check(FILES.tbill, "a dish with an EMPTY left-out list shows no 'No …' line, and no table-wide left-out line", HOW, () => with_(billLab(S1()), async (L) => {
  await until(L, async () => !!(await L.page.$(".stb-items"))); return { ok: !(await L.page.$(".stb-item-removed")) && !(await L.page.$(".stb-exclusions")) };
}));
check(FILES.tbill, "the discount and the GST shown are the server's own amounts", HOW, () => with_(billLab(S1({ bill: { subtotal: 1000, discount: 100, tax: 45, total: 945 } })), async (L) => {
  await until(L, async () => !!(await L.page.$(".stb-bill"))); const rows = await L.page.$$eval(".stb-bill .bill-line", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const d = rows.find((r) => /^Discount/.test(r)) || "", g = rows.find((r) => /^GST/.test(r)) || "";
  return { ok: /100(\.00)?$/.test(d) && /45(\.00)?$/.test(g), note: `${d} | ${g}` };
}));
check(FILES.tbill, "'Try again' on the can't-reach message shows the loading shimmer while it asks", HOW, () => with_(billLab((a, n) => (n === 1 ? pgErr("57014", "canceling statement due to statement timeout") : "hang")), async (L) => {
  await until(L, async () => !!(await L.page.$("text=Try again"))); await L.page.click("text=Try again"); await L.wait(200);
  return { ok: !!(await L.page.$(".stb-loading")) && !(await L.page.$("text=Try again")) };
}));
