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

// One dish flows new → cooking → ready → served, then wraps back so a mis-tap is
// undoable. "ready" = kitchen finished it, waiter still has to carry it out (the
// pink alert); "served" = the waiter delivered it. Labels are the words shown.
// Waiter tap flow MATCHES the manager: cooking → served in one tap (the kitchen
// owns "ready"; if they're too busy to mark it, the waiter who carries the food
// just serves it directly). A dish already marked "ready" by the kitchen also
// serves in one tap. (owner, 2026-06-14)
const NEXT_STATUS = { received: "preparing", preparing: "served", ready: "served", served: "received" };
const STATUS_WORD = { received: "new", preparing: "cooking", ready: "ready", served: "served" };
// The standard allergens staff can toggle per order (keep in sync with lib/allergens.ts).
const ALLERGENS = [
  { slug: "gluten", label: "🌾 Gluten" },
  { slug: "dairy", label: "🥛 Dairy" },
  { slug: "eggs", label: "🥚 Eggs" },
  { slug: "nuts", label: "🥜 Nuts" },
  { slug: "soy", label: "🫘 Soy" },
  { slug: "fish", label: "🐟 Fish" },
];

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
  editOrders: new Set(),// order ids currently in staff EDIT mode (after the kitchen-confirm)
  addToOrderId: null,   // when set, the dish browser ADDS to this existing order (not a new one)
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
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  // ✕ so staff can dismiss the notification immediately (owner, 2026-06-21)
  const x = document.createElement("button");
  x.className = "toast-x";
  x.setAttribute("aria-label", "Dismiss");
  x.textContent = "✕";
  x.onclick = () => t.remove();
  t.appendChild(x);
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 2600);
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

// Ask for a MANAGER PIN (a self-contained modal so it needs nothing in the HTML).
// Resolves with the typed digits, or null if cancelled. Sensitive tablet actions
// (ban, discount, closing/restarting a busy table) are unlocked by a manager's PIN.
const pinPrompt = (message, errText) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,340px)", background: "#0f1830", color: "#e7eefc", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">🔑 Manager PIN</div>
    <div style="font-size:13px;color:#9fb2d8;margin:0 0 12px">${message || "A manager PIN is required for this action."}</div>
    <input class="pp-in" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:18px;letter-spacing:4px;text-align:center;outline:none" />
    <div class="pp-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0">${errText || ""}</div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="pp-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:#243049;color:#fff;cursor:pointer">Cancel</button>
      <button class="pp-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:#3b82f6;color:#fff;cursor:pointer">Confirm</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".pp-in");
  const err = box.querySelector(".pp-err");
  setTimeout(() => input.focus(), 50);
  const done = (val) => { ov.remove(); resolve(val); };
  box.querySelector(".pp-cancel").onclick = () => done(null);
  box.querySelector(".pp-ok").onclick = () => {
    const v = input.value.trim();
    if (!/^\d{4,8}$/.test(v)) { err.textContent = "Enter the 4–8 digit PIN."; return; }
    done(v);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") box.querySelector(".pp-ok").click(); else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// Run an action that MAY need a manager PIN: try it plainly first (so it stays
// frictionless when no PIN is configured yet, or for the admin super-user); if the
// server answers "manager PIN required", prompt once and retry with it. Reloads on
// success; a cancelled PIN aborts silently; real errors toast.
async function actGated(method, path, body, opts = {}) {
  try {
    try {
      await api(method, path, body);
    } catch (e) {
      if (!/manager pin/i.test(String(e && e.message))) throw e;
      let pin = await pinPrompt(opts.message);
      while (pin) {
        try { await api(method, path, { ...(body || {}), managerPin: pin }); break; }
        catch (e2) {
          if (/manager pin/i.test(String(e2 && e2.message))) { pin = await pinPrompt(opts.message, "That PIN didn't match — try again."); continue; }
          throw e2;
        }
      }
      if (!pin) return; // cancelled
    }
    await load();
    if (opts.toast) toast(opts.toast);
  } catch (e) {
    toast("Failed: " + e.message, false);
  }
}

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
// An "open" request is MOOT once the table is open (it's already been fulfilled), so
// never show it on an open table — that stale "Asked to open · X" with Approve/Deny was
// a glitch. join/access requests stay valid on an open table. (owner, 2026-06-18)
const reqsOf = (t) => (state.data.requests || []).filter((r) => String(r.table_number) === String(t) && !(r.type === "open" && sessionOf(t)));

// The dish rows for one order. Prefer the real order_items rows (they have an id,
// so each dish can be advanced individually); fall back to the order.items JSON
// (legacy / no per-dish id) exactly like the kitchen does.
function dishRowsOf(o) {
  const db = (state.data.items || []).filter((i) => i.order_id === o.id);
  if (db.length) return db.map((r) => ({ id: r.id, title: r.title, qty: r.qty || 1, status: r.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.unit_price) || 0, added_allergens: r.added_allergens, removed_flag: r.removed_flag, fromDb: true }));
  const js = Array.isArray(o.items) ? o.items : [];
  return js.map((r) => ({ id: null, title: r.title || r.name, qty: r.qty || 1, status: r.status || o.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.price) || 0, fromDb: false }));
}

// Everything a tile needs about a table in one pass: dish counts by status,
// KOT numbers, guests, and whether the bill is paid (drives the outline).
function tableAgg(t) {
  const os = ordersOf(t), s = sessionOf(t);
  let nw = 0, ck = 0, rd = 0, sv = 0, due = 0;
  const kots = [];
  os.forEach((o) => {
    if (o.kot_no != null) kots.push(o.kot_no);
    if (o.payment_status !== "paid") due += (Number(o.total) || 0) - (Number(o.discount) || 0);
    dishRowsOf(o).forEach((r) => {
      const q = r.qty || 1;
      if (r.status === "served") sv += q; else if (r.status === "ready") rd += q; else if (r.status === "preparing") ck += q; else nw += q;
    });
  });
  const unpaid = os.some((o) => o.payment_status !== "paid");
  return { os, nw, ck, rd, sv, due, kots, session: s, guests: membersOf(t).length, unpaid, paid: os.length > 0 && !unpaid, billNo: s && s.bill_no };
}

