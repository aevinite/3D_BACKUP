// kitchen/ui/app.js — the kitchen screen's brain. Polls the live board every
// 2 seconds and draws orders as big KOT tickets in three columns: New (VIEW ONLY
// — the waiter accepts, not the kitchen), Cooking (tick each dish ready), Ready
// (recently finished, for glory).
// Also: the 86 board (sold-out toggles with an UNDO toast — kitchens move fast,
// so no confirm dialog; a 6-second undo is safer than a popup mid-rush) and a
// chime when a brand-new order lands (mutable, remembered per device).

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { orders: [], items: [], dishes: [], knownIds: null, muted: localStorage.getItem("kds_muted") === "1" };

// ── tiny helpers ─────────────────────────────────────────────────────────────
const api = async (method, path, body) => {
  const r = await fetch("/api/kitchen" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = "/login"; throw new Error("login"); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || r.statusText);
  return j;
};
const timeAgo = (ts) => {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
};
const toast = (msg, undoFn) => {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button class="undo">UNDO</button>' : ""}`;
  if (undoFn) t.querySelector(".undo").onclick = () => { undoFn(); t.remove(); };
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

// A short two-note chime for new orders (WebAudio — no sound file needed).
let audioCtx = null;
const chime = () => {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1175, 0.18]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + at + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + 0.4);
    });
  } catch {}
};

// ── drawing the board ────────────────────────────────────────────────────────
// The per-dish rows of one order (session orders have order_items; legacy
// orders carry their dishes in the order's own items JSON).
const rowsOf = (o) => {
  const dbRows = state.items.filter((i) => i.order_id === o.id);
  if (dbRows.length) return dbRows.map((r) => ({ id: r.id, title: r.title, qty: r.qty, status: r.status, note: r.note, options: r.options, removed: r.removed, added_allergens: r.added_allergens, removed_flag: r.removed_flag, fromDb: true }));
  return (Array.isArray(o.items) ? o.items : []).map((i) => ({ id: null, title: i.title, qty: i.qty || 1, status: i.status || o.status, note: i.note, options: i.options, removed: i.removed, fromDb: false }));
};

