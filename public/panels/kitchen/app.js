// kitchen/ui/app.js — the kitchen screen's brain. Polls the live board every
// 2 seconds and draws orders as big KOT tickets in three columns: New (accept
// them), Cooking (tick each dish ready), Ready (recently finished, for glory).
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
  setTimeout(() => t.remove(), 6000);
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
  if (dbRows.length) return dbRows.map((r) => ({ id: r.id, title: r.title, qty: r.qty, status: r.status, note: r.note, options: r.options, removed: r.removed, fromDb: true }));
  return (Array.isArray(o.items) ? o.items : []).map((i) => ({ id: null, title: i.title, qty: i.qty || 1, status: i.status || o.status, note: i.note, options: i.options, removed: i.removed, fromDb: false }));
};

function ticketHtml(o) {
  const rows = rowsOf(o);
  const lines = rows.map((r) => {
    const extras = [
      ...(Array.isArray(r.options) ? r.options.map((op) => `+ ${op.label || op}`) : []),
      ...(Array.isArray(r.removed) && r.removed.length ? [`NO ${r.removed.join(", NO ")}`] : []),
      ...(r.note ? [`✎ ${r.note}`] : []),
    ];
    // Each cooking dish gets a ✓ to mark it READY (cooked). Once ready it shows a
    // pink "ready" tag (waiter still has to carry it out); once the waiter serves
    // it on the tablet it reads "served".
    const tick = r.fromDb && (r.status === "received" || r.status === "preparing")
      ? `<button class="tick" data-item-ready="${esc(r.id)}">✓</button>`
      : r.status === "ready" ? `<span class="done rdy">ready</span>`
        : r.status === "served" ? `<span class="done">served ✓</span>` : "";
    const lineCls = r.status === "served" ? "line-done" : r.status === "ready" ? "line-ready" : "";
    return `<div class="line ${lineCls}">
      <span class="qty">${esc(r.qty)}×</span>
      <span class="ltitle">${esc(r.title)}${extras.length ? `<small>${esc(extras.join(" · "))}</small>` : ""}</span>
      ${tick}</div>`;
  }).join("");
  // Allergies shout in red — the kitchen must never miss them.
  const allergy = Array.isArray(o.allergies) && o.allergies.length
    ? `<div class="allergy">⚠ ALLERGY: ${esc(o.allergies.join(", "))}</div>` : "";
  const rows2 = rowsOf(o);
  const allCooked = rows2.length > 0 && rows2.every((r) => r.status === "ready" || r.status === "served");
  const action = o.status === "received"
    ? `<button class="big accept" data-accept="${esc(o.id)}">ACCEPT</button>`
    : (!allCooked
      ? `<button class="big ready" data-ready="${esc(o.id)}">ALL READY</button>`
      : `<div class="awaiting">✓ ready — waiter serving</div>`);
  return `<div class="ticket st-${esc(o.status)}">
    <div class="thead"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="tbl">T${esc(o.table_number)}</span><span class="age">${esc(timeAgo(o.created_at))}</span></div>
    ${allergy}${lines}${action}</div>`;
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
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => act(() => api("POST", `/orders/${b.dataset.accept}/accept`))));
  document.querySelectorAll("[data-ready]").forEach((b) => (b.onclick = () => act(() => api("POST", `/orders/${b.dataset.ready}/ready`))));
  // The kitchen ✓ marks a dish READY (cooked) — the waiter serves it on the tablet.
  document.querySelectorAll("[data-item-ready]").forEach((b) => (b.onclick = () => act(() => api("POST", `/items/${b.dataset.itemReady}/status`, { status: "ready" }))));
}

// Run an action then refresh immediately (snappier than waiting for the poll).
const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast("Failed: " + e.message); } };

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
      await load(); renderDishes();
      const dish = state.dishes.find((d) => d.id === id);
      // No confirm — kitchens move fast — but always an UNDO escape hatch.
      toast(`${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked SOLD OUT"}`,
        async () => { await api("POST", `/dishes/${id}/sold-out`, { value: wasOut }); await load(); renderDishes(); });
    } catch (e) { toast("Failed: " + e.message); }
  }));
}

// A fingerprint of everything the board draws — same idea as the tablet: only
// re-render when it changes, so a tap on ACCEPT / a dish ✓ landing exactly when
// the poll fires can't be eaten by a DOM rebuild.
function boardSig(d) {
  return JSON.stringify([
    (d.orders || []).map((o) => [o.id, o.status, o.kot_no]),
    (d.items || []).map((i) => [i.id, i.status]),
    (d.dishes || []).map((x) => [x.id, (x.tags || []).includes("sold-out")]),
  ]);
}
let lastSig = null;
// ── the poll ─────────────────────────────────────────────────────────────────
async function load() {
  const data = await api("GET", "/board");
  // Chime only for orders we have NEVER seen (not on the very first load).
  const ids = new Set(data.orders.map((o) => o.id));
  if (state.knownIds) {
    const fresh = data.orders.some((o) => o.status === "received" && !state.knownIds.has(o.id));
    if (fresh) chime();
  }
  state.knownIds = ids;
  state.orders = data.orders; state.items = data.items; state.dishes = data.dishes;
  // If the 86-board drawer is open, keep it fresh regardless (its own render).
  if (!$("#drawerOverlay").hidden) renderDishes();
  const sig = boardSig(data);
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
setInterval(() => load().catch(() => {}), 1000); // ~1s real-time (signature-diff means no wasted redraws)