// The tile's colour/label, decided by the most urgent thing for the waiter: a
// brand-new (unaccepted) dish, then READY-to-serve (pink — go carry it out!),
// then cooking, then all-served, then just seated, then free.
function tileState(t) {
  const a = tableAgg(t);
  if (a.nw > 0) return { cls: "new", label: "New order" };
  if (a.rd > 0) return { cls: "ready", label: "Ready to serve" };
  if (a.ck > 0) return { cls: "prep", label: "Preparing" };
  // All dishes served: yellow "bill" tile while money is still due, plain "done" once paid.
  if (a.os.length && a.sv > 0) return { cls: a.unpaid ? "bill" : "done", label: "Served" };
  if (a.session) return a.guests ? { cls: "seated", label: "Seated" } : { cls: "waiting", label: "Open" };
  // Free table, but a guest has asked to be let in → "Wants in" (amber glow), matching
  // the manager. NOT a red ring — red is reserved for an UNPAID bill, so a red ring on
  // a free/requested table is confusing. (owner, 2026-06-18)
  if (reqsOf(t).length) return { cls: "req", label: "Wants in" };
  return { cls: "free", label: "Free" };
}

// A table "needs attention" if it has a waiter call, a pending request, a brand-new
// order to accept, or food sitting READY that the waiter must carry out.
const needsAttention = (i) => { const a = tableAgg(i); return callsOf(i).length > 0 || reqsOf(i).length > 0 || a.nw > 0 || a.rd > 0; };

