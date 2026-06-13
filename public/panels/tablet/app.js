// tablet/ui/app.js — the waiter tablet's brain.
//
// TOP (or LEFT on a wide screen): a live floor of table tiles. Each open table
// shows real info — guests, KOT #, a kitchen progress bar and dish-count pills —
// colour-coded by state, with a paid/unpaid outline and a red glow when a guest
// has called. BELOW (or RIGHT): the selected table's detail — every order, each
// DISH with its own status you can tap to advance (new → cooking → served),
// accept phone/app orders, move the table or a single order, and a big ATTEND
// button when there's a waiter call. The cart survives the 1s floor refresh
// because we only redraw the panel when the waiter ISN'T mid-order.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Prices are stored in rupees now (migration 043) — no conversion, just format.
const INR_RATE = 1;
const inr = (n) => "₹" + Math.round((parseFloat(n) || 0) * INR_RATE).toLocaleString("en-US");

// One dish status flows new → cooking → served, then wraps back to new so a
// mis-tap can be undone. Labels are the waiter-friendly words for each.
const NEXT_STATUS = { received: "preparing", preparing: "served", served: "received" };
const STATUS_WORD = { received: "new", preparing: "cooking", served: "served" };

const state = {
  data: { settings: null, sessions: [], members: [], orders: [], items: [], calls: [], dishes: [], categories: [], requests: [] },
  table: null,          // which table the panel is showing
  ordering: false,      // true while the waiter is building an order (freezes panel redraws)
  cart: [],             // [{ id, title, price, qty }]
  cat: "",              // active category chip in order mode ("" = all)
  dishSearch: "",       // the dish-search text in order mode
  note: "",             // one note for the whole order
  floorFilter: "all",   // which tables the floor shows: all | needs | open | free
  allergies: "",        // order-level allergies (comma list), applied to the whole order
};

const api = async (method, path, body) => {
  const r = await fetch("/api/tablet" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = "/login"; throw new Error("login"); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || r.statusText);
  return j;
};
const toast = (msg, ok = true) => {
  const t = document.createElement("div");
  t.className = "toast" + (ok ? "" : " bad");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
};
// Two-step confirm (a promise that resolves true/false) — used before sending
// an order to the kitchen, so a stray tap can't fire a ticket.
const confirmDialog = (text, yesLabel = "Yes, send it") => new Promise((resolve) => {
  $("#confirmText").textContent = text;
  $("#confirmYes").textContent = yesLabel;
  $("#confirmOverlay").hidden = false;
  $("#confirmYes").onclick = () => { $("#confirmOverlay").hidden = true; resolve(true); };
  $("#confirmNo").onclick = () => { $("#confirmOverlay").hidden = true; resolve(false); };
});

// ── floor helpers ────────────────────────────────────────────────────────────
const sessionOf = (t) => state.data.sessions.find((s) => String(s.table_number) === String(t) && s.status === "open");
const ordersOf = (t) => state.data.orders.filter((o) => String(o.table_number) === String(t) && o.status !== "cancelled");
const callsOf = (t) => state.data.calls.filter((c) => String(c.table_number) === String(t));
const joinersOf = (t) => {
  const s = sessionOf(t);
  return s ? state.data.members.filter((m) => m.session_id === s.id && !m.approved) : [];
};
const membersOf = (t) => {
  const s = sessionOf(t);
  return s ? state.data.members.filter((m) => m.session_id === s.id) : [];
};
const reqsOf = (t) => (state.data.requests || []).filter((r) => String(r.table_number) === String(t));

// The dish rows for one order. Prefer the real order_items rows (they have an id,
// so each dish can be advanced individually); fall back to the order.items JSON
// (legacy / no per-dish id) exactly like the kitchen does.
function dishRowsOf(o) {
  const db = (state.data.items || []).filter((i) => i.order_id === o.id);
  if (db.length) return db.map((r) => ({ id: r.id, title: r.title, qty: r.qty || 1, status: r.status || "received", options: r.options, removed: r.removed, note: r.note, fromDb: true }));
  const js = Array.isArray(o.items) ? o.items : [];
  return js.map((r) => ({ id: null, title: r.title || r.name, qty: r.qty || 1, status: r.status || o.status || "received", options: r.options, removed: r.removed, note: r.note, fromDb: false }));
}

