// kitchen/ui/app.js — the kitchen screen's brain. Polls the live board every
// 2 seconds and draws orders as big KOT tickets in three columns: New (VIEW ONLY
// — the waiter accepts, not the kitchen), Cooking (tick each dish ready), Ready
// (recently finished, for glory).
// Also: the 86 board (sold-out toggles with an UNDO toast — kitchens move fast,
// so no confirm dialog; a 6-second undo is safer than a popup mid-rush) and a
// chime when a brand-new order lands (mutable, remembered per device).

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { orders: [], items: [], dishes: [], platform: [], platformAccept: false, knownIds: null, muted: localStorage.getItem("kds_muted") === "1" };
// Platform (Zomato/Swiggy/Website/Parcel) source badges shown on a platform ticket.
const PLAT_META = {
  zomato:   { label: "ZOMATO",  cls: "z" },
  swiggy:   { label: "SWIGGY",  cls: "s" },
  takeaway: { label: "WEBSITE", cls: "t" }, // the restaurant's own site (mig 209)
  parcel:   { label: "PARCEL",  cls: "p" }, // staff counter parcel — never "Takeaway"
  other:    { label: "PLATFORM", cls: "o" },
};
// Which layout the cook is using: "columns" (New/Cooking/Ready) or "wall" (every
// live order at once, oldest first — the "expansion"). Persisted per device.
let view = localStorage.getItem("kds_view") === "wall" ? "wall" : "columns";

// ── tiny helpers ─────────────────────────────────────────────────────────────
// PER-TAB restaurant pin (ADMIN "view as" only): ?rid= comes in via the iframe URL and
// is echoed on every API call so this tab never shifts restaurants when the admin opens
// another restaurant's panel (the act-as cookie is browser-wide — owner bug, 2026-07-03).
// Empty for real staff logins; the server ignores it for them.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
// ACTUAL-VIEW toggle (owner, 2026-07-28): ?view=real on an admin-view tab makes whoami
// answer as the real kitchen screen. Per-tab like ?rid, echoed on every call.
const PANEL_VIEW_REAL = PANEL_RID && new URLSearchParams(location.search).get("view") === "real";
const ridQ = (path) => {
  if (!PANEL_RID) return path;
  path += (path.includes("?") ? "&" : "?") + "rid=" + encodeURIComponent(PANEL_RID);
  if (PANEL_VIEW_REAL) path += "&view=real";
  return path;
};
const api = async (method, path, body) => {
  // Writes go through the offline outbox (sent now if online, else saved + replayed
  // on reconnect, at-most-once). GETs stay a plain fetch. Same contract as before.
  if (method !== "GET" && window.LFH_OUTBOX) {
    return window.LFH_OUTBOX.send({ base: "/api/kitchen", method, path: ridQ(path), body, panel: "kitchen" });
  }
  const r = await fetch("/api/kitchen" + ridQ(path), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
  // message · optional UNDO · always a ✕ so staff can dismiss it now (owner, 2026-06-21)
  t.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button class="undo">UNDO</button>' : ""}<button class="toast-x" aria-label="Dismiss">✕</button>`;
  if (undoFn) t.querySelector(".undo").onclick = () => { undoFn(); t.remove(); };
  t.querySelector(".toast-x").onclick = () => t.remove();
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

// A short two-note chime for new orders (WebAudio — no sound file needed).
let audioCtx = null;
// A KDS is usually a wall display nobody ever taps. WebAudio's autoplay policy starts
// a context created outside a user gesture in "suspended" state, so the FIRST order
// chimed silently and the display never beeped until someone touched it (bug M8,
// 2026-07-05). Fix: create the context eagerly and resume() it on the first ANY user
// gesture (one-time), and also try to resume() on every chime in case it lapsed.
function primeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const p = audioCtx.resume?.();
    if (p && p.then) p.then(() => updateSoundNudge()).catch(() => {}); // resume() is async — re-check once it settles
  } catch {}
  updateSoundNudge();
}
if (typeof window !== "undefined") {
  const once = () => { primeAudio(); ["pointerdown", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, once)); };
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, once, { once: true, passive: true }));
}
// Is sound actually usable right now (context exists AND is running, not suspended)?
const audioReady = () => !!(audioCtx && audioCtx.state === "running");
// A wall-mounted KDS nobody ever taps never fires a user gesture, so the AudioContext stays
// suspended and the chime is silent forever. Show a big one-tap "enable sound" affordance
// WHILE sound is on but the context isn't running yet; tapping it primes+resumes the context
// (that tap IS the user gesture the autoplay policy needs). It hides itself the instant the
// context is running or the cook mutes. (The eager gesture-priming above still runs too.)
let soundNudgeEl = null;
function updateSoundNudge() {
  const need = !state.muted && !audioReady();
  if (need) {
    if (!soundNudgeEl) {
      soundNudgeEl = document.createElement("button");
      soundNudgeEl.id = "soundNudge"; soundNudgeEl.type = "button"; soundNudgeEl.className = "sound-nudge";
      soundNudgeEl.textContent = "🔊 Tap to enable sound";
      soundNudgeEl.onclick = () => { primeAudio(); setTimeout(updateSoundNudge, 250); };
      (document.body || document.documentElement).appendChild(soundNudgeEl);
    }
    soundNudgeEl.hidden = false;
  } else if (soundNudgeEl) {
    soundNudgeEl.hidden = true;
  }
}
const chime = () => {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume?.();
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
  updateSoundNudge(); // if the context couldn't run, surface the "enable sound" nudge
};

// ── drawing the board ────────────────────────────────────────────────────────
// The per-dish rows of one order (session orders have order_items; legacy
// orders carry their dishes in the order's own items JSON).
// itemsByOrderId(): build the order_id → item-rows index ONCE per render pass so the
// board no longer runs state.items.filter() per order per ticket. It used to be called
// 3× per order (orderPhase + ticketHtml twice) → O(orders × items) each render, which is
// the rush-hour freeze. Callers pass the pre-filtered slice into rowsOf(o, slice); the
// surgical single-order callers (markItemReady/moveCardToReady) still pass nothing and
// fall back to a one-off filter, which is cheap for one order.
const itemsByOrderId = () => {
  const m = new Map();
  for (const it of (state.items || [])) {
    if (it == null || it.order_id == null) continue;
    let arr = m.get(it.order_id); if (!arr) m.set(it.order_id, (arr = []));
    arr.push(it);
  }
  return m;
};
const rowsOf = (o, dbRowsOpt) => {
  const dbRows = dbRowsOpt || state.items.filter((i) => i.order_id === o.id);
  if (dbRows.length) return dbRows.map((r) => ({ id: r.id, title: r.title, qty: r.qty, status: r.status, note: r.note, options: r.options, removed: r.removed, added_allergens: r.added_allergens, removed_flag: r.removed_flag, fromDb: true }));
  return (Array.isArray(o.items) ? o.items : []).map((i) => ({ id: null, title: i.title, qty: i.qty || 1, status: i.status || o.status, note: i.note, options: i.options, removed: i.removed, fromDb: false }));
};