function tableCount() { return Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12); }
// Tablet billing permission for an action (set by the manager in General settings):
// 'off' (hidden — default) | 'on' (waiter can do it) | 'pin' (needs a manager PIN).
const tperm = (k) => ((state.data.settings || {})[k] || "off");

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
    if (st.cls === "free" || st.cls === "req") {
      body = `<span class="tsub">${st.cls === "req" ? "asked to open" : "tap to open"}</span><span class="topen" data-quick="open" data-qt="${i}">Open</span>`;
    } else {
      const kot = a.kots.length ? `KOT #${a.kots[a.kots.length - 1]}${a.kots.length > 1 ? ` +${a.kots.length - 1}` : ""}` : "no order yet";
      const total = a.nw + a.ck + a.rd + a.sv;
      const strip = total > 0 ? `<div class="tstrip">${a.nw ? `<i style="width:${(a.nw / total) * 100}%;background:#f59e0b"></i>` : ""}${a.ck ? `<i style="width:${(a.ck / total) * 100}%;background:#4f9dff"></i>` : ""}${a.rd ? `<i style="width:${(a.rd / total) * 100}%;background:#ec4899"></i>` : ""}${a.sv ? `<i style="width:${(a.sv / total) * 100}%;background:#22c55e"></i>` : ""}</div>` : "";
      const pills = total > 0 ? `<div class="tpills">${a.nw ? `<span class="tpill nw">${a.nw} new</span>` : ""}${a.ck ? `<span class="tpill ck">${a.ck} cooking</span>` : ""}${a.rd ? `<span class="tpill rd">${a.rd} ready</span>` : ""}${a.sv ? `<span class="tpill sv">${a.sv} served</span>` : ""}</div>` : "";
      // ONE contextual quick action, same priority as the manager floor tile:
      // new order → Accept, a call/request → Attend, served-but-unpaid → Mark paid.
      let quick = "";
      if (a.nw > 0) quick = `<span class="tacc" data-quick="accept" data-qt="${i}">✓ Accept</span>`;
      else if (called || joiners) quick = `<span class="tatt" data-quick="attend" data-qt="${i}">Attend</span>`;
      else if (st.cls === "bill" && tperm("tablet_mark_paid") !== "off") quick = `<span class="tpay" data-quick="pay" data-qt="${i}">💳 Mark paid</span>`;
      body = `<span class="tsub">${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${kot}</span>${strip}${pills}${quick}`;
    }
    html += `<button class="tile t-${st.cls} ${payCls} ${state.table === String(i) ? "sel" : ""}" data-t="${i}">
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
    optimisticOpen(q.dataset.qt);
  }));
  // Quick "Accept" on the tile — accept every new order for the table in one tap.
  // Optimistic (instant), reusing the same helper the Accept-all button uses.
  document.querySelectorAll(".tacc[data-quick='accept']").forEach((q) => (q.onclick = (e) => {
    e.stopPropagation();
    optimisticAccept(ordersOf(q.dataset.qt).filter((o) => o.status === "received").map((o) => o.id));
  }));
  // Quick "Attend" — open the table's detail to handle the call / join request.
  document.querySelectorAll(".tatt[data-quick='attend']").forEach((q) => (q.onclick = (e) => {
    e.stopPropagation();
    state.table = q.dataset.qt; state.ordering = false; renderFloor(); renderPanel();
    if (window.matchMedia("(max-width: 760px)").matches) document.getElementById("panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  // Quick "Mark paid" on a served-but-unpaid tile — same confirm + whole-table
  // pay as the detail panel's "Mark bill paid", without opening the table.
  document.querySelectorAll(".tpay[data-quick='pay']").forEach((q) => (q.onclick = async (e) => {
    e.stopPropagation();
    const t = q.dataset.qt, a = tableAgg(t);
    if (await confirmDialog(`Mark bill ${a.billNo ? `#${a.billNo} ` : ""}PAID for table ${t}? Total ${inr(a.due)}. Are you sure the payment has been collected?`, "Yes, payment done"))
      payBill(t);
  }));
}

// openDishEditModal: ONE editor for a single placed dish — toggle which allergens
// to AVOID (the 6 standard ones PLUS any custom typed in the box) and write a
// kitchen note. IDENTICAL to the manager panel's modal, adapted to the tablet's
// state (state.data.items) + /api/tablet endpoints. Save persists in one go:
//   • adding an allergen → this dish's own list (order_items.removed)
//   • removing one → cleared from the dish AND the order-wide "avoid" list
//   • the note → order_items.note
function openDishEditModal(itemId) {
  document.querySelector(".dish-edit-overlay")?.remove();
  const item = (state.data.items || []).find((i) => i.id === itemId);
  if (!item) { toast("That dish is no longer on the order.", false); return; }
  const order = (state.data.orders || []).find((o) => o.id === item.order_id) || {};
  // Normalise: lowercase, trim, strip a leading "no " so "no water"/"water" both store "water".
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/^no[\s-]+/, "");
  const itemRemoved = (Array.isArray(item.removed) ? item.removed : []).map(norm).filter(Boolean);
  const orderAllergies = (Array.isArray(order.allergies) ? order.allergies : []).map(norm).filter(Boolean);
  const initial = new Set([...itemRemoved, ...orderAllergies]); // what the dish avoids now
  const working = new Set(initial);                             // live working copy until Save
  const STD = ALLERGENS.map((a) => a.slug);
  const labelFor = (slug) => { const a = ALLERGENS.find((x) => x.slug === slug); return a ? a.label : "🚫 " + slug; };
  const chipsHtml = () => {
    const std = ALLERGENS.map((a) => `<span class="chip talg ${working.has(a.slug) ? "on" : ""}" data-slug="${esc(a.slug)}">${esc(a.label)}</span>`).join("");
    // Custom allergens are their own chips — tap one to REMOVE it (same as a standard chip).
    const cust = [...working].filter((s) => !STD.includes(s)).map((s) => `<span class="chip talg on" data-slug="${esc(s)}">${esc(labelFor(s))}</span>`).join("");
    return std + cust;
  };
  const ov = document.createElement("div");
  ov.className = "dish-edit-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="dish-edit-box" style="width:min(94vw,460px);max-height:90vh;overflow:auto;background:#0f1830;color:#e7eefc;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #1d2944"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Edit dish · ${esc(item.title)}</h3><button class="dish-edit-close" aria-label="Close" style="background:#243049;border:0;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px">⚠ Allergies to avoid <span class="muted small">— tap to add or remove</span></div>
      <div class="dish-alg-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><input type="text" class="dish-edit-custominput" maxlength="24" placeholder="Type a custom allergen — e.g. water" style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px"><button class="btn small dish-edit-customadd">Add</button></div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">✎ Note for the kitchen</div>
      <textarea class="dish-edit-note" rows="2" maxlength="200" placeholder="e.g. less ice, extra chocolate" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #1d2944"><button class="btn dish-edit-cancel">Cancel</button><button class="btn primary dish-edit-save">Save</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".dish-edit-note").value = item.note || "";
  const listEl = ov.querySelector(".dish-alg-list");
  const input = ov.querySelector(".dish-edit-custominput");
  const bindChips = () => listEl.querySelectorAll("[data-slug]").forEach((c) => (c.onclick = () => { const s = c.dataset.slug; working.has(s) ? working.delete(s) : working.add(s); redraw(); }));
  const redraw = () => { listEl.innerHTML = chipsHtml(); bindChips(); };
  redraw();
  const addCustom = () => { const v = norm(input.value); if (v) working.add(v); input.value = ""; redraw(); input.focus(); };
  ov.querySelector(".dish-edit-customadd").onclick = addCustom;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } };
  const close = () => ov.remove();
  ov.querySelector(".dish-edit-close").onclick = close;
  ov.querySelector(".dish-edit-cancel").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
  ov.querySelector(".dish-edit-save").onclick = async () => {
    const note = ov.querySelector(".dish-edit-note").value.trim();
    const removed = [...initial].filter((s) => !working.has(s));  // cleared → drop everywhere
    const added = [...working].filter((s) => !initial.has(s));    // new avoids → this dish only
    const newItemRemoved = [...new Set([...itemRemoved.filter((s) => !removed.includes(s)), ...added])];
    const newOrderAllergies = orderAllergies.filter((s) => !removed.includes(s));
    try {
      if (note !== String(item.note || "").trim()) await api("POST", `/items/${item.id}/note`, { note });
      if (!same(newItemRemoved, itemRemoved)) await api("POST", `/items/${item.id}/removed`, { removed: newItemRemoved });
      if (order.id && !same(newOrderAllergies, orderAllergies)) await api("POST", `/orders/${order.id}/allergies`, { allergies: newOrderAllergies });
      close();
      await load(); if (!state.ordering) renderPanel();
      toast("Dish updated");
    } catch (e) { toast("Couldn't save: " + e.message, false); }
  };
  setTimeout(() => input.focus(), 30);
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
  const partyRows = members.map((m) => `<div class="row"><span>${m.role === "owner" ? "👑" : "•"} ${esc(m.name || "Guest")}${m.approved ? "" : ` <span class="muted">(pending)</span>`}</span>${m.role === "owner" ? `<span class="muted small">head</span>` : `<span class="reqbtns"><button class="btn small" data-makehead="${esc(m.id)}">Make head</button><button class="btn small" data-kick="${esc(m.id)}">Kick</button><button class="btn small danger" data-ban="${esc(m.id)}">Ban</button></span>`}</div>`).join("");
  // Live shared cart the table is BUILDING but hasn't sent yet (read-only) — mirrors
  // the manager's "Building" section; clears itself the moment they place the order.
  const cart = s && Array.isArray(s.cart) ? s.cart : [];
  const buildingRows = cart.map((it) => `<div class="row"><span>×${esc(String(it.qty || 1))} ${esc(it.title || "Item")}</span><span class="muted small">building</span></div>`).join("");

  // Each order is a card: KOT chip, time, "via app" badge for guest/phone orders,
  // every dish with a tappable status pill, and an Accept button when it's new.
  // One dish row: qty · name · price · status badge · Serve button, with per-item
  // allergens (the order-wide "avoid in all" distributed onto each item; no banner).
  const dishRowHtml = (r, o) => {
    const opt = (r.options && r.options.length) ? `<div class="iopt">${esc(r.options.map((x) => x.label || x).join(" · "))}</div>` : "";
    const orderAllergies = Array.isArray(o.allergies) ? o.allergies : [];
    const lineRem = [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])];
    // A staff-ADDED allergen carries a green "＋"; a removed one flags "✎−" on the name.
    const addedSet = new Set((Array.isArray(r.added_allergens) ? r.added_allergens : []).map((x) => String(x).toLowerCase()));
    const rem = lineRem.length ? `<div class="irem">no ${lineRem.map((x) => `${esc(String(x))}${addedSet.has(String(x).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", ")}</div>` : "";
    const remMark = r.removed_flag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
    const note = r.note ? `<div class="iopt">“${esc(r.note)}”</div>` : "";
    const priceTag = r.price > 0 ? `<span class="iprice">${inr(r.price * r.qty)}</span>` : "";
    const statusBadge = `<span class="ist ${r.status}">${STATUS_WORD[r.status] || r.status}</span>`;
    const serveBtn = (r.fromDb && (r.status === "preparing" || r.status === "ready"))
      ? `<button class="ist-serve" data-serve="${esc(r.id)}" data-cur="${esc(r.status)}">✓ Serve</button>` : "";
    // Per-dish delete (only for real saved dishes, not served): removes the dish and
    // re-prices the bill server-side. (owner, 2026-06-16)
    const delBtn = (r.fromDb && r.status !== "served")
      ? `<button class="idel" data-del-item="${esc(r.id)}" title="Remove this dish">🗑</button>` : "";
    // STAFF EDIT mode (gated by the kitchen-confirm): quantity steppers + a single
    // "✎ Edit" button that opens ONE modal (allergens + kitchen note) — IDENTICAL to
    // the manager panel. (owner, 2026-06-18)
    const editing = state.editOrders.has(o.id);
    // No editing once a dish is READY or SERVED — it's cooked/out, changing it is too
    // late (mirror the manager; place a new order instead). (owner, 2026-06-18)
    const editCtl = (editing && r.fromDb && r.status !== "served" && r.status !== "ready")
      ? `<span class="iedit"><button class="qbtn" data-qty-dec="${esc(r.id)}" data-qty="${r.qty}" title="Fewer">−</button><button class="qbtn" data-qty-inc="${esc(r.id)}" data-qty="${r.qty}" title="More">＋</button><button class="qbtn" data-edit-dish="${esc(r.id)}" title="Edit allergens & note for this dish">✎ Edit</button></span>`
      : "";
    return `<div class="iline${editing ? " editing" : ""}"><span class="iqty">${r.qty}×</span><span class="inm">${esc(r.title)}${remMark}${opt}${rem}${note}</span>${priceTag}${statusBadge}${serveBtn}${editCtl}${delBtn}</div>`;
  };
  // Per-order staff controls. NOT editing: an "✎ Edit" button (opens the gated edit
  // mode) + Delete order. EDITING: allergen toggle chips ("avoid in all dishes"),
  // an "＋ Add dish" button, Delete order, and "✓ Done editing". The dish rows show
  // qty steppers + a note edit while editing. (owner, 2026-06-17)
  const orderControlsHtml = (o) => {
    if (!state.editOrders.has(o.id)) {
      return `<div class="ordctl">
        <button class="btn small" data-edit-order="${esc(o.id)}">✎ Edit</button>
        <button class="btn small danger" data-del-order="${esc(o.id)}">🗑 Delete order${o.kot_no != null ? ` #${esc(o.kot_no)}` : ""}</button>
      </div>`;
    }
    // Order-wide allergen chips = the 6 standard toggles only, EXACTLY like the
    // manager's per-order chips. A CUSTOM ("other") allergen is added per-dish via
    // the "✎ Edit" modal, not here. (owner, 2026-06-18 — mirror the manager)
    const aSet = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
    const chips = ALLERGENS.map((a) => `<span class="chip talg ${aSet.has(a.slug) ? "on" : ""}" data-alg="${esc(o.id)}" data-slug="${a.slug}">${esc(a.label)}</span>`).join("");
    return `<div class="ordctl ordctl-edit">
      <div class="ordctl-alg"><span class="muted small">⚠ Avoid (all dishes):</span>${chips}</div>
      <div class="ordctl-row">
        <button class="btn small" data-add-dish="${esc(o.id)}">＋ Add dish</button>
        ${tperm("tablet_discount") !== "off" ? `<button class="btn small" data-discount="${esc(o.id)}">− Discount${Number(o.discount) > 0 ? ` (${inr(o.discount)})` : ""}</button>` : ""}
        <button class="btn small danger" data-del-order="${esc(o.id)}">🗑 Delete order${o.kot_no != null ? ` #${esc(o.kot_no)}` : ""}</button>
        <button class="btn small primary" data-done-order="${esc(o.id)}">✓ Done editing</button>
      </div>
    </div>`;
  };
  // MERGED like the manager: un-accepted orders stay SEPARATE (each with its own
  // Accept); accepted orders fold into ONE combined list with a dashed separator
  // between each source order — the single bill lives in the footer (owner, 2026-06-14).
  const newOrdersT = os.filter((o) => o.status === "received");
  const liveOrdersT = os.filter((o) => o.status !== "received" && o.status !== "cancelled");
  const newCards = newOrdersT.map((o) => {
    const when = o.created_at ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const viaApp = !!o.member_id;
    const rows = dishRowsOf(o).map((r) => dishRowHtml(r, o)).join("");
    return `<div class="ord"><div class="ordh"><span class="left"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="when">New order${when ? ` · ${when}` : ""}</span>${viaApp ? `<span class="viaapp">via app 📱</span>` : ""}</span></div>${rows || `<div class="iline muted">No items.</div>`}${orderControlsHtml(o)}<button class="accept" data-accept="${esc(o.id)}">✓ Accept</button></div>`;
  }).join("");
  const mergedDishes = liveOrdersT.map((o, i) => (i > 0 ? `<div class="ord-sep" aria-hidden="true"></div>` : "") + dishRowsOf(o).map((r) => dishRowHtml(r, o)).join("") + orderControlsHtml(o)).join("");
  const mergedCard = liveOrdersT.length ? `<div class="ord">${mergedDishes}</div>` : "";
  const orderCards = newCards + mergedCard;

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
      ${callRows ? `<div class="sec"><h3>Calls</h3>${calls.length > 1 ? `<button class="btn small primary" data-attend-all-calls="${esc(t)}">Attend all (${calls.length})</button>` : ""}${callRows}</div>` : ""}
      ${s ? `<div class="sec"><h3>Party</h3>${partyRows || `<div class="muted small">No guests joined yet.</div>`}</div>` : ""}
      ${buildingRows ? `<div class="sec"><h3>🛒 Building <span class="muted small">· not sent yet</span></h3>${buildingRows}</div>` : ""}
      <div class="sec"><h3>Orders</h3>${(os.filter((o) => o.status === "received").length > 1) ? `<button class="accept accept-all" data-accept-all="${esc(t)}">✓ Accept all &amp; prepare (${os.filter((o) => o.status === "received").length})</button>` : ""}${(os.some((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served"))) ? `<button class="serve-all-btn" data-serve-all="${esc(t)}">🍽️ Serve all</button>` : ""}${orderCards || `<div class="muted">No orders yet.</div>`}</div>
    </div>
    <div class="dacts">
      ${s ? "" : `<button class="btn" id="openTable">Open this table</button>`}
      <button class="btn primary big" id="takeOrder">＋ Take order</button>
      ${s ? `<button class="btn" id="shiftTable">⇄ Move table</button>` : ""}
      ${s && os.length ? `<button class="btn" id="restartTable">↻ Restart</button>` : ""}
      ${s && os.length && a.unpaid && tperm("tablet_mark_paid") !== "off" ? `<button class="btn pay" id="payBill">💳 Mark bill paid</button>` : ""}
      ${s ? `<button class="btn danger" id="closeTable">✕ Close table</button>` : ""}
    </div>
    ${foot}`;

  // wire it up
  document.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqApprove}/resolve`, { status: "approved" }))));
  document.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqDeny}/resolve`, { status: "denied" }))));
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = () => act(() => api("POST", `/calls/${b.dataset.attend}/attend`))));
  document.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.approve}/approve`))));
  document.querySelectorAll("[data-makehead]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.makehead}/make-head`))));
  // Kick a guest off the table (table stays open). Confirm first — it ends access.
  document.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Kick this guest from the table? Their access ends now — the table stays open.", "Kick"))
      act(() => api("POST", `/members/${b.dataset.kick}/remove`));
  }));
  // Ban a guest: kicked now AND blocklisted so they can't rejoin. Destructive — confirm.
  document.querySelectorAll("[data-ban]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Ban this guest? They're kicked now and blocked from rejoining this table.", "Ban"))
      actGated("POST", `/members/${b.dataset.ban}/ban`, null, { message: "Enter a manager PIN to ban this guest." });
  }));
  // Auto-approve toggle: future joiners are approved automatically (no staff review).
  // Attend every waiter call on the table in one tap.
  document.querySelectorAll("[data-attend-all-calls]").forEach((b) => (b.onclick = () => act(async () => {
    for (const c of callsOf(b.dataset.attendAllCalls)) await api("POST", `/calls/${c.id}/attend`);
  })));
  // Discount: shown only when the manager enables it for the tablet (General settings
  // → tablet_discount = on/pin; default off = no button). tabletDiscount() applies
  // the on/pin rule; the server enforces it too.
  document.querySelectorAll("[data-discount]").forEach((b) => (b.onclick = () => tabletDiscount(b.dataset.discount)));
  // Accept ONE order — optimistic (flips received→preparing instantly, persists in bg).
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => optimisticAccept([b.dataset.accept])));
  // Accept ALL un-accepted orders on the table in one tap — optimistic + bulk.
  document.querySelectorAll("[data-accept-all]").forEach((b) => (b.onclick = () =>
    optimisticAccept(ordersOf(b.dataset.acceptAll).filter((o) => o.status === "received").map((o) => o.id))));
  // Serve ALL accepted-but-unserved dishes on the table in one tap — optimistic + bulk.
  // Flips every dish to served on screen INSTANTLY, then fires one /serve-all per order
  // in the background (mirrors the manager + advanceDish). No more waiting on the network.
  document.querySelectorAll("[data-serve-all]").forEach((b) => (b.onclick = () =>
    optimisticServeAll(ordersOf(b.dataset.serveAll).filter((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served")).map((o) => o.id))));
  // Per-dish advance: optimistically flip the pill, then persist + reconcile.
  document.querySelectorAll(".ist.tap[data-item]").forEach((el) => (el.onclick = () => advanceDish(el.dataset.item, el.dataset.cur)));
  // Explicit "✓ Serve" button on each cooking/ready dish → serves it directly
  // (advanceDish takes preparing/ready straight to served).
  document.querySelectorAll("[data-serve]").forEach((b) => (b.onclick = () => advanceDish(b.dataset.serve, b.dataset.cur)));
  // Per-dish delete (confirm first; the server re-prices / cancels an emptied order).
  document.querySelectorAll("[data-del-item]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Remove this dish from the order? The bill updates automatically.", "Remove dish"))
      act(() => api("POST", `/items/${b.dataset.delItem}/delete`));
  }));
  // Delete a WHOLE order (confirm; refused server-side if the order is already paid).
  document.querySelectorAll("[data-del-order]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Delete this whole order? It will be permanently removed.", "Delete order"))
      act(() => api("POST", `/orders/${b.dataset.delOrder}/delete`));
  }));
  // ── STAFF EDIT-AFTER-CONFIRM (owner, 2026-06-17) ──────────────────────────
  // Enter edit mode ONLY after the waiter confirms with the kitchen it's still
  // editable (the order may already be cooking). The 2-step confirm IS the guard.
  document.querySelectorAll("[data-edit-order]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Have you checked with the kitchen that this order is still editable? Only edit if they haven't started making it.", "Yes — it's editable")) {
      state.editOrders.add(b.dataset.editOrder); renderPanel();
    }
  }));
  document.querySelectorAll("[data-done-order]").forEach((b) => (b.onclick = () => { state.editOrders.delete(b.dataset.doneOrder); renderPanel(); }));
  // Quantity −/＋ on one dish (re-prices the bill server-side, clamped 1..99).
  document.querySelectorAll("[data-qty-inc]").forEach((b) => (b.onclick = () => act(() => api("POST", `/items/${b.dataset.qtyInc}/qty`, { qty: Math.min(99, (parseInt(b.dataset.qty, 10) || 1) + 1) }))));
  document.querySelectorAll("[data-qty-dec]").forEach((b) => (b.onclick = () => { const q = (parseInt(b.dataset.qty, 10) || 1) - 1; if (q < 1) { toast("Use 🗑 to remove the dish", false); return; } act(() => api("POST", `/items/${b.dataset.qtyDec}/qty`, { qty: q })); }));
  // "✎ Edit" one dish → the unified modal (allergens incl. custom + kitchen note),
  // IDENTICAL to the manager panel's openDishEditModal.
  document.querySelectorAll("[data-edit-dish]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.editDish)));
  // Add a dish to THIS already-placed order: reuse the dish browser in add mode.
  document.querySelectorAll("[data-add-dish]").forEach((b) => (b.onclick = () => { state.ordering = true; state.addToOrderId = b.dataset.addDish; state.cat = ""; state.dishSearch = ""; renderPanel(); }));
  // Per-order allergen chips: toggle an allergen on/off for the whole order.
  document.querySelectorAll(".talg[data-alg]").forEach((chip) => (chip.onclick = () => {
    const id = chip.dataset.alg, slug = chip.dataset.slug;
    const o = (state.data.orders || []).find((x) => x.id === id);
    if (!o) return;
    const cur = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
    if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
    act(() => api("POST", `/orders/${id}/allergies`, { allergies: [...cur] }));
  }));
  const ob = $("#openTable"); if (ob) ob.onclick = () => optimisticOpen(t);
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = () => renderShiftPicker(t, s);
  // Restart: clear this round's orders off the floor (they stay served+archived in
  // records) but keep the table OPEN for a fresh round. Mirrors the manager.
  const rsb = $("#restartTable"); if (rsb && s) rsb.onclick = async () => {
    if (!(await confirmDialog(`Restart table ${t}? Its current orders clear off the floor and the table stays OPEN for a fresh round.`, "Restart"))) return;
    // Restart means NO ONE is sitting and the round is cleared — show that INSTANTLY.
    // Clear this table's orders + free its seats locally so the tile never flashes the
    // old "1 seated"/round state during the (gated) round-trip. The final load() below
    // reconciles — and reverts this if the manager PIN is cancelled. (owner, 2026-06-20)
    const sid = s.id;
    state.data.orders = state.data.orders.filter((o) => String(o.table_number) !== String(t));
    state.data.members = state.data.members.filter((m) => m.session_id !== sid);
    renderFloor(); renderPanel();
    await actGated("POST", `/tables/${t}/restart`, null, { message: "This table has a round going — enter a manager PIN to restart it." });
    await load(); // reconcile (also reverts the optimistic clear if the PIN was cancelled)
  };
  const pb = $("#payBill"); if (pb) pb.onclick = async () => {
    if (await confirmDialog(`Mark bill ${a.billNo ? `#${a.billNo} ` : ""}PAID for table ${t}? Total ${inr(a.due)}. Are you sure the payment has been collected?`, "Yes, payment done"))
      payBill(t);
  };
  const clb = $("#closeTable"); if (clb && s) clb.onclick = async () => {
    const warn = a.unpaid && os.length ? ` The bill (${inr(a.due)}) is still UNPAID.` : "";
    if (!(await confirmDialog(`Close table ${t} and free it?${warn}`, "Close table"))) return;
    // OPTIMISTIC: drop the session locally so the tile frees INSTANTLY, then persist.
    state.data.sessions = (state.data.sessions || []).filter((x) => x.id !== s.id);
    state.table = null; state.ordering = false;
    renderFloor(); renderPanel();
    try {
      await api("POST", `/sessions/${s.id}/close`);
      await load();
    } catch (e) {
      await load(); // server refused — refetch so the still-open table reappears
      if (/close anyway/i.test(String(e && e.message))) {
        if (await confirmDialog(`${e.message}`, "Close anyway")) {
          await actGated("POST", `/sessions/${s.id}/close`, { force: true }, { message: "Enter a manager PIN to close this busy table.", toast: "Table closed" });
        }
        return;
      }
      toast("Failed: " + e.message, false);
    }
  };
  const bt = $("#backTop"); if (bt) bt.onclick = () => document.querySelector(".floor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#takeOrder").onclick = () => { state.ordering = true; state.cart = []; state.cat = ""; state.dishSearch = ""; renderPanel(); };
}

// Advance one dish new→cooking→served (wrapping). Optimistic so it feels instant.
// After serving stops for a moment, do ONE real refetch to reconcile — instead of
// reloading the whole board after EVERY tap (that full reload was the ~1.5s
// "auto-refresh" between serves). The optimistic update already shows it instantly.
let serveReconcileTimer = null;
function scheduleServeReconcile() {
  if (serveReconcileTimer) clearTimeout(serveReconcileTimer);
  serveReconcileTimer = setTimeout(() => { serveReconcileTimer = null; load().catch(() => {}); }, 2500);
}
function advanceDish(id, cur) {
  const next = NEXT_STATUS[cur] || "preparing";
  const it = (state.data.items || []).find((x) => x.id === id);
  if (it) it.status = next;            // optimistic — the pill flips instantly
  // Adopt this state as the baseline so a poll that arrives with the SAME
  // (server-confirmed) data won't repaint the panel under the waiter's finger.
  lastSig = boardSig(state.data);
  renderFloor();
  if (!state.ordering) renderPanel();
  // Fire-and-forget; reconcile once after the taps stop (not per tap).
  api("POST", `/items/${id}/status`, { status: next })
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}

// Bulk order actions (accept / serve-all) the OPTIMISTIC way — flip the orders +
// their dishes in local state and repaint INSTANTLY, then persist in the background
// (one bulk call per order), then reconcile once after. Mirrors advanceDish above
// and the manager's serveAllOrders/acceptTableOrders so it feels instant instead of
// making the waiter wait on the network. (owner, 2026-06-18)
function flipOrders(orderIds, { from, to, orderStatus }) {
  const items = state.data.items || [];
  orderIds.forEach((oid) => {
    const o = (state.data.orders || []).find((x) => x.id === oid);
    if (o) o.status = orderStatus;
    items.forEach((it) => { if (it.order_id === oid && (from ? it.status === from : it.status !== "served")) it.status = to; });
    if (o && Array.isArray(o.items)) o.items = o.items.map((i) => ((from ? i.status === from : i.status !== "served") ? { ...i, status: to } : i));
  });
  lastSig = boardSig(state.data);      // adopt as baseline so a poll can't flicker it back
  renderFloor();
  if (!state.ordering) renderPanel();
}
function optimisticAccept(orderIds) {
  if (!orderIds.length) return;
  flipOrders(orderIds, { from: "received", to: "preparing", orderStatus: "preparing" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/accept`)))
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}
function optimisticServeAll(orderIds) {
  if (!orderIds.length) return;
  flipOrders(orderIds, { from: null, to: "served", orderStatus: "served" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/serve-all`)))
    .then(() => scheduleServeReconcile())
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
  await load();   // load() already repaints if anything changed — no second render (that was the extra flash)
}

const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast("Failed: " + e.message, false); } };