// Everything a tile needs about a table in one pass: dish counts by status,
// KOT numbers, guests, and whether the bill is paid (drives the outline).
function tableAgg(t) {
  const os = ordersOf(t), s = sessionOf(t);
  let nw = 0, ck = 0, sv = 0, due = 0;
  const kots = [];
  os.forEach((o) => {
    if (o.kot_no != null) kots.push(o.kot_no);
    if (o.payment_status !== "paid") due += (Number(o.total) || 0) - (Number(o.discount) || 0);
    dishRowsOf(o).forEach((r) => {
      const q = r.qty || 1;
      if (r.status === "served") sv += q; else if (r.status === "preparing") ck += q; else nw += q;
    });
  });
  const unpaid = os.some((o) => o.payment_status !== "paid");
  return { os, nw, ck, sv, due, kots, session: s, guests: membersOf(t).length, unpaid, paid: os.length > 0 && !unpaid, billNo: s && s.bill_no };
}

// The tile's colour/label, decided by the most urgent thing happening: a brand-new
// (unaccepted) dish wins, then cooking, then all-served, then just seated, then free.
function tileState(t) {
  const a = tableAgg(t);
  if (a.nw > 0) return { cls: "new", label: "New order" };
  if (a.ck > 0) return { cls: "prep", label: "Preparing" };
  if (a.os.length && a.sv > 0) return { cls: "done", label: "Served" };
  if (a.session) return a.guests ? { cls: "seated", label: "Seated" } : { cls: "waiting", label: "Open" };
  return { cls: "free", label: "Free" };
}

// A table "needs attention" if it has a waiter call, a pending request, or a
// brand-new order waiting to be accepted.
const needsAttention = (i) => callsOf(i).length > 0 || reqsOf(i).length > 0 || tileState(i).cls === "new";

function tableCount() { return Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12); }

