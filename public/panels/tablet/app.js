// tablet/ui/app.js — the waiter tablet's brain.
//
// LEFT: a live floor of table tiles (state colour, call/joiner badges).
// RIGHT: the selected table's panel — open it, attend calls, approve joiners,
// see its orders, and the heart of it all: TAKE AN ORDER for the table
// (category chips → tap dishes → quantities → confirm → sent to the kitchen
// with a KOT number). The cart survives the 2.5s floor refresh because we only
// redraw the panel when the waiter ISN'T mid-order.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Prices are stored in a USD base; show them in rupees the SAME way the editor
// and guest menu do (× INR_RATE), so every panel shows the identical ₹ amount.
// (Was the bug: this prepended ₹ to the raw USD number → "₹4.19" instead of ₹350.)
const INR_RATE = 84;
const inr = (n) => "₹" + Math.round((parseFloat(n) || 0) * INR_RATE).toLocaleString("en-US");

const state = {
  data: { settings: null, sessions: [], members: [], orders: [], calls: [], dishes: [], categories: [] },
  table: null,          // which table the panel is showing
  ordering: false,      // true while the waiter is building an order (freezes panel redraws)
  cart: [],             // [{ id, title, price, qty }]
  cat: "",              // active category chip in order mode ("" = all)
  dishSearch: "",       // the dish-search text in order mode
  note: "",             // one note for the whole order
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
const confirmDialog = (text) => new Promise((resolve) => {
  $("#confirmText").textContent = text;
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
// Everyone seated at a table's open session (for the Party list + transfer head).
const membersOf = (t) => {
  const s = sessionOf(t);
  return s ? state.data.members.filter((m) => m.session_id === s.id) : [];
};

function tileState(t) {
  const os = ordersOf(t), s = sessionOf(t);
  if (os.some((o) => o.status === "received")) return { cls: "new", label: "New order" };
  if (os.some((o) => o.status === "preparing")) return { cls: "prep", label: "Cooking" };
  if (os.length) return { cls: "done", label: "Served" };
  if (s) return { cls: "seated", label: "Seated" };
  return { cls: "free", label: "Free" };
}

function renderFloor() {
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  let html = "";
  for (let i = 1; i <= n; i++) {
    const st = tileState(i);
    const calls = callsOf(i).length, joiners = joinersOf(i).length;
    html += `<button class="tile t-${st.cls} ${state.table === String(i) ? "sel" : ""}" data-t="${i}">
      <span class="tnum">${i}</span>
      <span class="tlabel">${st.label}</span>
      <span class="tbadges">${calls ? `<em class="b-call">🔔${calls}</em>` : ""}${joiners ? `<em class="b-join">🙋${joiners}</em>` : ""}</span>
    </button>`;
  }
  $("#tiles").innerHTML = html;
  document.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => {
    state.table = b.dataset.t;
    state.ordering = false; state.cart = []; state.note = ""; state.dishSearch = "";
    renderFloor(); renderPanel();
  }));
}

// ── the table panel (view mode) ──────────────────────────────────────────────
function renderPanel() {
  const p = $("#panel");
  if (!state.table) { p.innerHTML = `<div class="empty">Tap a table to see it — or to take an order for it.</div>`; return; }
  if (state.ordering) { renderOrderMode(); return; }
  const t = state.table, s = sessionOf(t), os = ordersOf(t), calls = callsOf(t), joiners = joinersOf(t);
  const members = s ? membersOf(t) : [];
  const callRows = calls.map((c) => `<div class="row"><span>🔔 ${esc(c.note || "Waiter call")}</span><button class="btn small primary" data-attend="${esc(c.id)}">Done</button></div>`).join("");
  const joinRows = joiners.map((m) => `<div class="row"><span>🙋 ${esc(m.name || "Guest")} wants to join</span><button class="btn small primary" data-approve="${esc(m.id)}">Approve</button></div>`).join("");
  // The seated party: the head shows a crown; tap "Make head" to transfer it.
  const partyRows = members.map((m) => `<div class="row"><span>${m.role === "owner" ? "👑" : "•"} ${esc(m.name || "Guest")}${m.approved ? "" : ` <span class="muted">(pending)</span>`}</span>${m.role === "owner" ? `<span class="muted small">head</span>` : `<button class="btn small" data-makehead="${esc(m.id)}">Make head</button>`}</div>`).join("");
  const orderRows = os.map((o) => `<div class="row"><span><b>#${esc(o.kot_no ?? "—")}</b> · ${esc(o.status)} · ${inr(o.total)}</span></div>`).join("");
  p.innerHTML = `
    <div class="phead"><h2>Table ${esc(t)}</h2>${s ? `<span class="live">● open${s.bill_no ? ` · bill #${esc(s.bill_no)}` : ""}</span>` : `<span class="off">closed</span>`}</div>
    ${joinRows ? `<div class="sec"><h3>Waiting to join</h3>${joinRows}</div>` : ""}
    ${callRows ? `<div class="sec"><h3>Calls</h3>${callRows}</div>` : ""}
    ${members.length ? `<div class="sec"><h3>Party</h3>${partyRows}</div>` : ""}
    <div class="sec"><h3>Today's orders</h3>${orderRows || `<div class="muted">No orders yet.</div>`}</div>
    <div class="pactions">
      ${s ? "" : `<button class="btn" id="openTable">Open this table</button>`}
      <button class="btn primary big" id="takeOrder">📝 TAKE ORDER</button>
      ${s ? `<button class="btn" id="shiftTable">⇄ Shift to another table</button>` : ""}
    </div>`;
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = () => act(() => api("POST", `/calls/${b.dataset.attend}/attend`))));
  document.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.approve}/approve`))));
  document.querySelectorAll("[data-makehead]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.makehead}/make-head`))));
  const ob = $("#openTable"); if (ob) ob.onclick = () => act(() => api("POST", "/sessions/open", { table: t }));
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = async () => { const to = prompt("Shift this table's party to which table number?"); if (!to) return; act(() => api("POST", `/sessions/${s.id}/shift`, { to: String(to).trim() })); };
  $("#takeOrder").onclick = () => { state.ordering = true; state.cart = []; state.cat = ""; state.dishSearch = ""; renderPanel(); };
}