// Open a table INSTANTLY (mirrors the manager): drop a pending "open" session into
// local state + repaint NOW, then create it on the server and reconcile. On failure
// runOptimistic's load() refetches and the pending session disappears. (owner, 2026-06-19)
function optimisticOpen(table) {
  const t = String(table);
  if (sessionOf(t)) return; // already open
  runOptimistic(
    () => {
      state.data.sessions = [...(state.data.sessions || []), { id: "pending-" + t, table_number: t, status: "open", auto_approve: false }];
      if (Array.isArray(state.data.requests)) state.data.requests = state.data.requests.filter((r) => !(r.type === "open" && String(r.table_number) === t));
    },
    () => api("POST", "/sessions/open", { table: t }),
  );
}

// Mark a table's whole bill paid INSTANTLY: flip every order's payment_status to
// "paid" locally so the tile/detail re-read as paid (no due) right away, then persist
// + reconcile. runOptimistic's load() reverts on failure. (owner, 2026-06-20)
function optimisticPay(t) {
  runOptimistic(
    () => { state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.payment_status = "paid"; }); },
    () => api("POST", `/tables/${t}/pay`),
  );
}
// Settle a table's bill respecting the manager's tablet_mark_paid setting: 'on' →
// instant optimistic pay; 'pin' → manager-PIN-gated (the server also enforces it).
function payBill(t) {
  if (tperm("tablet_mark_paid") === "pin") {
    actGated("POST", `/tables/${t}/pay`, null, { message: "Enter a manager PIN to mark this bill paid.", toast: "Bill paid" });
  } else {
    optimisticPay(t);
  }
}
// Apply a per-order discount respecting tablet_discount: prompt amount + reason, then
// 'on' → apply directly, 'pin' → manager-PIN-gated. (Discount is clamped server-side.)
async function tabletDiscount(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  const cur = o && Number(o.discount) > 0 ? String(o.discount) : "";
  const raw = window.prompt("Discount amount (₹) for this order — 0 to clear:", cur);
  if (raw === null) return;
  const amount = Math.max(0, Number(raw) || 0);
  const note = amount > 0 ? (window.prompt("Reason (optional, e.g. loyalty/comp):", (o && o.discount_note) || "") || "") : "";
  if (tperm("tablet_discount") === "pin") {
    actGated("POST", `/orders/${orderId}/discount`, { amount, note }, { message: "Enter a manager PIN to apply this discount." });
  } else {
    act(() => api("POST", `/orders/${orderId}/discount`, { amount, note }));
  }
}