// ── the floor ────────────────────────────────────────────────────────────────
function renderFloor() {
  const n = tableCount();
  const filt = state.floorFilter || "all";
  let cNeeds = 0, cOpen = 0, cFree = 0;
  for (let i = 1; i <= n; i++) { if (needsAttention(i)) cNeeds++; if (sessionOf(i)) cOpen++; else cFree++; }
  // The same filter set is shown two ways: as count chips beside the brand (wide
  // screens) and as the floor-nav row (narrow). Tapping either filters the floor.
  const filters = [["all", "All", n], ["needs", "⚠ Needs", cNeeds], ["open", "Active", cOpen], ["free", "Free", cFree]];
  const countsEl = document.getElementById("counts");
  if (countsEl) countsEl.innerHTML = filters.map(([k, lbl, c]) =>
    `<button class="cchip ${k === "needs" && c ? "needs" : ""} ${filt === k ? "on" : ""}" data-filter="${k}"><b>${c}</b> ${lbl.replace("⚠ ", "")}</button>`).join("");
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = filters.map(([k, lbl, c]) =>
    `<button class="fnav ${filt === k ? "on" : ""}" data-filter="${k}">${lbl} <em>${c}</em></button>`).join("");

  let html = "";
  for (let i = 1; i <= n; i++) {
    if (filt === "needs" && !needsAttention(i)) continue;
    if (filt === "open" && !sessionOf(i)) continue;
    if (filt === "free" && sessionOf(i)) continue;
    const st = tileState(i), a = tableAgg(i);
    const calls = callsOf(i), joiners = joinersOf(i).length, reqs = reqsOf(i);
    const called = calls.length > 0 || reqs.length > 0;
    const payCls = a.os.length ? (a.unpaid ? "pay-unpaid" : "pay-paid") : "";
    // Body differs by state: free tables get the big Open button; open tables
    // get guests + KOT, and (once there are dishes) a progress bar + count pills.
    let body = "";
    if (st.cls === "free") {
      body = `<span class="tsub">tap to open</span><span class="topen" data-quick="open" data-qt="${i}">Open</span>`;
    } else {
      const kot = a.kots.length ? `KOT #${a.kots[a.kots.length - 1]}${a.kots.length > 1 ? ` +${a.kots.length - 1}` : ""}` : "no order yet";
      const total = a.nw + a.ck + a.sv;
      const strip = total > 0 ? `<div class="tstrip">${a.nw ? `<i style="width:${(a.nw / total) * 100}%;background:#f59e0b"></i>` : ""}${a.ck ? `<i style="width:${(a.ck / total) * 100}%;background:#4f9dff"></i>` : ""}${a.sv ? `<i style="width:${(a.sv / total) * 100}%;background:#22c55e"></i>` : ""}</div>` : "";
      const pills = total > 0 ? `<div class="tpills">${a.nw ? `<span class="tpill nw">${a.nw} new</span>` : ""}${a.ck ? `<span class="tpill ck">${a.ck} cooking</span>` : ""}${a.sv ? `<span class="tpill sv">${a.sv} ready</span>` : ""}</div>` : "";
      body = `<span class="tsub">${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${kot}</span>${strip}${pills}`;
    }
    html += `<button class="tile t-${st.cls} ${payCls} ${called ? "called" : ""} ${state.table === String(i) ? "sel" : ""}" data-t="${i}">
      <span class="tbadges">${called ? `<em class="b-call">🔔</em>` : ""}${reqs.length ? `<em class="b-req">📨${reqs.length}</em>` : ""}${joiners ? `<em class="b-join">🙋${joiners}</em>` : ""}</span>
      <span class="tnum">${i}</span>
      <span class="tlabel">${st.label}</span>
      ${body}
    </button>`;
  }
  $("#tiles").innerHTML = html || `<div class="muted" style="padding:14px">No tables here right now.</div>`;

  document.querySelectorAll(".fnav, .cchip").forEach((b) => (b.onclick = () => { state.floorFilter = b.dataset.filter; renderFloor(); }));
  document.querySelectorAll(".tile[data-t]").forEach((b) => (b.onclick = () => {
    state.table = b.dataset.t;
    state.ordering = false; state.cart = []; state.note = ""; state.dishSearch = "";
    renderFloor(); renderPanel();
    // Stacked (phone/narrow) layout: the detail sits below the floor — jump to it.
    if (window.matchMedia("(max-width: 760px)").matches) {
      document.getElementById("panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }));
  // The big "Open" button on a free tile (stopPropagation so it doesn't also
  // select the tile underneath).
  document.querySelectorAll(".topen[data-quick='open']").forEach((q) => (q.onclick = (e) => {
    e.stopPropagation();
    act(() => api("POST", "/sessions/open", { table: q.dataset.qt }));
  }));
}

// ── the table detail panel (view mode) ───────────────────────────────────────
function renderPanel() {
  const p = $("#panel");
  p.classList.remove("has-detail");
  if (!state.table) { p.innerHTML = `<div class="empty">Tap a table to see it — or to take an order for it.</div>`; return; }
  if (state.ordering) { renderOrderMode(); return; }
  const t = state.table, s = sessionOf(t), a = tableAgg(t);
  const os = a.os, calls = callsOf(t), joiners = joinersOf(t), members = s ? membersOf(t) : [], reqs = reqsOf(t);

  const reqRows = reqs.map((r) => `<div class="row"><span>📨 ${r.type === "open" ? "Asked to open" : "Asked for access"}${r.name ? ` · ${esc(r.name)}` : ""}</span><span class="reqbtns"><button class="btn small primary" data-req-approve="${esc(r.id)}">Approve</button><button class="btn small" data-req-deny="${esc(r.id)}">Deny</button></span></div>`).join("");
  const joinRows = joiners.map((m) => `<div class="row"><span>🙋 ${esc(m.name || "Guest")} wants to join</span><button class="btn small primary" data-approve="${esc(m.id)}">Approve</button></div>`).join("");
  const partyRows = members.map((m) => `<div class="row"><span>${m.role === "owner" ? "👑" : "•"} ${esc(m.name || "Guest")}${m.approved ? "" : ` <span class="muted">(pending)</span>`}</span>${m.role === "owner" ? `<span class="muted small">head</span>` : `<button class="btn small" data-makehead="${esc(m.id)}">Make head</button>`}</div>`).join("");

  // Each order is a card: KOT chip, time, "via app" badge for guest/phone orders,
  // every dish with a tappable status pill, and an Accept button when it's new.
  const orderCards = os.map((o, oi) => {
    const when = o.created_at ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const viaApp = !!o.member_id; // guest orders carry a member_id; staff-taken ones don't
    const rows = dishRowsOf(o).map((r) => {
      const opt = (r.options && r.options.length) ? `<div class="iopt">${esc(r.options.map((x) => x.label || x).join(" · "))}</div>` : "";
      const rem = (r.removed && r.removed.length) ? `<div class="irem">no ${esc(r.removed.join(", "))}</div>` : "";
      const note = r.note ? `<div class="iopt">“${esc(r.note)}”</div>` : "";
      // Real DB rows are tappable (advance the dish); legacy JSON rows just show.
      const tap = r.fromDb ? `tap data-item="${esc(r.id)}" data-cur="${esc(r.status)}"` : "";
      return `<div class="iline"><span class="iqty">${r.qty}×</span><span class="inm">${esc(r.title)}${opt}${rem}${note}</span><span class="ist ${r.status} ${r.fromDb ? "tap" : ""}" ${tap} title="${r.fromDb ? "tap to advance" : ""}">${STATUS_WORD[r.status] || r.status}</span></div>`;
    }).join("");
    const accept = o.status === "received" ? `<button class="accept" data-accept="${esc(o.id)}">✓ Accept &amp; send to kitchen</button>` : "";
    // Allergies are safety-critical — show them as a loud banner on the order.
    const allergy = (o.allergies && o.allergies.length) ? `<div class="oallergy">⚠ ALLERGY — ${esc(o.allergies.join(", "))}</div>` : "";
    return `<div class="ord">
      <div class="ordh"><span class="left"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="when">Order ${oi + 1}${when ? ` · ${when}` : ""}</span>${viaApp ? `<span class="viaapp">via app 📱</span>` : ""}</span><span class="ordtotal">${inr(o.total)}</span></div>
      ${allergy}
      ${rows || `<div class="iline muted">No items.</div>`}
      ${accept}
    </div>`;
  }).join("");

  const callRows = calls.map((c) => `<div class="row"><span>🔔 ${esc(c.note || "Waiter call")}</span><button class="btn small primary" data-attend="${esc(c.id)}">Done</button></div>`).join("");

  // Bottom bar: bill + paid/unpaid on the left; a big ATTEND filling the rest when
  // there's a call (sized to whatever space is left, exactly as asked). The bill
  // number only exists once the table has ordered — until then we say so plainly.
  let foot = "";
  if (s) {
    const hasOrders = os.length > 0;
    const payCls = hasOrders ? (a.unpaid ? "unpaid" : "paid") : "";
    const billInner = hasOrders
      ? `<span class="bn">bill #${esc(a.billNo ?? "—")}</span>${a.due > 0 ? `<span class="due">${inr(a.due)} due</span>` : ""}<span class="pay">${a.unpaid ? "● UNPAID" : "paid ✓"}</span>`
      : `<span class="bn">no bill yet</span><span class="due">starts on first order</span>`;
    const attend = calls.length
      ? `<button class="attend ${calls.length > 1 ? "more" : ""}" data-attend="${esc(calls[0].id)}">🔔 ATTEND — ${esc(calls[0].note || "call")}${calls.length > 1 ? ` (+${calls.length - 1} more)` : ""}</button>`
      : "";
    foot = `<div class="foot"><div class="billbox ${payCls}">${billInner}</div>${attend}</div>`;
  }

  p.classList.add("has-detail");
  p.innerHTML = `
    <div class="phead">
      <div style="flex:1"><h2 style="margin:0;font-size:19px">Table ${esc(t)}</h2><div class="pmeta">${s ? `${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${os.length ? `bill #${esc(a.billNo ?? "—")}` : "no bill yet"}` : "closed"}</div></div>
      <button class="btn small backtop" id="backTop">↑ Tables</button>
      ${s ? `<span class="live">● open</span>` : `<span class="off">closed</span>`}
    </div>
    <div class="detail-body">
      ${reqRows ? `<div class="sec"><h3>Requests</h3>${reqRows}</div>` : ""}
      ${joinRows ? `<div class="sec"><h3>Waiting to join</h3>${joinRows}</div>` : ""}
      ${callRows ? `<div class="sec"><h3>Calls</h3>${callRows}</div>` : ""}
      ${members.length ? `<div class="sec"><h3>Party</h3>${partyRows}</div>` : ""}
      <div class="sec"><h3>Orders</h3>${orderCards || `<div class="muted">No orders yet.</div>`}</div>
    </div>
    <div class="dacts">
      ${s ? "" : `<button class="btn" id="openTable">Open this table</button>`}
      <button class="btn primary big" id="takeOrder">＋ Take order</button>
      ${s ? `<button class="btn" id="shiftTable">⇄ Move table</button>` : ""}
      ${s && os.length ? `<button class="btn" id="moveOrder">↪ Move an order</button>` : ""}
      ${s ? `<button class="btn danger" id="closeTable">✕ Close table</button>` : ""}
    </div>
    ${foot}`;

  // wire it up
  document.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqApprove}/resolve`, { status: "approved" }))));
  document.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqDeny}/resolve`, { status: "denied" }))));
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = () => act(() => api("POST", `/calls/${b.dataset.attend}/attend`))));
  document.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.approve}/approve`))));
  document.querySelectorAll("[data-makehead]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.makehead}/make-head`))));
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => act(() => api("POST", `/orders/${b.dataset.accept}/accept`))));
  // Per-dish advance: optimistically flip the pill, then persist + reconcile.
  document.querySelectorAll(".ist.tap[data-item]").forEach((el) => (el.onclick = () => advanceDish(el.dataset.item, el.dataset.cur)));
  const ob = $("#openTable"); if (ob) ob.onclick = () => act(() => api("POST", "/sessions/open", { table: t }));
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = () => renderShiftPicker(t, s);
  const mvb = $("#moveOrder"); if (mvb) mvb.onclick = () => renderMoveOrderPicker(t);
  const clb = $("#closeTable"); if (clb && s) clb.onclick = async () => {
    const warn = a.unpaid && os.length ? ` The bill (${inr(a.due)}) is still UNPAID.` : "";
    if (await confirmDialog(`Close table ${t} and free it?${warn}`, "Close table")) act(() => api("POST", `/sessions/${s.id}/close`));
  };
  const bt = $("#backTop"); if (bt) bt.onclick = () => document.querySelector(".floor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#takeOrder").onclick = () => { state.ordering = true; state.cart = []; state.cat = ""; state.dishSearch = ""; renderPanel(); };
}