function ticketHtml(o, rows) {
  rows = rows || rowsOf(o);
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
  const allCooked = rows.length > 0 && rows.every((r) => r.status === "ready" || r.status === "served");
  // The kitchen does NOT accept orders (owner, 2026-06-14): a new order is shown
  // for visibility only — the waiter/manager accepts it. The kitchen's only job is
  // moving a COOKING dish to READY (the ✓ ticks, or "ALL READY").
  const action = o.status === "received"
    ? `<div class="awaiting">🆕 new — waiting for the waiter to accept</div>`
    : (!allCooked
      ? `<button class="big ready" data-ready="${esc(o.id)}">ALL READY</button>`
      : `<div class="awaiting">✓ ready — waiter serving</div>`);
  // Manual PRINT button — on EVERY ticket for EVERY restaurant (owner 2026-07-21: "it
  // should be for everyone"). Any kitchen with any printer can print a ticket on demand
  // (or reprint after a jam / paper-out). Only the AUTOMATIC printing stays gated by the
  // admin entitlement + owner toggle (autoPrintKot). Independent of the auto-print
  // tracking (printedIds) — it just runs printKot for this order's current dishes.
  const reprintBtn = `<button class="reprint" data-reprint="${esc(o.id)}" title="Print this kitchen ticket" aria-label="Print kitchen ticket">🖨</button>`;
  // Special table type (mig 166): a small coloured badge next to the table number so
  // cooks know to prioritise (👑 VIP · 🏠 Family · 🤝 Owner's guest). Read-only here.
  const TAG_BADGE = { vip: ["👑 VIP", "#8b5cf6"], family: ["🏠 FAMILY", "#e11d48"], guest: ["🤝 GUEST", "#aab4c4"] };
  const tb = TAG_BADGE[o.tag];
  const tagBadge = tb ? `<span class="ttag" style="background:${tb[1]};color:${o.tag === "guest" ? "#1c2230" : "#fff"}">${tb[0]}</span>` : "";
  return `<div class="ticket st-${esc(o.status)}" data-ticket="${esc(o.id)}">
    <div class="thead"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="tbl">T${esc(o.table_number)}</span>${tagBadge}<span class="age">${esc(timeAgo(o.created_at))}</span>${reprintBtn}</div>
    ${lines}${action}</div>`;
}

// A kitchen ticket's column comes from its DISHES, not the coarse order status:
// New = not accepted; Ready = every dish cooked (awaiting the waiter); Cooking =
// anything in between. Fully-served orders have been delivered and leave the board.
function orderPhase(o, rows) {
  if (o.status === "received") return "new";
  rows = rows || rowsOf(o);
  if (!rows.length) return o.status === "served" ? "served" : "cooking";
  if (rows.every((r) => r.status === "served")) return "served";
  if (rows.every((r) => r.status === "ready" || r.status === "served")) return "ready";
  return "cooking";
}
// ONE delegated click handler for every ticket action (✓ per-dish ready, ALL READY, the
// platform accept/ready/hand buttons). Attached ONCE to a stable ancestor (document.body,
// which is never replaced) so the incremental tile patcher can add/remove/replace ticket
// nodes freely WITHOUT re-binding a listener per card — the old bindButtons() re-bound
// every button on every whole-board redraw, and a replaced node would orphan its handler
// (the exact reason the board was rebuilt wholesale before). e.target.closest() finds the
// clicked control on whichever card it lives, patched or not.
let clickDelegationBound = false;
function bindDelegation() {
  if (clickDelegationBound) return;
  clickDelegationBound = true;
  document.body.addEventListener("click", (e) => {
    const reprint = e.target.closest("[data-reprint]");
    if (reprint) { reprintOrder(reprint.dataset.reprint); return; }
    const ready = e.target.closest("[data-ready]");
    if (ready) { markOrderReady(ready.dataset.ready); return; }
    // The kitchen ✓ marks a dish READY (cooked) — the waiter serves it on the tablet.
    const item = e.target.closest("[data-item-ready]");
    if (item) { markItemReady(item.dataset.itemReady, item); return; }
    // Platform-order actions (accept gated by the manager toggle on the server too).
    const pa = e.target.closest("[data-plat-accept]");
    if (pa) { platAct(pa.dataset.platAccept, "accepted"); return; }
    const pr = e.target.closest("[data-plat-ready]");
    if (pr) { platAct(pr.dataset.platReady, "ready"); return; }
    const ph = e.target.closest("[data-plat-hand]");
    if (ph) { platAct(ph.dataset.platHand, "handed_over"); return; }
  });
}
// ── platform (Zomato/Swiggy/takeaway) tickets ────────────────────────────────
// Which kitchen column a platform order sits in (mirrors orderPhase for dine-in).
function platPhase(st) {
  if (st === "new") return "new";
  if (st === "accepted" || st === "preparing") return "cooking";
  if (st === "ready") return "ready";
  return "served"; // handed_over/cancelled — already filtered out by the board API
}
// One platform ticket. Same ticket look as dine-in but with a coloured source
// badge instead of a table number, and platform actions. ACCEPT only shows when
// the manager toggle (state.platformAccept) allows the kitchen to accept.
function platTicketHtml(p) {
  const meta = PLAT_META[p.source] || PLAT_META.other;
  const items = Array.isArray(p.items) ? p.items : [];
  const lines = items.map((it) => {
    const rem = Array.isArray(it.removed) && it.removed.length ? `<small>${it.removed.map((x) => `NO ${esc(String(x).toUpperCase())}`).join(", ")}</small>` : "";
    const note = it.note ? `<small>${esc("✎ " + it.note)}</small>` : "";
    return `<div class="line"><span class="qty">${esc(it.qty)}×</span><span class="ltitle">${esc(it.title)}${rem}${note}</span></div>`;
  }).join("");
  let action;
  if (p.status === "new") {
    action = state.platformAccept
      ? `<button class="big" data-plat-accept="${esc(p.id)}">ACCEPT</button>`
      : `<div class="awaiting">🆕 new — manager will accept</div>`;
  } else if (p.status === "accepted" || p.status === "preparing") {
    action = `<button class="big ready" data-plat-ready="${esc(p.id)}">ALL READY</button>`;
  } else {
    action = `<button class="big" data-plat-hand="${esc(p.id)}">HANDED OVER</button>`;
  }
  return `<div class="ticket plat plat-${esc(meta.cls)} st-plat-${esc(p.status)}" data-ticket="plat-${esc(p.id)}">
    <div class="thead"><span class="src-badge ${esc(meta.cls)}">${esc(meta.label)}</span><span class="kot">#${esc(p.kot_no ?? "—")}</span><span class="age">${esc(timeAgo(p.created_at))}</span></div>
    ${p.customer_name ? `<div class="plat-cust-line">${esc(p.customer_name)}</div>` : ""}
    ${lines}${action}</div>`;
}
// Advance a platform order (accept/ready/handed_over), then refresh.
function platAct(id, status) {
  api("POST", `/platform/${id}/status`, { status }).then(() => load()).catch((e) => { toast("Failed: " + e.message); load(); });
}