function ticketHtml(o) {
  const rows = rowsOf(o);
  // NO common allergy banner anywhere (owner, 2026-06-14). The order-wide "avoid" is
  // DISTRIBUTED onto every item, so each dish shows its own "NO x" — matching the
  // manager and tablet. Each item = its own removals ∪ the order-wide allergens.
  const orderAllergies = Array.isArray(o.allergies) ? o.allergies : [];
  const lines = rows.map((r) => {
    const lineRemoved = [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])];
    // Allergens render as HTML so a staff-ADDED one carries a green "＋"; options/note
    // stay escaped text. A removed allergen flags "✎−" on the dish name (built below).
    const added = new Set((Array.isArray(r.added_allergens) ? r.added_allergens : []).map((x) => String(x).toLowerCase()));
    const segs = [];
    if (Array.isArray(r.options) && r.options.length) segs.push(esc(r.options.map((op) => `+ ${op.label || op}`).join(" · ")));
    if (lineRemoved.length) segs.push(lineRemoved.map((x) => `NO ${esc(String(x).toUpperCase())}${added.has(String(x).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", "));
    if (r.note) segs.push(esc(`✎ ${r.note}`));
    const small = segs.length ? `<small>${segs.join(" · ")}</small>` : "";
    const remMark = r.removed_flag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
    // Each cooking dish gets a ✓ to mark it READY (cooked). Once ready it shows a
    // pink "ready" tag (waiter still has to carry it out); once the waiter serves
    // it on the tablet it reads "served".
    const tick = r.fromDb && r.status === "preparing"
      ? `<button class="tick" data-item-ready="${esc(r.id)}">✓</button>`
      : r.status === "ready" ? `<span class="done rdy">ready</span>`
        : r.status === "served" ? `<span class="done">served ✓</span>` : "";
    const lineCls = r.status === "served" ? "line-done" : r.status === "ready" ? "line-ready" : "";
    return `<div class="line ${lineCls}">
      <span class="qty">${esc(r.qty)}×</span>
      <span class="ltitle">${esc(r.title)}${remMark}${small}</span>
      ${tick}</div>`;
  }).join("");
  const rows2 = rowsOf(o);
  const allCooked = rows2.length > 0 && rows2.every((r) => r.status === "ready" || r.status === "served");
  // The kitchen does NOT accept orders (owner, 2026-06-14): a new order is shown
  // for visibility only — the waiter/manager accepts it. The kitchen's only job is
  // moving a COOKING dish to READY (the ✓ ticks, or "ALL READY").
  const action = o.status === "received"
    ? `<div class="awaiting">🆕 new — waiting for the waiter to accept</div>`
    : (!allCooked
      ? `<button class="big ready" data-ready="${esc(o.id)}">ALL READY</button>`
      : `<div class="awaiting">✓ ready — waiter serving</div>`);
  return `<div class="ticket st-${esc(o.status)}">
    <div class="thead"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="tbl">T${esc(o.table_number)}</span><span class="age">${esc(timeAgo(o.created_at))}</span></div>
    ${lines}${action}</div>`;
}

// A kitchen ticket's column comes from its DISHES, not the coarse order status:
// New = not accepted; Ready = every dish cooked (awaiting the waiter); Cooking =
// anything in between. Fully-served orders have been delivered and leave the board.
function orderPhase(o) {
  if (o.status === "received") return "new";
  const rows = rowsOf(o);
  if (!rows.length) return o.status === "served" ? "served" : "cooking";
  if (rows.every((r) => r.status === "served")) return "served";
  if (rows.every((r) => r.status === "ready" || r.status === "served")) return "ready";
  return "cooking";
}
function render() {
  const buckets = { new: [], cooking: [], ready: [], served: [] };
  state.orders.forEach((o) => { if (o.status !== "cancelled") buckets[orderPhase(o)].push(o); });
  const draw = (key, list) => {
    $("#list-" + key).innerHTML = list.length ? list.map(ticketHtml).join("") : `<div class="empty">Nothing here.</div>`;
    $("#count-" + key).textContent = list.length || "";
  };
  draw("new", buckets.new); draw("cooking", buckets.cooking); draw("ready", buckets.ready);
  // wire the buttons (we redraw each poll, so we rebind each poll)
  // (No accept handler — the kitchen can't accept orders anymore; the waiter does.)
  document.querySelectorAll("[data-ready]").forEach((b) => (b.onclick = () => markOrderReady(b.dataset.ready)));
  // The kitchen ✓ marks a dish READY (cooked) — the waiter serves it on the tablet.
  // Optimistic + debounced reconcile so rapid one-by-one ✓ taps in a rush stay snappy.
  document.querySelectorAll("[data-item-ready]").forEach((b) => (b.onclick = (e) => markItemReady(b.dataset.itemReady, e.currentTarget)));
}

// Run an action then refresh immediately (snappier than waiting for the poll).
// Used by the 86-board toggle/undo — a single deliberate tap, so a reload is fine.
const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast("Failed: " + e.message); } };

// Marking dishes READY is OPTIMISTIC. In a rush the cook taps ✓ down a long ticket
// one after another; we flip the dish locally + redraw INSTANTLY, fire the API in the
// background, and reconcile with ONE refetch after the taps stop. (Was: await POST +
// a full board reload PER tap → each tap waited a round-trip and the DOM rebuild
// between taps ate the next tap → "clicking ready one by one doesn't work" in a rush.)
// pendingReady keeps a just-tapped dish showing ready even if a realtime/poll refetch
// lands mid-rush before the server caught up. (owner, 2026-06-18)
const pendingReady = new Set();
let readyReconcileTimer = null;
function scheduleReadyReconcile() {
  if (readyReconcileTimer) clearTimeout(readyReconcileTimer);
  readyReconcileTimer = setTimeout(() => { readyReconcileTimer = null; pendingReady.clear(); load().catch(() => {}); }, 2500);
}
function setLocalReady(matches) {
  (state.items || []).forEach((i) => { if (i.status !== "served" && matches(i)) { i.status = "ready"; pendingReady.add(i.id); } });
  // Legacy orders carry their dishes in the order's items JSON (no order_items rows).
  (state.orders || []).forEach((o) => { if (Array.isArray(o.items)) o.items = o.items.map((i) => (i.status !== "served" && matches({ ...i, order_id: o.id })) ? { ...i, status: "ready" } : i); });
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes });
  render();
}
// Mark ONE dish ready (the ✓ tick). Update ONLY this dish's line IN PLACE — do NOT
// rebuild the whole board. A full render() per tap (a) re-buckets the ticket so it
// jumps to the Ready column mid-rush and (b) destroys+recreates the other ✓ buttons,
// so the cook's next rapid tap lands on a replaced node and is eaten ("clicking ready
// one by one doesn't work"). The ticket re-buckets to Ready exactly once, on the
// debounced reconcile after the taps stop. (owner, 2026-06-18)
function markItemReady(id, btn) {
  const it = (state.items || []).find((x) => x.id === id);
  if (!it || it.status === "served") return;
  it.status = "ready"; pendingReady.add(id);
  if (btn) { const line = btn.closest(".line"); if (line) { line.classList.add("line-ready"); btn.outerHTML = '<span class="done rdy">ready</span>'; } }
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes });
  api("POST", `/items/${id}/status`, { status: "ready" }).then(scheduleReadyReconcile).catch((e) => { toast("Failed: " + e.message); load(); });
}
// Mark every not-served dish on an order ready (the "ALL READY" button).
function markOrderReady(orderId) {
  setLocalReady((i) => i.order_id === orderId);
  api("POST", `/orders/${orderId}/ready`).then(scheduleReadyReconcile).catch((e) => { toast("Failed: " + e.message); load(); });
}

// ── the 86 board (sold-out toggles) ──────────────────────────────────────────
function renderDishes() {
  const q = ($("#dishSearch").value || "").toLowerCase();
  const list = state.dishes.filter((d) => !q || (d.title || "").toLowerCase().includes(q));
  $("#dishList").innerHTML = list.map((d) => {
    const out = (d.tags || []).includes("sold-out");
    return `<div class="dish-row ${out ? "is-out" : ""}">
      <span class="dtitle">${esc(d.title)}<small>${esc(d.category || "")}</small></span>
      <button class="btn ${out ? "danger" : ""}" data-86="${esc(d.id)}" data-out="${out ? "1" : "0"}">${out ? "SOLD OUT" : "available"}</button>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-86]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset["86"], wasOut = b.dataset.out === "1";
    try {
      await api("POST", `/dishes/${id}/sold-out`, { value: !wasOut });
      await load(); // load() already re-renders the open 86 board (its drawer is open here)
      const dish = state.dishes.find((d) => d.id === id);
      // No confirm — kitchens move fast — but always an UNDO escape hatch.
      toast(`${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked SOLD OUT"}`,
        async () => { await api("POST", `/dishes/${id}/sold-out`, { value: wasOut }); await load(); });
    } catch (e) { toast("Failed: " + e.message); }
  }));
}