// Advance one dish new→cooking→served (wrapping). Optimistic so it feels instant.
function advanceDish(id, cur) {
  const next = NEXT_STATUS[cur] || "preparing";
  const it = (state.data.items || []).find((x) => x.id === id);
  if (it) it.status = next;
  renderPanel();
  api("POST", `/items/${id}/status`, { status: next })
    .then(() => load()).then(() => { if (!state.ordering) renderPanel(); })
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}

// Shift the WHOLE party to another free table. Optimistic: move the tiles/labels
// immediately, fire the RPC, then reconcile on the next load — no dead wait.
function renderShiftPicker(t, s) {
  const n = tableCount();
  const free = [];
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && !sessionOf(i)) free.push(i); }
  const btns = free.length
    ? free.map((i) => `<button class="btn shiftpick" data-shiftto="${i}">Table ${i}</button>`).join("")
    : `<div class="muted">No free tables to shift to.</div>`;
  $("#panel").classList.remove("has-detail");
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move Table ${esc(t)} →</h2><button class="btn small" id="shiftBack">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Move this party — orders &amp; calls included — to a free table:</div>
    <div class="shiftgrid">${btns}</div>`;
  $("#shiftBack").onclick = renderPanel;
  document.querySelectorAll("[data-shiftto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.shiftto;
    runOptimistic(
      () => { if (s) s.table_number = to; state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.table_number = to; }); state.table = to; },
      () => api("POST", `/sessions/${s.id}/shift`, { to }),
    );
  }));
}

// Move a SINGLE order to another table's bill. Two taps: pick the order, pick the
// target table.
function renderMoveOrderPicker(t) {
  const os = ordersOf(t);
  const list = os.map((o, i) => `<button class="btn" style="text-align:left" data-pickorder="${esc(o.id)}">#${esc(o.kot_no ?? "—")} · Order ${i + 1} · ${inr(o.total)}</button>`).join("");
  $("#panel").classList.remove("has-detail");
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move an order</h2><button class="btn small" id="moveBack">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Pick the order to move off Table ${esc(t)}:</div>
    <div class="pactions">${list || `<div class="muted">No orders.</div>`}</div>`;
  $("#moveBack").onclick = renderPanel;
  document.querySelectorAll("[data-pickorder]").forEach((b) => (b.onclick = () => renderMoveOrderTarget(t, b.dataset.pickorder)));
}
function renderMoveOrderTarget(t, orderId) {
  const n = tableCount();
  const tiles = [];
  for (let i = 1; i <= n; i++) {
    if (String(i) === String(t)) continue;
    const st = tileState(i);
    tiles.push(`<button class="btn shiftpick" data-moveto="${i}">Table ${i}<br><span class="muted small">${st.label}</span></button>`);
  }
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move order →</h2><button class="btn small" id="moveBack2">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Send this order to which table's bill?</div>
    <div class="shiftgrid">${tiles.join("")}</div>`;
  $("#moveBack2").onclick = () => renderMoveOrderPicker(t);
  document.querySelectorAll("[data-moveto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.moveto;
    runOptimistic(
      () => { const o = state.data.orders.find((x) => x.id === orderId); if (o) o.table_number = to; },
      () => api("POST", `/orders/${orderId}/move`, { to }),
    );
  }));
}