// INCREMENTAL tile patcher. Given a container and the DESIRED ordered list of tickets
// ({ id, html }), it reconciles the DOM in place: it REUSES an existing card node when its
// id is unchanged, only REPLACES a card whose html actually changed, ADDS new cards, and
// REMOVES cards that left — instead of blowing away and rebuilding every ticket's DOM on
// every update (the rush-hour freeze: a full innerHTML rebuild + re-bind on each poll).
// Cards keep their identity across updates, so a card the cook is mid-tap on isn't yanked
// out from under them. Button clicks are handled by the ONE delegated handler on body, so
// added/replaced nodes need NO re-binding. The rendered html is stashed on the node
// (`__kdsHtml`) purely as the cheap change check — a stale value (after a surgical optimistic
// tweak) just means the next reconcile refreshes that one card, which is correct.
function reconcileList(container, desired) {
  if (!container) return;
  if (!desired.length) {
    // Only (re)write the empty placeholder if it isn't already the sole child — avoids a
    // needless rebuild/flicker when an already-empty column re-renders.
    if (!(container.children.length === 1 && container.firstElementChild && container.firstElementChild.classList.contains("empty"))) {
      container.innerHTML = `<div class="empty">Nothing here.</div>`;
    }
    return;
  }
  // Index existing ticket nodes by their id; drop anything without a data-ticket (skeleton
  // shimmer cards, the "Nothing here" placeholder, strays).
  const existing = new Map();
  for (const node of Array.from(container.children)) {
    const id = node.getAttribute("data-ticket");
    if (id != null) existing.set(id, node); else node.remove();
  }
  let prev = null;
  for (const d of desired) {
    let node = existing.get(d.id);
    if (node) {
      existing.delete(d.id);
      if (node.__kdsHtml !== d.html) { // content actually changed → swap just this card
        const tmp = document.createElement("div"); tmp.innerHTML = d.html;
        const fresh = tmp.firstElementChild;
        if (fresh) { fresh.__kdsHtml = d.html; container.replaceChild(fresh, node); node = fresh; }
      }
    } else { // a brand-new card
      const tmp = document.createElement("div"); tmp.innerHTML = d.html;
      node = tmp.firstElementChild;
      if (node) node.__kdsHtml = d.html;
    }
    if (!node) continue;
    // Keep the DOM order matching `desired`: place this card right after the previous one.
    const target = prev ? prev.nextSibling : container.firstChild;
    if (node !== target) container.insertBefore(node, target);
    prev = node;
  }
  // Anything still in `existing` is no longer on the board — remove it.
  for (const node of existing.values()) node.remove();
}