// A fingerprint of everything the board draws — same idea as the tablet: only
// re-render when it changes, so a tap on ACCEPT / a dish ✓ landing exactly when
// the poll fires can't be eaten by a DOM rebuild.
// BULLETPROOF redraw fingerprint. We serialize the FULL drawn rows (minus a few
// heartbeat-only columns) so ANY field that affects a ticket — including columns
// added in the FUTURE — flips the signature and forces a repaint. Do NOT shrink
// this back to a hand-picked field list: a hand-picked list silently missed
// allergy/note edits, so they only appeared after a MANUAL refresh (bug fixed
// 2026-06-17). New editable field on an order/dish? It's already covered here.
// See CLAUDE.md "Live-update redraw guard". RT_VOLATILE = columns that change with
// NO visible effect (heartbeats / derived timestamps) — excluded so idle polls and
// post-action reconciles don't needlessly rebuild the DOM.
const RT_VOLATILE = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
const stableRow = (row) => { const o = {}; for (const k in (row || {})) if (!RT_VOLATILE.has(k)) o[k] = row[k]; return o; };
function boardSig(d) {
  return JSON.stringify([
    (d.orders || []).map(stableRow),
    (d.items || []).map(stableRow),
    (d.dishes || []).map(stableRow),
  ]);
}
let lastSig = null;
// ── the poll ─────────────────────────────────────────────────────────────────
// Rising-ticket guard: act() taps, the 86-board undo, the realtime onEvent and the
// backup timer all call load() independently. Without this, whichever fetch FINISHES
// last wins — even an older snapshot — flashing a stale board. Drop any response
// that a newer load() has already superseded.
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const data = await api("GET", "/board");
  if (seq !== loadSeq) return; // a newer refresh started — drop this stale response
  // Chime only for orders we have NEVER seen (not on the very first load).
  const ids = new Set(data.orders.map((o) => o.id));
  if (state.knownIds) {
    const fresh = data.orders.some((o) => o.status === "received" && !state.knownIds.has(o.id));
    if (fresh) chime();
  }
  state.knownIds = ids;
  state.orders = data.orders; state.dishes = data.dishes;
  // Keep dishes the cook JUST tapped ready showing ready, even if this refetch landed
  // before the server caught up (cleared by the reconcile once the rush settles).
  state.items = pendingReady.size
    ? data.items.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i))
    : data.items;
  // If the 86-board drawer is open, keep it fresh regardless (its own render).
  if (!$("#drawerOverlay").hidden) renderDishes();
  const sig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes });
  if (sig === lastSig) return; // nothing visible changed — don't rebuild the tickets
  lastSig = sig;
  render();
}

// top-bar wiring
$("#muteBtn").textContent = state.muted ? "🔕" : "🔔";
$("#muteBtn").onclick = () => {
  state.muted = !state.muted;
  localStorage.setItem("kds_muted", state.muted ? "1" : "0");
  $("#muteBtn").textContent = state.muted ? "🔕" : "🔔";
};
$("#boardBtn").onclick = () => { $("#drawerOverlay").hidden = false; renderDishes(); };
$("#drawerClose").onclick = () => ($("#drawerOverlay").hidden = true);
$("#drawerOverlay").onclick = (e) => { if (e.target.id === "drawerOverlay") $("#drawerOverlay").hidden = true; };
$("#dishSearch").oninput = renderDishes;
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);

load().catch((e) => toast("Can't reach the database: " + e.message));
// Realtime: refetch only when an order/dish actually changes (instant), instead of
// polling every second. A slow 60s timer is the backup if the WebSocket drops.
// If realtime didn't load for any reason, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  LFH_RT.start({ topics: ["ops", "menu"], onEvent: () => load() }); // ops + menu (sold-out/dish edits)
  setInterval(() => load().catch(() => {}), 60000); // backup sync
} else {
  setInterval(() => load().catch(() => {}), 2000); // fallback poll
}