// Apply a local change, repaint instantly, then persist and reconcile from the
// server. On failure we toast and reload so the screen can't lie.
async function runOptimistic(mutate, fn) {
  try { mutate(); renderFloor(); renderPanel(); await fn(); }
  catch (e) { toast("Failed: " + e.message, false); }
  await load(); if (!state.ordering) renderPanel();
}

const act = async (fn) => { try { await fn(); await load(); if (!state.ordering) renderPanel(); } catch (e) { toast("Failed: " + e.message, false); } };

// ── order-taking mode ────────────────────────────────────────────────────────
const dishPrice = (d) => Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;

function orderDishes() {
  const q = state.dishSearch.trim().toLowerCase();
  return state.data.dishes.filter((d) =>
    q ? (d.title || "").toLowerCase().includes(q) : (!state.cat || d.category === state.cat));
}
function orderGridHtml() {
  const dishes = orderDishes();
  if (!dishes.length) return `<div class="muted" style="padding:14px">No dishes match.</div>`;
  return dishes.map((d) => {
    const out = (d.tags || []).includes("sold-out");
    const inCart = state.cart.find((l) => l.id === d.id);
    return `<button class="dish ${out ? "out" : ""} ${inCart ? "in" : ""}" data-dish="${esc(d.id)}" ${out ? "disabled" : ""}>
      <span class="dname">${esc(d.title)}</span>
      <span class="dprice">${out ? "SOLD OUT" : inr(dishPrice(d))}${inCart ? ` · ×${inCart.qty}` : ""}</span>
    </button>`;
  }).join("");
}
function bindDishButtons() {
  document.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = () => {
    const d = state.data.dishes.find((x) => x.id === b.dataset.dish);
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; }
    if (Array.isArray(d.options) && d.options.length) { renderDishOptions(d, null); return; }
    const line = state.cart.find((l) => l.id === d.id && !l.options);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 });
    renderOrderMode();
  }));
}