// COLUMNS view — the classic New → Cooking → Ready board. Dine-in tickets first,
// then platform tickets, in each column.
function renderColumns() {
  const map = itemsByOrderId(); // build the item index ONCE, not per ticket
  const buckets = { new: [], cooking: [], ready: [], served: [] };
  state.orders.forEach((o) => {
    if (o.status === "cancelled") return;
    const rows = rowsOf(o, map.get(o.id) || []);
    buckets[orderPhase(o, rows)].push({ o, rows });
  });
  const pb = { new: [], cooking: [], ready: [] };
  (state.platform || []).forEach((p) => { const c = platPhase(p.status); if (pb[c]) pb[c].push(p); });
  const draw = (key, list, plist) => {
    const desired = list.map(({ o, rows }) => ({ id: String(o.id), html: ticketHtml(o, rows) }))
      .concat((plist || []).map((p) => ({ id: "plat-" + p.id, html: platTicketHtml(p) })));
    reconcileList($("#list-" + key), desired);
    $("#count-" + key).textContent = String(list.length + (plist ? plist.length : 0)); // show "0", not a blank pill, when a column is empty (2026-07-05)
  };
  draw("new", buckets.new, pb.new); draw("cooking", buckets.cooking, pb.cooking); draw("ready", buckets.ready, pb.ready);
}
// WALL view (the "expansion") — EVERY live ticket in one dense grid, FIRST-COME-
// FIRST-SERVED (oldest top-left); fully-ready tickets sink to the end. Same tickets
// + same ✓/ALL-READY actions as the columns. (owner, 2026-06-19)
function renderWall() {
  const map = itemsByOrderId(); // build the item index ONCE, not per ticket
  const live = [];
  state.orders.forEach((o) => {
    if (o.status === "cancelled") return;
    const rows = rowsOf(o, map.get(o.id) || []);
    const phase = orderPhase(o, rows);
    if (phase !== "served") live.push({ o, rows, phase });
  });
  live.sort((a, b) => ((a.phase === "ready") - (b.phase === "ready")) || (new Date(a.o.created_at) - new Date(b.o.created_at)));
  const plat = (state.platform || []).slice().sort((a, b) => ((platPhase(a.status) === "ready") - (platPhase(b.status) === "ready")) || (new Date(a.created_at) - new Date(b.created_at)));
  const desired = live.map(({ o, rows }) => ({ id: String(o.id), html: ticketHtml(o, rows) }))
    .concat(plat.map((p) => ({ id: "plat-" + p.id, html: platTicketHtml(p) })));
  reconcileList($("#wall"), desired);
}
// Paint the ACTIVE view. Every render() caller (load, loadTables, applyView) repaints
// whichever layout the cook is on — via the incremental reconciler, not a full rebuild.
function render() { return view === "wall" ? renderWall() : renderColumns(); }
// Switch layout: show/hide the two <main>s, clear the inactive one, repaint, persist.
function applyView() {
  const wall = view === "wall";
  $("#cols").hidden = wall; $("#wall").hidden = !wall;
  $("#viewBtn").textContent = wall ? "▭ Columns" : "▦ Wall view";
  if (wall) { $("#list-new").innerHTML = $("#list-cooking").innerHTML = $("#list-ready").innerHTML = ""; }
  else { $("#wall").innerHTML = ""; }
  render();
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
// Order-level optimistic overlay for LEGACY orders (no order_items rows — their dishes live
// in orders[].items JSON). markOrderReady() adds the order id here so load()/loadTables() can
// re-apply the "ready" overlay to that order's legacy items after they replace state.orders
// with fresh server rows — otherwise a slow-DB reconcile reverts a just-tapped legacy order
// to cooking until the server catches up (item-keyed pendingReady can't cover legacy items,
// which have no id). (bug: legacy orders revert during optimistic ALL-READY)
const pendingReadyOrders = new Set();
let readyReconcileTimer = null;
function scheduleReadyReconcile() {
  if (readyReconcileTimer) clearTimeout(readyReconcileTimer);
  readyReconcileTimer = setTimeout(() => {
    readyReconcileTimer = null;
    // Refetch FIRST — while the optimistic overlay still protects the just-tapped dishes —
    // and clear pendingReady only AFTER the server-confirmed board has landed. Clearing the
    // overlay BEFORE the refetch (the old order) stripped the protection during the very
    // refresh most likely to be stale, so a slow DB briefly flipped a ready dish back to
    // cooking. load() re-applies the overlay during its run, so the painted board stays
    // ready; we drop the overlay once the fetch resolves.
    load().catch(() => {}).finally(() => { pendingReady.clear(); pendingReadyOrders.clear(); });
  }, 2500);
}
function setLocalReady(matches) {
  (state.items || []).forEach((i) => { if (i.status !== "served" && matches(i)) { i.status = "ready"; pendingReady.add(i.id); } });
  // Legacy orders carry their dishes in the order's items JSON (no order_items rows).
  (state.orders || []).forEach((o) => { if (Array.isArray(o.items)) o.items = o.items.map((i) => (i.status !== "served" && matches({ ...i, order_id: o.id })) ? { ...i, status: "ready" } : i); });
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  // NOTE: no render() here — callers do a SURGICAL card update instead of a whole-board
  // repaint (a full render() re-buckets/rebuilds every ticket, eating a concurrent tap).
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
  const prev = it.status; // remember where it was so a mis-tap can be taken back
  it.status = "ready"; pendingReady.add(id);
  if (btn) { const line = btn.closest(".line"); if (line) { line.classList.add("line-ready"); btn.outerHTML = '<span class="done rdy">ready</span>'; } }
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  // If THIS tick made the WHOLE order ready, slide its card to the Ready column NOW
  // (don't wait for the 2.5s reconcile) — moving just this one card, so other tickets'
  // ✓ buttons survive and the cook's next rapid tap isn't eaten. (owner, 2026-06-19)
  const o = (state.orders || []).find((x) => x.id === it.order_id);
  if (o && orderPhase(o) === "ready") moveCardToReady(o);
  api("POST", `/items/${id}/status`, { status: "ready" }).then(() => {
    scheduleReadyReconcile();
    // A ✓ is easy to mis-tap in a rush — give the cook a few seconds to send the
    // dish back to where it was (owner undo bar, 2026-07-22).
    if (window.LFH_UNDO) LFH_UNDO.show({
      message: `${it.title || "Dish"} marked ready`,
      sub: o ? `Table ${o.table_number} · tap undo to put it back` : "Tap undo to put it back",
      icon: "🔥",
      onUndo: () => undoReady([{ id, prev }]),
    });
  }).catch((e) => { toast("Failed: " + e.message); load(); });
}

// Take back a "marked ready": drop the optimistic overlay, restore each dish's
// prior status locally + on the server, then reconcile from the truth. Shared by
// the single-✓ and ALL-READY paths. Reverting is a rare manual tap, so a full
// load() at the end (instead of surgical patching) is fine and keeps state honest.
async function undoReady(snap, orderId) {
  if (orderId != null) pendingReadyOrders.delete(orderId);
  snap.forEach((s) => {
    pendingReady.delete(s.id);
    const it = (state.items || []).find((x) => x.id === s.id);
    if (it && it.status !== "served") it.status = s.prev;
  });
  render();
  try {
    for (const s of snap) await api("POST", `/items/${s.id}/status`, { status: s.prev });
  } catch (e) {
    toast("Undo failed: " + e.message);
  }
  load();
}
// Move ONE fully-ready ticket into the Ready column without a whole-board rebuild:
// re-render just that card (now shows "ready — waiter serving", no buttons), drop it
// in #list-ready, and recount/refill both columns.
function moveCardToReady(o) {
  const card = document.querySelector(`.ticket[data-ticket="${o.id}"]`);
  if (!card) return;
  const html = ticketHtml(o);
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  fresh.__kdsHtml = html; // keep the reconcile change-check in sync (buttons are delegated)
  // WALL view: just refresh this ONE card in place (footer → "ready — waiter serving",
  // ✓ buttons gone). The full re-sort to the end happens on the debounced reconcile —
  // rebuilding the whole grid per tap would jump cards + eat the cook's next tap.
  if (view === "wall") { card.replaceWith(fresh); return; }
  // COLUMNS view: slide the finished card into the Ready column + recount, without a
  // whole-board rebuild (so other tickets' ✓ buttons survive a rapid rush).
  const readyList = document.getElementById("list-ready");
  if (!readyList || card.parentElement === readyList) return;
  readyList.querySelector(".empty")?.remove();
  card.remove();
  readyList.appendChild(fresh);
  ["new", "cooking", "ready"].forEach((key) => {
    const list = document.getElementById("list-" + key); if (!list) return;
    const n = list.querySelectorAll(".ticket").length;
    const c = document.getElementById("count-" + key); if (c) c.textContent = String(n); // "0" on empty, matching the full-render pill (was n||"" → blank→"0" flicker)
    if (n === 0 && !list.querySelector(".empty")) list.innerHTML = `<div class="empty">Nothing here.</div>`;
  });
}
// Mark every not-served dish on an order ready (the "ALL READY" button). Update the board
// SURGICALLY (move just this card to Ready), NOT a whole-board render() — a full repaint
// re-buckets/rebuilds every ticket and eats a cook's concurrent tap on another card. Same
// surgical approach as the single-✓ path (markItemReady → moveCardToReady).
function markOrderReady(orderId) {
  // Snapshot each dish's prior status BEFORE we flip it, so an accidental "ALL READY"
  // can be taken back to exactly where each dish was (owner undo bar, 2026-07-22).
  const snap = (state.items || [])
    .filter((i) => i.order_id === orderId && i.status !== "served")
    .map((i) => ({ id: i.id, prev: i.status }));
  pendingReadyOrders.add(orderId); // legacy-order overlay so a slow-DB reconcile can't revert it
  setLocalReady((i) => i.order_id === orderId);
  const o = (state.orders || []).find((x) => x.id === orderId);
  if (o) {
    if (orderPhase(o) === "ready") moveCardToReady(o); // fully ready → slide its card over
    else { // (defensive) still cooking somehow → just refresh this one card in place
      const card = document.querySelector(`.ticket[data-ticket="${o.id}"]`);
      if (card) { const html = ticketHtml(o); const tmp = document.createElement("div"); tmp.innerHTML = html; const fresh = tmp.firstElementChild; if (fresh) { fresh.__kdsHtml = html; card.replaceWith(fresh); } }
    }
  }
  api("POST", `/orders/${orderId}/ready`).then(() => {
    scheduleReadyReconcile();
    // Offer a takeback only when we captured per-dish rows to revert (session
    // orders); legacy JSON-item orders have no per-dish id, so we skip the bar there.
    if (snap.length && window.LFH_UNDO) {
      LFH_UNDO.show({
        message: "All dishes marked ready",
        sub: o ? `Table ${o.table_number} · ${snap.length} dish${snap.length > 1 ? "es" : ""}` : `${snap.length} dishes`,
        icon: "🔥",
        onUndo: () => undoReady(snap, orderId),
      });
    }
  }).catch((e) => { toast("Failed: " + e.message); load(); });
}

// Manual REPRINT (owner 2026-07-07): re-run the KOT print for ONE order's current dishes on
// demand — the safety net for a print-first kitchen when the printer jammed / ran out of paper
// during the automatic print. It calls printKot directly (a local, no-network action), so it
// does NOT touch the auto-print tracking (printedIds) and can be tapped as many times as needed.
function reprintOrder(id) {
  const o = (state.orders || []).find((x) => x.id === id);
  if (!o) { toast("That order isn't on the board any more."); return; }
  const rows = (state.items || []).filter((it) => it.order_id === id); // empty for legacy orders → printKot falls back to o.items
  printKot(o, rows, state.restaurant);
  toast(`Reprinting KOT #${o.kot_no ?? "—"} · Table ${o.table_number}`);
}

// ── the 86 board (sold-out toggles) ──────────────────────────────────────────
function renderDishes() {
  // Trim so a stray space / spaces-only search isn't treated as a real query that matches
  // nothing (it used to blank the whole drawer).
  const q = ($("#dishSearch").value || "").trim().toLowerCase();
  const list = state.dishes.filter((d) => !q || (d.title || "").toLowerCase().includes(q));
  const rows = list.map((d) => {
    const out = (d.tags || []).includes("sold-out");
    return `<div class="dish-row ${out ? "is-out" : ""}">
      <span class="dtitle">${esc(d.title)}<small>${esc(d.category || "")}</small></span>
      <button class="btn ${out ? "danger" : ""}" data-86="${esc(d.id)}" data-out="${out ? "1" : "0"}">${out ? "SOLD OUT" : "available"}</button>
    </div>`;
  }).join("");
  // Never show a blank drawer: an empty result gets an honest message (a cook who mistypes
  // couldn't tell if the board broke), otherwise nothing seeded yet.
  const html = rows || `<div class="dish-row" style="justify-content:center;opacity:.65;pointer-events:none">${q ? `No dishes match “${esc(q)}”` : "No dishes on the menu yet"}</div>`;
  // Skip the rebuild when nothing changed (audit 2026-07-07): a poll while the drawer is
  // open used to blow away #dishList on EVERY refresh, which (a) lost the search box's focus/
  // caret mid-type and (b) orphaned the button node the optimistic toggle + UNDO closure hold,
  // so an UNDO landed on a detached node and the on-screen button kept showing the wrong label.
  if ($("#dishList").__kdsHtml === html) return;
  $("#dishList").innerHTML = html;
  $("#dishList").__kdsHtml = html;
  // OPTIMISTIC sold-out toggle (audit polish 2026-07-07): flip the button + the local
  // dish tag INSTANTLY (no ~1.5s dead window), disable to swallow a rapid double-tap, and
  // roll back on failure. No full load() per tap — the server POST fires the guest 86-sync
  // breadcrumb itself, and the kitchen tickets don't render sold-out, so a whole-board
  // refetch was pure waste. Mirrors the ticket-✓ optimistic+surgical pattern.
  // set86 works by dish ID and RE-QUERIES the on-screen button every time (audit 2026-07-07):
  // renderDishes can rebuild #dishList between the tap and the UNDO, so a captured button node
  // may be detached. Updating the local dish tag is independent of the DOM, so it still happens
  // even if the button isn't currently visible (e.g. filtered out by the search box).
  const set86 = (id, out) => {
    const dish = state.dishes.find((d) => d.id === id);
    if (dish) { const tags = new Set(dish.tags || []); out ? tags.add("sold-out") : tags.delete("sold-out"); dish.tags = [...tags]; }
    const btn = document.querySelector(`[data-86="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`);
    if (!btn) return;
    btn.dataset.out = out ? "1" : "0";
    btn.textContent = out ? "SOLD OUT" : "available";
    btn.classList.toggle("danger", out);
    btn.closest(".dish-row")?.classList.toggle("is-out", out);
  };
  document.querySelectorAll("[data-86]").forEach((b) => (b.onclick = async () => {
    if (b.disabled) return;
    const id = b.dataset["86"], wasOut = b.dataset.out === "1", nowOut = !wasOut;
    b.disabled = true; set86(id, nowOut);
    try {
      await api("POST", `/dishes/${id}/sold-out`, { value: nowOut });
      const dish = state.dishes.find((d) => d.id === id);
      // No confirm — kitchens move fast — but always an UNDO escape hatch, now the shared
      // ring-card bar (owner, 2026-07-22). The UNDO targets the dish by ID (re-querying the
      // live button), so it works even after a background refresh rebuilt the list. The
      // server toggle is an explicit set, so a double-tap is harmless.
      const undo86 = async () => {
        set86(id, wasOut);
        try { await api("POST", `/dishes/${id}/sold-out`, { value: wasOut }); }
        catch (e) { set86(id, nowOut); toast("Undo failed: " + e.message); }
      };
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: `${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked sold out"}`,
        sub: "Tap undo to change it back",
        icon: "🚫",
        onUndo: undo86,
      });
      else toast(`${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked SOLD OUT"}`, undo86);
    } catch (e) {
      set86(id, wasOut); // roll back the optimistic flip
      toast("Failed: " + e.message);
    } finally { b.disabled = false; }
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
    (d.platform || []).map(stableRow),
    d.platformAccept,
    // autoPrintKot drives whether the per-ticket 🖨 reprint button renders, so a change to it
    // must flip the signature and force a repaint (read from state — it's not on every caller's d).
    state.autoPrintKot,
  ]);
}
let lastSig = null;
// ── the poll ─────────────────────────────────────────────────────────────────
// Rising-ticket guard: act() taps, the 86-board undo, the realtime onEvent and the
// backup timer all call load() independently. Without this, whichever fetch FINISHES
// last wins — even an older snapshot — flashing a stale board. Drop any response
// that a newer load() has already superseded.
let loadSeq = 0;
// The restaurant's display name for the header: prefer the short brand label
// (logo_text), else the English name, else any translation, else a neutral
// fallback. Renders "" while nothing is loaded yet — never "undefined". NEVER a
// hardcoded brand (this app is multi-tenant).
function restDisplayName(r) {
  if (!r) return "";
  if (r.logo_text && String(r.logo_text).trim()) return String(r.logo_text).trim();
  const n = r.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  if (n && typeof n === "object") {
    if (n.en && String(n.en).trim()) return String(n.en).trim();
    const any = Object.values(n).find((v) => v && String(v).trim());
    if (any) return String(any).trim();
  }
  return "Restaurant";
}
function setRestName(r) {
  const el = document.getElementById("restName");
  // Strip the *accent* wordmark markers so a literal '*' never shows in the
  // header (matches lib/brandText stripBrandMarkers; see tablet setRestName).
  if (el) el.textContent = restDisplayName(r).replace(/\*/g, "");
}

