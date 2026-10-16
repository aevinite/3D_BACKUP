// BLOCK D · from P176401 — EVERY SCREEN MY THIRD DRAWS, RENDERED AND MEASURED, on a 1280 desktop, a
// Samsung A35 (360×780, dpr 3, touch) and an iPad (1194×834, touch), in the light skin on all three
// and the dark skin on the desktop and the phone. Two assertions per screen and size: nothing runs
// off the right edge (outside a deliberate scroll box), and no raw code value reaches the eye
// (undefined / NaN / [object Object] / ${). Every shot is written to .claude/sweep/shots/S10-T7/ and a
// sample is LOOKED AT (block G). Busy tables are an in-memory party; nothing is written.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { check, panel, ROOT } from "./lib.mjs";
import { WITH } from "./fixture.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176401;
const id = () => "P" + n++;
const DIR = join(ROOT, ".claude/sweep/shots/S10-T7");
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => `await new Promise((f) => setTimeout(f, ${ms}));`;
const until = (cond, ms = 6000) => `await (async () => { const t0 = Date.now(); while (Date.now() - t0 < ${ms}) { if (${cond}) return true; await new Promise((f) => setTimeout(f, 80)); } return false; })();`;
// What a screen must not show, measured on the RENDERED page (inside the panel frame).
const MEASURE = `(() => {
  const W = document.documentElement.clientWidth;
  const clipped = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) return true; } return false; };
  const off = [...document.querySelectorAll('body *')].filter((e) => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > W + 1 && !clipped(e); }).map((e) => (e.className && String(e.className).slice(0, 30)) || e.tagName);
  const txt = document.body.innerText;
  const bad = ['undefined', 'NaN', '[object Object]', '\${'].filter((s) => txt.includes(s));
  return { W, off: off.slice(0, 4), offN: off.length, bad };
})()`;
const T28 = { t: 28, orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", status: "preparing", price: 320 }, { title: "French Onion Soup", status: "served", price: 240 }] }] };
const T29 = { t: 29, orders: [{ status: "served", pay: "paid", items: [{ title: "Quiche Lorraine", status: "served", price: 280 }] }] };
const T30 = { t: 30, orders: [{ status: "preparing", items: [{ title: "Ratatouille", status: "preparing", price: 260 }] }, { status: "received", items: [{ title: "Crème Brûlée", status: "received", price: 180 }] }] };
const FLOOR = (body) => WITH(T28, `return await ${WITH(T29, `return await ${WITH(T30, body)};`)};`);
const CART = `{ cart: [{ uid: 1, id: (state.data.items[0] || {}).id, title: (state.data.items[0] || {}).title, price: Number((state.data.items[0] || {}).price) || 100, qty: 2, note: 'less salt', avoid: ['dairy'] }], avoid: ['nuts'], note: 'birthday', disc: 0 }`;
const SHOT = (name) => `const m = ${MEASURE}; await window.__t7shot(${JSON.stringify(name)}); `;
const clean = "document.querySelectorAll('.sx-modal-overlay, .bill-overlay, .confirm-overlay, .to-overlay, [data-floating-table]').forEach((x) => { try { x.__lfhClose ? x.__lfhClose() : x.remove(); } catch (e) { x.remove(); } });";
// name → [what the person sees, expression that draws it, SHOTs inside and returns m]
const SCREENS = [
  ["floor", "the live floor with three busy tables", FLOOR(`setTab('tables'); renderEditor(); ${until("document.querySelector('.ftile[data-floor-table=\"28\"]')")} ${sleep(400)} ${SHOT("floor")} return m;`)],
  ["popup", "a table's bill popup with a ticket still waiting", WITH({ ...T30, keepOpen: false }, `setTab('tables'); renderEditor(); openFloatingTable(T); ${until("document.querySelector('[data-floating-table]')")} ${sleep(600)} ${SHOT("popup")} ${clean} return m;`)],
  ["takeorder", "＋ Take order with two dishes in the cart", WITH(T28, `openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} ${sleep(500)} ${SHOT("takeorder")} ${clean} return m;`)],
  ["qop", "⚡ QO/P — the category cards", `(async () => { openTakeOrder(null, null, { quick: true }); ${until("document.querySelector('.to-overlay')")} ${sleep(500)} ${SHOT("qop")} ${clean} return m; })()`],
  ["billpreview", "a table's bill preview", WITH(T28, `const ke = ensurePartySlices; ensurePartySlices = async () => {}; try { await openBillPreview(T); ${sleep(400)} ${SHOT("billpreview")} ${clean} return m; } finally { ensurePartySlices = ke; }`)],
  ["dishedit", "a dish's allergens & kitchen-note sheet", WITH(T28, `openDishEditModal(state.board.items[0].id, null); ${until("document.querySelector('.dish-edit-overlay')")} ${sleep(300)} ${SHOT("dishedit")} ${clean} return m;`)],
  ["adddish", "the add-a-dish sheet", WITH(T28, `openAddDishModal(state.data.orders.find((x) => x.table_number === T).id, null); ${until("document.querySelector('.add-dish-overlay')")} ${sleep(300)} ${SHOT("adddish")} ${clean} return m;`)],
  ["statlist", "the sheet behind a floor number (tap '3/30')", FLOOR(`setTab('tables'); renderEditor(); ${sleep(300)} openFloorStatList('occupied'); ${until("document.querySelector('.fstat-overlay')")} ${sleep(300)} ${SHOT("statlist")} ${clean} return m;`)],
  ["reason", "the 'why are you removing this?' question", `(async () => { window.__q = askRemovalReason('this dish'); ${until("document.querySelector('.rr-overlay')")} ${sleep(300)} ${SHOT("reason")} ${clean} return m; })()`],
  ["audit", "Audit & logs → what was removed (the real record)", `(async () => { setTab('log'); state.logView = 'audit'; renderList(); renderEditor(); ${until("Array.isArray(state.audit)")} renderEditor(); ${sleep(400)} ${SHOT("audit")} return m; })()`],
  ["auditcard", "the story of one removal (the real record)", `(async () => { setTab('log'); state.logView = 'audit'; renderList(); renderEditor(); ${until("document.querySelector('[data-au-open]')")} const o = document.querySelector('[data-au-open]'); if (o) { o.click(); ${until("document.querySelector('.au-detail-overlay')")} ${sleep(300)} } ${SHOT("auditcard")} ${clean} return m; })()`],
  ["activity", "Audit & logs → the activity log (the real record)", `(async () => { setTab('log'); state.logView = 'operations'; renderList(); renderEditor(); ${until("document.querySelector('.oplist .oprow')")} ${sleep(400)} ${SHOT("activity")} state.logView = 'audit'; return m; })()`],
  ["dishes", "Menu → Dishes, the first dish open", `(async () => { setTab('items'); renderList(); const d = (state.data.items || [])[0]; state.sel = JSON.parse(JSON.stringify(d)); state.selPristine = JSON.stringify(d); state.isNew = false; renderEditor(); ${sleep(500)} ${SHOT("dishes")} return m; })()`],
  ["categories", "Menu → Categories, the first one open", `(async () => { setTab('categories'); renderList(); const d = (state.data.categories || [])[0]; state.sel = JSON.parse(JSON.stringify(d)); state.selPristine = JSON.stringify(d); state.isNew = false; renderEditor(); ${sleep(500)} ${SHOT("categories")} setTab('tables'); return m; })()`],
];
const SIZES = [
  ["desktop 1280", { width: 1280, height: 800 }, {}, "light"],
  ["Samsung A35", { width: 360, height: 780 }, { deviceScaleFactor: 3, hasTouch: true, isMobile: true }, "light"],
  ["iPad", { width: 1194, height: 834 }, { hasTouch: true }, "light"],
  ["desktop 1280", { width: 1280, height: 800 }, {}, "dark"],
  ["Samsung A35", { width: 360, height: 780 }, { deviceScaleFactor: 3, hasTouch: true, isMobile: true }, "dark"],
];
const cache = new Map();
async function measure(si, screen) {
  const key = si + ":" + screen[0];
  if (cache.has(key)) return cache.get(key);
  const [label, vp, ctx, skin] = SIZES[si];
  // One browser page per size+skin, reused for every screen at that size.
  const pk = "page:" + si;
  if (!cache.has(pk)) {
    const P = await panel({ fresh: true, viewport: vp, ctx });
    await P.page.exposeFunction("__t7shot", async (name) => { await P.page.screenshot({ path: join(DIR, `${name}-${label.replace(/\W+/g, "")}-${skin}.png`) }); return true; });
    await P.frame.evaluate(`(() => { try { localStorage.setItem('lfh_panel_theme', '${skin}'); } catch {} document.documentElement.setAttribute('data-theme', '${skin}'); })()`);
    cache.set(pk, P);
  }
  const P = cache.get(pk);
  let r;
  try { r = await P.frame.evaluate(screen[2]); } catch (e) { r = { error: e.message.slice(0, 120) }; }
  cache.set(key, r);
  return r;
}
SIZES.forEach(([label, , , skin], si) => {
  for (const s of SCREENS) {
    if (skin === "dark" && !["floor", "popup", "takeorder", "billpreview", "audit", "dishes"].includes(s[0])) continue;
    check(id(), `${F} — ${s[1]}, ${label} ${skin}: nothing runs off the right edge`, `LIVE + SHOT: ${s[0]}-${label.replace(/\W+/g, "")}-${skin}.png`, async () => {
      const r = await measure(si, s);
      if (!r || r.error) return { ok: false, note: (r && r.error) || "no measurement" };
      return { ok: r.offN === 0, note: `${r.W}px wide · ${r.offN} box(es) past the edge${r.offN ? ": " + r.off.join(", ") : ""}` };
    });
    check(id(), `${F} — ${s[1]}, ${label} ${skin}: no raw code value on screen`, "LIVE: undefined / NaN / [object Object] / ${ in the rendered text", async () => {
      const r = await measure(si, s);
      if (!r || r.error) return { ok: false, note: (r && r.error) || "no measurement" };
      return { ok: r.bad.length === 0, note: r.bad.length ? "found " + r.bad.join(", ") : "none" };
    });
  }
});