const act = async (fn) => { try { await fn(); await load(); renderPanel(); } catch (e) { toast("Failed: " + e.message, false); } };

// ── order-taking mode ────────────────────────────────────────────────────────
const dishPrice = (d) => Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;

// The dishes shown right now: a search term (matches the name) wins over the
// category chip so staff can find anything fast; otherwise filter by category.
function orderDishes() {
  const q = state.dishSearch.trim().toLowerCase();
  return state.data.dishes.filter((d) =>
    q ? (d.title || "").toLowerCase().includes(q) : (!state.cat || d.category === state.cat));
}
// Build just the dish-grid HTML (reused by the live search so we can refresh
// only the grid and keep the search box focused).
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
// Bind the dish "+add" buttons (called after the grid is (re)drawn).
function bindDishButtons() {
  document.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = () => {
    const d = state.data.dishes.find((x) => x.id === b.dataset.dish);
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; } // the poll removed/edited it between render and tap
    const line = state.cart.find((l) => l.id === d.id);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 });
    renderOrderMode();
  }));
}

function renderOrderMode() {
  const p = $("#panel");
  const cats = state.data.categories.filter((c) => c.active !== false);
  // A search term hides the category chips (it searches across everything).
  const chips = state.dishSearch.trim() ? "" : [`<button class="chip ${!state.cat ? "on" : ""}" data-cat="">All</button>`]
    .concat(cats.map((c) => `<button class="chip ${state.cat === c.slug ? "on" : ""}" data-cat="${esc(c.slug)}">${esc((c.name && c.name.en) || c.slug)}</button>`)).join("");
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}</span>
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
      <div class="ctotal"><span>Items total</span><b>${inr(total)}</b></div>
      <div class="muted small">Final bill (incl. tax) is computed by the system when you send it.</div>
      <button class="btn primary big" id="sendOrder" ${state.cart.length ? "" : "disabled"}>SEND TO KITCHEN</button>
    </div>`;
  document.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; renderOrderMode(); }));
  bindDishButtons();
  // Live dish search: refresh ONLY the grid so the search box keeps focus +
  // the cursor (re-rendering the whole panel would blur it after each keystroke).
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
  $("#backBtn").onclick = () => { state.ordering = false; renderPanel(); };
  $("#sendOrder").onclick = sendOrder;
}

let sendingOrder = false; // blocks a double-tapped SEND from firing two identical kitchen tickets
async function sendOrder() {
  if (sendingOrder) return; // already in flight — ignore the second tap
  const count = state.cart.reduce((s, l) => s + l.qty, 0);
  // Two-step confirm: a kitchen ticket is real work — no accidental sends.
  if (!(await confirmDialog(`Send ${count} item${count > 1 ? "s" : ""} to the kitchen for table ${state.table}?`))) return;
  sendingOrder = true;
  const sendBtn = document.getElementById("sendOrder");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending…"; }
  try {
    const r = await api("POST", "/order", {
      table: state.table,
      items: state.cart.map((l) => ({ id: l.id, qty: l.qty })),
      note: state.note.trim() || null,
    });
    // Treat a non-ok or shapeless response as a failure — but DON'T clear the
    // cart, so the waiter can retry without rebuilding the order.
    if (!r || r.ok !== true) { toast("Rejected: " + ((r && r.reason) || "unknown") + (r && r.item ? ` (${r.item})` : ""), false); return; }
    toast(`Sent! Kitchen ticket #${r.kot_no}`);
    state.ordering = false; state.cart = []; state.note = "";
    await load(); renderPanel();
  } catch (e) { toast("Failed: " + e.message, false); }
  finally {
    sendingOrder = false;
    const b = document.getElementById("sendOrder");
    if (b) { b.disabled = false; b.textContent = "SEND TO KITCHEN"; }
  }
}

// ── the poll ─────────────────────────────────────────────────────────────────
// A compact fingerprint of everything the floor tiles + table panel draw. The
// poll re-renders ONLY when this changes — otherwise it would rebuild the DOM
// every 2.5s and a tap landing on a node mid-replacement would be silently
// eaten ("the button is stuck"). User-driven renders (tapping a tile, taking
// an action) still redraw immediately because they call render* directly.
function boardSig(d) {
  return JSON.stringify([
    (d.sessions || []).map((s) => [s.id, s.table_number, s.status, s.bill_no]),
    (d.orders || []).map((o) => [o.id, o.table_number, o.status, o.total, o.kot_no, o.payment_status]),
    (d.calls || []).map((c) => [c.id, c.table_number]),
    (d.members || []).map((m) => [m.id, m.session_id, m.approved, m.removed]),
    (d.settings || {}).table_count,
  ]);
}
let lastSig = null;
async function load() {
  state.data = await api("GET", "/state");
  const sig = boardSig(state.data);
  if (sig === lastSig) return; // nothing the screen shows has changed — leave the live buttons alone
  lastSig = sig;
  renderFloor();
  // Don't clobber a half-built order — the panel only refreshes in view mode.
  if (!state.ordering) renderPanel();
}
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);
load().catch((e) => toast("Can't reach the database: " + e.message, false));
setInterval(() => load().catch(() => {}), 1000); // ~1s real-time (signature-diff means no wasted redraws)