// loadTables(tables): TARGETED refetch — fetch ONLY the named tables' orders+items
// (/board?table=N) and merge each table's rows into the cached board, instead of re-reading
// the WHOLE board on every breadcrumb. Dishes/platform are table-agnostic (a platform/menu
// event always arrives as `full`), so a targeted pass leaves them untouched. The merge drops
// the changed orders' old rows by id and adds the fresh ones; then it runs the SAME
// boardSig/render + chime path as load(). ANY surprise → full load() (safe fallback).
// (owner 2026-06-26 — 96%+ of egress was whole-board reads; this scopes it.)
async function loadTables(tables) {
  if (!tables || !tables.length) return load();
  if (!state.knownIds) return load(); // not baselined yet — let load() set it (and never chime on first paint)
  const seq = ++loadSeq;
  let slices;
  try {
    slices = await Promise.all(tables.map((t) => api("GET", "/board?table=" + encodeURIComponent(t))));
  } catch (e) { return load(); }      // network/parse blip → safe full reload
  // NOTE: the latest-wins `seq` guard used to sit HERE and `return` — which silently
  // dropped a superseded targeted refetch BEFORE it printed/chimed/merged, so a rush
  // (two new-order breadcrumbs on different tables >200ms apart, or a concurrent full
  // load()) could lose a KOT entirely until the 60s backstop (bug H6, 2026-07-05). The
  // side-effects (print/chime/knownIds) and the state MERGE are idempotent (dedup by
  // id, knownIds prevents a double-print), so we now always apply them and gate only
  // the final render() on staleness — the newer refresh paints the merged-in board.

  // Defensive dedup by row id (fresh row wins over a stale cached copy). The drop/add below
  // keys orders by id and items by order_id; this guarantees a row can never appear twice
  // even if a shift left a row's table_number disagreeing between cache and server.
  const dedupeById = (arr) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return [...m.values()]; };

  const freshOrders = dedupeById(slices.flatMap((s) => (s && s.orders) || []));
  const freshItems = dedupeById(slices.flatMap((s) => (s && s.items) || []));

  // CHIME — detect a brand-new dine-in order in the slice BEFORE touching
  // knownIds, then ADD each fresh order's id to the baseline (never reassign it — a
  // reassign would make the next targeted event for a DIFFERENT table false-chime its
  // existing orders as "new"). Platform tickets only arrive on the FULL path (load()).
  // Rings for 'received' (awaiting accept) AND for a GUEST order born 'preparing'
  // (member_id set) — follow-up orders auto-accept since mig 164, so they'd otherwise
  // land on the pass silently. Waiter orders (member_id null) stay chime-free: the
  // waiter is standing at the table. An accepted first order can't double-chime — its
  // id entered knownIds while it was still 'received'.
  const newReceived = freshOrders.filter((o) => (o.status === "received" || (o.status === "preparing" && o.member_id)) && !state.knownIds.has(o.id));
  if (newReceived.length) chime();
  // Auto-print via the shared helper (printedIds-tracked, hidden-tab-safe, serialized).
  autoPrintNew(state.autoPrintKot, freshOrders, freshItems, state.restaurant);
  for (const o of freshOrders) state.knownIds.add(o.id);

  // The set of orders the changed tables used to show (cached) PLUS the orders the slice
  // returned — drop ALL of these from the cached items, then add the slice's fresh items.
  // Keying items by order_id (not session_id) handles today's closed-session items too.
  const changedTables = new Set(tables.map(String));
  const purgedOrderIds = new Set(freshOrders.map((o) => o.id));
  for (const o of (state.orders || [])) if (changedTables.has(String(o.table_number))) purgedOrderIds.add(o.id);

  // ORDERS — drop the changed tables' old rows, add their fresh rows, keep the rest.
  let orders = (state.orders || []).filter((o) => !changedTables.has(String(o.table_number)));
  orders = dedupeById(orders.concat(freshOrders));
  orders.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))); // ascending, same as liveOrdersAndItems
  // Re-apply the LEGACY-order optimistic overlay (see load()) so a just-ALL-READY'd legacy
  // order (dishes in orders[].items, no order_items rows) doesn't revert to cooking on a
  // targeted refetch that landed before the server caught up.
  state.orders = pendingReadyOrders.size
    ? orders.map((o) => (pendingReadyOrders.has(o.id) && Array.isArray(o.items)
        ? { ...o, items: o.items.map((i) => (i.status !== "served" ? { ...i, status: "ready" } : i)) }
        : o))
    : orders;

  // ITEMS — drop every item belonging to a purged order, add the slice's fresh items.
  // Re-apply the pendingReady overlay exactly like load() so a mid-rush ✓ doesn't flicker.
  let items = (state.items || []).filter((it) => !purgedOrderIds.has(it.order_id));
  items = dedupeById(items.concat(freshItems));
  state.items = pendingReady.size
    ? items.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i))
    : items;

  // If the 86-board drawer is open, keep it fresh (dishes are unchanged on a targeted pass,
  // but a re-render is cheap and harmless).
  if (!$("#drawerOverlay").hidden) renderDishes();
  // Latest-wins guard, moved to gate ONLY the render (state + prints already applied
  // above so nothing is lost): if a newer refresh started, let IT paint the board.
  if (seq !== loadSeq) return;
  const sig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  if (sig === lastSig) return; // nothing visible changed — don't rebuild the tickets
  lastSig = sig;
  render();
}