// ── order-taking mode ────────────────────────────────────────────────────────
const dishPrice = (d) => Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;

// Add ONE dish to an already-placed order (staff edit). Server prices + re-prices.
// Stays in add mode so the waiter can add several, then taps "✓ Done".
async function addDishToOrder(orderId, payload) {
  try {
    const r = await api("POST", `/orders/${orderId}/add-item`, payload);
    if (r && r.ok === false) { toast("Couldn't add: " + (r.reason || "rejected"), false); return; }
    toast("Dish added ✓");
    await load();
    if (state.addToOrderId) renderOrderMode(); else if (!state.ordering) renderPanel();
  } catch (e) { toast("Failed: " + e.message, false); }
}

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
    // Total this dish across ALL its cart lines (a dish can now appear on several
    // lines — e.g. plain + "no nuts"), so the badge shows the true count.
    const inCartQty = state.cart.filter((l) => l.id === d.id).reduce((s, l) => s + l.qty, 0);
    return `<button class="dish ${out ? "out" : ""} ${inCartQty ? "in" : ""}" data-dish="${esc(d.id)}" ${out ? "disabled" : ""}>
      <span class="dname">${esc(d.title)}</span>
      <span class="drow">
        <span class="dprice">${out ? "SOLD OUT" : inr(dishPrice(d))}</span>
        ${out ? "" : inCartQty ? `<span class="dqty">×${inCartQty}</span>` : `<span class="dadd" aria-hidden="true">＋</span>`}
      </span>
    </button>`;
  }).join("");
}
function bindDishButtons() {
  document.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = () => {
    const d = state.data.dishes.find((x) => x.id === b.dataset.dish);
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; }
    if (Array.isArray(d.options) && d.options.length) { renderDishOptions(d, null); return; }
    // ADD-TO-EXISTING-ORDER mode: a plain dish is added straight away (no cart).
    if (state.addToOrderId) { addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1 }); return; }
    // A quick tap only stacks onto a PLAIN line of this dish — one with no options,
    // no per-item allergy and no note. An edited line (e.g. "no nuts") is left alone,
    // so tapping the dish again starts a fresh plain line instead of bumping the
    // customised one — letting a waiter order "1 no-nuts" AND "1 normal" of the same
    // dish side by side. (owner, 2026-06-16)
    const line = state.cart.find((l) => l.id === d.id && !l.options && !l.allergy && !l.note);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 });
    renderOrderMode();
  }));
}

