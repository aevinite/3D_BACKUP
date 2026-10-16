// BLOCK C · from P176301 — THE STATES THE HAPPY PATH NEVER VISITS, on my third's screens: a read that
// fails (no signal / too busy / refused), a write the server refuses or queues, two devices at once
// (first save wins), a switch turned off, the phone's BACK button and Escape inside every popup, and
// the window never scrolling. Driven in the real panel. The server is never actually written to:
// api() is replaced for one check at a time and put back in a finally; a busy table is an in-memory
// party (fixture.mjs).
import { check, ev } from "./lib.mjs";
import { WITH } from "./fixture.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176301;
const id = () => "P" + n++;
const sleep = (ms) => `await new Promise((f) => setTimeout(f, ${ms}));`;
const until = (cond, ms = 5000) => `await (async () => { const t0 = Date.now(); while (Date.now() - t0 < ${ms}) { if (${cond}) return true; await new Promise((f) => setTimeout(f, 60)); } return false; })();`;
// The three ways a request goes wrong, shaped exactly as the panel's own api() throws them.
const ERR = {
  offline: "(() => { const e = new Error('Failed to fetch'); e.offline = true; return e; })()",
  busy: "(() => { const e = new Error('the server didn\\'t answer in time'); e.status = 503; e.busy = true; return e; })()",
  refused: "(() => { const e = new Error('Your owner hasn\\'t given managers permission to do that.'); e.status = 403; e.data = { error: 'Your owner hasn\\'t given managers permission to do that.' }; return e; })()",
  clash: "(() => { const e = new Error('clash_changed_elsewhere'); e.status = 409; e.data = { error: 'clash_changed_elsewhere', clash: { plain: 'Someone else changed it while you had it open.', todo: 'Your change was NOT saved.' } }; return e; })()",
};
// STUB(match, how, body): api() answers paths matching `match` with `how` (an ERR key, "queued", or
// an expression for the reply), records every call, and captures every toast. Restored in a finally.
const STUB = (match, how, body) => `(async () => {
  const keepApi = api, keepToast = toast, calls = [], said = [];
  api = async (m, p, b, o) => { if (new RegExp(${JSON.stringify(match)}).test(m + " " + p)) { calls.push({ m, p, b, o }); ${how === "queued" ? "return { queued: true };" : ERR[how] ? `throw ${ERR[how]};` : `return (${how});`} } return keepApi(m, p, b, o); };
  toast = (msg, ...a) => { said.push(String(msg)); return keepToast(msg, ...a); };
  try { return await (async () => { ${/^\(async \(\) =>/.test(body.trim()) ? "return await " + body : body} })(); } finally { api = keepApi; toast = keepToast; }
})()`;
const C = (what, how, expr, cmp) => check(id(), `${F} — ${what}`, `LIVE: ${how}`, async () => {
  let g; try { g = await ev(expr); } catch (e) { return { ok: false, note: "threw: " + e.message }; }
  let ok; try { ok = !!cmp(g); } catch (e) { ok = false; }
  return { ok, note: JSON.stringify(g).slice(0, 200) };
});
const T28 = { t: 28, orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", status: "preparing", price: 320 }, { title: "French Onion Soup", status: "served", price: 240 }] }] };

// ── the floor's read fails ─────────────────────────────────────────────────────────────────────
for (const k of ["offline", "busy", "refused"]) {
  C(`the floor's read failing (${k}) says 'Couldn't load tables' in words and keeps the tiles it had`, `/summary answers ${k}`,
    STUB("GET /summary", k, `setTab('tables'); renderEditor(); ${sleep(300)} const before = document.querySelectorAll('.ftile').length; await loadSessions(); ${sleep(200)} return { said: said.slice(-1)[0] || '', tiles: document.querySelectorAll('.ftile').length, before };`),
    (g) => /^Couldn't load tables: /.test(g.said) && g.tiles === g.before && g.tiles > 0 && (k !== "offline" || /no internet/.test(g.said)) && (k !== "busy" || /very busy/.test(g.said)));
}
// ── the Audit list's read fails ────────────────────────────────────────────────────────────────
for (const k of ["offline", "busy", "refused"]) {
  C(`Audit & logs → removals, read failing (${k}): 'Couldn't load', never 'Nothing has been removed yet'`, `/audit answers ${k}`,
    STUB("GET /audit\\?limit", k, `const keep = state.audit; state.audit = null; setTab('log'); state.logView = 'audit'; renderList(); renderEditor(); ${until("state.audit")} renderEditor(); const t = document.getElementById('editor').innerText; state.audit = keep; return t.slice(0, 200);`),
    (g) => /Couldn't load/.test(g) && !/Nothing has been removed yet/.test(g));
}
C("a removal's story that cannot be read says 'Couldn't open that record' and opens no empty card", "/audit?detail= answers offline",
  STUB("GET /audit\\?detail", "offline", `await openRemovalDetail('00000000-0000-0000-0000-00000000dead'); ${sleep(150)} return { said: said.slice(-1)[0] || '', card: !!document.querySelector('.au-detail-overlay') };`),
  (g) => /^Couldn't open that record/.test(g.said) && !g.card);
C("the Z report that cannot be built says so (print path)", "/zreport answers busy",
  STUB("GET /zreport", "busy", `await printZReport(); return said.slice(-1)[0] || '';`), (g) => /^Couldn't build the report/.test(g));
// ── the menu editor's writes ───────────────────────────────────────────────────────────────────
const EDIT = (body) => `const keepTab = state.tab, keepSel = state.sel, keepP = state.selPristine, keepNew = state.isNew;
  try { setTab('items'); const d = (state.data.items || [])[0]; state.sel = JSON.parse(JSON.stringify(d)); state.selPristine = JSON.stringify(d); state.isNew = false; renderEditor(); ${body} }
  finally { state.saving = false; state.sel = keepSel; state.selPristine = keepP; state.isNew = keepNew; setTab(keepTab); }`;
C("a dish Save sends ONLY the changed field plus the dish's identity", "POST /items answers { ok: true } (stand-in)",
  STUB("POST /items", "({ ok: true })", EDIT(`const keepLoad = loadAll; loadAll = async () => {}; try { state.sel.price = String(Number(state.sel.price || 0) + 7); await save(); } finally { loadAll = keepLoad; } return Object.keys(calls[0].b).sort();`)),
  (g) => JSON.stringify(g) === JSON.stringify(["__create", "id", "price", "slug"]));
C("…and tells the server what the price WAS (first save wins)", "the same stand-in; read the expectation",
  STUB("POST /items", "({ ok: true })", EDIT(`const keepLoad = loadAll; loadAll = async () => {}; try { const was = state.sel.price; state.sel.price = String(Number(was || 0) + 7); await save(); return [calls[0].o.expect.table, calls[0].o.expect.fields.price === was]; } finally { loadAll = keepLoad; }`)),
  (g) => g[0] === "menu_items" && g[1] === true);
C("a second manager's clash on the same dish is SAID in words (item 8), not as a code", "POST /items answers 409 clash",
  STUB("POST /items", "clash", EDIT(`state.sel.price = String(Number(state.sel.price || 0) + 7); await save(); return said.slice(-1)[0] || '';`)),
  (g) => /^Someone else changed/.test(g) && !/clash_changed_elsewhere/.test(g));
C("a refused dish Save names the reason and gives the Save button back", "POST /items answers refused",
  STUB("POST /items", "refused", EDIT(`state.sel.price = String(Number(state.sel.price || 0) + 7); await save(); const b = document.getElementById('saveBtn'); return { said: said.slice(-1)[0] || '', disabled: b ? b.disabled : null, label: b ? b.textContent : '' };`)),
  (g) => /^Save failed: Your owner/.test(g.said) && g.disabled === false && g.label === "Save");
C("a dish Save with no signal is SAVED ON THIS DEVICE and says exactly that", "POST /items answers queued",
  STUB("POST /items", "queued", EDIT(`const keepLoad = loadAll; loadAll = async () => {}; try { state.sel.price = String(Number(state.sel.price || 0) + 7); await save(); return said.slice(-1)[0] || ''; } finally { loadAll = keepLoad; }`)),
  (g) => /^Saved on this device ✓/.test(g));
C("a double-tapped Save sends ONE write (state.saving guards re-entry)", "two save() calls back to back",
  STUB("POST /items", "({ ok: true })", EDIT(`const keepLoad = loadAll; loadAll = async () => { await new Promise((f) => setTimeout(f, 150)); }; try { state.sel.price = String(Number(state.sel.price || 0) + 7); await Promise.all([save(), save()]); return calls.length; } finally { loadAll = keepLoad; }`)),
  (g) => g === 1);
C("a new dish with no name is refused on the spot — nothing is sent", "save() on a blank new dish",
  STUB("POST /items", "({ ok: true })", `const keepTab = state.tab, keepSel = state.sel, keepNew = state.isNew; try { setTab('items'); state.sel = blank('items'); state.isNew = true; await save(); return { calls: calls.length, said: said.slice(-1)[0] || '' }; } finally { state.sel = keepSel; state.isNew = keepNew; setTab(keepTab); }`),
  (g) => g.calls === 0 && /Give the dish a name first/.test(g.said));
C("Delete → 'No' on the confirm sends nothing", "confirmDialog answers false",
  STUB("DELETE /items", "({ ok: true })", EDIT(`const kc = confirmDialog; confirmDialog = async () => false; try { await removeRecord(); return calls.length; } finally { confirmDialog = kc; }`)),
  (g) => g === 0);
C("a refused Delete says 'Delete failed' with the reason, and the dish stays selected", "DELETE answers refused",
  STUB("DELETE /items", "refused", EDIT(`const kc = confirmDialog; confirmDialog = async () => true; try { const before = state.sel && state.sel.id; await removeRecord(); return { said: said.slice(-1)[0] || '', still: state.sel && state.sel.id === before }; } finally { confirmDialog = kc; }`)),
  (g) => /^Delete failed: /.test(g.said) && g.still === true);
// ── the tag list (item 6) ──────────────────────────────────────────────────────────────────────
const TAG = (body) => `const d = (state.data.items || []).find((x) => Array.isArray(x.tags)) || (state.data.items || [])[0]; const keepTags = (d.tags || []).slice(); const slug = 't7s10-probe-tag';
  try { ${body} } finally { d.tags = keepTags; }`;
C("Menu → Tags → ticking a dish sends the list it STARTED from as the expectation (item 6)", "POST /items answers ok (stand-in)",
  STUB("POST /items", "({ ok: true })", TAG(`const before = (d.tags || []).slice(); await toggleTagMembership(slug, d.id, null); const o = calls[0].o; return [o.expect.table, JSON.stringify(o.expect.fields.tags) === JSON.stringify(before), calls[0].b.tags.includes(slug)];`)),
  (g) => g[0] === "menu_items" && g[1] === true && g[2] === true);
C("…and a refusal puts the tick back and says why in words", "POST /items answers 409 clash",
  STUB("POST /items", "clash", TAG(`const keepLoad = loadAll; loadAll = async () => {}; try { await toggleTagMembership(slug, d.id, null); return { has: (d.tags || []).includes(slug), said: said.slice(-1)[0] || '' }; } finally { loadAll = keepLoad; }`)),
  (g) => g.has === false && /^Someone else changed/.test(g.said));
// ── the floor's own writes ─────────────────────────────────────────────────────────────────────
C("a waiter call answered while the server refuses comes BACK onto the floor, with the reason", "PATCH /calls answers refused",
  STUB("PATCH /calls/", "refused", `const keep = state.summary; state.summary = { ...keep, calls: [{ id: 'c-t7', table_number: '9', resolved: false, note: 'water' }] }; try { await attendCall('c-t7'); return { back: state.summary.calls.some((c) => c.id === 'c-t7'), said: said.slice(-1)[0] || '' }; } finally { state.summary = keep; }`),
  (g) => g.back === true && /^Failed: /.test(g.said));
C("a guest request answered while the server refuses comes back too", "POST /requests/:id/resolve answers refused",
  STUB("POST /requests/", "refused", `const keep = state.summary; state.summary = { ...keep, requests: [{ id: 'r-t7', table_number: '9', type: 'join' }] }; try { await resolveRequest('r-t7', 'approved'); return state.summary.requests.some((r) => r.id === 'r-t7'); } finally { state.summary = keep; }`),
  (g) => g === true);
C("a dish marked served while the server refuses flips BACK to its old status", "POST /items/:id/status answers refused",
  STUB("POST /items/[^/]+/status", "refused", WITH(T28, `const it = state.board.items.find((x) => x.status === 'preparing'); await itemStatus(it.id, 'served'); return it.status;`)),
  (g) => g === "preparing");
C("closing a table that still owes money is refused ON THE SPOT, naming what is left", "closeFinishedTable on the in-memory unpaid party",
  STUB("POST /sessions/", "({ ok: true })", WITH(T28, `const kp = pollTables; pollTables = async () => {}; try { await closeFinishedTable(T); return { calls: calls.length, said: said.slice(-1)[0] || '' }; } finally { pollTables = kp; }`)),
  (g) => g.calls === 0 && /still owes money and has food to serve/.test(g.said));
C("Kick → 'No' sends nothing", "confirmDialog answers false", STUB("POST /members/", "({ ok: true })", `const kc = confirmDialog; confirmDialog = async () => false; try { await kickMember('m-1'); return calls.length; } finally { confirmDialog = kc; }`), (g) => g === 0);
C("Ban → 'No' sends nothing", "confirmDialog answers false", STUB("POST /blocklist", "({ ok: true })", `const kc = confirmDialog; confirmDialog = async () => false; try { await banMember('m-1', null); return calls.length; } finally { confirmDialog = kc; }`), (g) => g === 0);
C("the log-retention box goes back to the stored window when a change is refused (item 7)", "POST /settings answers busy",
  STUB("POST /settings", "busy", `const s = document.createElement('select'); s.className = 'ret-select'; s.dataset.ret = 'oplog_retention_days'; s.innerHTML = '<option value=7>7</option><option value=90>90</option>'; s.value = '7'; document.body.appendChild(s);
    const keep = state.data.settings.oplog_retention_days; state.data.settings.oplog_retention_days = 90; try { await saveRetention('oplog_retention_days', '7'); return s.value; } finally { s.remove(); state.data.settings.oplog_retention_days = keep; }`),
  (g) => g === "90");
// ── take-order: a refusal hands the order back whole ──────────────────────────────────────────
const CART = `{ cart: [{ uid: 1, id: (state.data.items[0] || {}).id, title: (state.data.items[0] || {}).title, price: Number((state.data.items[0] || {}).price) || 100, qty: 2, note: 'less salt', avoid: ['dairy'] }], avoid: ['nuts'], note: 'birthday', disc: 0 }`;
const SEND = (reply, after = "") => STUB("POST /order", reply, WITH(T28, `const kp = showPendingOrder; const kdp = dropPendingOrder;
  try { openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(700)}
    const o = document.querySelector('.to-overlay'); const r = { reopened: !!o, said, sent: calls.length, lines: o ? o.querySelectorAll('.to-line').length : 0, qty: o ? (o.querySelector('.to-total, .to-foot') || {}).textContent : '', note: o ? (o.querySelector('.to-note') || {}).value : null }; ${after}
    document.querySelectorAll('.to-overlay, .confirm-overlay').forEach((x) => x.remove()); return r; } finally { }`));
const refusal = (reason) => `({ ok: false, reason: '${reason}', item: 'Croque Monsieur' })`;
C("Send to kitchen: the builder closes AT ONCE and says 'Order sent' before the server answers", "POST /order answers ok after 500ms",
  STUB("POST /order", "(await new Promise((f) => setTimeout(() => f({ ok: true, kot_no: 77 }), 500)))", WITH(T28, `openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(60)} const closed = !document.querySelector('.to-overlay'); const first = said[0] || ''; ${sleep(700)} return { closed, first, last: said.slice(-1)[0] };`)),
  (g) => g.closed && /^Order sent to the kitchen ✓ · 2 dishes$/.test(g.first) && /Kitchen ticket #77/.test(g.last));
for (const [reason, re] of [["sold_out", /just sold out — it was NOT sent/], ["unknown_item", /no longer on the menu — it was NOT sent/], ["price_required", /needs a price — nothing was sent/]]) {
  C(`a '${reason}' refusal re-opens the builder holding the same order and names the dish`, `POST /order answers { ok: false, reason: ${reason} }`,
    SEND(refusal(reason)), (g) => g.reopened && g.lines >= 1 && g.said.some((s) => re.test(s) && /Croque Monsieur/.test(s)));
}
C("…and the kitchen note comes back with it (nothing retyped)", "POST /order answers sold_out", SEND(refusal("sold_out")), (g) => g.note === "birthday");
C("a server error hands the order back with 'Couldn't send' — never a silent loss", "POST /order answers busy (thrown)", SEND("busy"), (g) => g.reopened && g.said.some((s) => /^Couldn't send: /.test(s)));
C("no signal: the order is queued and the toast is rewritten to 'Saved on this device' — never 'sent'", "POST /order answers queued", SEND("queued"), (g) => !g.reopened && /^Saved on this device ✓/.test(g.said.slice(-1)[0] || ""));
C("'the same order twice?' is ASKED, and 'No' hands the order back untouched", "POST /order answers duplicateWarning; confirm → No",
  STUB("POST /order", "({ ok: false, duplicateWarning: true })", WITH(T28, `const kc = confirmDialog; let q = null; confirmDialog = async (m) => { q = m; return false; }; try { openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(700)} const o = document.querySelector('.to-overlay'); const r = { q, reopened: !!o, last: said.slice(-1)[0] }; document.querySelectorAll('.to-overlay').forEach((x) => x.remove()); return r; } finally { confirmDialog = kc; }`)),
  (g) => /identical to an order you just sent/.test(g.q || "") && g.reopened && /Nothing was sent — the order is back, unchanged/.test(g.last || ""));
C("the order travels with its allergens, line notes and whole-order note", "POST /order answers ok; read the body",
  STUB("POST /order", "({ ok: true, kot_no: 5 })", WITH(T28, `openTakeOrder(T, null, { restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(300)} const b = calls[0].b; return { table: b.table, note: b.note, alg: b.allergies, line: b.items[0] };`)),
  (g) => g.table === "28" && g.note === "birthday" && Array.isArray(g.alg) && g.alg.includes("nuts") && g.line && g.line.qty === 2);
C("an empty cart cannot be sent: the send button is disabled", "open the builder with nothing in it", WITH(T28, `openTakeOrder(T, null); ${until("document.querySelector('.to-overlay .to-send')")} const b = document.querySelector('.to-overlay .to-send'); const r = b.disabled; document.querySelector('.to-overlay').remove(); return r;`), (g) => g === true);
C("the bill preview on a table with nothing to bill says so and opens nothing", "openBillPreview on an empty in-memory table",
  STUB("GET /nothing", "({})", WITH({ t: 25, noSession: true, orders: [] }, `const ke = ensurePartySlices; ensurePartySlices = async () => {}; try { await openBillPreview(T); return { said: said.slice(-1)[0] || '', open: !!document.querySelector('.bill-overlay') }; } finally { ensurePartySlices = ke; }`)),
  (g) => /has nothing to bill yet/.test(g.said) && !g.open);
// ── a switch turned off ────────────────────────────────────────────────────────────────────────
C("table types OFF: the popup has no 🏷 Type chip and no tile wears a ribbon", "settings.table_tags_allowed = false",
  WITH({ ...T28, settings: { table_tags_allowed: false } }, `const p = tablePanelParts(T); return { chip: /sxTag|Type ▾/.test(JSON.stringify(p)), tag: tagForTable(T) };`), (g) => g.chip === false && g.tag === "");
C("parcels OFF: ⚡ QO/P's destination picker offers no 🥡 Parcel", "settings.parcel_allowed = false",
  WITH({ ...T28, settings: { parcel_allowed: false } }, `openTakeOrder(null, null, { quick: true, restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(300)} const d = document.querySelector('.qo-dest-overlay'); const r = d ? !!d.querySelector('[data-qop-parcel]') : 'no picker'; document.querySelectorAll('.qo-dest-overlay, .to-overlay').forEach((x) => x.remove()); return r;`), (g) => g === false);
C("…and parcels ON offers it", "settings.parcel_allowed = true",
  WITH({ ...T28, settings: { parcel_allowed: true, parcel_owner_control: false } }, `openTakeOrder(null, null, { quick: true, restore: ${CART} }); ${until("document.querySelector('.to-overlay .to-send')")} document.querySelector('.to-overlay .to-send').click(); ${sleep(300)} const d = document.querySelector('.qo-dest-overlay'); const r = d ? !!d.querySelector('[data-qop-parcel]') : 'no picker'; document.querySelectorAll('.qo-dest-overlay, .to-overlay').forEach((x) => x.remove()); return r;`), (g) => g === true || g === "no picker");
C("take-order NOT granted: no ＋ Take order on a tile and none in the popup footer", "xrayGrantedForManager answers false for take_orders",
  WITH({ ...T28, keepOpen: false }, `const kg = xrayGrantedForManager, kw = XRAY_WHO.higherView, ka = XRAY_WHO.actor; xrayGrantedForManager = (f) => f === 'take_orders' ? false : kg(f); XRAY_WHO.higherView = false; XRAY_WHO.actor = 'manager';
    // The permission pass (XRAY_CONTROLS) runs over the RENDERED screen, re-run by its observer.
    try { setTab('tables'); renderEditor(); openFloatingTable(T); ${sleep(700)} const vis = (e) => !!e && !e.hidden && e.offsetParent !== null;
      const tile = document.querySelector('.ftile[data-floor-table="28"] [data-take-order]'); const foot = [...document.querySelectorAll('[data-floating-table="28"] .tp-detail-foot button')].find((b) => /Take order/.test(b.textContent));
      return { tile: vis(tile), foot: vis(foot) }; } finally { xrayGrantedForManager = kg; XRAY_WHO.higherView = kw; XRAY_WHO.actor = ka; renderEditor(); }`),
  (g) => g.tile === false && g.foot === false);
C("sessions ON: a party nobody has joined yet reads Free on the floor (open/close is gone)", "a session with no orders and no members",
  WITH({ t: 24, settings: { sessions_enabled: true }, orders: [] }, `return normalizeTileState(tableTileStateFromBoard(T)).label;`), (g) => g === "Free");
C("an empty restaurant (no table count saved) still draws a floor from the remembered or default count", "settings.table_count = null",
  `(() => { const s = state.data.settings, k = s.table_count; s.table_count = null; try { setTab('tables'); renderEditor(); return document.querySelectorAll('.ftile').length; } finally { s.table_count = k; renderEditor(); } })()`, (g) => g >= 1);
// ── the phone's BACK button and Escape, inside every popup my third opens ─────────────────────
const BACK = (open, sel, closeExpr = "history.back()") => `(async () => { ${open}; ${until(`document.querySelector(${JSON.stringify(sel)})`)} ${sleep(250)} const was = !!document.querySelector(${JSON.stringify(sel)}); if (!was) return { was, gone: false, scrolled: window.scrollY }; ${closeExpr}; ${until(`!document.querySelector(${JSON.stringify(sel)})`, 2500)} const gone = !document.querySelector(${JSON.stringify(sel)}); document.querySelectorAll(${JSON.stringify(sel)}).forEach((x) => x.remove()); ${sleep(500)} return { was, gone, scrolled: window.scrollY }; })()`;
const POPUPS = [
  ["the take-order builder", WITH(T28, `return await ${BACK("openTakeOrder(T, null)", ".to-overlay")};`)],
  ["⚡ QO/P (quick order)", BACK("openTakeOrder(null, null, { quick: true })", ".to-overlay")],
  ["the floor's stat sheet (tap a number)", BACK("setTab('tables'); renderEditor(); openFloorStatList('occupied')", ".fstat-overlay")],
  ["the log row card", BACK("logDetailDialog('Test', [{ label: 'When', value: 'now' }])", ".confirm-overlay")],
  ["the 'why remove?' question", BACK("window.__rr = askRemovalReason('this dish')", ".rr-overlay")],
  ["the 'why reopen?' question", BACK("window.__rr = askReopenReason('this bill')", ".rr-overlay")],
  ["the bill preview", WITH(T28, `const ke = ensurePartySlices; ensurePartySlices = async () => {}; try { return await ${BACK("openBillPreview(T)", ".bill-overlay")}; } finally { ensurePartySlices = ke; }`)],
  ["the dish-edit sheet (allergens & note)", WITH(T28, `const it = state.board.items[0]; return await ${BACK("openDishEditModal(it.id, null)", ".dish-edit-overlay")};`)],
  ["the add-a-dish sheet", WITH(T28, `const o = state.data.orders.find((x) => x.table_number === T); return await ${BACK("openAddDishModal(o.id, null)", ".add-dish-overlay")};`)],
  ["the open-price pad", BACK("window.__pp = pricePrompt('Test dish')", ".pr-in")],
];
for (const [what, expr] of POPUPS) {
  C(`the phone's BACK closes ${what} — and not the whole panel`, "open it, history.back(), it is gone", expr, (g) => g.was && g.gone);
}
for (const [what, expr] of POPUPS.slice(0, 7)) {
  C(`…and nothing behind ${what} scrolled the window`, "window.scrollY after open + back", expr, (g) => g.was && g.scrolled === 0);
}
C("the BACK button on 'why remove?' ANSWERS the question (null), it never leaves it hanging", "askRemovalReason → back → its promise settles",
  `(async () => { let done = 'pending'; askRemovalReason('this dish').then((v) => { done = v; }); const open = ${until("document.querySelector('.rr-overlay')")} if (!open) return 'never opened'; ${sleep(250)} history.back(); ${until("!document.querySelector('.rr-overlay')", 2500)} ${sleep(100)} return done; })()`, (g) => g === null);
C("the table popup closes on BACK too (its own layer, 'table-detail')", "openFloatingTable → back",
  WITH({ ...T28, keepOpen: false }, `return await ${BACK("setTab('tables'); renderEditor(); openFloatingTable(T)", "[data-floating-table]")};`), (g) => g.was && g.gone);
const ESC = (open, sel) => `(async () => { ${open}; ${until(`document.querySelector(${JSON.stringify(sel)})`)} ${sleep(200)} document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${until(`!document.querySelector(${JSON.stringify(sel)})`, 1500)} const gone = !document.querySelector(${JSON.stringify(sel)}); document.querySelectorAll(${JSON.stringify(sel)}).forEach((x) => x.remove()); return gone; })()`;
C("Escape closes the log row card", "keydown Escape", ESC("logDetailDialog('Test', [{ label: 'When', value: 'now' }])", ".confirm-overlay"), (g) => g === true);
C("Escape closes the bill preview", "keydown Escape", WITH(T28, `const ke = ensurePartySlices; ensurePartySlices = async () => {}; try { return await ${ESC("openBillPreview(T)", ".bill-overlay")}; } finally { ensurePartySlices = ke; }`), (g) => g === true);
C("Escape on the open-price pad cancels it (no price)", "keydown Escape in the input",
  `(async () => { let v = 'pending'; pricePrompt('Test').then((x) => { v = x; }); ${sleep(250)} const inp = document.querySelector('.pr-in'); if (inp) inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${sleep(200)} return v; })()`, (g) => g === null);
// ── the keyboard ───────────────────────────────────────────────────────────────────────────────
C("a floor tile is a real control for a keyboard: role=button and tabindex=0", "read a busy tile's attributes",
  WITH(T28, `setTab('tables'); renderEditor(); const t = document.querySelector('.ftile[data-floor-table="28"]'); return [t.getAttribute('role'), t.getAttribute('tabindex')];`), (g) => g[0] === "button" && g[1] === "0");
C("Enter on a focused tile opens that table", "focus the tile, keydown Enter",
  WITH({ ...T28, keepOpen: false }, `setTab('tables'); renderEditor(); const t = document.querySelector('.ftile[data-floor-table="28"]'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); ${sleep(500)} return !!document.querySelector('[data-floating-table="28"]');`), (g) => g === true);
C("a dish tile in take-order is reachable by keyboard (role=button, tabindex=0)", "read a dish tile",
  WITH(T28, `openTakeOrder(T, null); ${until("document.querySelector('.to-dish')")} const d = document.querySelector('.to-dish'); const r = [d.getAttribute('role'), d.getAttribute('tabindex')]; document.querySelector('.to-overlay').remove(); return r;`), (g) => g[0] === "button" && g[1] === "0");
// ── two devices at once ────────────────────────────────────────────────────────────────────────
C("the dish-edit sheet sends what the note WAS (first save wins on a dish line)", "POST /items/:id/note answers ok; read the expectation",
  STUB("POST /items/[^/]+/note", "({ ok: true })", WITH(T28, `const it = state.board.items[0]; it.note = 'old note'; openDishEditModal(it.id, null); ${until("document.querySelector('.dish-edit-note')")} document.querySelector('.dish-edit-note').value = 'new note'; document.querySelector('.dish-edit-save').click(); ${sleep(500)} document.querySelectorAll('.dish-edit-overlay').forEach((x) => x.remove()); return calls[0] ? [calls[0].o.expect.table, calls[0].o.expect.fields.note] : null;`)),
  (g) => g && g[0] === "order_items" && g[1] === "old note");
C("…and when another device got there first the sheet says so in words", "POST /items/:id/note answers 409 clash",
  STUB("POST /items/[^/]+/note", "clash", WITH(T28, `const it = state.board.items[0]; it.note = 'old note'; openDishEditModal(it.id, null); ${until("document.querySelector('.dish-edit-note')")} document.querySelector('.dish-edit-note').value = 'new note'; document.querySelector('.dish-edit-save').click(); ${sleep(600)} document.querySelectorAll('.dish-edit-overlay').forEach((x) => x.remove()); return said.slice(-1)[0] || '';`)),
  (g) => /^Someone else changed/.test(g));
// ── a reader in another country (item 3) ───────────────────────────────────────────────────────
C("the Audit list's times are the restaurant's clock (fmtWhen) whatever the device's zone", "render a row time through auditHtml's own helper",
  `(() => { const keep = state.audit; state.audit = [{ id: 'x', kind: 'order_cancelled', at: '2026-10-16T16:00:00Z', actor: 'a', table_number: '3' }]; try { const h = auditHtml(); return /16 Oct, 09:30 pm/i.test(h.replace(/\\u202f/g, ' ')); } finally { state.audit = keep; } })()`, (g) => g === true);