function renderDishOptions(d, editIndex) {
  const sel = {};
  if (editIndex != null && state.cart[editIndex] && state.cart[editIndex].options) {
    for (const o of state.cart[editIndex].options) (sel[o.group] = sel[o.group] || []).push(o.label);
  }
  state._opt = { d, sel, editIndex };
  drawDishOptions();
}
function drawDishOptions() {
  const { d, sel, editIndex } = state._opt;
  const base = dishPrice(d);
  let addons = 0;
  const groups = (d.options || []).map((g) => {
    const multi = g.type === "multi";
    const choices = (g.choices || []).map((c) => {
      const on = (sel[g.name] || []).includes(c.label);
      if (on) addons += Number(c.price) || 0;
      const plus = Number(c.price) > 0 ? ` <em>+${inr(c.price)}</em>` : "";
      return `<button class="optchoice ${on ? "on" : ""}" data-optg="${esc(g.name)}" data-optl="${esc(c.label)}" data-multi="${multi}">${esc(c.label)}${plus}</button>`;
    }).join("");
    return `<div class="optgroup"><h4>${esc(g.name)}${multi ? ` <span class="muted small">· choose any</span>` : ""}</h4><div class="optchoices">${choices}</div></div>`;
  }).join("");
  const unit = base + addons;
  $("#panel").classList.remove("has-detail");
  $("#panel").innerHTML = `
    <div class="phead"><h2>${esc(d.title)}</h2><button class="btn small" id="optBack">← back</button></div>
    <div class="muted small">Base ${inr(base)}</div>
    ${groups || `<div class="muted">No options.</div>`}
    <div class="ctotal"><span>Per item</span><b>${inr(unit)}</b></div>
    <button class="btn primary big" id="optAdd">${editIndex != null ? "Update item" : "Add to order"}</button>`;
  document.querySelectorAll("[data-optg]").forEach((b) => (b.onclick = () => {
    const g = b.dataset.optg, l = b.dataset.optl, multi = b.dataset.multi === "true";
    const cur = sel[g] || [];
    sel[g] = multi ? (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]) : (cur.includes(l) ? [] : [l]);
    drawDishOptions();
  }));
  $("#optBack").onclick = renderOrderMode;
  $("#optAdd").onclick = () => {
    const opts = [];
    for (const g of (d.options || [])) for (const c of (g.choices || [])) {
      if ((sel[g.name] || []).includes(c.label)) opts.push({ group: g.name, label: c.label, price: Number(c.price) || 0 });
    }
    const unitPrice = base + opts.reduce((s, o) => s + o.price, 0);
    const line = { id: d.id, title: d.title, price: unitPrice, qty: 1, options: opts };
    if (editIndex != null && state.cart[editIndex]) { line.qty = state.cart[editIndex].qty; state.cart[editIndex] = line; }
    else state.cart.push(line);
    state._opt = null;
    renderOrderMode();
  };
}

