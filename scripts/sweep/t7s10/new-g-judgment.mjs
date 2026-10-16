// BLOCK G · from P176801 — JUDGMENT: is this how a real restaurant needs it to work? Each row is a
// question asked of the screen as it is today, answered from what was MEASURED or LOOKED AT (the
// block-D shots in .claude/sweep/shots/S10-T7/). A confusing label or a two-tap flow that should be
// one is not a fault — it is listed for the owner (Part 4) and the row says so.
import { check, panel, ev, APP, MINE } from "./lib.mjs";
import { WITH } from "./fixture.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176801;
const id = () => "P" + n++;
const sleep = (ms) => `await new Promise((f) => setTimeout(f, ${ms}));`;
const until = (cond, ms = 6000) => `await (async () => { const t0 = Date.now(); while (Date.now() - t0 < ${ms}) { if (${cond}) return true; await new Promise((f) => setTimeout(f, 80)); } return false; })();`;
const J = (what, how, fn) => check(id(), `${F} — ${what}`, how, fn);
const T30 = { t: 30, orders: [{ status: "preparing", items: [{ title: "Ratatouille", status: "preparing", price: 260 }] }, { status: "received", items: [{ title: "Crème Brûlée", status: "received", price: 180 }] }] };
const T28 = { t: 28, orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", status: "preparing", price: 320 }, { title: "French Onion Soup", status: "served", price: 240 }] }] };
const CART = `{ cart: [{ uid: 1, id: (state.data.items[0] || {}).id, title: (state.data.items[0] || {}).title, price: Number((state.data.items[0] || {}).price) || 100, qty: 2, note: 'less salt', avoid: ['dairy'] }, { uid: 2, id: (state.data.items[1] || {}).id, title: (state.data.items[1] || {}).title, price: Number((state.data.items[1] || {}).price) || 100, qty: 1, note: '', avoid: [] }], avoid: [], note: '', disc: 0 }`;

J("LOOKED AT popup-SamsungA35-light.png: can a waiter read and act on the bill popup on a phone?", "SHOT + judgment", () => ({ ok: true, note: "yes — dish lines, the amber waiting ticket with ✓ Accept / ✕ Cancel, the money line and five footer actions all fit one screen; ✎ Edit is back beside the view switch (item 1)" }));
J("LOOKED AT floor-SamsungA35-dark.png: does a 30-table floor read as one grid on a phone in the dark skin?", "SHOT + judgment", () => ({ ok: true, note: "yes — four a row, equal squares, the three busy tiles stand out by colour and ring; 3/30 · 2 PAY · 1 NY fits the header line with KOT ▾ and QO/P" }));
J("LOOKED AT auditcard-SamsungA35-light.png: is the story of a removal readable as evidence?", "SHOT + judgment", () => ({ ok: true, note: "yes — What / When (now the restaurant's own clock, item 3) / Who / Reason / Value removed, then the ticket and its lines; the 'no invoice was printed' sentence explains the missing bill number" }));
J("LOOKED AT billpreview-SamsungA35-light.png: does the bill preview say what the table owes?", "SHOT + judgment", () => ({ ok: true, note: "yes — 'not invoiced' chip, lines with ×qty, Subtotal ₹560 + Tax 5% ₹28 = Total due ₹588, Print and Close" }));
J("LOOKED AT dishes-SamsungA35-light.png: can a dish be edited on a phone?", "SHOT + judgment", () => ({ ok: true, note: "yes — tabs, search, category chips, a sideways dish strip, then the form with Save/Delete above it; the permanent ID is greyed and says 'Can't change later'" }));
J("LOOKED AT takeorder-SamsungA35-dark.png: on a phone, can the person SEE what is already in the order?", "SHOT + measured cart-rail height", async () => {
  const P = await panel({ fresh: true, viewport: { width: 360, height: 780 }, ctx: { deviceScaleFactor: 3, hasTouch: true, isMobile: true } });
  const r = await P.frame.evaluate(WITH(T28, `openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} ${sleep(400)} const foot = document.querySelector('.to-overlay .to-foot'); const ft = foot ? Math.round(foot.getBoundingClientRect().top) : 9999; const lines = [...document.querySelectorAll('.to-overlay .to-line')].map((l) => { const x = l.getBoundingClientRect(); return [Math.round(x.top), Math.round(x.bottom)]; }); const r = { footTop: ft, lines, hidden: lines.filter((l) => l[1] > ft).length }; document.querySelector('.to-overlay').remove(); return r;`));
  return { ok: true, note: `two cart lines at ${JSON.stringify(r.lines)}; the footer (total, − Discount, Send) starts at ${r.footTop}px, so ${r.hidden} of 2 lines sit partly under it until the sheet is scrolled — usable, but the order you are building is half hidden on a phone; listed in Part 4 as a judgment` };
});
J("does the money line under a table's bill ADD UP while a guest's ticket is still waiting?", "LIVE: the in-memory party with one waiting ticket", async () => {
  const g = await ev(WITH(T30, `return tablePanelParts(T).billSec.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();`));
  const nums = [...g.matchAll(/₹([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const foots = nums.length >= 3 && Math.abs(nums[0] + nums[1] - nums[nums.length - 1]) <= 1;
  return { ok: foots, note: `"${g}" — the sub and tax INCLUDE the waiting ticket, TOTAL DUE leaves it out (owner 2026-07-06), and Print bill / 💳 Mark all paid both take it in. Not a broken screen — a decision for the owner, Part 4` };
});
J("does 💳 Mark all paid settle a ticket the kitchen has not even accepted?", "SRC: markTablePaid's order filter", () => {
  const i = APP.indexOf("async function markTablePaid(");
  const body = APP.slice(i, i + 1200);
  const includesWaiting = /const os = partyOrders\(t\)\.filter\(\(o\) => o\.status !== "cancelled" && o\.payment_status !== "paid"\);/.test(body);
  return { ok: !includesWaiting, note: includesWaiting ? "yes — it settles every unpaid ticket including one still waiting in the amber box (that is how item 2's paid-but-waiting ticket arises). Listed in Part 4 for the owner to rule on — not changed" : "no" };
});
J("is a refused order easy to put right? (sold out → the builder comes back holding the order)", "LIVE (block C P176328–P176333)", () => ({ ok: true, note: "yes — the order comes back whole with the dish named, and since item 9 the kitchen note is visible too" }));
J("is 'NY' on the floor header understandable? ('Needs you')", "SRC + the owner's own words in the code", () => ({ ok: /you can just keep NY\s*(\/\/)?\s*when you over it/.test(APP), note: "the owner chose the short label himself ('you can just keep NY…'); the full words are in the tooltip and the sheet heading. Not re-raised." }));
J("is the 32px footer on the phone's table popup big enough to tap?", "LIVE (rerun P02370) + the Spine design note", () => ({ ok: true, note: "the five actions measure 32px tall on an A35 — under the panel's own 44px floor, chosen on purpose for the one-bill popup (2026-09-17, 'every pixel of head is a dish'). Usable; listed as a judgment only, not a fault" }));
J("on the A35 the busy tile shows only '＋' — is that clear enough?", "LIVE (rerun P02364) + R31", () => ({ ok: true, note: "with six tables a row the tile is ~55px and the ladder shows the bare ＋ — exactly what the owner ruled (R31: 'just a plus icon, nothing else'). Not re-raised." }));
J("does the ✎ Edit button now appear only where it does something?", "LIVE (rerun P99277 + block C)", async () => {
  const g = await ev(WITH(T28, `return /data-edit-table/.test(JSON.stringify(tablePanelParts(T)));`));
  const h = await ev(WITH(T30, `return /data-edit-table/.test(JSON.stringify(tablePanelParts(T)));`));
  return { ok: g === false && h === true, note: `no waiting ticket → no Edit (${g}); a waiting ticket → Edit (${h}) — item 1` };
});
J("would a manager understand 'not on the bill yet' on a waiting ticket?", "SHOT popup + the money line", () => ({ ok: true, note: "the words are right for the ticket itself; what reads oddly is the money line under it (row above) — Part 4" }));
J("a guest call with a note the panel does not know shows 🙋 here and 🔔 on the waiter's tablet — does that matter?", "SRC (block F)", () => ({ ok: true, note: "the six named calls agree; only an unknown note differs. Harmless, listed as a tidy-up in Part 4" }));
J("a dish named only in Hindi gets no web address (slug) until one is typed — is that clear?", "LIVE (block B slugifyKey)", () => ({ ok: true, note: "Save says 'Slug is required' and the Slug box is right there; rare (dish names are usually entered in English first). Not raised" }));
J("two unused helpers (unblock, openTablePanel) remain from replaced screens — does the owner's 'new way replaces the old' rule want them gone?", "SRC (block E P176641)", () => ({ ok: true, note: "yes by his rule, but nothing breaks with them there — listed in Part 4 as a 5-minute tidy-up" }));
J("the floor header counts, the floor and the tablet now agree on an off-plan open table (item 10) — anything else off-plan?", "LIVE (block B floorTableList) + guard T", () => ({ ok: true, note: "free strays, cooking tables above the plan and merged tables all agree between the two floors (six cases)" }));
J("does the Audit list still answer 'what was removed today, by whom, why' at a glance?", "SHOT audit-SamsungA35-light.png", () => ({ ok: true, note: "yes — type chips, sort, a search box, each row: icon, what, table, reason, person, time (restaurant's clock since item 3), value" }));
J("does the bell sit in the top bar on every tab (not only the floor)?", "SRC renderEditor + SHOTs", () => ({ ok: /setTimeout\(syncGuestBell, 0\);/.test(APP), note: "yes — synced first thing on every render; visible in every phone shot" }));
J("is anything in my third asking a second 'are you sure?' where one tap was asked for?", "SRC (block E) + owner 2026-07-31", () => ({ ok: true, note: "no — Send to kitchen has no confirm; only Delete, Kick, Ban and the duplicate-order case ask, each a real question" }));
J("would I have built the take-order hand-back differently?", "judgment", () => ({ ok: true, note: "no — closing at once and handing the order back on refusal is right for a rush; the one gap (the hidden note) is fixed as item 9" }));
J("would I have built the one-bill popup differently?", "judgment", () => ({ ok: true, note: "the shape is right; the two things worth his decision are the money line with a waiting ticket and 'Mark all paid' taking that ticket in (Part 4)" }));
J("is there any screen in my third that a second restaurant would see wrongly branded?", "SHOTs (French House name in every top bar) + SRC", () => ({ ok: !/Little French House|French House/.test(MINE.replace(/\/\/[^\n]*/g, "")), note: "no restaurant name is written into my third's code; the top bar reads the restaurant's own name from its settings" }));
J("the old sweeps' T5 rows on this screen asked for 36px footer buttons — is it right to re-judge them to 32px?", "judgment", () => ({ ok: true, note: "yes — the owner chose the compact one-bill popup after those rows were written; the rows now say so instead of going red forever" }));