function renderDishOptions(d, editIndex) {
  const sel = {};
  const line = editIndex != null ? state.cart[editIndex] : null;
  if (line && line.options) for (const o of line.options) (sel[o.group] = sel[o.group] || []).push(o.label);
  // carry the line's per-item allergy + note so editing keeps them
  state._opt = { d, sel, editIndex, allergy: (line && line.allergy) || "", note: (line && line.note) || "" };
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
  // Size/extras (if the dish has any) PLUS a per-item allergy + note — so the
  // waiter can flag "no nuts" or "less ice" on this one dish, not the whole order.
  $("#panel").innerHTML = `
    <div class="phead"><h2>${esc(d.title)}</h2><button class="btn small" id="optBack">← back</button></div>
    <div class="muted small">Base ${inr(base)}</div>
    ${groups || `<div class="muted small">No size / extras for this dish.</div>`}
    <div class="optgroup"><h4>⚠ Allergy / avoid <span class="muted small">· this item</span></h4>
      <input type="text" id="optAllergy" class="note allergy" placeholder="e.g. nuts, dairy" value="${esc(state._opt.allergy || "")}"></div>
    <div class="optgroup"><h4>Note <span class="muted small">· optional</span></h4>
      <input type="text" id="optNote" class="note" placeholder="e.g. less ice, extra hot" value="${esc(state._opt.note || "")}"></div>
    <div class="ctotal"><span>Per item</span><b>${inr(unit)}</b></div>
    <button class="btn primary big" id="optAdd">${editIndex != null ? "Update item" : "Add to order"}</button>`;
  document.querySelectorAll("[data-optg]").forEach((b) => (b.onclick = () => {
    const g = b.dataset.optg, l = b.dataset.optl, multi = b.dataset.multi === "true";
    const cur = sel[g] || [];
    sel[g] = multi ? (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]) : (cur.includes(l) ? [] : [l]);
    drawDishOptions();
  }));
  // Persist the typed allergy/note onto _opt so a re-render (toggling an option)
  // doesn't wipe them.
  const al = $("#optAllergy"); if (al) al.oninput = (e) => (state._opt.allergy = e.target.value);
  const nt = $("#optNote"); if (nt) nt.oninput = (e) => (state._opt.note = e.target.value);
  $("#optBack").onclick = renderOrderMode;
  $("#optAdd").onclick = () => {
    const opts = [];
    for (const g of (d.options || [])) for (const c of (g.choices || [])) {
      if ((sel[g.name] || []).includes(c.label)) opts.push({ group: g.name, label: c.label, price: Number(c.price) || 0 });
    }
    const unitPrice = base + opts.reduce((s, o) => s + o.price, 0);
    const allergy = (state._opt.allergy || "").trim();
    const noteRaw = (state._opt.note || "").trim();
    // ADD-TO-EXISTING-ORDER mode: send straight to the order's add-item endpoint.
    // The allergy rides as this dish's own `removed` list (NOT the order-wide
    // list), so it stays on this dish only — mirroring how new orders carry it.
    if (state.addToOrderId) {
      const removed = allergy ? allergy.split(",").map((s) => s.trim()).filter(Boolean) : [];
      addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1, options: opts.length ? opts.map((o) => ({ group: o.group, label: o.label })) : undefined, removed: removed.length ? removed : undefined, note: noteRaw || undefined });
      state._opt = null;
      return;
    }
    const line = { id: d.id, title: d.title, price: unitPrice, qty: 1, options: opts.length ? opts : undefined,
      allergy: allergy || undefined, note: noteRaw || undefined };
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
  // ADD-TO-EXISTING-ORDER mode: a slim dish browser. Tapping a dish adds it straight
  // to the order (the bill re-prices itself); "✓ Done" returns to the table.
  if (state.addToOrderId) {
    p.innerHTML = `
      <div class="phead"><h2 style="margin:0;font-size:19px">Add a dish · Table ${esc(state.table)}</h2><button class="btn small primary" id="addDoneBtn">✓ Done</button></div>
      <input type="search" id="dishSearch" class="order-search" placeholder="🔎 Search dishes…" value="${esc(state.dishSearch)}">
      <div class="chips">${chips}</div>
      <div class="muted small" style="padding:4px 2px">Tap a dish to add it to this order — the bill updates automatically.</div>
      <div class="dishgrid">${orderGridHtml()}</div>`;
    document.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; renderOrderMode(); }));
    bindDishButtons();
    const search = $("#dishSearch");
    if (search) search.oninput = (e) => { state.dishSearch = e.target.value; const g = document.querySelector(".dishgrid"); if (g) { g.innerHTML = orderGridHtml(); bindDishButtons(); } };
    $("#addDoneBtn").onclick = () => { state.ordering = false; state.addToOrderId = null; renderPanel(); };
    return;
  }
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}${l.options && l.options.length ? `<small class="copts">${esc(l.options.map((o) => o.label).join(", "))}</small>` : ""}${l.allergy ? `<small class="callergy">⚠ ${esc(l.allergy)}</small>` : ""}${l.note ? `<small class="copts">✎ ${esc(l.note)}</small>` : ""}</span>
      <span class="cqty"><button class="qbtn" data-minus="${i}">−</button><b>${l.qty}</b><button class="qbtn" data-plus="${i}">+</button><button class="qbtn edit" data-edit="${i}" title="Size / extras / allergy">✎</button></span>
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
    // A per-item allergy belongs to THAT dish only, so it travels as that line's
    // own `removed` list — the kitchen then shows "NO NUTS" on that one dish.
    // The order-level `allergies` is ONLY the whole-order avoid box (under the
    // cart): anything there applies to EVERY dish. We used to fold per-item
    // allergies into that order-level list too, which made them leak onto every
    // dish on the ticket — that's the bug this fixes (2026-06-17).
    const splitCsv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
    const orderAllergies = splitCsv(state.allergies);
    const r = await api("POST", "/order", {
      table: state.table,
      items: state.cart.map((l) => {
        const removed = splitCsv(l.allergy);
        return {
          id: l.id, qty: l.qty,
          options: l.options ? l.options.map((o) => ({ group: o.group, label: o.label })) : undefined,
          removed: removed.length ? removed : undefined,
          note: l.note || undefined,
        };
      }),
      allergies: [...new Set(orderAllergies)],
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
// BULLETPROOF redraw fingerprint. We serialize the FULL drawn rows (minus a few
// heartbeat-only columns) so ANY field that affects the floor or the detail panel —
// including columns added in the FUTURE (a new per-dish flag, a new session field,
// etc.) — flips the signature and forces a repaint. Do NOT shrink this back to a
// hand-picked field list: that list silently missed allergy/note/discount/auto-
// approve edits, so they only appeared after a MANUAL refresh (bug fixed 2026-06-17).
// See CLAUDE.md "Live-update redraw guard". RT_VOLATILE = columns that change with
// NO visible effect (heartbeats / derived timestamps) — excluded so idle polls don't
// churn (last_activity_at ticks constantly; excluding it is what keeps this cheap).
const RT_VOLATILE = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
const stableRow = (row) => { const o = {}; for (const k in (row || {})) if (!RT_VOLATILE.has(k)) o[k] = row[k]; return o; };
function boardSig(d) {
  return JSON.stringify([
    (d.sessions || []).map(stableRow),
    (d.orders || []).map(stableRow),
    (d.items || []).map(stableRow),
    (d.calls || []).map(stableRow),
    (d.members || []).map(stableRow),
    (d.requests || []).map(stableRow),
    stableRow(d.settings || {}),
  ]);
}
let lastSig = null;
// Every load() gets a rising ticket; only the most-recently-STARTED fetch is
// allowed to apply. Without this, two overlapping refetches (your tap + the
// realtime event for that same change + the backup timer) race, and whichever
// GET *finishes* last wins — even when it's the OLDER snapshot. That stale
// snapshot is what made the panel flash the pre-open "Attend/request" view,
// drop an order that's actually there, then pop it back a moment later.
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const data = await api("GET", "/state");
  if (seq !== loadSeq) return;          // a newer refresh started — this one is stale, drop it
  state.data = data;
  const sig = boardSig(state.data);
  if (sig === lastSig) return;
  lastSig = sig;
  renderFloor();
  if (!state.ordering) renderPanel();
}
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);
load().catch((e) => toast("Can't reach the database: " + e.message, false));
// Realtime: refetch only when something on the floor actually changes (instant),
// instead of polling every second. A slow 60s timer is the backup if the
// WebSocket drops; if realtime didn't load, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  LFH_RT.start({ topics: ["ops", "menu"], onEvent: () => load() }); // ops + menu (dish/price edits)
  setInterval(() => load().catch(() => {}), 60000); // backup sync
} else {
  setInterval(() => load().catch(() => {}), 2000); // fallback poll
}