// Auto-print a KOT (kitchen order ticket) for a brand-new order. Uses a HIDDEN IFRAME (not a
// popup) so no popup-blocker prompt fires; on a kitchen device launched in Chrome "kiosk
// printing" mode it prints silently to the default printer. Default OFF — only runs when the
// admin allowed it AND the owner toggled it on (board.autoPrintKot). Printer-agnostic compact
// layout (works on an 80mm thermal roll or A4). NO prices — a KOT is for the kitchen, not a bill.
function printKot(order, itemRows, restaurant) {
  try {
    const rname = restDisplayName(restaurant).replace(/\*/g, "") || "Kitchen";
    const tnum = order.table_number != null ? order.table_number : "?";
    const kot = order.kot_no != null ? order.kot_no : "—";
    const when = order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const rows = (itemRows && itemRows.length)
      ? itemRows
      : (Array.isArray(order.items) ? order.items : []);
    const linesHtml = rows.map((r) => {
      const q = r.qty || 1;
      const opts = Array.isArray(r.options) ? r.options.map((o) => (typeof o === "string" ? o : (o && o.label) || "")).filter(Boolean).join(", ") : "";
      const rem = Array.isArray(r.removed) ? r.removed.filter(Boolean).join(", ") : "";
      const note = r.note ? String(r.note) : "";
      return `<div class="kl"><span class="q">${q}×</span><span class="n">${esc(r.title || "")}${opts ? ` <i>(${esc(opts)})</i>` : ""}${rem ? ` <i>— no ${esc(rem)}</i>` : ""}${note ? `<br><small>&raquo; ${esc(note)}</small>` : ""}</span></div>`;
    }).join("");
    const allerg = Array.isArray(order.allergies) && order.allergies.length ? `<div class="al">⚠ AVOID: ${esc(order.allergies.join(", "))}</div>` : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>KOT ${esc(String(kot))}</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:ui-monospace,monospace;width:280px;padding:8px;color:#000}
      .h{text-align:center;font-weight:700;font-size:15px;border-bottom:2px dashed #000;padding-bottom:6px;margin-bottom:6px}
      .meta{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:4px}
      .kl{font-size:14px;padding:4px 0;border-bottom:1px dotted #999}.kl .q{font-weight:700;margin-right:6px}.kl i{font-style:italic;color:#333;font-size:12px}
      .al{margin-top:8px;font-weight:700;font-size:13px;border:1px solid #000;padding:4px}
      /* Thermal-roll print recipe — VALIDATED offline through the real CUPS+ESC/POS
         driver chain (2026-07-21). margin:0 kills the browser header/footer junk; NO
         @page size override (a forced short page is landscape-shaped → CUPS rotates it
         sideways, and a mismatched size gets bottom-anchored → 20cm blank lead-in);
         content ≤66mm CENTERED because the 80mm head only prints ~70mm, ~5mm in from
         the left paper edge — a full-width body loses the right ~8mm of every line.
         The cutter is driven by the QUEUE (CutMedia=EndOfJob, after the end feed). */
      @page{margin:0}
      @media print{body{margin:0 !important;padding:2mm 5mm 4mm !important}
        .kl,.meta,.al{break-inside:avoid;page-break-inside:avoid}}
    </style></head><body>
      <div class="h">${esc(rname)}<br>KITCHEN TICKET</div>
      <div class="meta"><span>KOT #${esc(String(kot))}</span><span>Table ${esc(String(tnum))}</span></div>
      <div class="meta"><span>${esc(when)}</span></div>
      ${linesHtml || "<div>(no items)</div>"}
      ${allerg}
    </body></html>`;
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(ifr);
    const d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
    // Remove the hidden print frame only AFTER the browser signals it finished printing.
    // The old blind 1500ms timer often deleted the frame while Chrome's print preview was
    // still open, dropping Chrome's internal print callback ("The provided callback is no
    // longer runnable" — logged as a red client_error). onafterprint fires in both silent/
    // kiosk and preview modes; the long fallback covers a preview the user just walks away from.
    setTimeout(() => {
      const w = ifr.contentWindow;
      let done = false;
      const cleanup = () => { if (done) return; done = true; try { ifr.remove(); } catch (e) {} };
      try { w.onafterprint = cleanup; } catch (e) {}
      try { w.focus(); w.print(); } catch (e) {}
      setTimeout(cleanup, 60000);
    }, 250);
  } catch (e) { /* printing must NEVER break the board */ }
}

// Auto-print the KOT for brand-new received orders — the ONE place both load() and
// loadTables() call so print-tracking is consistent (bug H7, 2026-07-05).
//  • `printedIds` is SEPARATE from `knownIds` (which tracks chime/"seen"). A hidden
//    tab's 60s backstop still advances knownIds, so gating print on knownIds meant a
//    backgrounded tab consumed new orders as "seen" and NEVER printed them. Gating on
//    printedIds instead means an unprinted order stays pending until it actually prints.
//  • While the tab is HIDDEN the browser suppresses iframe printing, so we DON'T print
//    (and DON'T mark printed) — the orders flush on the next visible pass instead of
//    being silently lost, and don't flood all at once.
//  • Prints are SERIALIZED (spaced) so a burst doesn't stack N blocking dialogs at once
//    in a non-kiosk browser (partially mitigates M7; kiosk mode prints silently anyway).
const printedIds = new Set();
// When this panel booted. Used so a brand-new order that arrives DURING the first /board
// fetch (the ~1s boot window) is recognised as genuinely new and still auto-prints — the
// old code seeded EVERY order on first load as "already printed", so a KOT placed in that
// window was silently never printed. KOT print is the kitchen's main use, so this matters.
const BOOT_TS = Date.now();
// Serialized (spaced) printer for a queue of orders — the ONE place that actually prints,
// so print-tracking (printedIds) stays consistent and a burst can't stack N blocking
// dialogs at once in a non-kiosk browser. Paused while the tab is hidden mid-burst.
function printQueue(queue, allItems, restaurant) {
  if (!queue || !queue.length) return;
  let i = 0;
  const step = () => {
    if (document.hidden || i >= queue.length) return; // paused if tab hidden mid-burst
    const o = queue[i++];
    if (!printedIds.has(o.id)) { printedIds.add(o.id); printKot(o, (allItems || []).filter((it) => it.order_id === o.id), restaurant); }
    if (i < queue.length) setTimeout(step, 400);
  };
  step();
}
function autoPrintNew(autoOn, orders, allItems, restaurant) {
  if (!autoOn || document.hidden) return;
  // Print a brand-new order that still needs a KOT — 'received' (guest order awaiting
  // accept) OR 'preparing'. Waiter/tablet orders auto-accept straight to 'preparing'
  // (the waiter already took them), so they never pass through 'received' while the
  // tab is open — filtering to 'received' alone meant a tablet-only restaurant (e.g.
  // Aangan) never auto-printed a single KOT. printedIds guards against a double-print
  // when a guest order later advances received→preparing. Matches the visibilitychange
  // handler below, which already prints both.
  printQueue((orders || []).filter((o) => (o.status === "received" || o.status === "preparing") && !printedIds.has(o.id)), allItems, restaurant);
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.autoPrintKot) return;
    // On becoming visible, print EVERY not-yet-printed order that still needs a ticket —
    // not just those still 'received'. An order that advanced to 'preparing' (accepted by
    // the waiter/manager) WHILE the tab was hidden never had a chance to print (the browser
    // suppresses iframe printing on a hidden tab AND autoPrintNew only looks at 'received'),
    // so it would be lost. printedIds guards against a double-print. (bug: auto-print skips
    // a KOT accepted while the tab was hidden)
    printQueue((state.orders || []).filter((o) => (o.status === "received" || o.status === "preparing") && !printedIds.has(o.id)), state.items || [], state.restaurant);
  });
  // When the offline outbox drains on reconnect, snap the board to server truth at once
  // (a replayed action could have been rejected → the optimistic tile would otherwise stay
  // wrong until the 60s backstop). outbox.js dispatches this after a flush. (audit 2026-07-07)
  window.addEventListener("lfh:outbox-flushed", () => { if (!document.hidden) load().catch(() => {}); });
}

async function load() {
  const seq = ++loadSeq;
  const data = await api("GET", "/board");
  if (seq !== loadSeq) return; // a newer refresh started — drop this stale response
  // Chime only for orders we have NEVER seen (not on the very first load) — dine-in
  // 'received', a GUEST order born 'preparing' (auto-accepted follow-up, mig 164 —
  // member_id set; waiter orders have member_id null and stay silent), OR a
  // brand-new platform order.
  const ids = new Set([...data.orders.map((o) => o.id), ...((data.platform || []).map((p) => p.id))]);
  if (state.knownIds) {
    const newReceived = data.orders.filter((o) => (o.status === "received" || (o.status === "preparing" && o.member_id)) && !state.knownIds.has(o.id));
    const freshPlat = (data.platform || []).some((p) => p.status === "new" && !state.knownIds.has(p.id));
    if (newReceived.length || freshPlat) chime();
    // Auto-print via the shared helper (printedIds-tracked, hidden-tab-safe, serialized)
    // — never prints the existing board on first open (knownIds is set only after) and
    // never double-prints (printedIds).
    autoPrintNew(!!data.autoPrintKot, data.orders, data.items, data.restaurant);
  } else {
    // FIRST load (no baseline yet): treat orders that already existed BEFORE this panel
    // opened as already handled, so we never retro-print the existing board. But an order
    // that arrived DURING the boot fetch (created at/after BOOT_TS) is genuinely new and, as
    // KOT print is the main use, it MUST still print — the old code seeded EVERY order as
    // printed, so an order placed in the ~1s boot window was silently never printed.
    // Invalid/missing created_at is treated as pre-existing (seeded) so a bad timestamp can
    // never spew an old ticket. (audit 2026-07-07)
    for (const o of data.orders) {
      const t = new Date(o.created_at).getTime();
      if (!Number.isFinite(t) || t < BOOT_TS) printedIds.add(o.id);
    }
    // Print any order that landed during boot (created after BOOT_TS, still 'received' and
    // not seeded above). Safe: printedIds guards against a double-print on the next pass.
    autoPrintNew(!!data.autoPrintKot, data.orders, data.items, data.restaurant);
  }
  state.autoPrintKot = !!data.autoPrintKot;
  state.restaurant = data.restaurant || null;
  state.knownIds = ids;
  // Bound printedIds on a long (24/7 wall-display) service: an order that has LEFT the board
  // (served/cancelled) can never reappear as a new 'received', so forgetting it can't cause a
  // reprint — this stops the Set growing forever. Only prune the ones no longer on the board.
  // (knownIds is already replaced with the current board `ids` each full load, so it's bounded.)
  if (printedIds.size > 500) { for (const id of printedIds) if (!ids.has(id)) printedIds.delete(id); }
  state.dishes = data.dishes;
  // Re-apply the LEGACY-order optimistic overlay so a just-ALL-READY'd legacy order (dishes
  // in orders[].items, no order_items rows) doesn't revert to cooking when this refetch
  // replaces state.orders before the server caught up. (pendingReady below only covers the
  // order_items rows in state.items — legacy items have no id, so they need this order-keyed
  // overlay too.) Cleared by the reconcile once the rush settles.
  state.orders = pendingReadyOrders.size
    ? data.orders.map((o) => (pendingReadyOrders.has(o.id) && Array.isArray(o.items)
        ? { ...o, items: o.items.map((i) => (i.status !== "served" ? { ...i, status: "ready" } : i)) }
        : o))
    : data.orders;
  state.platform = data.platform || []; state.platformAccept = !!data.platformAccept;
  // Show WHICH restaurant this panel is scoped to (multi-tenant). Set here in load()
  // — NOT in render() — because render() is skipped when the board signature is
  // unchanged, and the name must still appear on the very first load.
  setRestName(data.restaurant);
  // Keep dishes the cook JUST tapped ready showing ready, even if this refetch landed
  // before the server caught up (cleared by the reconcile once the rush settles).
  state.items = pendingReady.size
    ? data.items.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i))
    : data.items;
  // If the 86-board drawer is open, keep it fresh regardless (its own render).
  if (!$("#drawerOverlay").hidden) renderDishes();
  const sig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
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
  if (!state.muted) primeAudio(); // unmuting IS a gesture — unlock audio + re-check the nudge
  updateSoundNudge();
};
// 86-board drawer. open/close are wrapped so the phone's BACK button closes the
// drawer (via LFH_BACK) instead of leaving the kitchen panel.
let drawerOff = null;
function openDrawer() {
  $("#drawerOverlay").hidden = false; renderDishes();
  drawerOff = window.LFH_BACK ? LFH_BACK.layer("86-board", closeDrawer) : null;
}
function closeDrawer() {
  $("#drawerOverlay").hidden = true;
  if (drawerOff) { const off = drawerOff; drawerOff = null; off(); }
}
$("#boardBtn").onclick = openDrawer;
// 🚩 Report an issue (subject + optional photo + live voice note) — shared widget.
{ const _ib = document.getElementById("reportIssueBtn"); if (_ib) _ib.onclick = () => { if (window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m) }); }; }
$("#drawerClose").onclick = closeDrawer;
$("#drawerOverlay").onclick = (e) => { if (e.target.id === "drawerOverlay") closeDrawer(); };
$("#dishSearch").oninput = renderDishes;
// Wall ⇄ Columns toggle (the "expansion"). Persist the choice per device.
$("#viewBtn").onclick = () => { view = view === "wall" ? "columns" : "wall"; localStorage.setItem("kds_view", view); applyView(); };
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);

bindDelegation(); // ONE delegated click handler for all ticket buttons (survives tile patching)
updateSoundNudge(); // show the "enable sound" affordance if this is an untouched wall display
applyView(); // honour the saved layout (sets which <main> shows) before the first paint
load().catch((e) => toast("Can't reach the database: " + e.message));
// Realtime: refetch only when an order/dish actually changes (instant), instead of
// polling every second. A slow 60s timer is the backup if the WebSocket drops.
// If realtime didn't load for any reason, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  // Split by topic: ops churn → TARGETED loadTables() when the breadcrumb names specific
  // tables, else full load() (platform change, wake, reconnect, initial). menu edits
  // (sold-out / dish edits) always do a full load() so the dish lists + 86 board refresh.
  // FULL-reload rate guard (stress test 2026-07-03): breadcrumbs that can't name a table
  // (pay/close/platform…) force a WHOLE-board reload, and a rush hour fires them constantly —
  // one kitchen screen pulled 278MB in 50min re-reading a big board every few seconds. Collapse
  // full reloads to at most one per 4s, TRAILING (a suppressed burst still lands one reload at
  // the window edge — nothing is ever dropped). Targeted per-table refetches stay instant.
  let lastFullAt = 0, fullTimer = null;
  const fullSoon = () => {
    if (fullTimer) return;
    const wait = Math.max(0, lastFullAt + 4000 - Date.now());
    fullTimer = setTimeout(() => { fullTimer = null; lastFullAt = Date.now(); load().catch(() => {}); }, wait);
  };
  LFH_RT.start({ handlers: {
    ops: (detail) => (detail && !detail.full && detail.tables && detail.tables.length) ? loadTables(detail.tables) : fullSoon(),
    menu: () => fullSoon(),
  }});
  // Backup sync — but NOT while the tab is hidden: a backgrounded wall display kept
  // firing a full-board read every 60s forever (egress waste). realtime.js already does
  // a fresh full reload via wake() on re-show, so a hidden tab needs no backstop.
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 60000);
  // If realtime NEVER actually connects (blocked/flaky WebSocket), LFH_RT.start() swallows
  // the subscribe error and only the 60s backstop runs — a new KOT could sit unseen up to
  // 60s (bug M9, 2026-07-05). Engage a 5s catch-up poll UNTIL a subscription lands. Gated on
  // subscribed===0, so the instant realtime works this is a no-op and egress stays low.
  setInterval(() => {
    if (!document.hidden && (!window.LFH_RT.metrics || window.LFH_RT.metrics.subscribed === 0)) load().catch(() => {});
  }, 5000);
} else {
  setInterval(() => load().catch(() => {}), 2000); // fallback poll
}

// ── HIERARCHY X-RAY ribbon (Phase 4, 2026-07-06) ─────────────────────────────
// The kitchen has no permission-gated actions (yet), so this is the "viewed by a
// higher role" marker only: an amber ribbon naming the admin view + Exit. Same
// language as the manager/tablet ribbons; add zones here when kitchen gets gated
// controls. One whoami request at boot — no polling.
(function kitchenXray() {
  const css = `
  #xrayRibbon { display: flex; align-items: center; gap: 12px; padding: 6px 14px;
    background: color-mix(in srgb, #d97706 14%, var(--panel, #101826)); border-bottom: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    font-size: 12px; color: var(--text, #e8eefc); position: relative; z-index: 40; }
  #xrayRibbon .rb-tag { font-weight: 800; letter-spacing: .04em; color: #f59e0b; text-transform: uppercase; font-size: 11px; }
  #xrayRibbon .rb-rest { color: var(--muted, #9fb0cc); font-weight: 600; }
  #xrayRibbon .rb-crumbs { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; flex-wrap: wrap; }
  #xrayRibbon .rb-crumbs a { color: #f59e0b; text-decoration: none; cursor: pointer; }
  #xrayRibbon .rb-crumbs a:hover { text-decoration: underline; }
  #xrayRibbon .rb-sep { font-size: 10px; color: var(--muted, #9fb0cc); }
  #xrayRibbon .rb-spacer { margin-left: auto; }
  #xrayRibbon button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid var(--line, #26324a);
    background: transparent; color: var(--muted, #9fb0cc); font-weight: 700; padding: 4px 12px; }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);

  // Flip this admin-view TAB between the full admin view and the "actual kitchen" view
  // (?view=real). Pure URL state — reloading with/without the param is the whole toggle.
  const setViewReal = (on) => {
    const u = new URL(location.href);
    if (on) u.searchParams.set("view", "real"); else u.searchParams.delete("view");
    location.replace(u.toString());
  };
  api("GET", "/whoami").then((w) => {
    const sim = !!(w && w.simulated); // ACTUAL-VIEW mode: real kitchen render, slim ribbon back
    if (!w || (!w.higherView && !sim)) return;
    const rb = document.createElement("div"); rb.id = "xrayRibbon";
    const who = sim || w.actor === "admin" ? "Admin" : w.actor.charAt(0).toUpperCase() + w.actor.slice(1);
    // ADMIN came from the console → show the PATH (Restaurants › name › Kitchen
    // panel), the owner panel's breadcrumb language (owner, 2026-07-06). Any other
    // higher role keeps the plain name — no console to crumb back to.
    const body = who === "Admin"
      ? `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Restaurants</a>` +
        `<span class="rb-sep">›</span><span id="xrayRest"></span>` +
        `<span class="rb-sep">›</span><span>Kitchen panel</span></nav>`
      : `<span class="rb-rest" id="xrayRest"></span>`;
    // The kitchen has no gated controls, so the "actual view" only drops the admin extras;
    // the toggle still exists on every panel (owner 2026-07-28: one per panel, default off).
    const simBtn = sim
      ? `<button id="xraySimBtn" title="Back to the full admin view">See full admin view</button>`
      : (who === "Admin" && PANEL_RID
        ? `<button id="xraySimBtn" title="Reload this tab showing exactly what the real kitchen screen sees">👁 See actual panel</button>`
        : "");
    rb.innerHTML =
      `<span class="rb-tag">${who} view${sim ? " · as real kitchen" : ""}</span>` +
      body +
      `<span class="rb-spacer"></span>` +
      simBtn +
      `<button id="xrayExit">Exit view</button>`;
    document.body.insertBefore(rb, document.body.firstChild);
    const simB = document.getElementById("xraySimBtn");
    if (simB) simB.onclick = () => setViewReal(!sim);
    const home = document.getElementById("xrayHome");
    if (home) home.onclick = () => {
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
    // The restaurant name lands with the first /board load — mirror it when it does.
    const restEl = document.getElementById("restName");
    if (restEl) {
      const mirror = () => { const t = restEl.textContent || ""; const me = document.getElementById("xrayRest"); if (me && me.textContent !== t) me.textContent = t; };
      mirror();
      new MutationObserver(mirror).observe(restEl, { childList: true, characterData: true, subtree: true });
    }
    document.getElementById("xrayExit").onclick = async () => {
      try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
  }).catch(() => {});
})();
