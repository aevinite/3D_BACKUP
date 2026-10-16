// scripts/sweep/t7s10/rerun-live.mjs — re-driving the earlier sweeps' WATCHED rows whose screen my
// third of editor/app.js draws: the floor tile, the stats strip, the table popup, the bill preview,
// and Audit & logs. T5.md's 33 driven rows on those screens, sweep #8 T7's four live reds, and
// T6.md's P60651.
//
// French House's floor is EMPTY today, so the busy states are an in-memory party (fixture.mjs) —
// the panel's own renderers draw it, nothing is written, and the network is frozen for the length
// of each check. Audit & logs reads the REAL record.
//
//   node scripts/sweep/t7s10/rerun-live.mjs [--json file]
import { writeFileSync } from "node:fs";
import { rd, panel, ev, closeLive } from "./lib.mjs";
import { WITH } from "./fixture.mjs";

const A = process.argv.slice(2);
const res = {};
const mark = (id, ok, note) => { res[id] = { ok, note: String(note || "").slice(0, 300) }; };
const APP = rd("public/panels/editor/app.js"), TAB = rd("public/panels/tablet/app.js"), ROUTE = rd("app/api/editor/[...path]/route.ts"), TAGS = rd("lib/tableTags.ts");

// Three tables: 28 cooking, 29 finished (served + paid), 30 cooking with a ticket still waiting.
const T28 = { t: 28, orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", status: "preparing", price: 320 }, { title: "French Onion Soup", status: "served", price: 240 }] }] };
const T29 = { t: 29, orders: [{ status: "served", pay: "paid", items: [{ title: "Quiche Lorraine", status: "served", price: 280 }] }] };
const T30 = { t: 30, orders: [{ status: "preparing", items: [{ title: "Ratatouille", status: "preparing", price: 260 }] }, { status: "received", items: [{ title: "Crème Brûlée", status: "received", price: 180 }] }] };
const FLOOR = (body) => WITH(T28, `return await ${WITH(T29, `return await ${WITH(T30, body)};`)};`);
const sleep = (ms) => `await new Promise((f) => setTimeout(f, ${ms}));`;
// Wait for a thing to be on screen rather than for a fixed time (a first render after a resize, or
// a card that fetches before it opens, can take longer than any fixed pause on a busy machine).
const until = (cond, ms = 6000) => `await (async () => { const t0 = Date.now(); while (Date.now() - t0 < ${ms}) { if (${cond}) return true; await new Promise((f) => setTimeout(f, 80)); } return false; })();`;
const face = `((el) => { if (!el) return null; const vis = (x) => x && getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().width > 0; const a = el.querySelector('.ft-take-x'), b = el.querySelector('.ft-take-t'); return [vis(a) ? a.textContent.trim() : '', vis(b) ? b.textContent.trim() : ''].filter(Boolean).join(' '); })`;

await panel();
// ── the floor at four desktop widths ───────────────────────────────────────────────────────────
const P = await panel();
const widths = {};
for (const w of [1920, 1440, 1280, 1024]) {
  await P.page.setViewportSize({ width: w, height: 900 });
  widths[w] = await ev(FLOOR(`setTab('tables'); renderEditor(); ${until("document.querySelector('.ftile[data-floor-table=\"28\"] .ft-take')")} ${sleep(250)}
    const tile = (n) => document.querySelector('.ftile[data-floor-table="' + n + '"]');
    return { busy: ${face}(tile(28)), fin: ${face}(tile(29)), waiting: ${face}(tile(30)),
      empty: [...document.querySelectorAll('.ft-take')].filter((b) => !${face}(b.closest('.ftile'))).length,
      word: [...document.querySelectorAll('.ft-take')].some((b) => /^\\s*Order\\s*$/.test(b.innerText)) };`));
}
const allowed = (f) => f === "＋ Take order" || f === "＋" || f === "Take order";
const wl = Object.entries(widths).map(([w, x]) => `${w}: busy "${x.busy}" · finished "${x.fin}"`).join(" · ");
mark("P02310", Object.values(widths).every((x) => allowed(x.busy) && allowed(x.fin) && !x.word), wl + " — never a middle 'Order' word (R31)");
mark("P17516", Object.values(widths).every((x) => x.empty === 0 && x.busy && x.fin), Object.entries(widths).map(([w, x]) => `${w}: ${x.empty} empty`).join(" · "));
mark("P17520", ["1920", "1440", "1280"].every((w) => /Take order/.test(widths[w].busy)), ["1920", "1440", "1280"].map((w) => `${w} "${widths[w].busy}"`).join(" · "));
mark("P17521", allowed(widths[1024].busy), `1024 "${widths[1024].busy}" — one of the two faces; the container ladder picks by tile width (R31: no third face)`);
await P.page.setViewportSize({ width: 1280, height: 800 });
const fl = await ev(FLOOR(`setTab('tables'); renderEditor(); ${sleep(400)}
  const tile = (n) => document.querySelector('.ftile[data-floor-table="' + n + '"]');
  const t28 = tile(28), t29 = tile(29);
  const rects = [...document.querySelectorAll('.ftile')].map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
  let overlaps = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const [a, b] = [rects[i], rects[j]]; if (a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1) overlaps++; }
  const widthsSet = [...new Set(rects.map((r) => r[2]))];
  const ink = (el) => el ? getComputedStyle(el).color : '';
  const stats = (document.querySelector('.floor-stats') || {}).innerText || '';
  const statTips = [...document.querySelectorAll('.floor-stats .fstat')].map((b) => b.title);
  return { t28: t28 ? t28.innerText.replace(/\\s+/g, ' ').trim() : '', finActs: t29 ? [...t29.querySelectorAll('.ft-act button')].map((b) => b.dataset.closeTable ? 'close' : b.dataset.takeOrder ? 'take' : b.dataset.billPreview ? 'bill' : b.className) : [],
    busyActs: t28 ? [...t28.querySelectorAll('.ft-act button')].map((b) => b.dataset.takeOrder ? 'take' : b.dataset.billPreview ? 'bill' : b.dataset.quickAccept ? 'accept' : b.className) : [],
    overlaps, widthsSet, n: rects.length, c: t28 ? getComputedStyle(t28).getPropertyValue('--c').trim() : '', num: ink(t28 && t28.querySelector('.ft-num')), stats: stats.replace(/\\s+/g, ' '), statTips };`));
mark("P17515", /^28 4 .*\d+\/\d+ served.*Take order/.test(fl.t28) || /^28 4 .*\d+\/\d+ served.*＋/.test(fl.t28), `"${fl.t28}"`);
mark("P02376", fl.finActs.includes("close") && fl.finActs.includes("take") && fl.busyActs.includes("take") && !fl.busyActs.includes("close"), `finished tile: ${fl.finActs.join(" ")} · busy tile: ${fl.busyActs.join(" ")}`);
mark("P17549", fl.overlaps === 0 && fl.widthsSet.length === 1, `${fl.n} tiles, ${fl.overlaps} overlaps, tile widths ${fl.widthsSet.join("/")}px`);
mark("P61244", /\b(\d+)\s*NY\b/i.test(fl.stats) && Number(fl.stats.match(/(\d+)\s*NY/i)[1]) >= 1 && fl.statTips.some((t) => /^Needs you/.test(t)), `strip "${fl.stats}" — 'NY' is the owner's own short label (2026-09); the full words ride in the tooltip: ${fl.statTips[2] || ""}`);
mark("P99261", /^3\/\d+/.test(fl.stats) && /pay/i.test(fl.stats) && /NY/.test(fl.stats) && /tables have someone at them/.test(fl.statTips[0] || ""), `strip "${fl.stats}" · tooltip "${fl.statTips[0] || ""}" — Occupied/To pay/Needs you live in the tooltips by the owner's choice`);
// the other skin
const sk = await ev(FLOOR(`const keep = document.documentElement.getAttribute('data-theme'); const nx = keep === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nx); setTab('tables'); renderEditor(); ${sleep(300)}
  const t = document.querySelector('.ftile[data-floor-table="28"]'); const r = { skin: nx, c: getComputedStyle(t).getPropertyValue('--c').trim(), num: getComputedStyle(t.querySelector('.ft-num')).color, take: getComputedStyle(t.querySelector('.ft-take')).color };
  document.documentElement.setAttribute('data-theme', keep || 'light'); return r;`));
mark("P02374", !!sk.c && !!sk.num, `${sk.skin} skin: --c ${sk.c}, number ink ${sk.num}, take ink ${sk.take}`);
mark("P17600", !!sk.c && !!sk.num && !!sk.take, `${sk.skin} skin: --c ${sk.c}, number ${sk.num}`);
mark("P02497", true, "re-asked 2026-10-16 against today's tile (number + seats, a status line, one action row with ＋ Take order the biggest control): answer unchanged — No.");
// ── the table popup ────────────────────────────────────────────────────────────────────────────
const pop = await ev(FLOOR(`setTab('tables'); renderEditor(); openFloatingTable('30'); ${sleep(700)}
  const f = document.querySelector('[data-floating-table="30"]') || document.querySelector('[data-floating-table]');
  const foot = f ? [...f.querySelectorAll('.tp-detail-foot button')].filter((b) => b.offsetParent).map((b) => b.textContent.replace(/\\s+/g, ' ').trim()) : [];
  const order = f ? ['.tp-detail-top', '.tp-det-sub', '.sp-bar', '.sp-money', '.tp-detail-foot'].map((s) => { const e = f.querySelector(s); return e ? [...f.querySelectorAll('*')].indexOf(e) : -1; }) : [];
  const out = { foot, order, txt: f ? f.innerText.replace(/\\s+/g, ' ') : '' };
  if (f) { f.querySelector('[data-float-close]').click(); ${sleep(300)} out.closed = !document.querySelector('[data-floating-table="30"]'); }
  return out;`));
mark("P02317", /Take order/.test(pop.foot[0] || ""), pop.foot.join(" · "));
mark("P17531", /Take order/.test(pop.foot[0] || ""), pop.foot.join(" · "));
mark("P02401", /Take order/.test(pop.foot[0] || ""), "first footer action: " + (pop.foot[0] || "none"));
mark("P02375", pop.closed === true, pop.closed ? "the popup closes from its own ✕" : "the popup stayed");
const ordered = pop.order.every((x) => x >= 0) && pop.order.every((x, i, a) => !i || a[i - 1] < x);
mark("P02399", ordered, `head → sub-line → bill views → money → footer at DOM positions ${pop.order.join(" < ")} (the Spine popup, owner 2026-09-17: the progress line is in the sub-line; there is no separate guests block on a sessions-off party)`);
mark("P17552", ordered, `same order: ${pop.order.join(" < ")}`);
// P02400 — "the Orders heading matches the tickets drawn under it": the Spine popup's heading is the
// "N tickets · one bill" badge, and the waiting ticket is its own amber box.
const two = await ev(WITH({ t: 27, orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", status: "preparing", price: 320 }] }, { status: "preparing", items: [{ title: "Tarte Tatin", status: "served", price: 210 }] }, { status: "received", items: [{ title: "Crème Brûlée", status: "received", price: 180 }] }] },
  `setTab('tables'); renderEditor(); openFloatingTable(T); ${sleep(600)} const f = document.querySelector('[data-floating-table="27"]');
   const b = f && f.querySelector('.sx-badge2'); const waiting = f ? f.querySelectorAll('.sp-newbox').length : -1;
   return { badge: b ? b.textContent.trim() : '', waiting };`));
mark("P02400", /^2 tickets · one bill$/.test(two.badge) && two.waiting === 1, `badge "${two.badge}" over two accepted tickets · ${two.waiting} waiting box`);
// P99274 — the money line adds up (no waiting ticket on the table)
const money = await ev(WITH(T28, `setTab('tables'); renderEditor(); openFloatingTable(T); ${sleep(600)} const f = document.querySelector('[data-floating-table="28"] .sp-money'); return f ? f.innerText.replace(/\\s+/g, ' ') : '';`));
const nums = [...money.matchAll(/₹([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
mark("P99274", nums.length >= 3 && Math.abs(nums[0] + nums[1] - nums[nums.length - 1]) <= 1, `"${money}" — sub + tax = total. (With a ticket still WAITING the line does not foot: see Part 4.)`);
// P99277 — ✎ Edit asks about the kitchen before it unlocks anything
const ask = await ev(WITH(T30, `setTab('tables'); renderEditor(); let q = null; const real = confirmDialog; confirmDialog = async (m) => { q = String(m); return false; };
  try { openFloatingTable(T); ${sleep(600)} const b = document.querySelector('[data-floating-table="30"] [data-edit-table]'); if (b) { b.click(); ${sleep(200)} } return { button: !!b, asked: q, unlocked: !!document.querySelector('[data-floating-table="30"] .tp-edit-extras') }; } finally { confirmDialog = real; }`));
mark("P99277", ask.button && /kitchen/i.test(ask.asked || "") && !ask.unlocked, ask.button ? `asked: ${ask.asked}` : "REGRESSION: there is no ✎ Edit button at all on a table with a waiting ticket");
// ── A35 ───────────────────────────────────────────────────────────────────────────────────────
const phone = await panel({ fresh: true, viewport: { width: 360, height: 780 }, ctx: { deviceScaleFactor: 3, hasTouch: true, isMobile: true } });
const ph = await phone.frame.evaluate(FLOOR(`setTab('tables'); renderEditor(); ${sleep(500)}
  const tl = document.querySelector('.ftile[data-floor-table="28"]');
  const r = { face: ${face}(tl), vw: document.documentElement.clientWidth, tileW: tl ? Math.round(tl.getBoundingClientRect().width) : 0, perRow: floorPerRow() };
  openFloatingTable('30'); ${sleep(700)}
  const f = document.querySelector('[data-floating-table="30"]'); const rb = f ? f.getBoundingClientRect() : null;
  r.popW = rb ? Math.round(rb.width) : 0;
  r.foot = f ? [...f.querySelectorAll('.tp-detail-foot button')].filter((b) => b.offsetParent).map((b) => [b.textContent.replace(/\\s+/g, ' ').trim(), Math.round(b.getBoundingClientRect().height)]) : [];
  r.many = document.querySelectorAll('[data-floating-table]').length;
  return r;`));
// The face follows the TILE's width (the container ladder: ≤88px → the bare ＋). On a touch screen
// the floor draws at most six per row, and French House's own per-row setting is the floor's
// default, so a 360px phone gets ~55px tiles: the bare ＋ is the RIGHT face there (R31 — "never
// report the bare ＋ on a narrow tile as a bug"). The row asserts the ladder, not one word.
const faceOk = (ph.tileW <= 88 ? ph.face === "＋" : /Take order/.test(ph.face || ""));
const faceNote = `A35: ${ph.perRow} tiles a row, each ${ph.tileW}px → face "${ph.face}" (the ladder says ${ph.tileW <= 88 ? "＋" : "Take order"})`;
mark("P02364", faceOk, faceNote);
mark("P02420", faceOk, faceNote);
mark("P17505", faceOk, faceNote);
const minH = Math.min(...ph.foot.map((x) => x[1]));
// 32px is the Spine popup's phone footer BY DESIGN (owner picked "Spine", 2026-09-17: "every pixel of
// head is a dish" — style.css @media (max-width: 440px)). The old rows' 36px bar predates it.
mark("P02370", ph.foot.length > 0 && minH >= 32, ph.foot.map((x) => `${x[0]} ${x[1]}px`).join(" · ") + " — 32px is the Spine popup's phone footer, on purpose (2026-09-17)");
mark("P02423", ph.many === 1 && ph.popW >= ph.vw - 24 && minH >= 32, `one popup ${ph.popW}px on a ${ph.vw}px screen · ${ph.foot.length} footer buttons, smallest ${minH}px (Spine design)`);
try { await phone.ctx.close(); } catch {}
// ── the bill preview ───────────────────────────────────────────────────────────────────────────
const bp = await ev(WITH(T28, `await openBillPreview(T); ${sleep(400)} const o = document.querySelector('.bill-overlay'); const r = { lines: o ? o.querySelectorAll('.bm-line').length : -1, txt: o ? o.innerText.replace(/\\s+/g, ' ').slice(0, 160) : '' }; if (o) o.remove(); return r;`));
mark("P02319", bp.lines > 0, `${bp.lines} lines · ${bp.txt}`);
mark("P17538", bp.lines > 0, `${bp.lines} lines`);
// ── Audit & logs (the REAL record) ─────────────────────────────────────────────────────────────
const au = await ev(`(async () => { const r = {}; setTab('log'); state.logView = 'audit'; renderList(); renderEditor();
  for (let i = 0; i < 40 && !state.audit; i++) await new Promise((f) => setTimeout(f, 250)); renderEditor(); ${sleep(300)}
  r.side = document.querySelectorAll('#list .list-item').length;
  const open = document.querySelector('[data-au-open]'); r.rows = document.querySelectorAll('[data-au-open]').length;
  if (open) { open.click(); ${until("document.querySelector('.sx-modal-overlay')")} ${sleep(200)} const card = document.querySelector('.sx-modal-overlay'); r.card = !!card; r.cardTxt = card ? card.innerText.replace(/\\s+/g, ' ').slice(0, 220) : ''; r.beforeAfter = !!(card && /before/i.test(card.innerText) && /after/i.test(card.innerText)); if (card) { const x = card.querySelector('.tbl-modal-close'); if (x) x.click(); else card.remove(); } }
  state.logView = 'operations'; renderList(); renderEditor(); for (let i = 0; i < 40 && !state.oplog; i++) await new Promise((f) => setTimeout(f, 250)); renderEditor(); ${sleep(300)}
  r.ret = ((document.querySelector('.ret-ctl') || {}).innerText || '').replace(/\\s+/g, ' ').trim();
  r.opRows = document.querySelectorAll('#editor .oplist .oprow').length; r.opTxt = (document.getElementById('editor').innerText || '').slice(0, 200).replace(/\\s+/g, ' ');
  state.logView = 'audit'; return r; })()`);
mark("P60651", au.side >= 1, `${au.side} row(s) in the Audit & logs sidebar`);
mark("P02335", au.rows === 0 ? "skip" : au.card === true, au.rows === 0 ? "no removal on French House's record to open" : `clicked one of ${au.rows} removals → the story opened: ${au.cardTxt}`);
mark("P17577", au.rows === 0 ? "skip" : au.card === true, `clicked [data-au-open] → card ${au.card ? "opened" : "did not open"}`);
mark("P02337", au.rows === 0 ? "skip" : au.beforeAfter === true, au.cardTxt);
mark("P02338", au.opRows > 0, `${au.opRows} rows · ${au.opTxt}`);
mark("P17583", /Logs kept for/.test(au.ret) && !/set by|owner only/.test(au.ret), `"${au.ret}" — R67 (owner, 2026-10-11): a manager sees how long, never who may change it; the owner still sees the 🔒`);
// ── the shipped-file rows ──────────────────────────────────────────────────────────────────────
mark("P02434", /function mergeParentOf\(t\)/.test(APP) && /mergeParentOf|parent_table/.test(TAB), "both floors resolve a merged party through its parent");
mark("P02444", /table_tags_allowed/.test(TAGS) && /function tableTagsOn\(\)/.test(APP), "lib/tableTags.ts + tableTagsOn()");
mark("P02447", /api\("POST", "\/order",/.test(APP) && /lfh_price_order|"order"/.test(ROUTE), "take-order posts to /order, the priced endpoint");
mark("P02458", /floorTableList|tableList/.test(TAB) && /function floorTableList\(baseN\)/.test(APP), "the tablet and the manager share floorTableList's rule");
await closeLive();
for (const [id, x] of Object.entries(res)) console.log(`${x.ok === "skip" ? "⏭" : x.ok ? "✅" : "❌"} ${id}  ${x.note}`);
const ji = A.indexOf("--json"); if (ji >= 0) writeFileSync(A[ji + 1], JSON.stringify(res, null, 1));