function renderOrderMode() {
  const p = $("#panel");
  p.classList.remove("has-detail");
  const cats = state.data.categories.filter((c) => c.active !== false);
  const chips = state.dishSearch.trim() ? "" : [`<button class="chip ${!state.cat ? "on" : ""}" data-cat="">All</button>`]
    .concat(cats.map((c) => `<button class="chip ${state.cat === c.slug ? "on" : ""}" data-cat="${esc(c.slug)}">${esc((c.name && c.name.en) || c.slug)}</button>`)).join("");
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}${l.options && l.options.length ? `<small class="copts">${esc(l.options.map((o) => o.label).join(", "))}</small>` : ""}${l.options ? ` <button class="cedit" data-edit="${i}">edit</button>` : ""}</span>
      <span class="cqty"><button class="qbtn" data-minus="${i}">−</button><b>${l.qty}</b><button class="qbtn" data-plus="${i}">+</button></span>
      <span class="cprice">${inr(l.price * l.qty)}</span>
    </div>`).join("");
  const total = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
  p.innerHTML = `
    <div class="phead"><h2>Order · Table ${esc(state.table)}</h2><button class="btn small" id="backBtn">← back</button></div>
    <input type="search" id="dishSearch" class="order-search" placeholder="🔎 Search dishes…" value="${esc(state.dishSearch)}">
    <div class="chips">${chips}</div>
    <div class="dishgrid">${orderGridHtml()}</div>
    <div class="cart">
      <h3>This order</h3>
      ${lines || `<div class="muted">Tap dishes above to add them.</div>`}
      <input type="text" id="orderNote" class="note" placeholder="Note for the kitchen (optional)" value="${esc(state.note)}">
      <input type="text" id="orderAllergy" class="note allergy" placeholder="⚠ Allergies (e.g. nuts, dairy) — applies to the whole order" value="${esc(state.allergies || "")}">
      <div class="ctotal"><span>Items total</span><b>${inr(total)}</b></div>
      <div class="muted small">Final bill (incl. tax) is computed by the system when you send it.</div>
      <button class="btn primary big" id="sendOrder" ${state.cart.length ? "" : "disabled"}>SEND TO KITCHEN</button>
    </div>`;
  document.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; renderOrderMode(); }));
  bindDishButtons();
  const search = $("#dishSearch");
  if (search) search.oninput = (e) => {
    state.dishSearch = e.target.value;
    const g = document.querySelector(".dishgrid");
    if (g) { g.innerHTML = orderGridHtml(); bindDishButtons(); }
  };
  document.querySelectorAll("[data-plus]").forEach((b) => (b.onclick = () => { state.cart[+b.dataset.plus].qty = Math.min(99, state.cart[+b.dataset.plus].qty + 1); renderOrderMode(); }));
  document.querySelectorAll("[data-minus]").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.minus;
    state.cart[i].qty -= 1;
    if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
    renderOrderMode();
  }));
  $("#orderNote").oninput = (e) => (state.note = e.target.value);
  const al = $("#orderAllergy"); if (al) al.oninput = (e) => (state.allergies = e.target.value);
  document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => {
    const l = state.cart[+b.dataset.edit];
    const d = l && state.data.dishes.find((x) => x.id === l.id);
    if (d) renderDishOptions(d, +b.dataset.edit);
  }));
  $("#backBtn").onclick = () => { state.ordering = false; renderPanel(); };
  $("#sendOrder").onclick = sendOrder;
}

let sendingOrder = false;
async function sendOrder() {
  if (sendingOrder) return;
  const count = state.cart.reduce((s, l) => s + l.qty, 0);
  if (!(await confirmDialog(`Send ${count} item${count > 1 ? "s" : ""} to the kitchen for table ${state.table}?`))) return;
  sendingOrder = true;
  const sendBtn = document.getElementById("sendOrder");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending…"; }
  try {
    const r = await api("POST", "/order", {
      table: state.table,
      items: state.cart.map((l) => ({ id: l.id, qty: l.qty, options: l.options ? l.options.map((o) => ({ group: o.group, label: o.label })) : undefined })),
      allergies: (state.allergies || "").split(",").map((s) => s.trim()).filter(Boolean),
      note: state.note.trim() || null,
    });
    if (!r || r.ok !== true) { toast("Rejected: " + ((r && r.reason) || "unknown") + (r && r.item ? ` (${r.item})` : ""), false); return; }
    toast(`Sent! Kitchen ticket #${r.kot_no}`);
    state.ordering = false; state.cart = []; state.note = ""; state.allergies = "";
    await load(); renderPanel();
  } catch (e) { toast("Failed: " + e.message, false); }
  finally {
    sendingOrder = false;
    const b = document.getElementById("sendOrder");
    if (b) { b.disabled = false; b.textContent = "SEND TO KITCHEN"; }
  }
}

// ── the poll ─────────────────────────────────────────────────────────────────
// A compact fingerprint of everything the floor + panel draw (now including each
// dish's status, so advancing a dish anywhere repaints the tiles + detail).
function boardSig(d) {
  return JSON.stringify([
    (d.sessions || []).map((s) => [s.id, s.table_number, s.status, s.bill_no]),
    (d.orders || []).map((o) => [o.id, o.table_number, o.status, o.total, o.kot_no, o.payment_status]),
    (d.items || []).map((i) => [i.id, i.order_id, i.status]),
    (d.calls || []).map((c) => [c.id, c.table_number]),
    (d.members || []).map((m) => [m.id, m.session_id, m.approved, m.removed]),
    (d.settings || {}).table_count,
  ]);
}
let lastSig = null;
async function load() {
  state.data = await api("GET", "/state");
  const sig = boardSig(state.data);
  if (sig === lastSig) return;
  lastSig = sig;
  renderFloor();
  if (!state.ordering) renderPanel();
}
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);
load().catch((e) => toast("Can't reach the database: " + e.message, false));
setInterval(() => load().catch(() => {}), 1000); // ~1s real-time (signature-diff means no wasted redraws)
